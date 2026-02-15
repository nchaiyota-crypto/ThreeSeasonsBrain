import { NextResponse } from "next/server";

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
      { status: 500 }
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
    headers: { "Content-Type": "application/json" },
  });
}