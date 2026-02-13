"use client";

import { useEffect, useState } from "react";

type LastOrder = {
  orderNumber?: string;
  pickupMode?: "asap" | "schedule";
  estimateMin?: number;
  pickupTimeISO?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  items?: Array<{
    key: string;
    qty: number;
    name: string;
    optionsSummary?: string;
  }>;
};

function money(n: number) {
  return (n ?? 0).toFixed(2);
}

export default function OrderSummary() {
  const [order, setOrder] = useState<LastOrder | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("last_order");
    if (!raw) return;
    try {
      setOrder(JSON.parse(raw));
    } catch {}
  }, []);

  if (!order) return null;

  const pickupLabel =
    order.pickupMode === "schedule"
      ? `Scheduled (${order.pickupTimeISO ? new Date(order.pickupTimeISO).toLocaleString() : "Selected time"})`
      : `ASAP (~${order.estimateMin ?? 35} min)`;

  return (
    <div
      style={{
        border: "1px solid #e8e8e8",
        borderRadius: 14,
        padding: 14,
        background: "#fafafa",
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div style={{ fontWeight: 900 }}>
          Order Summary
        </div>
      </div>

      <div style={{ marginTop: 12, borderTop: "1px solid #eaeaea", paddingTop: 10, display: "grid", gap: 8 }}>
        {(order.items ?? []).map((it) => (
          <div key={it.key}>
            <div style={{ fontWeight: 800 }}>
              {it.qty}× {it.name}
            </div>
            {it.optionsSummary ? (
              <div style={{ fontSize: 12, opacity: 0.7 }}>{it.optionsSummary}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}