"use client";

import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import CheckoutForm from "./CheckoutForm";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

export default function CheckoutClient() {
  const [clientSecret, setClientSecret] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let timeoutId: any = null;

    async function run() {
      try {
        console.log("✅ CheckoutClient mounted");

        // HARD timeout so it never spins forever
        timeoutId = setTimeout(() => {
          setErr("Checkout timed out. API not responding (check /api/create-payment-intent).");
          setLoading(false);
        }, 10_000);

        const raw = localStorage.getItem("last_order");
        console.log("✅ last_order exists?", !!raw);
        if (!raw) throw new Error("Missing last_order. Go back to Menu and click Checkout again.");

        const last = JSON.parse(raw);
        console.log("✅ last_order payload:", last);

        // IMPORTANT: Stripe amount must be integer cents
        const amount = Math.round(Number(last?.total) * 100);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error(`Invalid amount. last_order.total=${last?.total}`);
        }

        console.log("➡️ calling /api/create-payment-intent with amount:", amount);

        const res = await fetch("/api/create-payment-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, orderId: last?.orderId ?? null }),
        });

        const text = await res.text();
        console.log("✅ create-payment-intent status:", res.status);
        console.log("✅ create-payment-intent raw text:", text);

        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = { raw: text };
        }

        if (!res.ok) throw new Error(`API failed (${res.status}): ${data?.error ?? data?.raw ?? "Unknown"}`);
        if (!data?.clientSecret) throw new Error("API returned no clientSecret");

        setClientSecret(data.clientSecret);
      } catch (e: any) {
        console.error("❌ Checkout init error:", e);
        setErr(e?.message ?? "Checkout init failed");
      } finally {
        clearTimeout(timeoutId);
        setLoading(false);
      }
    }

    run();

    return () => clearTimeout(timeoutId);
  }, []);

  if (loading) return <div style={{ padding: 16 }}>Loading checkout…</div>;

  if (err) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 900, color: "crimson" }}>Checkout error</div>
        <div style={{ marginTop: 8 }}>{err}</div>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CheckoutForm />
    </Elements>
  );
}