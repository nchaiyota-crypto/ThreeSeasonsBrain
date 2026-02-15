"use client";

import React, { useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import CheckoutForm from "./CheckoutForm";
import OrderSummary from "./OrderSummary";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
function money(n: number) {
  return `$${Number(n || 0).toFixed(2)}`;
}

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

function getServiceFee(o: any) {
  if (!o) return 0;

  // ✅ preferred: matches Supabase column
  if (typeof o.service_fee_cents === "number") return o.service_fee_cents / 100;

  // ✅ optional fallbacks (if you stored fee in localStorage under these)
  const fromKeys = Number(
    o?.serviceFee ??
      o?.serviceFeeDollars ??
      o?.onlineServiceFee ??
      o?.service_fee ??
      o?.online_service_fee ??
      0
  );

  if (fromKeys > 0) return fromKeys;

  // ✅ last fallback: infer from totals (only works if total includes fee)
  const sub = Number(o?.subtotal ?? 0);
  const tx = Number(o?.tax ?? 0);
  const tot = Number(o?.total ?? 0);
  const inferred = tot > 0 ? Math.max(0, +(tot - sub - tx).toFixed(2)) : 0;

  return inferred;
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
    return (
      <div style={{ padding: 24 }}>
        <OrderSummary />
        <div style={{ marginTop: 12 }}>Loading checkout…</div>
      </div>
    );
  }

  return (
    <>
      <OrderSummary />
      {/* ✅ Breakdown (matches success style) */}
      {order ? (
        <div
          style={{
            marginBottom: 14,
            padding: 14,
            border: "1px solid #eee",
            borderRadius: 14,
            background: "#fafafa",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ opacity: 0.75 }}>Subtotal</div>
            <div style={{ fontWeight: 900 }}>${Number(order.subtotal ?? 0).toFixed(2)}</div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ opacity: 0.75 }}>Tax</div>
            <div style={{ fontWeight: 900 }}>${Number(order.tax ?? 0).toFixed(2)}</div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ opacity: 0.75 }}>Online Service Fee</div>
              <div style={{ fontWeight: 900 }}>
                {money(getServiceFee(order))}
              </div>
          </div>

          <div style={{ height: 1, background: "#e9e9e9", margin: "10px 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ opacity: 0.75 }}>Total (before tip)</div>
            <div style={{ fontWeight: 900 }}>
              ${(Number(order.subtotal ?? 0) + Number(order.tax ?? 0) + getServiceFee(order)).toFixed(2)}
            </div>
          </div>
        </div>
      ) : null}

      <Elements stripe={stripePromise} options={options}>
        <CheckoutForm />
      </Elements>
    </>
  );
}