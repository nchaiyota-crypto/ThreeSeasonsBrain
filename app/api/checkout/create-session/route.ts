// app/api/create-order/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function toInt(v: unknown) {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // ✅ you said table has items_json + order_type required
    const items = body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No cart items" }, { status: 400 });
    }

    // totals from client (dollars)
    const subtotal = Number(body?.subtotal ?? 0);
    const tax = Number(body?.tax ?? 0);
    const total = Number(body?.total ?? 0);

    if (!Number.isFinite(total) || total <= 0) {
      return NextResponse.json({ error: "Invalid total" }, { status: 400 });
    }

    const supabase = createClient(must("NEXT_PUBLIC_SUPABASE_URL"), must("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    // ✅ MUST satisfy your DB constraint:
    // order_type must be one of: dine_in | takeout | phone
    const orderType =
      body?.order_type === "dine_in" || body?.order_type === "phone" ? body.order_type : "takeout";

    const insertRow: any = {
      source: body?.source ?? "online", // your schema shows `source` default 'ipad' - online is ok
      order_type: orderType,            // ✅ FIX #1 (required + must match check constraint)
      status: body?.status ?? "draft",

      // your screenshots show numeric subtotal/tax/total exist
      subtotal,
      tax,
      total,

      // your screenshots show items_json jsonb exists
      items_json: items,                // ✅ FIX #2 (use items_json, not items)

      // Optional fields if you want to store them (only if columns exist in DB)
      customer_name: body?.customerName ?? null,
    };

    // If you ALSO have *_cents columns and want them filled, we can set them safely
    // (they exist in your screenshots: subtotal_cents, tax_cents, total_cents)
    const subtotalCents = toInt(Math.round(subtotal * 100));
    const taxCents = toInt(Math.round(tax * 100));
    const totalCents = toInt(Math.round(total * 100));

    if (subtotalCents !== null) insertRow.subtotal_cents = subtotalCents;
    if (taxCents !== null) insertRow.tax_cents = taxCents;
    if (totalCents !== null) insertRow.total_cents = totalCents;

    const { data, error } = await supabase.from("orders").insert(insertRow).select("id, order_number").single();

    if (error) {
      return NextResponse.json(
        { error: error.message, details: error },
        { status: 500 }
      );
    }

    // ✅ Create order_items rows so webhook can map -> kds_ticket_items.order_item_id
    const orderId = data.id;

    const orderItemsRows = items.map((it: any) => {
      const qty = Number(it?.qty ?? 1);

      // These fields MUST match your order_items columns (your screenshot shows these exist)
      return {
        order_id: orderId,
        menu_item_id: it?.menu_item_id ?? it?.itemId ?? it?.id ?? null,
        menu_item_name: String(it?.menu_item_name ?? it?.name ?? "Item"),
        qty,
        base_price_cents: toInt(Math.round(Number(it?.unitPrice ?? it?.price ?? 0) * 100)) ?? 0,
        line_subtotal_cents:
          toInt(Math.round(Number(it?.lineSubtotal ?? (Number(it?.unitPrice ?? it?.price ?? 0) * qty)) * 100)) ?? 0,
        special_instructions: it?.notes ?? it?.special_instructions ?? null,
      };
    });

    const { error: oiErr } = await supabase.from("order_items").insert(orderItemsRows);

    if (oiErr) {
      console.error("❌ order_items insert failed:", oiErr.message);
      return NextResponse.json(
        { error: "order_items insert failed", details: oiErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      orderId: data.id,
      orderNumber: data.order_number ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}