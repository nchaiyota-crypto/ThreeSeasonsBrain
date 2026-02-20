import Link from "next/link";
import CheckoutClient from "./CheckoutClient";
import OrderSummary from "./OrderSummary";

export default function CheckoutPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#f6f6f6", padding: "28px 16px", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
      <div style={{ width: "100%", maxWidth: 720 }}>
        {/* NAV */}
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <Link href="/menu" style={navLinkStyle}>← Back to Menu</Link>
          <Link href="/" style={navLinkStyle}>🏠 Home</Link>
        </div>

        {/* Header */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 26, fontWeight: 900 }}>Checkout</div>
          <div style={{ marginTop: 6, opacity: 0.7, fontSize: 14 }}>
            Secure payment powered by Stripe
          </div>
        </div>

        {/* Card */}
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)", borderRadius: 16, padding: 18, boxShadow: "0 6px 18px rgba(0,0,0,0.06)" }}>
          <CheckoutClient />
        </div>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.65 }}>
          By placing this order, you agree to our store policies.
        </div>
      </div>
    </div>
  );
}

const navLinkStyle: React.CSSProperties = {
  fontSize: 14,
  textDecoration: "none",
  padding: "6px 10px",
  borderRadius: 10,
  color: "var(--foreground)",
  background: "var(--card)",
  border: "1px solid var(--border)",
};