import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
    vercelEnv: process.env.VERCEL_ENV || null, // "production" | "preview" | "development"
  });
}