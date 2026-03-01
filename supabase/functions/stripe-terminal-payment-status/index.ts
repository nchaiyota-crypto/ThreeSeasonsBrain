// supabase/functions/stripe-terminal-payment-status/index.ts
//
// Polls the status of a Stripe PaymentIntent.
// Called every ~2 seconds by the iPad while waiting for customer to pay.
//
// Returns:
//   status: "processing" | "succeeded" | "canceled" | "requires_payment_method"
//   amountCents, amountReceivedCents

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const ADMIN_TOKEN       = Deno.env.get("ADMIN_TOKEN") ?? "";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const token = req.headers.get("x-admin-token") ?? "";
  if (ADMIN_TOKEN && token !== ADMIN_TOKEN) return json(401, { error: "Unauthorized" });
  if (!STRIPE_SECRET_KEY) return json(500, { error: "Missing STRIPE_SECRET_KEY secret" });

  try {
    const body            = await req.json();
    const paymentIntentId = (body.paymentIntentId ?? "").trim();

    if (!paymentIntentId) return json(400, { error: "Missing paymentIntentId" });

    const res = await fetch(
      `https://api.stripe.com/v1/payment_intents/${paymentIntentId}`,
      { headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` } }
    );
    const pi = await res.json();
    if (!res.ok) throw new Error(pi?.error?.message ?? `Stripe error ${res.status}`);

    // Stripe PaymentIntent statuses:
    //   requires_payment_method – no card yet
    //   requires_confirmation    – captured but not confirmed
    //   requires_action          – 3DS etc
    //   processing               – card submitted, awaiting bank
    //   requires_capture         – manual capture mode (we use automatic)
    //   succeeded                – ✅ paid
    //   canceled                 – canceled by staff or expired

    return json(200, {
      ok:                  true,
      status:              pi.status as string,
      amountCents:         pi.amount         as number,
      amountReceivedCents: pi.amount_received as number,
    });

  } catch (e: any) {
    console.error("❌ stripe-terminal-payment-status error:", e?.message ?? e);
    return json(500, { error: e?.message ?? String(e) });
  }
});
