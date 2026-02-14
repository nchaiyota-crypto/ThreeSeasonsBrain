"use client";

import { useEffect, useMemo, useState } from "react";

type LastOrder = {
  orderNumber?: string;
  pickupMode?: "asap" | "schedule";
  pickupTimeISO?: string;
  estimateMin?: number;
  total?: number;
  createdAt?: string;
};

function formatSlot(localValue: string) {
  // localValue like "2026-02-10T16:15"
  const [datePart, timePart] = localValue.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);

  return dt.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SuccessSummaryClient() {
  const [last, setLast] = useState<LastOrder | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("last_order");
      if (!raw) return;
      setLast(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const estimateText = useMemo(() => {
    if (!last) return null;

    if (last.pickupMode === "schedule" && last.pickupTimeISO) {
      return `Scheduled pickup: ${formatSlot(last.pickupTimeISO)}`;
    }

    const mins = typeof last.estimateMin === "number" ? last.estimateMin : null;
    return mins ? `Pickup ASAP: ready in ~${mins} minutes` : "Pickup ASAP";
  }, [last]);

  return (
    <div
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: 18,
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 900 }}>Order Confirmed ✅</div>

      {last?.orderNumber ? (
        <div style={{ marginTop: 8, opacity: 0.75 }}>Order #{last.orderNumber}</div>
      ) : null}

      <div
        style={{
          marginTop: 16,
          padding: 16,
          borderRadius: 16,
          border: "1px solid #e8e8e8",
          background: "#fff",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Pickup</div>
        <div style={{ fontSize: 15, opacity: 0.85 }}>{estimateText ?? "Pickup details not found."}</div>

        {typeof last?.total === "number" ? (
          <div style={{ marginTop: 12, fontWeight: 900 }}>Total Paid: ${last.total.toFixed(2)}</div>
        ) : null}
      </div>

      <div style={{ marginTop: 16, opacity: 0.7, fontSize: 13 }}>
        Thank you for ordering 3 Seasons Thai Bistro!
      </div>
    </div>
  );
}