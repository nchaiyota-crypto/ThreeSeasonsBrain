"use client";

import { useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  readLastOrderRaw,
  writeLastPaidOrder,
  clearAllCheckoutStorage,
} from "@/lib/cartStorage";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

type Order = {
  orderId?: string;
  customerName?: string;
  orderNumber: string;
  items: any[];
  subtotal: number;
  tax: number;

  // total = subtotal + tax + service fee (server truth)
  total: number;

  // ✅ add these
  service_fee_cents?: number; // cents (from DB)
  total_cents?: number;       // cents (from DB)

  // ✅ Tip support
  tipCents?: number;        // cents
  totalWithTip?: number;    // dollars

  pickupMode: "asap" | "schedule";
  pickupDate?: string;
  pickupTimeISO?: string;
  estimateMin?: number;
};

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

//add special request box
function mergeItemsPreserveNotes(supaItems: any[] | null | undefined, lastItems: any[]) {
  if (!Array.isArray(supaItems) || supaItems.length === 0) return lastItems;

  const byKey = new Map(lastItems.map((x) => [x.key, x]));
  return supaItems.map((it) => {
    const local = byKey.get(it.key);
    return {
      ...it,
      // keep local note fields if Supabase doesn't have them
      specialInstructions: it.specialInstructions ?? local?.specialInstructions,
      note: it.note ?? local?.note,
      optionsSummary: it.optionsSummary ?? local?.optionsSummary,
      imageUrl: it.imageUrl ?? local?.imageUrl,
    };
  });
}

function clearCartStorage() {
  // ✅ remove whatever your cart uses (safe even if key doesn't exist)
  const keys = [
    "cart",
    "cart_items",
    "cart_map",
    "cart_v1",
    "checkout_cart",
    "last_cart",
    // optional: if you store anything else cart-like, add here
  ];
  keys.forEach((k) => localStorage.removeItem(k));
}

export default function CheckoutSuccess() {
  const [status, setStatus] = useState<"loading" | "paid" | "not_paid" | "error">("loading");
  const [order, setOrder] = useState<Order | null>(null);
  const [msg, setMsg] = useState<string>("");

  // ✅ fetch official order_number from Supabase using orderId
  async function refreshOrderNumberFromSupabase(orderId?: string) {
    if (!orderId) return;

    try {
      const res = await fetch(`/api/orders/get?orderId=${encodeURIComponent(orderId)}`, {
        method: "GET",
      });
      const data = await res.json();

      if (!res.ok) {
        console.warn("Supabase order fetch failed:", data?.error || res.statusText);
        return;
      }

      if (data?.orderNumber) {
        setOrder((prev) => {
          if (!prev) return prev;
          return { ...prev, orderNumber: String(data.orderNumber) };
        });
      }
    } catch (e) {
      console.warn("Supabase order fetch error:", e);
    }
  }

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        const url = new URL(window.location.href);
        const paymentIntentClientSecret = url.searchParams.get("payment_intent_client_secret");
        const redirectStatus = url.searchParams.get("redirect_status"); // succeeded
        const paymentIntentId = url.searchParams.get("payment_intent");

        // 0) Read orderId from URL (so we show the correct confirmation)
        const orderIdFromUrl = url.searchParams.get("orderId") || undefined;

        // 0b) If we already have a locked paid order, ONLY use it if it matches this orderId
        const existingPaid = safeParse<Order>(localStorage.getItem("last_paid_order"));
        if (existingPaid && orderIdFromUrl && existingPaid.orderId === orderIdFromUrl && alive) {
          setOrder(existingPaid);
          setStatus("paid");
          clearAllCheckoutStorage();
          return;
        }

        // 1) Read last order (supports both keys)
        const raw = readLastOrderRaw();
        const last: Order | null = raw ? JSON.parse(raw) : null;

        if (!last) {
          setStatus("error");
          setMsg("No order found in storage.");
          return;
        }

        // Helper: fetch “official” order from Supabase (POST only)
        async function pullFromSupabase(orderId?: string) {
          if (!orderId) return null;
          const r = await fetch("/api/orders/get", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId }),
          });
          const data = await r.json();
          if (!r.ok) return null;
          return data;
        }

        // 2) Determine if paid
        let isPaid = redirectStatus === "succeeded";

        // If no redirectStatus, verify using Stripe client secret (when present)
        if (!isPaid && paymentIntentClientSecret) {
          const stripe = await stripePromise;
          if (!stripe) throw new Error("Stripe failed to load");
          const { paymentIntent } = await stripe.retrievePaymentIntent(paymentIntentClientSecret);
          if (!paymentIntent) throw new Error("Missing payment intent");
          isPaid = paymentIntent.status === "succeeded";
          if (!isPaid) {
            setStatus("not_paid");
            setOrder(last);
            setMsg(`Payment status: ${paymentIntent.status}`);
            return;
          }
        }

        // If we can’t verify, show warning UI but don’t clear anything
        if (!isPaid && !paymentIntentClientSecret) {
          // ✅ verify by orderId via server (Stripe secret)
          const targetOrderId = orderIdFromUrl || last.orderId;
          if (!targetOrderId) {
            setStatus("error");
            setOrder(last);
            setMsg("Missing orderId for verification.");
            return;
          }

          const r = await fetch(`/api/orders/status?orderId=${encodeURIComponent(targetOrderId)}`);
          const data = await r.json();

        if (data?.paid) {
          isPaid = true;
          setMsg("");
        } else {
          setStatus("not_paid");
          setOrder(last);
          setMsg(`We couldn't verify payment yet. Server status: ${data?.piStatus || "unknown"}`);
          return;
        }
        }

        // 3) PAID — pull official order from Supabase (orderNumber + items + totals)
        const targetOrderId = orderIdFromUrl || last.orderId;
        if (!targetOrderId) {
          setStatus("error");
          setOrder(last);
          setMsg("Missing orderId for confirmation.");
          return;
        }

        const supa = await pullFromSupabase(targetOrderId);

        // ✅ helpers: don't let [] or 0 overwrite the real order from localStorage
        const mergedSubtotal =
          typeof supa?.subtotal === "number" && supa.subtotal > 0 ? supa.subtotal : last.subtotal;

        const mergedTax =
          typeof supa?.tax === "number" && supa.tax > 0 ? supa.tax : last.tax;

        const mergedTotal =
          typeof supa?.total === "number" && supa.total > 0 ? supa.total : last.total;
        
        // ✅ TIP merge (prefer Supabase; fallback to localStorage last_order)
        const mergedTipCents =
          typeof supa?.tip_cents === "number"
            ? supa.tip_cents
            : typeof (last as any)?.tipCents === "number"
              ? (last as any).tipCents
              : typeof (last as any)?.tip_cents === "number"
                ? (last as any).tip_cents
                : 0;

        const supaTotalWithTip =
          typeof supa?.total_with_tip_cents === "number" ? supa.total_with_tip_cents / 100 : 0;

        const mergedTotalWithTip =
          supaTotalWithTip > 0
            ? supaTotalWithTip
            : (typeof (last as any)?.totalWithTip === "number" && (last as any).totalWithTip > 0)
              ? (last as any).totalWithTip
              : (mergedTotal + mergedTipCents / 100);

        // Protein/Add-on merged
        const lastItems = Array.isArray(last.items) ? last.items : [];
        const supaItems = Array.isArray(supa?.items) ? supa.items : [];

        // Prefer Supabase for "note/specialInstructions", but keep local "optionsSummary"
        const mergedItems =
          supaItems.length > 0
            ? supaItems.map((si: any) => {
                const li =
                  lastItems.find((x: any) => x.key && si.key && x.key === si.key) ||
                  lastItems.find((x: any) => x.itemId && si.itemId && x.itemId === si.itemId) ||
                  lastItems.find((x: any) => x.name && si.name && x.name === si.name);

                return {
                  ...li,               // brings optionsSummary, imageUrl, etc
                  ...si,               // brings note/specialInstructions from DB
                  optionsSummary: si.optionsSummary ?? li?.optionsSummary,
                  note: si.note ?? li?.note,
                  specialInstructions: si.specialInstructions ?? li?.specialInstructions,
                };
              })
            : lastItems;

        // ✅ SERVICE FEE merge (prefer Supabase; fallback to local)
        const mergedServiceFeeCents =
          typeof supa?.service_fee_cents === "number"
            ? supa.service_fee_cents
            : typeof (last as any)?.service_fee_cents === "number"
              ? (last as any).service_fee_cents
              : 0;

        // ✅ total cents (for exact display math)
        const mergedTotalCents =
          typeof supa?.total_cents === "number"
            ? supa.total_cents
            : Math.round(mergedTotal * 100);      

        const finalOrder: Order = {
          ...last,
          customerName: String(supa?.customerName ?? supa?.customer_name ?? last.customerName ?? ""),
          orderId: targetOrderId,
          orderNumber: String(supa?.orderNumber ?? last.orderNumber),
          items: mergedItems,
          subtotal: mergedSubtotal,
          tax: mergedTax,
          total: mergedTotal,
          service_fee_cents: mergedServiceFeeCents,
          total_cents: mergedTotalCents,
          tipCents: mergedTipCents,
          totalWithTip: mergedTotalWithTip,
          pickupMode: (supa?.pickupMode ?? last.pickupMode ?? "asap") as any,
          pickupTimeISO: supa?.pickupTimeISO ?? last.pickupTimeISO,
          estimateMin: supa?.estimateMin ?? last.estimateMin,
        };

        // 4) Lock paid order + clear cart/order keys
        writeLastPaidOrder(finalOrder);
        if (alive) {
          setOrder(finalOrder);
          setStatus("paid");
        }

        clearAllCheckoutStorage();
        window.dispatchEvent(new Event("storage"));
      } catch (e: any) {
        if (!alive) return;
        setStatus("error");
        setMsg(e?.message ?? "Failed to verify payment.");
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, []);

  const pickupText = useMemo(() => {
    if (!order) return "";
    if (order.pickupMode === "asap") return `ASAP (~${order.estimateMin ?? 35} min)`;
    if (order.pickupTimeISO) return `Scheduled: ${new Date(order.pickupTimeISO).toLocaleString()}`;
    return "Scheduled";
  }, [order]);

  if (status === "loading") {
    return <div style={{ maxWidth: 720, margin: "40px auto", padding: 20 }}>Verifying payment…</div>;
  }

  if (!order) {
    return (
      <div style={{ maxWidth: 720, margin: "40px auto", padding: 20 }}>
        <h2>{status === "paid" ? "✅ Payment successful" : "Order status"}</h2>
        <p style={{ opacity: 0.8 }}>{msg || "No order found."}</p>
        <div style={{ marginTop: 14 }}>
          <a href="/menu">← Back to Menu</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 20 }}>
      <h2 style={{ marginBottom: 6 }}>{status === "paid" ? "✅ Payment successful" : "⚠️ Order status"}</h2>

      <p style={{ opacity: 0.8 }}>{status === "paid" ? "Your order is confirmed." : msg}</p>
      {status === "paid" && msg ? <p style={{ opacity: 0.6, fontSize: 12 }}>{msg}</p> : null}

      <div style={{ marginTop: 18, padding: 14, border: "1px solid #eee", borderRadius: 14, background: "#fafafa" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 900 }}>Order #{order.orderNumber}</div>
            {order.customerName ? (
              <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
                Name: {order.customerName}
              </div>
            ) : null}
            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>Pickup: {pickupText}</div>
          </div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>
            ${(order.totalWithTip ?? (order.total + (order.tipCents ?? 0) / 100)).toFixed(2)}
          </div>
        </div>

        <div style={{ marginTop: 12, borderTop: "1px solid #e9e9e9", paddingTop: 12 }}>
          {order.items.map((it: any) => (
            <div key={it.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 800 }}>
                  {it.qty}× {it.name}
                </div>

                {it.optionsSummary ? (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{it.optionsSummary}</div>
                ) : null}

                {(it.specialInstructions || it.note) ? (
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                    <b>Note:</b> {it.specialInstructions || it.note}
                  </div>
                ) : null}
              </div>

              <div style={{ fontWeight: 800, whiteSpace: "nowrap" }}>
                ${(it.unitPrice * it.qty).toFixed(2)}
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: "1px solid #e9e9e9", paddingTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ opacity: 0.75 }}>Subtotal</div>
            <div style={{ fontWeight: 900 }}>${order.subtotal.toFixed(2)}</div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ opacity: 0.75 }}>Tax</div>
            <div style={{ fontWeight: 900 }}>${order.tax.toFixed(2)}</div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ opacity: 0.75 }}>Tip</div>
            <div style={{ fontWeight: 900 }}>${((order.tipCents ?? 0) / 100).toFixed(2)}</div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ opacity: 0.75 }}>Online Service Fee</div>
            <div style={{ fontWeight: 900 }}>
              ${((order.service_fee_cents ?? 0) / 100).toFixed(2)}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 0 }}>
            <div style={{ opacity: 0.75 }}>Total</div>
            <div style={{ fontWeight: 900 }}>
              ${(order.totalWithTip ?? (order.total + (order.tipCents ?? 0) / 100)).toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      <p style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>Please show this confirmation at pickup.</p>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <a href="/" style={{ flex: 1 }}>
          <button style={{ width: "100%", height: 44, borderRadius: 12 }}>Back to Home</button>
        </a>
        <a href="/menu" style={{ flex: 1 }}>
          <button style={{ width: "100%", height: 44, borderRadius: 12 }}>New Order</button>
        </a>
      </div>
    </div>
  );
}