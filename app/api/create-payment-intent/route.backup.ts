// app/api/create-payment-intent/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

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

    // 1) Load order totals + existing PI if any
    const { data: order, error } = await supabase
      .from("orders")
      .select("id, total_cents, stripe_payment_intent_id")
      .eq("id", orderId)
      .single();

    if (error || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // 2) If we already created a PI for this order, reuse it
    if (order.stripe_payment_intent_id) {
      const pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
      if (pi.client_secret) {
        return NextResponse.json({
          clientSecret: pi.client_secret,
          paymentIntentId: pi.id,
        });
      }
    }

    // 3) Create PI ONCE with idempotency key tied to orderId
    const amount = Number(order.total_cents);
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Invalid order total" }, { status: 400 });
    }

    const pi = await stripe.paymentIntents.create(
      {
        amount,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        metadata: { orderId: String(orderId) },
      },
      {
        idempotencyKey: `order_${orderId}_total_${amount}`,
      }
    );

    // 4) Save PI id on the order
    const { error: upErr } = await supabase
      .from("orders")
      .update({ stripe_payment_intent_id: pi.id })
      .eq("id", orderId);

    if (upErr) {
      console.error("Failed to save stripe_payment_intent_id:", upErr);
      // Still allow checkout to proceed
    }

    return NextResponse.json({
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
    });
  } catch (err: any) {
    console.error("Stripe PI error:", err);
    return NextResponse.json({ error: err.message || "PaymentIntent failed" }, { status: 500 });
  }
}