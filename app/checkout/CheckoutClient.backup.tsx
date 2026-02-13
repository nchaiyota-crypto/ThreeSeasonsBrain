"use client";

import React, { useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import CheckoutForm from "./CheckoutForm";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

type LastOrder = {
  orderId?: string;          // ✅ add
  orderNumber?: string;      // ✅ allow server to set
  customerName?: string;     // optional

  items: any[];
  subtotal: number;
  tax: number;
  total: number;

  pickupMode: "asap" | "schedule";
  pickupDate?: string;
  pickupTimeISO?: string;
  estimateMin?: number;
};

export default function CheckoutClient() {
  const [clientSecret, setClientSecret] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [order, setOrder] = useState<LastOrder | null>(null);

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setErr("");

        // 1) Load last_order
        const raw = localStorage.getItem("last_order");
        if (!raw) throw new Error("Missing last_order. Please go back and click Checkout again.");

        const parsed = JSON.parse(raw) as LastOrder;
        if (!parsed?.total || parsed.total <= 0) throw new Error("Invalid order total. Please go back and try again.");

        // 2) Ensure we have a Supabase orderId (create order if missing)
        let working = parsed;

        if (!working.orderId) {
          // Build items payload using YOUR expected shape
          const itemsPayload = (working.items || []).map((it: any) => ({
            name: it.name,
            qty: it.qty,
            price: it.unitPrice ?? it.price, // depends on your saved format
            special_instructions: it.special_instructions ?? it.optionsSummary ?? null,
          }));

          const res = await fetch("/api/orders/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: itemsPayload,
              source: "online",
              order_type: "takeout",
            }),
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || "Failed to create order in Supabase");

          working = {
            ...working,
            orderId: String(data.orderId),
            orderNumber: String(data.orderNumber ?? working.orderNumber ?? ""),
          };

          localStorage.setItem("last_order", JSON.stringify(working));
        }

        if (!alive) return;
        setOrder(working);

        // 3) Create payment intent using real total + orderId
        const amount = Math.round(Number(working.total) * 100);
        if (!amount || amount < 50) throw new Error("Invalid total amount.");

        const piRes = await fetch("/api/create-payment-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount,
            orderId: working.orderId,
            orderNumber: working.orderNumber,
            customerName: working.customerName ?? "",
          }),
        });

        const piData = await piRes.json();
        if (!piRes.ok) throw new Error(piData?.error || "create-payment-intent failed");
        if (!piData?.clientSecret) throw new Error("No clientSecret returned");

        if (!alive) return;
        setClientSecret(piData.clientSecret);
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
        <div style={{ marginBottom: 14, padding: 12, border: "1px solid #eee", borderRadius: 12, background: "#fafafa" }}>
          <div style={{ fontWeight: 900 }}>Total: ${order.total.toFixed(2)}</div>
        </div>
      ) : null}

      <Elements stripe={stripePromise} options={options}>
        <CheckoutForm />
      </Elements>
    </>
  );
}