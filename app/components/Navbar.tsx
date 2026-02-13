"use client";

import Link from "next/link";

export default function Navbar() {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #eee",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        {/* Logo */}
        <Link href="/" style={{ textDecoration: "none", color: "#111" }}>
          <div style={{ fontWeight: 900, lineHeight: 1.05 }}>
            <div style={{ fontSize: 18 }}>3 Seasons</div>
            <div style={{ fontSize: 18 }}>Thai Bistro</div>
          </div>
        </Link>

        {/* Nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <a href="#menu" style={{ textDecoration: "none", color: "#111", fontWeight: 700 }}>
            Menu
          </a>
          <a href="#catering" style={{ textDecoration: "none", color: "#111", fontWeight: 700 }}>
            Catering
          </a>
          <a href="#story" style={{ textDecoration: "none", color: "#111", fontWeight: 700 }}>
            Our Story
          </a>
          <a href="#giftcards" style={{ textDecoration: "none", color: "#111", fontWeight: 700 }}>
            Gift Cards
          </a>

          <button
            type="button"
            style={{
              height: 36,
              padding: "0 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
            onClick={() => alert("Sign in coming soon")}
          >
            Sign in
          </button>

          <Link
            href="/menu"
            style={{
              height: 36,
              display: "inline-flex",
              alignItems: "center",
              padding: "0 14px",
              borderRadius: 10,
              background: "#111",
              color: "#fff",
              fontWeight: 900,
              textDecoration: "none",
            }}
          >
            Order online →
          </Link>
        </div>
      </div>
    </div>
  );
}