// app/api/create-payment-intent/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const stripe = new Stripe(must("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });

export async function POST(req: Request) {
  try {
    const { orderId } = await req.json();

    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    const supabase = createClient(
      must("NEXT_PUBLIC_SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    // ✅ include payment_amount_cents
    const { data: order, error } = await supabase
      .from("orders")
      .select("id, total, total_cents, payment_amount_cents, stripe_payment_intent_id")
      .eq("id", orderId)
      .single();

    if (error || !order) {
      return NextResponse.json({ error: "Order not found", details: error?.message ?? null }, { status: 404 });
    }

    // ✅ Determine BASE charge amount (NO tip here)
    const amount =
      Number(order.payment_amount_cents) > 0
        ? Number(order.payment_amount_cents)
        : Number(order.total_cents) > 0
          ? Number(order.total_cents)
          : Math.round(Number(order.total) * 100);

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Invalid order total", debug: { total: order.total, total_cents: order.total_cents, payment_amount_cents: order.payment_amount_cents } },
        { status: 400 }
      );
    }

    // ✅ If PI already exists, reuse it.
    // But ensure DB has payment_amount_cents set (so tip route has stable base).
    if (order.stripe_payment_intent_id) {
      await supabase.from("orders").update({ payment_amount_cents: amount }).eq("id", orderId);

      const pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
      if (pi.client_secret) {
        return NextResponse.json({ clientSecret: pi.client_secret, paymentIntentId: pi.id });
      }
    }

    // ✅ Create PI (idempotent per order+amount)
    const pi = await stripe.paymentIntents.create(
      {
        amount,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        metadata: { orderId: String(orderId) },
      },
      { idempotencyKey: `order_${orderId}_amount_${amount}` }
    );

    // ✅ Save PI id + base charge amount
    await supabase
      .from("orders")
      .update({
        stripe_payment_intent_id: pi.id,
        payment_amount_cents: amount,
      })
      .eq("id", orderId);

    return NextResponse.json({ clientSecret: pi.client_secret, paymentIntentId: pi.id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "PaymentIntent failed" }, { status: 500 });
  }
}