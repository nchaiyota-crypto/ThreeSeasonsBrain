import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import SuccessClient from "./SuccessClient";
import SuccessPickupClient from "./SuccessPickupClient";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: { orderId?: string; session_id?: string };
}) {
  const orderId = searchParams.orderId;

  const supabase = createClient(
    must("NEXT_PUBLIC_SUPABASE_URL"),
    must("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  // Load order summary
  const { data: order, error: oErr } = orderId
    ? await supabase
        .from("orders")
        .select(
          "id, order_number, status, payment_status, subtotal_cents, tax_cents, total_cents, paid_at, pickup_scheduled_at, estimated_ready_at"
        )
        .eq("id", orderId)
        .single()
    : { data: null, error: { message: "Missing orderId" } as any };

  // Load items
  const { data: items, error: iErr } = orderId
    ? await supabase
        .from("order_items")
        .select("menu_item_name, qty, base_price_cents, line_subtotal_cents")
        .eq("order_id", orderId)
        .order("menu_item_name", { ascending: true })
    : { data: null, error: { message: "Missing orderId" } as any };

  const fmt = (cents?: number | null) =>
    typeof cents === "number" ? `$${(cents / 100).toFixed(2)}` : "-";

  return (
    <main style={{ padding: 24, maxWidth: 920, margin: "0 auto" }}>
      {/* ✅ This clears localStorage on the client */}
      <SuccessClient />

      <h1>Payment received ✅</h1>
      <SuccessPickupClient
        pickupScheduledAt={order?.pickup_scheduled_at ?? null}
        estimatedReadyAt={order?.estimated_ready_at ?? null}
      />

      {!orderId ? (
        <p style={{ color: "crimson" }}>Missing orderId in URL.</p>
      ) : null}

      {oErr ? (
        <p style={{ color: "crimson" }}>
          Could not load order: {String(oErr.message ?? oErr)}
        </p>
      ) : null}

      {order ? (
        <>
          <p style={{ opacity: 0.75 }}>
            Order #{order.order_number} • Order ID: {order.id}
          </p>

          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 16,
              marginTop: 12,
            }}
          >
            <h2 style={{ marginTop: 0 }}>Summary</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "180px 1fr",
                rowGap: 6,
              }}
            >
              <div>Order status</div>
              <div style={{ fontWeight: 700 }}>{order.status}</div>

              <div>Payment status</div>
              <div style={{ fontWeight: 700 }}>{order.payment_status}</div>

              <div>Subtotal</div>
              <div>{fmt(order.subtotal_cents)}</div>

              <div>Tax</div>
              <div>{fmt(order.tax_cents)}</div>

              <div>Total</div>
              <div style={{ fontWeight: 800 }}>{fmt(order.total_cents)}</div>

              <div>Paid at</div>
              <div>
                {order.paid_at ? new Date(order.paid_at).toLocaleString() : "-"}
              </div>
            </div>
          </div>

          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 16,
              marginTop: 12,
            }}
          >
            <h2 style={{ marginTop: 0 }}>Items</h2>

            {iErr ? (
              <p style={{ color: "crimson" }}>
                Could not load order_items: {String(iErr.message ?? iErr)}
              </p>
            ) : null}

            {!items || items.length === 0 ? (
              <p style={{ opacity: 0.7 }}>No items found.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {items.map((it, idx) => (
                  <li key={idx}>
                    {it.menu_item_name} × {it.qty}{" "}
                    <span style={{ opacity: 0.7 }}>
                      (
                      {fmt(
                        it.line_subtotal_cents ??
                          (it.base_price_cents ?? 0) * (it.qty ?? 1)
                      )}
                      )
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}

      <p style={{ marginTop: 16 }}>
        <Link href="/menu">Back to menu</Link>
      </p>
    </main>
  );
}