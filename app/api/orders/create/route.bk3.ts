import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe"; // ✅ ADD

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
    // ✅ Create Stripe client INSIDE handler (prevents Vercel build-time crash)
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { error: "Missing env var: STRIPE_SECRET_KEY" },
        { status: 500 }
      );
    }
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

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
    const STRIPE_FEE_RATE = 0.029; // 2.9%
    const STRIPE_FEE_FIXED_CENTS = 30; // $0.30

    const subtotalCents = items.reduce((sum, it) => {
    const unitCents = Math.round(Number(it.price) * 100);
      return sum + unitCents * Number(it.qty);
    }, 0);

    const taxCents = Math.round((subtotalCents * TAX_BPS) / 10000);
    const baseTotalCents = subtotalCents + taxCents; // what you want to receive (before Stripe fee)

    // charge enough to cover Stripe fee (2.9% + 30c)
    const chargeCents = Math.ceil(
      (baseTotalCents + STRIPE_FEE_FIXED_CENTS) / (1 - STRIPE_FEE_RATE)
    );

    const serviceFeeCents = Math.max(0, chargeCents - baseTotalCents);

    const source = body.source ?? "online";
    const orderType = body.order_type ?? "takeout";
    const customerPhone = (body.customerPhone ?? "").toString().trim() || null;
    const smsOptIn = typeof body.smsOptIn === "boolean" ? body.smsOptIn : true;

    const orderNumber = Math.floor(1000 + Math.random() * 9000);

    // 1) create order header
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
        service_fee_cents: serviceFeeCents,
        total_cents: chargeCents,

        // ✅ Step B fields
        customer_phone: customerPhone,
        sms_opt_in: smsOptIn,
      })
      .select("id, order_number")
      .single();

    if (orderErr || !order) {
      console.error(orderErr);
      return NextResponse.json({ error: orderErr?.message ?? "Order insert failed" }, { status: 400 });
    }

    // 2) create line items
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

    // ✅ 3) CREATE STRIPE PAYMENT INTENT (this was missing)
    const pi = await stripe.paymentIntents.create({
      amount: chargeCents, // ✅ charge full total (subtotal + tax)
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        orderId: order.id,
        orderNumber: String(order.order_number),
        source,
        orderType,
      },
    });
    const { error: itemsErr } = await supabase.from("order_items").insert(rows);

    if (itemsErr) {
      console.error(itemsErr);
      await supabase.from("orders").delete().eq("id", order.id);
      return NextResponse.json({ error: itemsErr.message }, { status: 400 });
    }

    // ✅ 4) SAVE stripe_payment_intent_id onto the order row
    const { error: updErr } = await supabase
      .from("orders")
      .update({
        stripe_payment_intent_id: pi.id,
        // optional but useful:
        stripe_client_secret: pi.client_secret,
      })
      .eq("id", order.id);

    if (updErr) {
      console.error(updErr);
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    // ✅ 5) RETURN clientSecret so Checkout can render PaymentElement
    return NextResponse.json({
      orderId: order.id,
      orderNumber: order.order_number,
      clientSecret: pi.client_secret,
    });
  } catch (err: unknown) {
    console.error(err);
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}