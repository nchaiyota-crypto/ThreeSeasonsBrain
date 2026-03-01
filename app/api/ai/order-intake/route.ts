import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { Resend } from "resend";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const supabaseAdmin = () =>
  createClient(must("NEXT_PUBLIC_SUPABASE_URL"), must("SUPABASE_SERVICE_ROLE_KEY"));

const stripe = new Stripe(must("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
const resend = new Resend(must("RESEND_API_KEY"));

type IntakeReq = {
  customer_name: string;
  customer_email: string;

  pickup_mode: "asap" | "scheduled";
  pickup_scheduled_at?: string; // ISO string if scheduled

  payment_choice: "pay_now" | "pay_at_pickup";

  items: Array<{
    menu_item_id?: string;     // if you have it
    name: string;
    qty: number;
    unit_price_cents: number;
    notes?: string;
  }>;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IntakeReq;

    if (!body.customer_name?.trim()) {
      return NextResponse.json({ ok: false, error: "Missing customer_name" }, { status: 400 });
    }
    if (!body.customer_email?.trim()) {
      return NextResponse.json({ ok: false, error: "Missing customer_email" }, { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ ok: false, error: "Missing items" }, { status: 400 });
    }

    // ---- check for 86'd (out of stock) items ----
    const { data: outOfStockRows } = await supabaseAdmin()
      .from("menu_86")
      .select("item_id, item_name");
    const outOfStockIds = new Set((outOfStockRows ?? []).map((r: any) => String(r.item_id)));

    const unavailableItems = body.items.filter(
      (it) => it.menu_item_id && outOfStockIds.has(String(it.menu_item_id))
    );
    if (unavailableItems.length > 0) {
      const names = unavailableItems.map((it) => it.name).join(", ");
      return NextResponse.json(
        { ok: false, error: `Sorry, the following item(s) are currently unavailable: ${names}. Please remove them and try again.` },
        { status: 422 }
      );
    }
    if (body.pickup_mode === "scheduled" && !body.pickup_scheduled_at) {
      return NextResponse.json({ ok: false, error: "Missing pickup_scheduled_at" }, { status: 400 });
    }

    // ---- totals (use your current rules; these match your columns) ----
    const subtotal_cents = body.items.reduce(
      (sum, it) => sum + it.unit_price_cents * it.qty,
      0
    );

    // your table has tax_bps (basis points). Oakland 10.75% = 1075 bps
    const tax_bps = 1075;
    const tax_cents = Math.round((subtotal_cents * tax_bps) / 10000);
    const total_cents = subtotal_cents + tax_cents;

    const payment_status =
      body.payment_choice === "pay_now" ? "pending" : "needs_payment";

    const sb = supabaseAdmin();

    // ---- create order (public.orders) ----
    const { data: order, error: orderErr } = await sb
      .from("orders")
      .insert({
        source: "ai_phone",
        order_type: "takeout",

        customer_name: body.customer_name.trim(),
        customer_email: body.customer_email.trim(),

        pickup_scheduled_at:
          body.pickup_mode === "scheduled" ? body.pickup_scheduled_at : null,

        status: "new",
        payment_status,

        tax_bps,
        subtotal_cents,
        tax_cents,
        total_cents,

        // payment_amount_cents set to null at creation; filled in when payment is confirmed
        payment_amount_cents: null,
      })
      .select("*")
      .single();

    if (orderErr || !order) {
      console.error("order insert error:", orderErr);
      return NextResponse.json({ ok: false, error: "Failed to create order" }, { status: 500 });
    }

    // ---- create items (public.order_items) ----
    // IMPORTANT: adjust keys here if your order_items table uses different column names.
    const itemsRows = body.items.map((it) => ({
      order_id: order.id,
      menu_item_id: it.menu_item_id ?? null,
      name: it.name,
      qty: it.qty,
      unit_price_cents: it.unit_price_cents,
      notes: it.notes ?? null,
    }));

    const { error: itemsErr } = await sb.from("order_items").insert(itemsRows);
    if (itemsErr) {
      console.error("items insert error:", itemsErr);

      // keep the order (so staff can see it), but mark it as error
      await sb.from("orders").update({ status: "error" }).eq("id", order.id);

      return NextResponse.json(
        { ok: false, error: "Order created, but items insert failed. Check order_items columns." },
        { status: 500 }
      );
    }

    // ---- if pay_now: create Stripe session + email link ----
    let checkoutUrl: string | null = null;

    if (body.payment_choice === "pay_now") {
      const siteUrl = must("NEXT_PUBLIC_SITE_URL");

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: body.customer_email.trim(),
        line_items: body.items.map((it) => ({
          quantity: it.qty,
          price_data: {
            currency: "usd",
            unit_amount: it.unit_price_cents,
            product_data: { name: it.name },
          },
        })),
        metadata: {
          order_id: String(order.id),
          order_number: String(order.order_number ?? ""),
          source: "ai_phone",
        },
        success_url: `${siteUrl}/checkout/success?oid=${order.id}`,
        cancel_url: `${siteUrl}/checkout/cancel?oid=${order.id}`,
      });

      checkoutUrl = session.url || null;

      // store on order if you have these columns; if not, remove this update
      await sb
        .from("orders")
        .update({
          // if these columns don't exist, comment them out:
          stripe_checkout_session_id: session.id,
          stripe_checkout_url: checkoutUrl,
        } as any)
        .eq("id", order.id);

      // email it
      const from = must("RESEND_FROM");

      const emailRes = await resend.emails.send({
        from,
        to: body.customer_email.trim(),
        subject: `Confirm your 3 Seasons order #${order.order_number ?? ""}`,
        html: `
          <div style="font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial; line-height:1.4">
            <p>Hi ${escapeHtml(body.customer_name.trim())},</p>
            <p>Please confirm and pay securely using this link:</p>
            <p><a href="${checkoutUrl}" target="_blank" rel="noreferrer">${checkoutUrl}</a></p>
            <p><b>Pickup:</b> ${body.pickup_mode === "asap" ? "ASAP" : escapeHtml(body.pickup_scheduled_at || "")}</p>
            <p>— 3 Seasons Thai Bistro</p>
          </div>
        `,
      });

      if (emailRes.error) {
        console.error("resend error:", emailRes.error);
        // Keep order pending; staff can still see “needs payment”
      }
    }

    return NextResponse.json({
      ok: true,
      order_id: order.id,
      order_number: order.order_number,
      payment_status: order.payment_status,
      checkout_url: checkoutUrl,
    });
  } catch (err: any) {
    console.error("order-intake error:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Server error" }, { status: 500 });
  }
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}