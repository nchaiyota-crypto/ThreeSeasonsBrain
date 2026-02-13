import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; // ✅ use this (you already set it in Vercel)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

// Accept BOTH GET (?orderId=...) and POST ({orderId})
async function readOrderId(req: Request) {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("orderId");

  if (fromQuery) return fromQuery;

  // If POST (or any method with body)
  try {
    const body = await req.json();
    return body?.orderId as string | undefined;
  } catch {
    return undefined;
  }
}

async function fetchOrder(orderId: string) {
  const supabase = getSupabase();

  // Try primary key id first
  let { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (data) return { data, error: null };

  ({ data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("orderId", orderId)
    .maybeSingle());

  if (data) return { data, error: null };

  ({ data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle());

  if (data) return { data, error: null };

  return { data: null, error: error ?? new Error("Order not found") };
}

export async function GET(req: Request) {
  const supabase = getSupabase();
  const orderId = await readOrderId(req);
  if (!orderId) return NextResponse.json({ error: "Missing orderId" }, { status: 400 });

  const { data } = await fetchOrder(orderId);
  if (!data) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const { data: lineItems } = await supabase
  .from("order_items")
  .select("menu_item_name, qty, base_price_cents, special_instructions")
  .eq("order_id", orderId);

  const items = (lineItems ?? []).map((it: any) => ({
    key: `${it.menu_item_name}-${it.qty}-${it.base_price_cents}`,
    name: it.menu_item_name,
    qty: it.qty,
    unitPrice: (it.base_price_cents ?? 0) / 100,
    optionsSummary: it.special_instructions ?? "",
  }));

  // Return normalized fields your success page expects
  return NextResponse.json({
    orderNumber: data.orderNumber ?? data.order_number ?? "",
    items: items ?? [],
    subtotal: (data.subtotal_cents ?? 0) / 100,
    tax: (data.tax_cents ?? 0) / 100,
    serviceFee: (data.service_fee_cents ?? 0) / 100,
    total: (data.total_cents ?? 0) / 100,
    pickupMode: data.pickupMode ?? data.pickup_mode ?? "asap",
    pickupTimeISO: data.pickupTimeISO ?? data.pickup_time_iso ?? null,
    estimateMin: data.estimateMin ?? data.estimate_min ?? null,

    stripe_client_secret: data.stripe_client_secret ?? data.stripe_client_secret ?? null,
    orderId,
  });
}

export async function POST(req: Request) {
  return GET(req);
}