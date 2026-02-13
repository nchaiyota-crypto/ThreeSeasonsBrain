import Link from "next/link";

export default function CancelPage() {
  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 900 }}>Payment canceled</h1>
      <p style={{ opacity: 0.75 }}>You can go back and try again.</p>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <Link href="/menu" style={{ padding: "10px 14px", background: "#000", color: "#fff", borderRadius: 10, fontWeight: 900 }}>
          Back to menu
        </Link>

        <Link href="/" style={{ padding: "10px 14px", border: "1px solid #ddd", borderRadius: 10, fontWeight: 900 }}>
          Home
        </Link>
      </div>
    </div>
  );
}