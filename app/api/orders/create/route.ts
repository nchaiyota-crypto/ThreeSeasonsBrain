import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type IncomingItem = {
  id?: string;
  name: string;
  qty: number;
  price: number; // dollars in UI
  special_instructions?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const items: IncomingItem[] = Array.isArray(body.items) ? body.items : [];

    if (items.length === 0) {
      return NextResponse.json({ error: "No items" }, { status: 400 });
    }

    const supabase = createClient(
      must("NEXT_PUBLIC_SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY")
    );

    const TAX_BPS = 1075; // 10.75%

    const subtotalCents = items.reduce((sum, it) => {
      const unitCents = Math.round(Number(it.price) * 100);
      return sum + unitCents * Number(it.qty);
    }, 0);

    const taxCents = Math.round((subtotalCents * TAX_BPS) / 10000);
    const totalCents = subtotalCents + taxCents;

    // ✅ must match your check constraint. Use "online" (not "web")
    const source = body.source ?? "online";
    const orderType = body.order_type ?? "takeout"; // you said it is order_type

    // 1) create order header ONCE
    const orderNumber = Math.floor(1000 + Math.random() * 9000);

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        order_number: orderNumber,
        source,
        order_type: orderType,
        status: "draft",
        payment_status: "unpaid",
        subtotal_cents: subtotalCents,
        tax_bps: TAX_BPS,
        tax_cents: taxCents,
        total_cents: totalCents,
      })
      .select("id, order_number")
      .single();

    if (orderErr) {
      console.error(orderErr);
      return NextResponse.json({ error: orderErr.message }, { status: 400 });
    }

    // 2) create line items (✅ uses line_subtotal_cents)
    const rows = items.map((it) => {
      const unitCents = Math.round(Number(it.price) * 100);
      const qty = Number(it.qty);
      return {
        order_id: order.id,
        menu_item_name: it.name,
        qty,
        base_price_cents: unitCents,
        line_subtotal_cents: unitCents * qty,
        special_instructions: it.special_instructions ?? null,
      };
    });

    const { error: itemsErr } = await supabase.from("order_items").insert(rows);

    if (itemsErr) {
      console.error(itemsErr);
      // optional cleanup: delete the order if item insert fails
      await supabase.from("orders").delete().eq("id", order.id);
      return NextResponse.json({ error: itemsErr.message }, { status: 400 });
    }

    return NextResponse.json({
      orderId: order.id,
      orderNumber: order.order_number,
    });
  } catch (err: unknown) {
    console.error(err);
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}