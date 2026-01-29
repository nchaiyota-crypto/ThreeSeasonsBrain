import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const stripe = new Stripe(must("STRIPE_SECRET_KEY"), {
  apiVersion: "2023-10-16",
});

export async function POST(req: Request) {
  console.log("🔔 STRIPE WEBHOOK HIT");

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      must("STRIPE_WEBHOOK_SECRET")
    );
  } catch (err: any) {
    console.error("❌ WEBHOOK SIGNATURE FAILED:", err.message);
    return NextResponse.json(
      { error: `Webhook error: ${err.message}` },
      { status: 400 }
    );
  }

  console.log("🔔 EVENT TYPE:", event.type);

  const supabase = createClient(
    must("NEXT_PUBLIC_SUPABASE_URL"),
    must("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    console.log("💰 CHECKOUT SESSION COMPLETED", {
      sessionId: session.id,
      orderId: session.metadata?.orderId,
      paymentIntent: session.payment_intent,
    });

    const orderId = session.metadata?.orderId;

    if (orderId) {
      await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          status: "confirmed",
          stripe_payment_intent_id: String(session.payment_intent ?? ""),
          stripe_session_id: session.id,
        })
        .eq("id", orderId);

      console.log("✅ ORDER MARKED PAID:", orderId);
    } else {
      console.warn("⚠️ Missing orderId in metadata");
    }
  }

  return NextResponse.json({ received: true });
}