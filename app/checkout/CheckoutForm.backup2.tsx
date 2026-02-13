"use client";

import React, { useEffect, useState } from "react";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

export default function CheckoutForm() {
  const stripe = useStripe();
  const elements = useElements();

  const [isPaying, setIsPaying] = useState(false);
  const [message, setMessage] = useState("");

  const [customerName, setCustomerName] = useState("");
  const [nameError, setNameError] = useState("");

    // ✅ Tip
  const [tipPreset, setTipPreset] = useState<number>(0); // percent: 0, 15, 18, 20
  const [tipCustom, setTipCustom] = useState<string>(""); // dollars as string
  const [baseTotal, setBaseTotal] = useState<number>(0);
  

  useEffect(() => {
    if (typeof window === "undefined") return;
    
    const raw = localStorage.getItem("last_order");
    if (raw) {
      try {
        const o = JSON.parse(raw);
        if (o?.customerName) setCustomerName(o.customerName);
        setBaseTotal(Number(o?.total ?? 0));
      } catch {}
    }
  }, []);

    // ✅ Read base total from last_order (what Stripe is currently charging)
  const tipAmount =
    tipCustom.trim() !== ""
      ? Math.max(0, Number(tipCustom))
      : tipPreset > 0
        ? (baseTotal * tipPreset) / 100
        : 0;

  const finalTotal = baseTotal + tipAmount;
  const tipCents = Math.round(tipAmount * 100);


  // ✅ IMPORTANT: don’t show a clickable pay button until Elements is mounted
  if (!stripe || !elements) {
    return (
      <div style={{ padding: 16 }}>
        Loading checkout... (stripe={String(!!stripe)} elements={String(!!elements)})
      </div>
    );
  }

  async function handlePay(e?: React.FormEvent) {
    e?.preventDefault();
    setMessage("");

    // ✅ TS + runtime guard
    if (!stripe || !elements) {
      setMessage("Checkout is still loading. Please wait 1–2 seconds and try again.");
      return;
    }

    const name = customerName.trim();
    if (!name) {
      setNameError("Please enter your full name.");
      return;
    }
    setNameError("");

    // ✅ Get orderId for success page
    let orderId: string | undefined;
    try {
      const raw = localStorage.getItem("last_order");
      if (raw) {
        const o = JSON.parse(raw);
        orderId = o?.orderId;
      }
    } catch {}

    if (!orderId) {
      setMessage("Missing orderId. Please go back and try again.");
      return;
    }

        // ✅ REAL TIP: update PaymentIntent amount BEFORE confirmPayment
    if (tipCents > 0) {
      const r = await fetch("/api/orders/tip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, tipCents }),
      });

      const data = await r.json().catch(() => ({}));

      if (!r.ok) {
        setMessage(data?.error ?? "Failed to apply tip");
        return;
      }

      // optional: store tip in last_order so success page can show it
      try {
        const raw2 = localStorage.getItem("last_order");
        if (raw2) {
          const o2 = JSON.parse(raw2);
          o2.tipCents = tipCents;
          o2.totalWithTip = (Number(o2.total ?? 0) + tipCents / 100);
          localStorage.setItem("last_order", JSON.stringify(o2));
        }
      } catch {}
    }

    // ✅ Persist name
    try {
      const raw = localStorage.getItem("last_order");
      if (raw) {
        const o = JSON.parse(raw);
        o.customerName = name;
        localStorage.setItem("last_order", JSON.stringify(o));
      }
    } catch {}

    if (isPaying) return;
    setIsPaying(true);

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          payment_method_data: { billing_details: { name } },
          return_url: `${window.location.origin}/checkout/success?orderId=${encodeURIComponent(orderId)}`,
        },
        redirect: "if_required", // ✅ best for cards (no redirect), still supports redirect methods
      });

      if (error) {
        setMessage(error.message ?? "Payment failed");
        return;
      }

      // ✅ If Stripe did NOT redirect (card payments usually don't), we redirect ourselves
      if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
        window.location.href = `/checkout/success?orderId=${encodeURIComponent(orderId)}`;
        return;
      }

      // Rare statuses
      setMessage(`Payment status: ${paymentIntent?.status ?? "unknown"}`);

    } finally {
      setIsPaying(false);
    }
  }

  return (
    <form onSubmit={handlePay} style={{ display: "grid", gap: 14 }}>
      <div style={{ fontWeight: 900, fontSize: 14 }}>Customer</div>

      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ fontSize: 13, fontWeight: 800, opacity: 0.8 }}>Full name</label>
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="e.g. Narin Chaiyota"
          style={{
            height: 44,
            borderRadius: 12,
            border: nameError ? "1px solid #e11d48" : "1px solid #e5e5e5",
            padding: "0 12px",
            outline: "none",
            background: "#fff",
            fontWeight: 700,
          }}
        />
        {nameError ? <div style={{ color: "#e11d48", fontSize: 12 }}>{nameError}</div> : null}
      </div>

            {/* ✅ Tip */}
      <div style={{ fontWeight: 900, fontSize: 14, marginTop: 6 }}>Tip</div>

      <div style={{ display: "flex", gap: 8 }}>
        {[0, 15, 18, 20].map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setTipPreset(p);
              setTipCustom("");
            }}
            style={{
              flex: 1,
              height: 40,
              borderRadius: 12,
              border: tipPreset === p && tipCustom === "" ? "2px solid #000" : "1px solid #e5e5e5",
              background: "#fff",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {p === 0 ? "No tip" : `${p}%`}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ fontSize: 13, fontWeight: 800, opacity: 0.8 }}>Custom tip ($)</label>
        <input
          inputMode="decimal"
          value={tipCustom}
          onChange={(e) => {
            setTipCustom(e.target.value);
            setTipPreset(0);
          }}
          placeholder="e.g. 5"
          style={{
            height: 44,
            borderRadius: 12,
            border: "1px solid #e5e5e5",
            padding: "0 12px",
            outline: "none",
            background: "#fff",
            fontWeight: 700,
          }}
        />
      </div>

      {/* ✅ Tip + Total preview */}
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900 }}>
        <div>Tip</div>
        <div>${tipAmount.toFixed(2)}</div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900 }}>
        <div>Total (with tip)</div>
        <div>${finalTotal.toFixed(2)}</div>
      </div>

      <div style={{ fontWeight: 900, fontSize: 14, marginTop: 6 }}>Payment</div>

      <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 14 }}>
        <PaymentElement />
      </div>

      <button
        type="submit" 
        disabled={isPaying}
        style={{
          height: 48,
          borderRadius: 14,
          border: "none",
          background: "#000",
          color: "#fff",
          fontWeight: 900,
          cursor: "pointer",
          opacity: isPaying ? 0.6 : 1,
        }}
      >
        {isPaying ? "Processing..." : "Pay now"}
      </button>

      {message ? <div style={{ color: "crimson", fontSize: 13 }}>{message}</div> : null}
    </form>
  );
}