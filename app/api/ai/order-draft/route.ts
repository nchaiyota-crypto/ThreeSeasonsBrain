import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Initialized inside the handler so env vars are only read at request time, not build time

type AiDraftReq = {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;

  pickupMode: "asap" | "scheduled";
  pickupScheduledAt?: string; // ISO if scheduled

  items: Array<{
    itemId: string;          // your menu item id
    name: string;
    qty: number;
    unitPriceCents: number;  // server will re-check later if you want
    notes?: string;
    options?: Array<{ name: string; priceCents?: number }>;
  }>;
};

export async function POST(req: Request) {
  try {
    const stripe = new Stripe(must("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
    const resend = new Resend(must("RESEND_API_KEY"));

    const body = (await req.json()) as AiDraftReq;

    // Basic validation
    if (!body.customerName?.trim()) return NextResponse.json({ ok: false, error: "Missing customerName" }, { status: 400 });
    if (!body.customerEmail?.trim()) return NextResponse.json({ ok: false, error: "Missing customerEmail" }, { status: 400 });
    if (!Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ ok: false, error: "Missing items" }, { status: 400 });
    if (body.pickupMode === "scheduled" && !body.pickupScheduledAt) {
      return NextResponse.json({ ok: false, error: "Missing pickupScheduledAt for scheduled pickup" }, { status: 400 });
    }

    // TODO (recommended): validate business hours + wait-time rules here
    // - if pickupMode=asap: compute estimated_ready_at from your wait status
    // - if scheduled: validate within allowed window

    const supabase = createClient(
      must("NEXT_PUBLIC_SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY")
    );

    // ---- Calculate totals (simple version; replace with your real fee/tax logic) ----
    const subtotalCents =
      body.items.reduce((sum, it) => {
        const opt = (it.options || []).reduce((s, o) => s + (o.priceCents || 0), 0);
        return sum + (it.unitPriceCents + opt) * it.qty;
      }, 0);

    // Replace these with your real rules
    const TAX_RATE = 0.1075; // Oakland
    const taxCents = Math.round(subtotalCents * TAX_RATE);
    const serviceFeeCents = Math.round(subtotalCents * 0.03); // example
    const totalCents = subtotalCents + taxCents + serviceFeeCents;

    // ---- Create draft order in Supabase ----
    const orderNumber = `A${Math.floor(1000 + Math.random() * 9000)}`; // replace w your sequence if you have one

    const { data: orderRow, error: orderErr } = await supabase
      .from("online_orders")
      .insert({
        order_number: orderNumber,
        status: "draft",
        payment_status: "draft",

        customer_name: body.customerName.trim(),
        customer_email: body.customerEmail.trim(),
        customer_phone: body.customerPhone?.trim() || null,

        pickup_mode: body.pickupMode,
        pickup_scheduled_at: body.pickupMode === "scheduled" ? body.pickupScheduledAt : null,

        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        service_fee_cents: serviceFeeCents,
        total_cents: totalCents,
      })
      .select("*")
      .single();

    if (orderErr || !orderRow) {
      console.error(orderErr);
      return NextResponse.json({ ok: false, error: "Failed to create order" }, { status: 500 });
    }

    const orderId = orderRow.id;

    const itemsToInsert = body.items.map((it) => ({
      order_id: orderId,
      item_id: it.itemId,
      name: it.name,
      qty: it.qty,
      unit_price_cents: it.unitPriceCents,
      options_json: it.options || [],
      notes: it.notes || null,
    }));

    const { error: itemsErr } = await supabase.from("online_order_items").insert(itemsToInsert);
    if (itemsErr) {
      console.error(itemsErr);
      return NextResponse.json({ ok: false, error: "Failed to create order items" }, { status: 500 });
    }

    // ---- Create Stripe Checkout Session ----
    const siteUrl = must("NEXT_PUBLIC_SITE_URL");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: body.customerEmail.trim(),

      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            product_data: {
              name: `3 Seasons Thai Bistro Order #${orderNumber}`,
            },
            unit_amount: totalCents,
          },
        },
      ],

      metadata: {
        order_id: String(orderId),
        order_number: String(orderNumber),
      },

      success_url: `${siteUrl}/checkout/success?oid=${orderId}`,
      cancel_url: `${siteUrl}/checkout/cancel?oid=${orderId}`,
    });

    // Save session id/url onto order (optional but useful)
    await supabase
      .from("online_orders")
      .update({
        stripe_checkout_session_id: session.id,
        stripe_checkout_url: session.url,
      })
      .eq("id", orderId);

    // ---- Email the payment link via Resend ----
    const from = must("RESEND_FROM");
    const link = session.url;

    await resend.emails.send({
      from,
      to: body.customerEmail.trim(),
      subject: `Confirm your 3 Seasons Thai Bistro order #${orderNumber}`,
      html: `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.4">
          <p>Hi ${escapeHtml(body.customerName.trim())},</p>
          <p>Please confirm and pay securely using this link:</p>
          <p><a href="${link}" target="_blank" rel="noreferrer">${link}</a></p>
          <p><b>Pickup:</b> ${body.pickupMode === "asap" ? "ASAP" : escapeHtml(body.pickupScheduledAt || "")}</p>
          <p>After payment, we’ll start cooking.</p>
          <p>— 3 Seasons Thai Bistro</p>
        </div>
      `,
    });

    return NextResponse.json({
      ok: true,
      orderId,
      orderNumber,
      checkoutUrl: session.url,
    });
  } catch (err: any) {
    console.error("order-draft error:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Server error" }, { status: 500 });
  }
}

// tiny helper to avoid broken html
function escapeHtml(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}