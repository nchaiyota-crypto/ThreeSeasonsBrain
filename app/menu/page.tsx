"use client";

import React, { useMemo, useState, useEffect } from "react";
import { menuItems, type MenuItem } from "./menuData";

type CartMap = Record<string, number>;

const TAX_RATE_BPS = 1075; // 10.75%

function formatPrice(p: number) {
  return `$${p.toFixed(2)}`;
}

export default function MenuPage() {
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [cart, setCart] = useState<CartMap>({});

  useEffect(() => {
    console.log("Stripe key:", process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const it of menuItems) set.add(it.category);
    return ["All", ...Array.from(set).sort()];
  }, []);

  const filteredItems = useMemo(() => {
    if (activeCategory === "All") return menuItems;
    return menuItems.filter((i) => i.category === activeCategory);
  }, [activeCategory]);

  function addOne(id: string) {
    setCart((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  }

  function removeOne(id: string) {
    setCart((prev) => {
      const current = prev[id] ?? 0;
      if (current <= 1) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: current - 1 };
    });
  }

  const cartLines = useMemo(() => {
    const lines: Array<{ item: MenuItem; qty: number; lineTotal: number }> = [];
    for (const item of menuItems) {
      const qty = cart[item.id] ?? 0;
      if (qty > 0) lines.push({ item, qty, lineTotal: qty * item.price });
    }
    return lines;
  }, [cart]);

  const subtotal = cartLines.reduce((s, l) => s + l.lineTotal, 0);
  const tax = subtotal * (TAX_RATE_BPS / 10000);
  const total = subtotal + tax;

  async function startCheckout() {
    // Build items from current cartLines (no stale values)
    const items = cartLines.map((l) => ({
      name: l.item.name,
      qty: l.qty,
      unit_cents: Math.round(l.item.price * 100),
    }));

    if (items.length === 0) {
      alert("Missing items");
      return;
    }

    const subtotal_cents = items.reduce((sum, i) => sum + i.unit_cents * i.qty, 0);
    const tax_cents = Math.round((subtotal_cents * TAX_RATE_BPS) / 10000);
    const total_cents = subtotal_cents + tax_cents;

    const payload = { items, totals: { subtotal_cents, tax_cents, total_cents } };

    console.log("CHECKOUT PAYLOAD", payload);

    const res = await fetch("/api/checkout/create-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("create-session failed:", data);
      alert(data?.error || "Checkout failed");
      return;
    }

    if (!data?.url) {
      console.error("No url returned:", data);
      alert("No checkout URL returned");
      return;
    }

    window.location.href = data.url;
  }

  return (
    <main style={{ padding: 40, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 6 }}>3 Seasons Online Ordering</h1>
      <p style={{ marginTop: 0, opacity: 0.75 }}>
        Menu (MVP) — next step: add to cart + checkout
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        {categories.map((cat) => {
          const active = cat === activeCategory;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: active ? "1px solid #111" : "1px solid #ddd",
                background: active ? "#111" : "#fff",
                color: active ? "#fff" : "#111",
                cursor: "pointer",
              }}
            >
              {cat}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 22, display: "grid", gap: 14 }}>
        {filteredItems.map((item) => {
          const qty = cart[item.id] ?? 0;
          return (
            <div
              key={item.id}
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 14,
                display: "grid",
                gridTemplateColumns: "1fr 160px 120px",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 800 }}>{item.name}</div>
                {item.description && (
                  <div style={{ opacity: 0.7, marginTop: 4 }}>{item.description}</div>
                )}
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800 }}>{formatPrice(item.price)}</div>

                <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
                  {qty === 0 ? (
                    <button
                      onClick={() => addOne(item.id)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 8,
                        border: "1px solid #ccc",
                        background: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      Add
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button
                        onClick={() => removeOne(item.id)}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 8,
                          border: "1px solid #ccc",
                          background: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        –
                      </button>
                      <div style={{ minWidth: 18, textAlign: "center", fontWeight: 700 }}>
                        {qty}
                      </div>
                      <button
                        onClick={() => addOne(item.id)}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 8,
                          border: "1px solid #ccc",
                          background: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ textAlign: "right", fontWeight: 800 }}>
                {formatPrice(item.price * (qty || 0))}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 26, borderTop: "1px solid #eee", paddingTop: 18 }}>
        <h2 style={{ margin: 0 }}>Cart</h2>

        {cartLines.length === 0 ? (
          <div style={{ opacity: 0.7, marginTop: 8 }}>Your cart is empty.</div>
        ) : (
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {cartLines.map((l) => (
              <div
                key={l.item.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 90px 120px",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <div style={{ fontWeight: 600 }}>{l.item.name}</div>
                <div style={{ textAlign: "right", opacity: 0.8 }}>x{l.qty}</div>
                <div style={{ textAlign: "right", fontWeight: 700 }}>
                  {formatPrice(l.lineTotal)}
                </div>
              </div>
            ))}

            <div style={{ borderTop: "1px solid #eee", paddingTop: 10, marginTop: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ opacity: 0.8 }}>Subtotal</span>
                <span style={{ fontWeight: 700 }}>{formatPrice(subtotal)}</span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span style={{ opacity: 0.8 }}>Tax (10.75%)</span>
                <span style={{ fontWeight: 700 }}>{formatPrice(tax)}</span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                <span style={{ fontWeight: 800 }}>Total</span>
                <span style={{ fontWeight: 900 }}>{formatPrice(total)}</span>
              </div>

              <button
                onClick={startCheckout}
                style={{
                  width: "100%",
                  marginTop: 14,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #111",
                  background: "#111",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                Checkout (next)
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}