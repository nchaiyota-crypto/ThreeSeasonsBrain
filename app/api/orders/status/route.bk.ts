import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getStripe() {
  return new Stripe(must("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
}

function getSupabase() {
  return createClient(
    must("NEXT_PUBLIC_SUPABASE_URL"),      // ✅ matches your Vercel env
    must("SUPABASE_SERVICE_ROLE_KEY"),     // ✅ server-only key
    { auth: { persistSession: false } }
  );
}

async function findOrder(orderId: string) {
  const supabase = getSupabase();

  // Try common key names
  let { data } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (data) return data;

  ({ data } = await supabase.from("orders").select("*").eq("orderId", orderId).maybeSingle());
  if (data) return data;

  ({ data } = await supabase.from("orders").select("*").eq("order_id", orderId).maybeSingle());
  return data ?? null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderId = url.searchParams.get("orderId");

  if (!orderId) return NextResponse.json({ error: "Missing orderId" }, { status: 400 });

  const order = await findOrder(orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // You MUST have stored the payment_intent id on the order row
  const pi =
    order.payment_intent ??
    order.paymentIntent ??
    order.payment_intent_id ??
    order.stripe_payment_intent_id;

  if (!pi) {
    return NextResponse.json({
      paid: false,
      piStatus: "missing_payment_intent_on_order",
    });
  }

  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(String(pi));
  const paid = intent.status === "succeeded" || intent.status === "processing";

  return NextResponse.json({ paid, piStatus: intent.status });
}