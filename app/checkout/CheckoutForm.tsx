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
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(true);
  const [subtotal, setSubtotal] = useState<number>(0);
  const [tax, setTax] = useState<number>(0);
  const [serviceFee, setServiceFee] = useState<number>(0);


useEffect(() => {
  if (typeof window === "undefined") return;

  const raw = localStorage.getItem("last_order");
  if (!raw) return;

  try {
    const o = JSON.parse(raw);

    const sub = Number(o?.subtotal ?? 0);
    const tx = Number(o?.tax ?? 0);
    const fee = Number(o?.serviceFee ?? o?.service_fee ?? o?.onlineServiceFee ?? 0);

    setSubtotal(sub);
    setTax(tx);
    setServiceFee(fee);
    setBaseTotal(Number((sub + tx + fee).toFixed(2)));

    if (o?.customerName) setCustomerName(o.customerName);
    if (o?.customerEmail) setCustomerEmail(o.customerEmail);
    if (o?.customerPhone) setCustomerPhone(o.customerPhone);
    if (typeof o?.smsOptIn === "boolean") setSmsOptIn(o.smsOptIn);

    console.log("✅ loaded last_order:", { sub, tx, fee });
  } catch (e) {
    console.log("❌ last_order parse failed", e);
  }
}, []);
useEffect(() => {
  const t = setTimeout(async () => {
    try {
      const raw = localStorage.getItem("last_order");
      if (!raw) return;
      const o = JSON.parse(raw);
      if (!o?.orderId) return;

      const phoneE164 = normalizeUSPhone(customerPhone);

      // update localStorage
      localStorage.setItem(
        "last_order",
        JSON.stringify({
          ...o,
          customerName,
          customerPhone,
          customerEmail,
          smsOptIn,
        })
      );

      // save to DB only if name exists
      const email = customerEmail.trim().toLowerCase();

      if (email.includes("@")) {
        await fetch("/api/orders/customer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: o.orderId,
            customerName: customerName.trim() || null,
            customerPhone: phoneE164 ?? null,
            customerEmail: email,
            smsOptIn,
          }),
        });
      }
    } catch {
      // ignore
    }
  }, 500);

  return () => clearTimeout(t);
}, [customerName, customerPhone, customerEmail, smsOptIn]);

    // ✅ Read base total from last_order (what Stripe is currently charging)
  const custom = tipCustom.trim() === "" ? 0 : Number.parseFloat(tipCustom);
  const safeCustom = Number.isFinite(custom) ? Math.max(0, custom) : 0;

  console.log("DEBUG totals:", { subtotal, tax, serviceFee, baseTotal, tipPreset, tipCustom });
  const tipAmount =
    safeCustom > 0
      ? safeCustom
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

  function normalizeUSPhone(input: string): string | null {
    const digits = (input || "").replace(/\D/g, "");

    // 10 digits => US local
    if (digits.length === 10) return `+1${digits}`;

    // 11 digits starting with 1 => already includes country code
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

    return null; // invalid
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

    const email = customerEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setMessage("Please enter a valid email for receipt & updates.");
      return;
    }

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
    const phoneE164 = normalizeUSPhone(customerPhone);

    // If they want SMS, phone must be valid
    if (smsOptIn && !phoneE164) {
      setMessage("Please enter a valid US phone number (ex: 510-479-3339).");
      return;
    }

        // ✅ Save customer name/phone/opt-in to Supabase BEFORE payment
        try {
          const res = await fetch("/api/orders/customer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId,
              customerName: name,
              customerPhone: phoneE164,
              customerEmail: email,
              smsOptIn,
            }),
          });
          const data = await res.json().catch(() => ({}));

          if (!res.ok) {
            console.error("customer failed:", res.status, data);
            setMessage(data?.error ?? "Failed to save customer info");
            return; // ✅ block payment until DB saves (for now)
          }
          console.log("✅ updated:", data);
        } catch (e) {
          console.error("❌ customer save crashed:", e);
          setMessage("Failed to save customer info (network error)");
          return; // block for now
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

      // ✅ STEP 3: refresh Stripe PaymentElement after PI amount changes
      await elements.fetchUpdates();

      // optional: store tip in last_order so success page can show it
      try {
        const raw2 = localStorage.getItem("last_order");
        if (raw2) {
          const o2 = JSON.parse(raw2);
          o2.tipCents = tipCents;
          o2.totalWithTip = Number(o2.total ?? 0) + tipCents / 100;
          localStorage.setItem("last_order", JSON.stringify(o2));
        }
      } catch {}
    
      // IMPORTANT: Stripe PaymentElement must refresh after PI amount changes
    }

    // ✅ Persist customer info (name + phone + sms opt-in)
    try {
      const raw = localStorage.getItem("last_order");
        if (raw) {
          const o = JSON.parse(raw);
          o.customerName = name;
          o.customerPhone = phoneE164 ?? ""; // ✅ normalized (or blank)
          o.customerEmail = email;
          o.smsOptIn = smsOptIn;
          localStorage.setItem("last_order", JSON.stringify(o));
        }
      } catch {}

      if (isPaying) return;
      setIsPaying(true);

      try {
        // ✅ IMPORTANT: validate PaymentElement first (this is what triggers the card UI validation)
        const { error: submitError } = await elements.submit();
        if (submitError) {
          setMessage(submitError.message ?? "Please check your payment details.");
          return;
        }
        
        const origin = window.location.origin;

        // ✅ IMPORTANT: match your real route
        // If your file is app/checkout/success/page.tsx use "/checkout/success"
        // If your file is app/success/page.tsx use "/success"
        const successPath = "/checkout/success"; // <-- CHANGE if needed
        const returnUrl = `${origin}${successPath}?orderId=${encodeURIComponent(orderId)}`;

        const result = await stripe.confirmPayment({
          elements,
          confirmParams: {
            payment_method_data: { billing_details: { name } },
            return_url: returnUrl,
          },
          redirect: "if_required",
        });

        if (result.error) {
          setMessage(result.error.message ?? "Payment failed");
          return;
        }

        // ✅ If Stripe didn't redirect automatically, we MUST do it
        // Sometimes result.paymentIntent is undefined even when it worked.
        const status = result.paymentIntent?.status;

        if (status === "succeeded" || status === "processing" || !status) {
          window.location.assign(returnUrl);
          return;
        }

        setMessage(`Payment status: ${status}`);
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
                placeholder="e.g. Enter full name "
                style={{
                  height: 44,
                  borderRadius: 12,
                  padding: "0 12px",
                  outline: "none",
                  background: "var(--card)",
                  color: "var(--foreground)",
                  border: nameError
                    ? "1px solid #e11d48"
                    : "1px solid var(--border)",
                  fontWeight: 700,
                }}
              />
              {nameError ? <div style={{ color: "#e11d48", fontSize: 12 }}>{nameError}</div> : null}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 800, opacity: 0.8 }}>
                Email (for receipt & updates)
              </label>

              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="e.g. you@example.com"
                autoComplete="email"
                required
                style={{
                  height: 44,
                  borderRadius: 12,
                  padding: "0 12px",
                  outline: "none",
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  color: "var(--foreground)",
                  fontWeight: 700,
                }}
              />
            </div>

            {/* ✅ Phone + SMS opt-in */}
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 800, opacity: 0.8 }}>
                Phone (for pickup SMS)
              </label>

              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="e.g. Enter phone number"
                style={{
                  height: 44,
                  borderRadius: 12,
                  padding: "0 12px",
                  outline: "none",
                  border: "1px solid var(--border)",
                  background: "var(--btnAltBg)",
                  color: "var(--btnAltText)",
                  fontWeight: 700,
                }}
              />

              <label
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  fontSize: 12,
                  opacity: 0.9,
                }}
              >
                <input
                  type="checkbox"
                  checked={smsOptIn}
                  onChange={(e) => setSmsOptIn(e.target.checked)}
                />
                I agree to receive SMS order updates (confirmation, acceptance, ready).
              </label>

              {/* ✅ A2P CTA disclosure (REQUIRED) */}
              <div style={{ fontSize: 12, lineHeight: 1.35, opacity: 0.75 }}>
                Message frequency varies. Msg &amp; data rates may apply. Reply <b>STOP</b> to opt out,
                reply <b>HELP</b> for help. By checking this box, you consent to receive transactional
                SMS about your order. See our{" "}
                <a href="/privacy-policy" target="_blank" rel="noreferrer">
                  Privacy Policy
                </a>{" "}
                and{" "}
                <a href="/terms" target="_blank" rel="noreferrer">
                  Terms
                </a>
                .
              </div>
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
                    border:
                      tipPreset === p && tipCustom === ""
                        ? "2px solid var(--foreground)"
                        : "1px solid var(--border)",
                    background:
                      tipPreset === p && tipCustom === ""
                        ? "var(--foreground)"
                        : "var(--card)",
                    color:
                      tipPreset === p && tipCustom === ""
                        ? "var(--background)"
                        : "var(--foreground)",
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
                  padding: "0 12px",
                  outline: "none",
                  border: "1px solid var(--border)",
                  background: "var(--btnAltBg)",
                  color: "var(--btnAltText)",
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

            <div
              style={{
                padding: 12,
                border: "1px solid var(--border)",
                borderRadius: 14,
                background: "var(--card)",
                color: "var(--foreground)",
              }}
            >
              <PaymentElement />
            </div>

            <button
              type="submit" 
              disabled={isPaying}
              style={{
                height: 48,
                borderRadius: 14,
                border: "none",
                background: "var(--btn)",
                color: "var(--btnText)",
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