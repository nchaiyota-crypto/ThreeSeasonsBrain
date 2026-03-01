// supabase/functions/stripe-terminal-create-payment/index.ts
//
// Creates a Stripe PaymentIntent and pushes it to the S700 smart reader.
// The reader will display the payment prompt to the customer immediately.
//
// Required Supabase secrets:
//   STRIPE_SECRET_KEY          – your Stripe secret key (sk_live_... or sk_test_...)
//   STRIPE_TERMINAL_READER_ID  – the S700 reader ID from Stripe dashboard (e.g. tmr_xxxx)
//   ADMIN_TOKEN                – internal auth token (already used by other functions)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const STRIPE_SECRET_KEY     = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_READER_ID      = Deno.env.get("STRIPE_TERMINAL_READER_ID") ?? "";
const ADMIN_TOKEN           = Deno.env.get("ADMIN_TOKEN") ?? "";

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

// Wrapper for Stripe REST API calls using form-encoded body
async function stripePost(path: string, params: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Stripe error ${res.status}`);
  }
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  // Auth check
  const token = req.headers.get("x-admin-token") ?? "";
  if (ADMIN_TOKEN && token !== ADMIN_TOKEN) {
    return json(401, { error: "Unauthorized" });
  }

  if (!STRIPE_SECRET_KEY) return json(500, { error: "Missing STRIPE_SECRET_KEY secret" });
  if (!STRIPE_READER_ID)  return json(500, { error: "Missing STRIPE_TERMINAL_READER_ID secret" });

  try {
    const body       = await req.json();
    const amountCents: number  = body.amountCents;
    const orderId: string      = body.orderId ?? "";
    const description: string  = body.description ?? "In-store order";
    const customerName: string = body.customerName ?? "";

    if (!amountCents || amountCents <= 0) {
      return json(400, { error: "amountCents must be a positive integer" });
    }

    // ── Step 1: Create PaymentIntent ───────────────────────────────────
    const pi = await stripePost("/payment_intents", {
      amount:                          String(amountCents),
      currency:                        "usd",
      "payment_method_types[]":        "card_present",
      capture_method:                  "automatic",
      description,
      "metadata[order_id]":            orderId,
      "metadata[customer_name]":       customerName,
      "metadata[source]":              "in_store_ipad",
    });

    console.log("✅ PaymentIntent created:", pi.id);

    // ── Step 2: Push to S700 reader ────────────────────────────────────
    await stripePost(
      `/terminal/readers/${STRIPE_READER_ID}/process_payment_intent`,
      { payment_intent: pi.id }
    );

    console.log("✅ Payment pushed to reader:", STRIPE_READER_ID);

    return json(200, {
      ok:              true,
      paymentIntentId: pi.id,
      readerId:        STRIPE_READER_ID,
      amountCents:     pi.amount,
      status:          "processing",
    });

  } catch (e: any) {
    console.error("❌ stripe-terminal-create-payment error:", e?.message ?? e);
    return json(500, { error: e?.message ?? String(e) });
  }
});
