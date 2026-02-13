import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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
    must("NEXT_PUBLIC_SUPABASE_URL"),
    must("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

export async function POST(req: Request) {
  try {
    const stripe = getStripe();
    const supabase = getSupabase();

    const body = await req.json();
    const orderId = String(body?.orderId || "");
    const tipCents = Number(body?.tipCents ?? 0);

    if (!orderId) return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    if (!Number.isFinite(tipCents) || tipCents < 0)
      return NextResponse.json({ error: "Invalid tipCents" }, { status: 400 });
    if (tipCents > 10000)
      return NextResponse.json({ error: "Tip too large" }, { status: 400 });

    // Get the PaymentIntent id from your order
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, total_cents, tip_cents, stripe_payment_intent_id")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const paymentIntentId = order.stripe_payment_intent_id as string | null;
    if (!paymentIntentId)
      return NextResponse.json({ error: "Missing stripe_payment_intent_id" }, { status: 400 });

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (pi.status === "succeeded") {
      return NextResponse.json({ error: "Payment already succeeded" }, { status: 409 });
    }

    const currentTipCents = Number(order.tip_cents ?? 0);

    // base = total - currentTip (so we never stack tips)
    const baseAmountCents = Number(order.total_cents) - currentTipCents;

    const newAmountCents = baseAmountCents + tipCents;

    const updated = await stripe.paymentIntents.update(paymentIntentId, {
      amount: newAmountCents,
      metadata: {
        orderId,
        tip_cents: String(tipCents),
        base_amount_cents: String(baseAmountCents),
      },
    });

    await supabase
      .from("orders")
      .update({
        tip_cents: tipCents,
        total_cents: newAmountCents,
      })
      .eq("id", orderId);

    return NextResponse.json({
      ok: true,
      orderId,
      tipCents,
      baseAmountCents,
      newAmountCents,
      piStatus: updated.status,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}