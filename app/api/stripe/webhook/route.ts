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

      const customerName =
        String(
          pi.metadata?.customerName ??
          pi.metadata?.customer_name ??
          pi.shipping?.name ??
          ""
        ).trim() || null;
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
          ...(customerName ? { customer_name: customerName } : {}),
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
      // 2) Create KDS ticket + items
      try {
        // Get fresh order info (source of truth)
        const { data: orderRow, error: orderRowErr } = await supabase
          .from("orders")
          .select("customer_name, customer_phone, order_number")
          .eq("id", orderId)
          .single();

        if (orderRowErr) {
          console.error("❌ Could not load order row for ticket:", orderRowErr.message);
        }

        const safeCustomerName = orderRow?.customer_name ?? customerName ?? null;
        const safeCustomerPhone = orderRow?.customer_phone ?? null;

        console.log("✅ webhook orderId:", orderId);
        console.log("✅ webhook safeCustomer:", { safeCustomerName, safeCustomerPhone });

        // ✅ Upsert ticket so webhook can run twice without duplicates
        const { data: ticket, error: kdsErr } = await supabase
          .from("kds_tickets")
          .upsert(
            {
              order_id: orderId,
              station: "kitchen",
              status: "new",
              customer_name: safeCustomerName,
              customer_phone: safeCustomerPhone,
            },
            { onConflict: "order_id" }
          )
          .select("id, order_id, customer_name, customer_phone")
          .single();

        console.log("✅ webhook ticket row:", ticket);

        if (kdsErr) {
          console.error("❌ KDS ticket upsert failed:", kdsErr.message);
          return NextResponse.json({ received: true });
        }

        // B) Load order items
        const { data: orderItems, error: oiErr } = await supabase
          .from("order_items")
          .select("id, menu_item_name, qty, options_summary, special_instructions, created_at")
          .eq("order_id", orderId)
          .order("created_at", { ascending: true });

        if (oiErr) {
          console.error("❌ Could not load public.order_items:", oiErr.message);
          return NextResponse.json({ received: true });
        }

        // ✅ Prevent duplicate inserts if webhook runs twice:
        // delete existing ticket items for this ticket then re-insert
        await supabase.from("kds_ticket_items").delete().eq("kds_ticket_id", ticket.id);

        const ticketItems = (orderItems ?? []).map((it) => ({
          kds_ticket_id: ticket.id,
          order_item_id: it.id,
          display_name: String(it.menu_item_name ?? "Item"),
          qty: Number(it.qty ?? 1),
          modifiers_text: it.options_summary ? String(it.options_summary).replace(/\s*•\s*/g, "\n") : null,
          instructions_text: it.special_instructions ? String(it.special_instructions) : null,
          status: "new",
        }));

        if (ticketItems.length > 0) {
          const { error: itemsErr } = await supabase.from("kds_ticket_items").insert(ticketItems);
          if (itemsErr) console.error("❌ kds_ticket_items insert failed:", itemsErr.message);
        } else {
          console.warn("⚠️ order_items empty — no ticket items inserted");
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