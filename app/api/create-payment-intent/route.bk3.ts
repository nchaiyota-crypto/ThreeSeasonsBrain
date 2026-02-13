// app/api/create-payment-intent/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
        // ✅ Create Stripe client INSIDE handler (and DON'T throw if missing)
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { error: "Missing env var: STRIPE_SECRET_KEY" },
        { status: 500 }
      );
    }
    const stripe = new Stripe(must("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });

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

    // 2) Reuse existing PI
    if (order.stripe_payment_intent_id) {
      const existing = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
      if (existing.client_secret) {
        return NextResponse.json({
          clientSecret: existing.client_secret,
          paymentIntentId: existing.id,
        });
      }
    }

    // 3) Create a new PI
    const pi = await stripe.paymentIntents.create({
      amount: Number(order.total_cents),
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: { orderId: String(order.id) },
    });

    // 4) Save PI id on the order
    const { error: upErr } = await supabase
      .from("orders")
      .update({ stripe_payment_intent_id: pi.id })
      .eq("id", orderId);

    if (upErr) {
      console.error("Failed to save stripe_payment_intent_id:", upErr);
      // still proceed
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