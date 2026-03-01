import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Public endpoint — returns the list of item IDs currently 86'd (out of stock).
// Used by the online menu page to hide out-of-stock items from customers.

export const runtime = "nodejs";
export const revalidate = 0; // no caching — always fresh

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET() {
  try {
    const supabase = createClient(
      must("NEXT_PUBLIC_SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const { data, error } = await supabase
      .from("menu_86")
      .select("item_id, item_name");

    if (error) {
      // If table doesn't exist yet, return empty list gracefully
      return NextResponse.json({ item_ids: [] }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const item_ids = (data ?? []).map((r: any) => String(r.item_id));

    return NextResponse.json({ item_ids }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    return NextResponse.json({ item_ids: [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
