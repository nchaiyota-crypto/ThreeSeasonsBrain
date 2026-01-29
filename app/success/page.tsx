"use client";

import Link from "next/link";

export default function SuccessPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Payment successful ✅</h1>
      <p>Thanks! Your order is confirmed.</p>

      <p style={{ marginTop: 16 }}>
        <Link href="/menu">Back to menu</Link>
      </p>
    </main>
  );
}