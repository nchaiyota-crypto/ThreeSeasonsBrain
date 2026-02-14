// app/api/create-order/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
const SERVICE_FEE_RATE = 0.035; // 3.5%

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body?.items?.length) {
      return NextResponse.json({ error: "No cart items" }, { status: 400 });
    }

    const supabase = createClient(
      must("NEXT_PUBLIC_SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const subtotal = Number(body.subtotal ?? 0);
    const tax = Number(body.tax ?? 0);

    // ✅ server is source of truth for fee + total
    const subtotalCents = Math.round(subtotal * 100);
    const taxCents = Math.round(tax * 100);

    // ✅ 3.5% fee
    const serviceFeeCents = Math.round(subtotalCents * SERVICE_FEE_RATE);

    // ✅ total BEFORE tip
    const totalCents = subtotalCents + taxCents + serviceFeeCents;
    const total = totalCents / 100;

    const { data, error } = await supabase
      .from("orders")
      .insert({
        source: "online",
        order_type: "takeout", // dine_in, takeout, phone
        status: "draft",
        payment_status: "unpaid", // keep draft until payment succeeds

        // ✅ write BOTH numeric + cents (your schema has both)
        subtotal,
        tax,
        total,
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        service_fee_cents: serviceFeeCents,
        total_cents: totalCents,

        // ✅ your items column (keep this)
        items_json: body.items,
      })
      .select("id, order_number, total, total_cents, payment_status, status")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message, details: error }, { status: 400 });
    }

    // ✅ ✅ ✅ STEP 2: create public.order_items rows for THIS order (THIS is what your webhook is missing)
    const orderId = data.id;

    // map whatever the client sends into your real order_items schema
    const items = Array.isArray(body.items) ? body.items : [];

    const orderItemRows = items.map((it: any) => {
      const qty = Number(it?.qty ?? it?.quantity ?? 1) || 1;

      // Try common price fields from your cart (unitPrice dollars OR cents)
      const unitPriceDollars =
        typeof it?.unitPrice === "number" ? it.unitPrice :
        typeof it?.price === "number" ? it.price :
        typeof it?.unit_price === "number" ? it.unit_price :
        null;

      const basePriceCents =
        typeof it?.base_price_cents === "number" ? Math.round(it.base_price_cents) :
        typeof it?.basePriceCents === "number" ? Math.round(it.basePriceCents) :
        unitPriceDollars != null ? Math.round(unitPriceDollars * 100) :
        0;

      const lineSubtotalCents =
        typeof it?.line_subtotal_cents === "number" ? Math.round(it.line_subtotal_cents) :
        typeof it?.lineSubtotalCents === "number" ? Math.round(it.lineSubtotalCents) :
        basePriceCents * qty;

      const menuItemName =
        String(it?.menu_item_name ?? it?.name ?? it?.title ?? "Item");

      const specialInstructions =
        it?.special_instructions ?? it?.specialInstructions ?? it?.instructions ?? it?.note ?? null;

      // menu_item_id is nullable in your screenshot, so we only set it if it looks like a UUID
      const maybeId = it?.menu_item_id ?? it?.menuItemId ?? it?.itemId ?? it?.id ?? null;
      const looksLikeUUID =
        typeof maybeId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(maybeId);

      const optionsSummary =
        it?.optionsSummary ??
        it?.options_summary ??
        it?.modifiersSummary ??
        it?.modifiers?.join?.(" • ")
        null;

      return {
        order_id: orderId,
        menu_item_id: looksLikeUUID ? maybeId : null,
        menu_item_name: menuItemName,
        qty,
        base_price_cents: basePriceCents,
        line_subtotal_cents: lineSubtotalCents,
        special_instructions: specialInstructions ? String(specialInstructions) : null,
        options_summary: optionsSummary ? String(optionsSummary) : null, // ✅ ADD THIS
      };
    });

    const { error: itemsErr } = await supabase
      .from("order_items")
      .insert(orderItemRows);

    if (itemsErr) {
      // optional cleanup so you don’t keep an order with no items
      await supabase.from("orders").delete().eq("id", orderId);

      return NextResponse.json(
        { error: "Failed to create order_items", details: itemsErr.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      orderId: data.id,
      orderNumber: data.order_number,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}