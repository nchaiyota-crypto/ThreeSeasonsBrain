import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const adminToken = process.env.ADMIN_TOKEN;

  if (!url || !anonKey || !adminToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing env vars on server",
        has: { url: !!url, anonKey: !!anonKey, adminToken: !!adminToken },
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  const res = await fetch(`${url}/functions/v1/get_wait_status`, {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "x-admin-token": adminToken,
    },
    cache: "no-store",
  });

  const text = await res.text();

  return new NextResponse(text, {
    status: res.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}