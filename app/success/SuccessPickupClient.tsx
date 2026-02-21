"use client";

function fmt(dt: Date) {
  return dt.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SuccessPickupClient({
  pickupScheduledAt,
  estimatedReadyAt,
}: {
  pickupScheduledAt: string | null;
  estimatedReadyAt: string | null;
}) {
  let line = "Pickup ASAP";

  if (pickupScheduledAt) {
    const d = new Date(pickupScheduledAt);
    line = `Scheduled pickup: ${fmt(d)}`;
  } else if (estimatedReadyAt) {
    const d = new Date(estimatedReadyAt);
    line = `Pickup ASAP: ready ~${d.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        borderTop: "1px solid var(--border)",
        background: "var(--background)",
        borderRadius: 12,
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