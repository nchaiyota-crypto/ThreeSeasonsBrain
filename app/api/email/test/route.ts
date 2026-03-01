import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const { to } = await req.json();

    console.log("📧 email test -> to:", to);
    console.log("RESEND_API_KEY exists?", !!process.env.RESEND_API_KEY);
    console.log("RESEND_FROM:", process.env.RESEND_FROM);

    const resend = new Resend(must("RESEND_API_KEY"));

    const result = await resend.emails.send({
      // ✅ use a guaranteed working sender for local test first
      from: process.env.RESEND_FROM || "onboarding@resend.dev",
      to,
      subject: "Resend test – 3 Seasons",
      html: "<p>If you got this, Resend is working ✅</p>",
    });

    console.log("✅ resend result:", result);

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    console.error("❌ email test error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}