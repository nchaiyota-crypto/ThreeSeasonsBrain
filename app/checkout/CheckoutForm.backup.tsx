"use client";

import React, { useEffect, useState } from "react";
import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

export default function CheckoutForm() {
  const stripe = useStripe();
  const elements = useElements();
  const [isPaying, setIsPaying] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [nameError, setNameError] = useState("");

  // optional: load saved name if you want
  useEffect(() => {
    const raw = localStorage.getItem("last_order");
    if (raw) {
      try {
        const o = JSON.parse(raw);
        if (o?.customerName) setCustomerName(o.customerName);
      } catch {}
    }
  }, []);

  async function handlePay() {
    const name = customerName.trim();
    if (!name) {
      setNameError("Please enter your full name.");
      return;
    }
    setNameError("");

    // ✅ Persist name to last_order so success page always has latest info
    try {
      const raw = localStorage.getItem("last_order");
      if (raw) {
        const o = JSON.parse(raw);
        o.customerName = name;
        localStorage.setItem("last_order", JSON.stringify(o));
      }
    } catch {}

    if (!stripe || !elements) return;

    setIsPaying(true);

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        payment_method_data: {
          billing_details: { name },
        },
        return_url: `${window.location.origin}/checkout/success`,
      },
    });

    if (result.error) {
      alert(result.error.message ?? "Payment failed");
      setIsPaying(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
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

      <div style={{ fontWeight: 900, fontSize: 14, marginTop: 6 }}>Payment</div>

      <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 14 }}>
        <PaymentElement />
      </div>

      <button
        type="button"
        onClick={handlePay}
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
    </div>
  );
}