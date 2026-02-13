"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type TicketOrder = {
  order_number?: number | null;
  order_type?: string | null;
  source?: string | null;
};

type TicketRow = {
  id: string;
  order_id: string;
  station: string;
  status: string;
  created_at: string;
  orders?: TicketOrder[] | null; // ✅ array (nested select returns array)
};

type TicketItemRow = {
  id: string;
  kds_ticket_id: string;
  display_name: string;
  qty: number;
};

export default function KDSPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [itemsByTicket, setItemsByTicket] = useState<Record<string, TicketItemRow[]>>({});
  const [error, setError] = useState<string>("");

  async function load() {
    setError("");

    // ✅ must have session, otherwise go login
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) {
      window.location.href = "/kds/login";
      return;
    }

    const { data: tData, error: tErr } = await supabase
      .from("kds_tickets")
      .select("id, order_id, station, status, created_at, orders(order_number, order_type, source)")
      .eq("station", "kitchen")
      .in("status", ["new"])
      .order("created_at", { ascending: true });

    if (tErr) {
      setError(tErr.message);
      return;
    }

    const ticketIds = (tData ?? []).map((t) => t.id);

    const { data: iData, error: iErr } = ticketIds.length
      ? await supabase
          .from("kds_ticket_items")
          .select("id, kds_ticket_id, display_name, qty")
          .in("kds_ticket_id", ticketIds)
      : { data: [], error: null };

    if (iErr) {
      setError(iErr.message);
      return;
    }

    const map: Record<string, TicketItemRow[]> = {};
    for (const it of iData ?? []) (map[it.kds_ticket_id] ||= []).push(it);

    setTickets((tData ?? []) as TicketRow[]);
    setItemsByTicket(map);
  }

    useEffect(() => {
      load();

      const interval = setInterval(() => {
        load();
      }, 5000);

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) window.location.href = "/kds/login";
      });

      return () => {
        clearInterval(interval);
        sub.subscription.unsubscribe();
      };
    }, []);

  return (
    <main style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Kitchen KDS</h1>
        <div style={{ display: "flex", gap: 12 }}>
          <button onClick={load} style={{ border: "1px solid #ddd", padding: "8px 12px", borderRadius: 10 }}>
            Refresh
          </button>
          <Link href="/menu">Menu</Link>
        </div>
      </div>

      <p style={{ opacity: 0.7 }}>Showing <b>NEW</b> tickets only.</p>

      {error ? (
        <div style={{ color: "crimson", border: "1px solid #f2c", padding: 12, borderRadius: 12 }}>
          {error}
        </div>
      ) : null}

      {tickets.length === 0 ? (
        <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12 }}>
          No new tickets ✅
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {tickets.map((t) => (
            <div key={t.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>
                    Order #{t.orders?.[0]?.order_number ?? "—"}
                  </div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>Ticket: {t.id}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700 }}>{t.status}</div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    {new Date(t.created_at).toLocaleString()}
                  </div>
                </div>
              </div>

              <ul style={{ marginTop: 10, marginBottom: 0, paddingLeft: 18 }}>
                {(itemsByTicket[t.id] ?? []).map((it) => (
                  <li key={it.id}>{it.display_name} × {it.qty}</li>
                ))}
              </ul>

              <form action="/api/kds/mark-done" method="POST" style={{ marginTop: 12 }}>
                <input type="hidden" name="ticketId" value={t.id} />
                <button style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", cursor: "pointer", fontWeight: 700 }}>
                  Mark Done
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}