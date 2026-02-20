"use client";

import { useEffect, useState } from "react";

type LastOrder = {
  orderNumber?: string;
  pickupMode?: "asap" | "schedule";
  estimateMin?: number;
  pickupTimeISO?: string;

  // ✅ NEW
  pickupScheduledAt?: string;
  pickup_scheduled_at?: string;
  estimatedReadyAt?: string;
  estimated_ready_at?: string;

  subtotal?: number;
  tax?: number;
  total?: number;
  items?: Array<{
    key: string;
    qty: number;
    name: string;
    optionsSummary?: string;
    specialInstructions?: string;
    note?: string;
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

    const scheduledISO =
    order.pickupScheduledAt ??
    order.pickup_scheduled_at ??
    order.pickupTimeISO; // fallback

    const pickupLabel =
      order.pickupMode === "schedule"
        ? `Scheduled (${
            scheduledISO
              ? new Date(scheduledISO).toLocaleString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "Selected time"
          })`
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
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
        Pickup: {pickupLabel}
      </div>
      <div style={{ marginTop: 12, borderTop: "1px solid #eaeaea", paddingTop: 10, display: "grid", gap: 8 }}>
        {(order.items ?? []).map((it: any, idx: number) => {
          const key =
            it.key ??
            `${it.itemId ?? it.menu_item_id ?? it.name ?? "item"}-${idx}`;

          const options =
            it.optionsSummary ??
            it.options_summary ??
            it.modifiersSummary ??
            "";

          const note =
            it.specialInstructions ??
            it.special_instructions ??
            it.note ??
            it.instructions ??
            "";

          return (
            <div key={key}>
              <div style={{ fontWeight: 800 }}>
                {it.qty}× {it.name}
              </div>

              {options ? (
                <div style={{ fontSize: 12, opacity: 0.7 }}>{options}</div>
              ) : null}

              {note ? (
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                  <b>Note:</b> {note}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}