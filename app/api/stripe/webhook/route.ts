import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const stripe = new Stripe(must("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });

export async function POST(req: Request) {
  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });

    // IMPORTANT: raw body
    const rawBody = await req.text();

    const event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      must("STRIPE_WEBHOOK_SECRET")
    );

    // Use service role (server only)
    const supabase = createClient(
      must("NEXT_PUBLIC_SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;

      const orderId = String(pi.metadata?.orderId || "");
      if (!orderId) {
        // If you ever forget metadata, fallback could be: lookup by stripe_payment_intent_id
        return NextResponse.json({ error: "Missing orderId in metadata" }, { status: 400 });
      }

      const tipCents = Number(pi.metadata?.tip_cents ?? 0);
      const amount = Number(pi.amount ?? 0);
      const baseAmount = Number(pi.metadata?.base_amount_cents ?? (amount - tipCents));

      // 1) Mark order as paid
      const { error: updErr } = await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          status: "paid",                // ✅ allowed by constraint
          total_cents: baseAmount, // ✅ optional, see note below
          tip_cents: tipCents,
          paid_at: new Date().toISOString(),
          stripe_payment_intent_id: pi.id, // ✅ if you have this column (recommended)
        })    
        .eq("id", orderId);

      if (updErr) {
        return NextResponse.json({ error: "Failed to update order", details: updErr.message }, { status: 500 });
      }

      const { data: orderMeta, error: orderMetaErr } = await supabase
        .from("orders")
        .select("order_number")
        .eq("id", orderId)
        .single();

      if (orderMetaErr) {
        console.error("❌ Could not fetch orders.order_number:", orderMetaErr.message);
      }
      const orderNumber = Number(orderMeta?.order_number ?? pi.metadata?.order_number ?? 0);

      // 2) Create KDS ticket + items (match real schema)
      try {
        // A) Create (or upsert) the ticket
        const { data: ticket, error: kdsErr } = await supabase
          .from("kds_tickets")
          .insert({
            order_id: orderId,
            station: "kitchen",
            status: "new",
            order_number: orderNumber,
          })
          .select("id")
          .single();

        if (kdsErr) {
          console.error("❌ KDS ticket insert failed:", kdsErr.message);
        } else {
        // B) Load order items from public.order_items (so we have order_item_id)
        const { data: orderItems, error: oiErr } = await supabase
          .from("order_items")
          .select("*") // adjust column names if yours differ
          .eq("order_id", orderId)
          .order("created_at", { ascending: true });

        if (oiErr) {
          console.error("❌ Could not load public.order_items:", oiErr.message);
        } else {
          const ticketItems = (orderItems ?? []).map((it: any) => ({
            kds_ticket_id: ticket.id,              // ✅ correct FK
            order_item_id: it.id,                  // ✅ NOT NULL REQUIRED
            display_name: String(it.menu_item_name ?? "Item"),
            qty: Number(it.qty ?? 1),
            modifiers_text: null,
            instructions_text: it.special_instructions ? String(it.special_instructions) : null,
            status: "new",
          }));

          if (ticketItems.length > 0) {
            const { error: itemsErr } = await supabase
              .from("kds_ticket_items")
              .insert(ticketItems);

            if (itemsErr) console.error("❌ kds_ticket_items insert failed:", itemsErr.message);
          } else {
            console.warn("⚠️ order_items empty — no ticket items inserted");
          }
        }
        }
      } catch (err: any) {
        console.error("❌ KDS insert exception:", err?.message ?? err);
      }
      return NextResponse.json({ received: true });

    }

    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const orderId = String(pi.metadata?.orderId || "");
      if (orderId) {
        await supabase
          .from("orders")
          .update({ payment_status: "failed", status: "voided" })
          .eq("id", orderId);
      }
      return NextResponse.json({ received: true });
    }

    return NextResponse.json({ received: true });
  } catch (e: any) {
    console.error("❌ Webhook handler failed:", e);
    return NextResponse.json({ error: e?.message ?? "Webhook error" }, { status: 500 });
  }
}