"use client";

import { useEffect, useMemo, useState } from "react";

type LastOrder = {
  pickupMode?: "asap" | "schedule";
  pickupTimeISO?: string; // "YYYY-MM-DDTHH:mm" (local)
  estimateMin?: number;
};

function formatSlot(localValue: string) {
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

export default function SuccessPickupClient() {
  const [last, setLast] = useState<LastOrder | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("last_order");
      if (!raw) return;
      setLast(JSON.parse(raw));
    } catch {}
  }, []);

  const line = useMemo(() => {
    if (!last) return null;

    if (last.pickupMode === "schedule" && last.pickupTimeISO) {
      return `Scheduled pickup: ${formatSlot(last.pickupTimeISO)}`;
    }

    if (typeof last.estimateMin === "number") {
      return `Pickup ASAP: ready in ~${last.estimateMin} minutes`;
    }

    return "Pickup ASAP";
  }, [last]);

  if (!line) return null;

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        border: "1px solid #eee",
        borderRadius: 12,
        background: "#fff",
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Pickup</div>
      <div style={{ fontWeight: 800 }}>{line}</div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.65 }}>
        Please arrive at your selected pickup time.
      </div>
    </div>
  );
}