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

type IntakeReq = {
  customer_name: string;
  customer_phone?: string;       // used for SMS + KDS display
  customer_email?: string;       // optional — email payment link if provided

  pickup_mode: "asap" | "scheduled";
  pickup_scheduled_at?: string;  // ISO string if scheduled

  payment_choice: "pay_now" | "pay_at_pickup";

  items: Array<{
    menu_item_id?: string;
    name: string;
    qty: number;
    unit_price_cents: number;
    modifiers?: string;          // protein / add-ons summary
    notes?: string;              // special instructions
  }>;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IntakeReq;

    // ── Validation ────────────────────────────────────────────────────────
    if (!body.customer_name?.trim())
      return NextResponse.json({ ok: false, error: "Missing customer_name" }, { status: 400 });
    if (!Array.isArray(body.items) || body.items.length === 0)
      return NextResponse.json({ ok: false, error: "Missing items" }, { status: 400 });
    if (body.payment_choice === "pay_now" && !body.customer_email?.trim())
      return NextResponse.json({ ok: false, error: "customer_email required for pay_now" }, { status: 400 });
    if (body.pickup_mode === "scheduled" && !body.pickup_scheduled_at)
      return NextResponse.json({ ok: false, error: "Missing pickup_scheduled_at" }, { status: 400 });

    const sb = supabaseAdmin();

    // ── Check for 86'd items ───────────────────────────────────────────────
    const { data: outOfStockRows } = await sb.from("menu_86").select("item_id, item_name");
    const outOfStockIds = new Set((outOfStockRows ?? []).map((r: any) => String(r.item_id)));

    const unavailable = body.items.filter(
      (it) => it.menu_item_id && outOfStockIds.has(String(it.menu_item_id))
    );
    if (unavailable.length > 0) {
      const names = unavailable.map((it) => it.name).join(", ");
      return NextResponse.json(
        { ok: false, error: `Sorry, the following item(s) are unavailable: ${names}. Please choose something else.` },
        { status: 422 }
      );
    }

    // ── Totals ────────────────────────────────────────────────────────────
    const subtotal_cents = body.items.reduce((sum, it) => sum + it.unit_price_cents * it.qty, 0);
    const tax_bps    = 1075; // Oakland 10.75%
    const tax_cents  = Math.round((subtotal_cents * tax_bps) / 10000);
    const total_cents = subtotal_cents + tax_cents;

    const payment_status = body.payment_choice === "pay_now" ? "pending" : "needs_payment";

    // ── Create order ──────────────────────────────────────────────────────
    const { data: order, error: orderErr } = await sb
      .from("orders")
      .insert({
        source:       "ai_phone",
        order_type:   "takeout",
        customer_name:  body.customer_name.trim(),
        customer_phone: body.customer_phone?.trim() ?? null,
        customer_email: body.customer_email?.trim() ?? null,
        pickup_scheduled_at: body.pickup_mode === "scheduled" ? body.pickup_scheduled_at : null,
        status:         body.payment_choice === "pay_at_pickup" ? "new" : "new",
        payment_status,
        tax_bps,
        subtotal_cents,
        tax_cents,
        total_cents,
        payment_amount_cents: null,
      })
      .select("*")
      .single();

    if (orderErr || !order) {
      console.error("order insert error:", orderErr);
      return NextResponse.json({ ok: false, error: "Failed to create order" }, { status: 500 });
    }

    // ── Create order items ────────────────────────────────────────────────
    // ✅ Use correct column names: menu_item_name, options_summary, special_instructions
    const itemRows = body.items.map((it) => ({
      order_id:           order.id,
      menu_item_id:       it.menu_item_id ?? null,
      menu_item_name:     it.name,                        // ✅ was "name" (bug)
      qty:                it.qty,
      unit_price_cents:   it.unit_price_cents,
      line_subtotal_cents: it.unit_price_cents * it.qty,
      options_summary:    it.modifiers ?? null,            // ✅ was missing
      special_instructions: it.notes ?? null,             // ✅ was "notes" (bug)
    }));

    const { error: itemsErr } = await sb.from("order_items").insert(itemRows);
    if (itemsErr) {
      console.error("items insert error:", itemsErr);
      await sb.from("orders").update({ status: "error" }).eq("id", order.id);
      return NextResponse.json(
        { ok: false, error: "Order created but items failed. Check order_items columns." },
        { status: 500 }
      );
    }

    // ── pay_at_pickup → create KDS ticket immediately ─────────────────────
    // (pay_now orders get their KDS ticket from the Stripe webhook on payment)
    if (body.payment_choice === "pay_at_pickup") {
      try {
        const { data: ticket, error: kdsErr } = await sb
          .from("kds_tickets")
          .upsert(
            {
              order_id:      order.id,
              order_number:  order.order_number,
              station:       "kitchen",
              status:        "new",
              customer_name:  body.customer_name.trim(),
              customer_phone: body.customer_phone?.trim() ?? null,
            },
            { onConflict: "order_id" }
          )
          .select("id")
          .single();

        if (kdsErr) {
          console.error("KDS ticket error:", kdsErr.message);
        } else if (ticket) {
          // Add ticket items
          const ticketItems = itemRows.map((it) => ({
            kds_ticket_id:     ticket.id,
            display_name:      it.menu_item_name,
            qty:               it.qty,
            modifiers_text:    it.options_summary ?? null,
            instructions_text: it.special_instructions ?? null,
            status:            "new",
          }));
          const { error: tiErr } = await sb.from("kds_ticket_items").insert(ticketItems);
          if (tiErr) console.error("kds_ticket_items error:", tiErr.message);
        }
      } catch (e: any) {
        console.error("KDS creation exception:", e?.message);
      }

      // Send SMS confirmation for pay_at_pickup
      if (body.customer_phone?.trim()) {
        try {
          await sendSMS({
            supabaseUrl: must("NEXT_PUBLIC_SUPABASE_URL"),
            supabaseKey:  must("SUPABASE_SERVICE_ROLE_KEY"),
            to:    body.customer_phone.trim(),
            body:  `Hi ${body.customer_name.trim()}! ✅ Order #${order.order_number} confirmed at 3 Seasons Thai Bistro. Pay at pickup. We'll text when ready! 🍜`,
          });
        } catch (e: any) {
          console.error("SMS error:", e?.message);
        }
      }
    }

    // ── pay_now → create Stripe checkout + email link ─────────────────────
    let checkoutUrl: string | null = null;

    if (body.payment_choice === "pay_now") {
      const stripe   = new Stripe(must("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
      const resend   = new Resend(must("RESEND_API_KEY"));
      const siteUrl  = must("NEXT_PUBLIC_SITE_URL");
      const email    = body.customer_email!.trim();

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        line_items: body.items.map((it) => ({
          quantity: it.qty,
          price_data: {
            currency: "usd",
            unit_amount: it.unit_price_cents,
            product_data: { name: it.name },
          },
        })),
        metadata: {
          order_id:     String(order.id),
          order_number: String(order.order_number ?? ""),
          source:       "ai_phone",
        },
        // ✅ Copy orderId into the Payment Intent metadata too,
        // so payment_intent.succeeded webhook can find the order.
        payment_intent_data: {
          metadata: {
            orderId:      String(order.id),
            order_number: String(order.order_number ?? ""),
            source:       "ai_phone",
          },
        },
        success_url: `${siteUrl}/checkout/success?oid=${order.id}`,
        cancel_url:  `${siteUrl}/checkout/cancel?oid=${order.id}`,
      });

      checkoutUrl = session.url ?? null;

      await sb.from("orders").update({
        stripe_checkout_session_id: session.id,
        stripe_checkout_url: checkoutUrl,
      } as any).eq("id", order.id);

      // ✅ Use RESEND_FROM_EMAIL — consistent with send-order-email edge function
      const from = must("RESEND_FROM_EMAIL");
      await resend.emails.send({
        from,
        to: email,
        subject: `Pay for your 3 Seasons order #${order.order_number ?? ""}`,
        html: `
          <div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;max-width:480px">
            <h2 style="color:#d97706">3 Seasons Thai Bistro</h2>
            <p>Hi ${escapeHtml(body.customer_name.trim())},</p>
            <p>Your order is ready to be confirmed! Please pay securely using the link below:</p>
            <p style="margin:20px 0">
              <a href="${checkoutUrl}" style="background:#d97706;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
                Pay Now — $${(total_cents / 100).toFixed(2)}
              </a>
            </p>
            <p><strong>Pickup:</strong> ${body.pickup_mode === "asap" ? "ASAP" : escapeHtml(body.pickup_scheduled_at || "")}</p>
            <p style="color:#888;font-size:14px">— 3 Seasons Thai Bistro</p>
          </div>
        `,
      });

      // Also SMS payment link if phone provided
      if (body.customer_phone?.trim()) {
        try {
          await sendSMS({
            supabaseUrl: must("NEXT_PUBLIC_SUPABASE_URL"),
            supabaseKey:  must("SUPABASE_SERVICE_ROLE_KEY"),
            to:    body.customer_phone.trim(),
            body:  `Hi ${body.customer_name.trim()}! Your 3 Seasons order #${order.order_number} is ready to pay: ${checkoutUrl}`,
          });
        } catch (e: any) {
          console.error("SMS error:", e?.message);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      order_id:       order.id,
      order_number:   order.order_number,
      payment_status: order.payment_status,
      checkout_url:   checkoutUrl,
    });

  } catch (err: any) {
    console.error("order-intake error:", err);
    return NextResponse.json({ ok: false, error: err?.message || "Server error" }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function escapeHtml(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// Calls the sms-order-event Supabase edge function to send SMS via Twilio
async function sendSMS({ supabaseUrl, supabaseKey, to, body }: {
  supabaseUrl: string;
  supabaseKey: string;
  to: string;
  body: string;
}) {
  const url = `${supabaseUrl}/functions/v1/sms-order-event`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({ directSend: true, to, message: body }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SMS edge function error: ${txt}`);
  }
}
