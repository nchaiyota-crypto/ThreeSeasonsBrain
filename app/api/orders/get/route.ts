import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
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
    .select("menu_item_name, qty, base_price_cents, options_summary, special_instructions")
    .eq("order_id", (data as any).id);

  const items = (lineItems ?? []).map((it: any) => ({
    key: `${it.menu_item_name}-${it.qty}-${it.base_price_cents}`,
    name: it.menu_item_name,
    qty: it.qty,
    unitPrice: (it.base_price_cents ?? 0) / 100,

    // ✅ protein/add-on
    optionsSummary: it.options_summary ?? "",

    // ✅ special request / note
    specialInstructions: it.special_instructions ?? "",
  }));

  const subtotal_cents = Number(
    data.subtotal_cents ?? Math.round(Number(data.subtotal ?? 0) * 100)
  );
  const tax_cents = Number(
    data.tax_cents ?? Math.round(Number(data.tax ?? 0) * 100)
  );
  const service_fee_cents = Number(data.service_fee_cents ?? 0);
  const tip_cents = Number(data.tip_cents ?? (data as any).tipCents ?? 0);
  const total_cents = Number(
    data.total_cents ?? Math.round(Number(data.total ?? 0) * 100)
  );
  const total_with_tip_cents =
    Number((data as any).total_with_tip_cents ?? 0) || (total_cents + tip_cents);

  const pickup_scheduled_at =
  (data as any).pickup_scheduled_at ??
  (data as any).pickupScheduledAt ??
  null;

  return NextResponse.json({
    __version: "get-route-2026-02-25-v3",
    orderNumber: (data as any).order_number ?? (data as any).orderNumber ?? "",
    items,
    customerName: (data as any).customer_name ?? (data as any).customerName ?? null,

    // dollars
    subtotal: subtotal_cents / 100,
    tax: tax_cents / 100,
    serviceFee: service_fee_cents / 100,
    total: total_cents / 100,
    totalWithTip: total_with_tip_cents / 100,

    // cents
    subtotal_cents,
    tax_cents,
    service_fee_cents,
    tip_cents,
    total_cents,
    total_with_tip_cents,

    pickup_scheduled_at,
    pickupScheduledAt: pickup_scheduled_at,   // alias for your frontend merge
    pickupTimeISO: pickup_scheduled_at ?? (data as any).pickup_time_iso ?? (data as any).pickupTimeISO ?? null,
    pickupMode: pickup_scheduled_at ? "schedule" : ((data as any).pickup_mode ?? (data as any).pickupMode ?? "asap"),
    estimateMin: (data as any).estimate_min ?? (data as any).estimateMin ?? null,

    stripe_client_secret: (data as any).stripe_client_secret ?? null,
    orderId,
  });
} // ✅ THIS was missing

export async function POST(req: Request) {
  return GET(req);
}