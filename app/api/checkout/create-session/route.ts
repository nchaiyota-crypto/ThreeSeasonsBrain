import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type IncomingItem = {
  name: string;
  qty: number;
  unit_cents: number;
};

type IncomingTotals = {
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
};

const stripe = new Stripe(must("STRIPE_SECRET_KEY"), {
  apiVersion: "2023-10-16",
});

export async function POST(req: Request) {
  console.log("🔥🔥 create-session HIT (FINGERPRINT-123) 🔥🔥");
  
  try {
    const body = await req.json().catch(() => null);

    const items: IncomingItem[] | undefined = body?.items;
    const totals: IncomingTotals | undefined = body?.totals;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Missing items" }, { status: 400 });
    }
    if (
      !totals ||
      typeof totals.subtotal_cents !== "number" ||
      typeof totals.tax_cents !== "number" ||
      typeof totals.total_cents !== "number"
    ) {
      return NextResponse.json({ error: "Missing totals" }, { status: 400 });
    }

    // Validate items
    for (const it of items) {
      if (!it?.name || typeof it.name !== "string") {
        return NextResponse.json({ error: "Item missing name" }, { status: 400 });
      }
      if (!Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) {
        return NextResponse.json({ error: "Invalid qty" }, { status: 400 });
      }
      if (!Number.isFinite(Number(it.unit_cents)) || Number(it.unit_cents) < 0) {
        return NextResponse.json({ error: "Invalid unit_cents" }, { status: 400 });
      }
    }

    // Supabase admin (service role)
    const supabase = createClient(
      must("NEXT_PUBLIC_SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    // Insert order
    const orderInsert: any = {
      order_number: Date.now(),
      source: "online",
      order_type: "takeout",
      status: "draft",
      payment_status: "unpaid",
      subtotal_cents: totals.subtotal_cents,
      tax_cents: totals.tax_cents,
      total_cents: totals.total_cents,
      payment_amount_cents: totals.total_cents,
      items_json: items,
    };

    console.log("🧾 ORDER INSERT:", orderInsert);

    const { data: orderRow, error: orderErr } = await supabase
      .from("orders")
      .insert(orderInsert)
      .select("id, order_number")
      .single();

    if (orderErr || !orderRow?.id) {
      console.error("❌ ORDER INSERT FAILED:", orderErr);
      return NextResponse.json(
        { error: "Failed to create order", details: orderErr },
        { status: 500 }
      );
    }

    const orderId = String(orderRow.id);
    const baseUrl = must("NEXT_PUBLIC_SITE_URL"); // http://localhost:3000

    const totalCents = Number(totals.total_cents);
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      return NextResponse.json({ error: "Invalid total_cents" }, { status: 400 });
    }

    const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: totalCents,
          product_data: { name: "3 Seasons Order Total" },
        },
      },
    ];

    console.log("🧾 totals received:", totals);
    console.log("🧾 items received:", items);
    console.log("💳 STRIPE LINE_ITEMS SENT:", JSON.stringify(stripeLineItems, null, 2));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: stripeLineItems,
      success_url: `${baseUrl}/success?orderId=${encodeURIComponent(orderId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel?orderId=${encodeURIComponent(orderId)}`,
      metadata: { orderId },
    });
    console.log("✅ STRIPE SESSION CREATED:", { id: session.id, url: session.url });

    // Save stripe session id
    const { error: updErr } = await supabase
      .from("orders")
      .update({
        stripe_checkout_session_id: session.id,
        stripe_session_id: session.id,
      })
      .eq("id", orderId);

    if (updErr) {
      console.error("⚠️ ORDER UPDATE FAILED:", updErr);
    }

    return NextResponse.json({
      url: session.url,
      orderId,
      sessionId: session.id,
    });
  } catch (err: any) {
    console.error("❌ CREATE SESSION ERROR:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error", details: String(err) },
      { status: 500 }
    );
  }
}