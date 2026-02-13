// app/api/create-order/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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
    const total = Number(body.total ?? 0);

    const subtotalCents = Math.round(subtotal * 100);
    const taxCents = Math.round(tax * 100);
    const totalCents = Math.round(total * 100);

    const { data, error } = await supabase
    .from("orders")
    .insert({
        source: "online",
        order_type: "takeout", // dine_in, takeout, phone
        status: "draft",       // keep draft until payment succeeds

        // ✅ write BOTH numeric + cents (your schema has both)
        subtotal,
        tax,
        total,
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        total_cents: totalCents,

        // ✅ set payment status so downstream filters work
        payment_status: "requires_payment",

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