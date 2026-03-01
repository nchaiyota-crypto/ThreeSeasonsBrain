// supabase/functions/stripe-terminal-cancel-payment/index.ts
//
// Cancels an in-progress terminal payment.
// 1) Tells the S700 reader to stop waiting (cancel_action)
// 2) Cancels the PaymentIntent so no charge occurs
//
// Safe to call even if the reader has already finished (errors are swallowed).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_READER_ID  = Deno.env.get("STRIPE_TERMINAL_READER_ID") ?? "";
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

async function stripePost(path: string, params: Record<string, string> = {}) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Stripe error ${res.status}`);
  return data;
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

    // ── Step 1: Cancel reader action (best-effort) ─────────────────────
    if (STRIPE_READER_ID) {
      try {
        await stripePost(`/terminal/readers/${STRIPE_READER_ID}/cancel_action`);
        console.log("✅ Reader action canceled");
      } catch (e: any) {
        // Reader might already be idle — that's fine
        console.log("ℹ️ cancel_action skipped:", e?.message);
      }
    }

    // ── Step 2: Cancel the PaymentIntent ──────────────────────────────
    await stripePost(`/payment_intents/${paymentIntentId}/cancel`);
    console.log("✅ PaymentIntent canceled:", paymentIntentId);

    return json(200, { ok: true, canceled: true });

  } catch (e: any) {
    console.error("❌ stripe-terminal-cancel-payment error:", e?.message ?? e);
    return json(500, { error: e?.message ?? String(e) });
  }
});
