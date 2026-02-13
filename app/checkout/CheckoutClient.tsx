"use client";

import React, { useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import CheckoutForm from "./CheckoutForm";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

type LastOrder = {
  orderId?: string;
  orderNumber?: string;
  customerName?: string;

  items: any[];
  subtotal: number;
  tax: number;
  total: number;

  pickupMode: "asap" | "schedule";
  pickupDate?: string;
  pickupTimeISO?: string;
  estimateMin?: number;
};

async function ensureOrderId(lastOrder: LastOrder) {
  if (lastOrder?.orderId) return lastOrder.orderId;

  const r = await fetch("/api/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lastOrder),
  });

  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || "Create order failed");
  if (!j?.orderId) throw new Error("Create order did not return orderId");

  const updated = { ...lastOrder, orderId: j.orderId };
  localStorage.setItem("last_order", JSON.stringify(updated));

  return j.orderId as string;
}

async function getClientSecret(lastOrder: LastOrder) {
  const orderId = await ensureOrderId(lastOrder);

  const r = await fetch("/api/create-payment-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }), // ✅ IMPORTANT: send ONLY orderId
  });

  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || "Create payment intent failed");
  if (!j?.clientSecret) throw new Error("Missing clientSecret");

  return j.clientSecret as string;
}

export default function CheckoutClient() {
  const [clientSecret, setClientSecret] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [order, setOrder] = useState<LastOrder | null>(null);

useEffect(() => {
  let alive = true;

  async function run() {
    try {
      setErr("");

      const raw = localStorage.getItem("last_order");
      if (!raw) throw new Error("Missing last_order. Please go back and click Checkout again.");

      const parsed = JSON.parse(raw) as LastOrder;
      if (!parsed?.total || parsed.total <= 0) throw new Error("Invalid order total. Please go back and try again.");

      // ✅ THIS is the key: it creates the order if needed and returns a real orderId
      const secret = await getClientSecret(parsed);

      if (!alive) return;
      setOrder(JSON.parse(localStorage.getItem("last_order") || "null"));
      setClientSecret(secret);
    } catch (e: any) {
      if (!alive) return;
      setErr(e?.message ?? "CheckoutClient failed");
    }
  }

  run();
  return () => {
    alive = false;
  };
}, []);

  const options = useMemo(() => ({ clientSecret }), [clientSecret]);

  if (err) {
    return (
      <div style={{ padding: 18 }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Checkout error</div>
        <div style={{ opacity: 0.8 }}>{err}</div>
        <div style={{ marginTop: 12 }}>
          <a href="/menu">← Back to Menu</a>
        </div>
      </div>
    );
  }

  if (!clientSecret) {
    return <div style={{ padding: 24 }}>Loading checkout…</div>;
  }

  return (
    <>
      {order ? (
        <div
          style={{
            marginBottom: 14,
            padding: 12,
            border: "1px solid #eee",
            borderRadius: 12,
            background: "#fafafa",
          }}
        >
          <div style={{ fontWeight: 900 }}>Total: ${Number(order.total).toFixed(2)}</div>
          {order.orderId ? <div style={{ fontSize: 12, opacity: 0.7 }}>Order ID: {order.orderId}</div> : null}
        </div>
      ) : null}

      <Elements stripe={stripePromise} options={options}>
        <CheckoutForm />
      </Elements>
    </>
  );
}