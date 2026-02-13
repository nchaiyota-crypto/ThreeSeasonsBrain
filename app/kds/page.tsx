// app/kds/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
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
  status: "new" | "in_progress" | "done" | string;
  created_at: string;
  orders?: TicketOrder[] | null; // supabase returns array for nested select
};

type TicketItemRow = {
  id: string;
  kds_ticket_id: string;
  display_name: string;
  qty: number;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function KDSPage() {
  const [doneFlash, setDoneFlash] = useState(false);

  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [items, setItems] = useState<TicketItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});

  const itemsByTicket = useMemo(() => {
    const map: Record<string, TicketItemRow[]> = {};
    for (const it of items) (map[it.kds_ticket_id] ||= []).push(it);
    return map;
  }, [items]);

  async function load() {
    setLoading(true);
    setError(null);

    // Must be logged in
    const sessionRes = await supabase.auth.getSession();
    if (sessionRes.error) {
      setError(sessionRes.error.message);
      setLoading(false);
      return;
    }
    if (!sessionRes.data.session) {
      window.location.href = "/kds/login";
      return;
    }

    // ✅ Load tickets (kitchen, new + in_progress)
    const ticketsRes = await supabase
      .from("kds_tickets")
      .select("id, order_id, station, status, created_at, orders(order_number, order_type, source)")
      .eq("station", "kitchen")
      .in("status", ["new", "in_progress"])
      .order("created_at", { ascending: true })
      .returns<TicketRow[]>();

    if (ticketsRes.error) {
      setError(ticketsRes.error.message);
      setLoading(false);
      return;
    }

    const ticketIds = (ticketsRes.data ?? []).map((t) => t.id);

    // ✅ Load items for those tickets
    const itemsRes =
      ticketIds.length > 0
        ? await supabase
            .from("kds_ticket_items")
            .select("id, kds_ticket_id, display_name, qty")
            .in("kds_ticket_id", ticketIds)
            .returns<TicketItemRow[]>()
        : ({ data: [] as TicketItemRow[], error: null } as const);

    if ((itemsRes as any).error) {
      setError((itemsRes as any).error.message);
      setLoading(false);
      return;
    }

    setTickets(ticketsRes.data ?? []);
    setItems((itemsRes as any).data ?? []);
    setLoading(false);
  }

  // ✅ realtime refetch: updates BOTH tickets + items
  const refetchTickets = async () => {
    console.log("🔄 refetchTickets called");

    const sb = supabaseBrowser();

    const ticketsRes = await sb
      .from("kds_tickets")
      .select("id, order_id, station, status, created_at, orders(order_number, order_type, source)")
      .eq("station", "kitchen")
      .in("status", ["new", "in_progress"])
      .order("created_at", { ascending: true })
      .returns<TicketRow[]>();

    if (ticketsRes.error) {
      console.error("❌ Failed to refetch tickets", ticketsRes.error);
      return;
    }

    const ticketIds = (ticketsRes.data ?? []).map((t) => t.id);

    const itemsRes =
      ticketIds.length > 0
        ? await sb
            .from("kds_ticket_items")
            .select("id, kds_ticket_id, display_name, qty")
            .in("kds_ticket_id", ticketIds)
            .returns<TicketItemRow[]>()
        : ({ data: [] as TicketItemRow[], error: null } as const);

    if ((itemsRes as any).error) {
      console.error("❌ Failed to refetch items", (itemsRes as any).error);
      return;
    }

    setTickets(ticketsRes.data ?? []);
    setItems((itemsRes as any).data ?? []);
  };

  // ✅ realtime subscription
  // ✅ Realtime: refresh when tickets OR items change
  useEffect(() => {
    const channel = supabase
      .channel("kds-live")
      // New ticket created
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "kds_tickets" },
        () => refetchTickets()
      )
      // Ticket updated (start/done)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "kds_tickets" },
        () => refetchTickets()
      )
      // Ticket items inserted (THIS fixes “no items until refresh”)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "kds_ticket_items" },
        () => refetchTickets()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // flash after redirect: /kds?done=1
    const params = new URLSearchParams(window.location.search);
    if (params.get("done") === "1") {
      setDoneFlash(true);
      params.delete("done");
      const newUrl =
        window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
      window.history.replaceState({}, "", newUrl);
      setTimeout(() => setDoneFlash(false), 2000);
    }

    load();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) window.location.href = "/kds/login";
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/kds/login";
  }

  async function markDone(ticketId: string) {
    try {
      setSubmitting((p) => ({ ...p, [ticketId]: true }));

      const form = new FormData();
      form.set("ticketId", ticketId);

      const res = await fetch("/api/kds/mark-done", { method: "POST", body: form });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || "Failed to mark done");
      }

      setDoneFlash(true);
      setTimeout(() => setDoneFlash(false), 2000);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Mark done failed");
    } finally {
      setSubmitting((p) => ({ ...p, [ticketId]: false }));
    }
  }

  async function markStart(ticketId: string) {
    try {
      setSubmitting((p) => ({ ...p, [ticketId]: true }));

      const form = new FormData();
      form.set("ticketId", ticketId);

      const res = await fetch("/api/kds/mark-start", { method: "POST", body: form });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || "Failed to start ticket");
      }

      await load();
    } catch (e: any) {
      setError(e?.message ?? "Start failed");
    } finally {
      setSubmitting((p) => ({ ...p, [ticketId]: false }));
    }
  }

  if (loading) return <main style={{ padding: 16 }}>Loading…</main>;

  return (
    <main style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Kitchen KDS</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={load}
            style={{
              textDecoration: "underline",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontWeight: 700,
            }}
          >
            Refresh
          </button>
          <Link href="/menu">Menu</Link>
          <button
            onClick={signOut}
            style={{
              textDecoration: "underline",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontWeight: 700,
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      {doneFlash && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 10,
            background: "#e8fff1",
            border: "1px solid #9ae6b4",
            fontWeight: 800,
          }}
        >
          ✅ Ticket marked done
        </div>
      )}

      <p style={{ opacity: 0.7, marginTop: 8 }}>
        Showing <b>NEW</b> tickets only.
      </p>

      {error ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: "1px solid #f3c",
            borderRadius: 12,
            color: "crimson",
          }}
        >
          KDS error: {error}
        </div>
      ) : null}

      {tickets.length === 0 ? (
        <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12 }}>
          No new tickets ✅
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {tickets.map((t) => {
            const orderNum = t.orders?.[0]?.order_number ?? "—"; // ✅ FIXED (orders is array)
            const isBusy = !!submitting[t.id];

            return (
              <div key={t.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 18 }}>Order #{orderNum}</div>
                    <div style={{ opacity: 0.7, fontSize: 12 }}>Ticket: {t.id}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800 }}>{t.status}</div>
                    <div style={{ opacity: 0.7, fontSize: 12 }}>
                      {new Date(t.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {(itemsByTicket[t.id] ?? []).map((it) => (
                      <li key={it.id}>
                        {it.display_name} × {it.qty}
                      </li>
                    ))}
                  </ul>
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                  <button
                    disabled={isBusy}
                    onClick={() => (t.status === "new" ? markStart(t.id) : markDone(t.id))}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "1px solid #ddd",
                      cursor: isBusy ? "not-allowed" : "pointer",
                      fontWeight: 800,
                      opacity: isBusy ? 0.6 : 1,
                    }}
                  >
                    {isBusy ? "Saving…" : t.status === "new" ? "Start" : "Done"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}