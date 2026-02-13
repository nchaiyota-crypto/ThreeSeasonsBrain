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

      const orderId = String(pi.metadata?.orderId || "");
      if (!orderId) {
        // If you ever forget metadata, fallback could be: lookup by stripe_payment_intent_id
        return NextResponse.json({ error: "Missing orderId in metadata" }, { status: 400 });
      }

      const tipCents = Number(pi.metadata?.tip_cents ?? 0);
      const amount = Number(pi.amount ?? 0);

      // 1) Mark order as paid
      const { error: updErr } = await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          status: "new", // or "confirmed"
          total_cents: amount,
          tip_cents: tipCents,
          paid_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (updErr) {
        return NextResponse.json({ error: "Failed to update order", details: updErr.message }, { status: 500 });
      }

      // 2) OPTIONAL BUT RECOMMENDED: create KDS ticket so iPad shows it
      // If your KDS listens to kds_tickets, you must insert there.
      // Adjust column names to match your schema.
      await supabase.from("kds_tickets").insert({
        order_id: orderId,
        status: "new",
        source: "online",
        created_at: new Date().toISOString(),
      });

      return NextResponse.json({ received: true });
    }

    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const orderId = String(pi.metadata?.orderId || "");
      if (orderId) {
        await supabase
          .from("orders")
          .update({ payment_status: "failed", status: "payment_failed" })
          .eq("id", orderId);
      }
      return NextResponse.json({ received: true });
    }

    return NextResponse.json({ received: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Webhook error" }, { status: 400 });
  }
}