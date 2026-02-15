// app/api/orders/tip/route.ts
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
    const body = await req.json().catch(() => ({}));
    const orderId = String(body?.orderId || "");
    const tipCents = Number(body?.tipCents ?? 0);

    if (!orderId) return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    if (!Number.isFinite(tipCents) || tipCents < 0)
      return NextResponse.json({ error: "Invalid tipCents" }, { status: 400 });
    if (tipCents > 10000)
      return NextResponse.json({ error: "Tip too large" }, { status: 400 });

    const supabase = createClient(
      must("NEXT_PUBLIC_SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, tip_cents, payment_amount_cents, stripe_payment_intent_id")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) {
      return NextResponse.json({ error: "Order not found", details: orderErr?.message ?? null }, { status: 404 });
    }

    const paymentIntentId = order.stripe_payment_intent_id as string | null;
    if (!paymentIntentId) {
      return NextResponse.json(
        { error: "Missing stripe_payment_intent_id (create-payment-intent must run first)" },
        { status: 400 }
      );
    }

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (pi.status === "succeeded") {
      return NextResponse.json({ error: "Payment already succeeded" }, { status: 409 });
    }

    // ✅ current tip in DB
    const currentTipCents = Number(order.tip_cents ?? 0);

    // ✅ current charge amount (prefer DB, fallback Stripe)
    const currentPayAmountCents =
      Number(order.payment_amount_cents) > 0 ? Number(order.payment_amount_cents) : Number(pi.amount ?? 0);

    // ✅ base = currentPay - currentTip (so tips never stack)
    const baseAmountCents = currentPayAmountCents - currentTipCents;

    if (!Number.isFinite(baseAmountCents) || baseAmountCents <= 0) {
      return NextResponse.json(
        {
          error: "Invalid base total",
          debug: {
            payment_amount_cents: order.payment_amount_cents,
            tip_cents: order.tip_cents,
            pi_amount: pi.amount,
          },
        },
        { status: 400 }
      );
    }

    const newPayAmountCents = baseAmountCents + tipCents;

    // ✅ Update PI amount
    const updated = await stripe.paymentIntents.update(paymentIntentId, {
      amount: newPayAmountCents,
      metadata: {
        orderId,
        tip_cents: String(tipCents),
        base_amount_cents: String(baseAmountCents),
      },
    });

    // ✅ Update DB (OPTION A): do NOT touch total_cents
    const { error: updErr } = await supabase
      .from("orders")
      .update({
        tip_cents: tipCents,
        payment_amount_cents: newPayAmountCents,
      })
      .eq("id", orderId);

    if (updErr) {
      return NextResponse.json({ error: "DB update failed", details: updErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      orderId,
      tipCents,
      baseAmountCents,
      paymentAmountCents: newPayAmountCents,
      piStatus: updated.status,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}