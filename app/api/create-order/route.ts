// app/api/create-order/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
const SERVICE_FEE_RATE = 0.13; // 13%

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

    // ✅ 13% fee
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
        payment_status: "unpaid",       // keep draft until payment succeeds

        // ✅ write BOTH numeric + cents (your schema has both)
        subtotal,
        tax,
        total,
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        service_fee_cents: serviceFeeCents,
        total_cents: totalCents,

        // ✅ your items column
        items_json: body.items,
    })
    .select("id, order_number, total, total_cents, payment_status, status")
    .single();

    if (error) {
      return NextResponse.json({ error: error.message, details: error }, { status: 400 });
    }

    return NextResponse.json({
      orderId: data.id,
      orderNumber: data.order_number,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}