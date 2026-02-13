// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import {
  buildKitchenTicketText,
  buildCheckerTicketText,
} from "../../../../lib/printFormat";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function safeBeep() {
  const beepUrl =
    process.env.BEEP_WORKER_URL ||
    process.env.PRINTER_WORKER_URL ||
    "http://127.0.0.1:8787/print";

  const BEEP = "\x07\x07";

  try {
    const res = await fetch(beepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload_text: `${BEEP}\n` }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      console.error("⚠️ Beep printer returned non-200:", res.status, msg);
    }
  } catch (e: any) {
    console.error("⚠️ Beep printer unreachable (ignored):", e?.message ?? e);
  }
}

async function safePrint(text: string) {
  const workerUrl = process.env.PRINTER_WORKER_URL || "http://127.0.0.1:8787/print";

  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload_text: text }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      console.error("⚠️ Printer-worker returned non-200:", res.status, msg);
    }
  } catch (e: any) {
    console.error("⚠️ Printer-worker unreachable (ignored):", e?.message ?? e);
  }
}

type DBOrder = {
  order_number: number | string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
};

type DBOrderItem = {
  id: string;
  menu_item_name: string | null;
  qty: number | null;
  base_price_cents: number | null;
};

function getSupabase() {
  return createClient(
    must("NEXT_PUBLIC_SUPABASE_URL"),
    must("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

export async function POST(req: Request) {
  console.log("🔔 STRIPE WEBHOOK HIT");
  
    // ✅ Create Stripe client INSIDE handler (prevents build-time crash)
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error("Missing env var: STRIPE_SECRET_KEY");
    return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });
  }
  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, must("STRIPE_WEBHOOK_SECRET"));
  } catch (err: any) {
    console.error("❌ WEBHOOK SIGNATURE FAILED:", err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? "Bad signature" }, { status: 400 });
  }

  // ✅ PaymentElement flow uses PaymentIntent events
  if (event.type !== "payment_intent.succeeded") {
    return NextResponse.json({ received: true });
  }

  const pi = event.data.object as Stripe.PaymentIntent;

  const supabase = getSupabase();

  // ✅ Prefer metadata.orderId
  let orderId: string | null = pi.metadata?.orderId ? String(pi.metadata.orderId) : null;

  // ✅ Fallback: find by stripe_payment_intent_id
  if (!orderId) {
    const { data } = await supabase
      .from("orders")
      .select("id")
      .eq("stripe_payment_intent_id", pi.id)
      .maybeSingle();

    if (!data?.id) {
      console.error("❌ No order found for payment_intent:", pi.id);
      return NextResponse.json({ received: true });
    }
    orderId = String(data.id);
  }

  // 🔒 Idempotency: skip if already paid
  const { data: existingOrder, error: existingErr } = await supabase
    .from("orders")
    .select("payment_status")
    .eq("id", orderId)
    .single();

  if (existingErr) {
    console.error("❌ Failed reading existing order:", existingErr);
    return NextResponse.json({ received: true });
  }

  if (existingOrder?.payment_status === "paid") {
    return NextResponse.json({ received: true });
  }

  // Claim processing (one-time) to prevent parallel webhook runs
  const { data: claimed, error: claimErr } = await supabase
    .from("orders")
    .update({ webhook_processing_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("webhook_processing_at", null)
    .select("id")
    .maybeSingle();

  if (claimErr) {
    console.error("❌ Claim failed:", claimErr);
    return NextResponse.json({ received: true });
  }
  if (!claimed?.id) {
    console.log("⏭️ Another webhook already processing this order:", orderId);
    return NextResponse.json({ received: true });
  }

  // 💰 Mark order paid (PaymentIntent flow)
  const { error: updErr } = await supabase
    .from("orders")
    .update({
      payment_status: "paid",
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_payment_intent_id: pi.id,
    })
    .eq("id", orderId);

  if (updErr) {
    console.error("❌ Failed updating order paid:", updErr);
    return NextResponse.json({ received: true });
  }

  // 🧾 Load order
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("order_number, subtotal_cents, tax_cents, total_cents")
    .eq("id", orderId)
    .single<DBOrder>();

  if (orderErr || !order) {
    console.error("❌ Failed loading order:", orderErr);
    return NextResponse.json({ received: true });
  }

  const orderNumber = String(order.order_number ?? orderId);
  const createdAtISO = new Date().toISOString();

  // 🧾 Load order items
  const { data: orderItems, error: itemsErr } = await supabase
    .from("order_items")
    .select("id, menu_item_name, qty, base_price_cents")
    .eq("order_id", orderId)
    .returns<DBOrderItem[]>();

  if (itemsErr) {
    console.error("❌ Failed loading order items:", itemsErr);
    return NextResponse.json({ received: true });
  }
  if (!orderItems || orderItems.length === 0) {
    console.warn("⚠️ No order items found for order:", orderId);
    return NextResponse.json({ received: true });
  }

  // ✅ Ticket idempotency
  const { data: existingTicket, error: existingTicketErr } = await supabase
    .from("kds_tickets")
    .select("id")
    .eq("order_id", orderId)
    .eq("station", "kitchen")
    .maybeSingle();

  if (existingTicketErr) {
    console.error("⚠️ existingTicket check failed:", existingTicketErr);
  } else if (existingTicket?.id) {
    console.log("⏭️ KDS ticket already exists, skipping create/print:", existingTicket.id);
    return NextResponse.json({ received: true });
  }

  // 🍳 Create KDS ticket
  const { data: kdsTicket, error: ticketErr } = await supabase
    .from("kds_tickets")
    .insert({
      order_id: orderId,
      station: "kitchen",
      status: "new",
    })
    .select("id")
    .single();

  if (ticketErr || !kdsTicket?.id) {
    console.error("❌ Failed creating kds ticket:", ticketErr);
    return NextResponse.json({ received: true });
  }

  const ticketId = String(kdsTicket.id);

  // 🍽 Insert KDS ticket items
  const ticketItems = orderItems.map((it) => ({
    kds_ticket_id: ticketId,
    order_item_id: String(it.id),
    display_name: String(it.menu_item_name ?? "Item"),
    qty: Number(it.qty ?? 1),
  }));

  const { error: kdsItemsErr } = await supabase.from("kds_ticket_items").insert(ticketItems);
  if (kdsItemsErr) console.error("⚠️ kds_ticket_items insert failed:", kdsItemsErr);

  // ✅ Build tickets (NO prices)
  const kitchen_text = buildKitchenTicketText({
    table: "A1",
    guestCount: 2,
    terminalName: "Terminal #1",
    orderNumber,
    createdAtISO,
    items: orderItems.map((it) => ({
      qty: Number(it.qty ?? 1),
      name: String(it.menu_item_name ?? "Item"),
      modifiers: [],
    })),
    topGapLines: 4,
  });

  const checker_text = buildCheckerTicketText({
    table: "A1",
    guestCount: 2,
    terminalName: "Terminal #1",
    orderNumber,
    createdAtISO,
    items: orderItems.map((it) => ({
      qty: Number(it.qty ?? 1),
      name: String(it.menu_item_name ?? "Item"),
      modifiers: [],
    })),
    topGapLines: 4,
  });

  // ✅ Print only 2 tickets + beep
  await safePrint(kitchen_text);
  await safePrint(checker_text);
  await safeBeep();

  console.log("✅ KDS ticket created:", { orderId, ticketId, items: ticketItems.length });
  return NextResponse.json({ received: true });
}