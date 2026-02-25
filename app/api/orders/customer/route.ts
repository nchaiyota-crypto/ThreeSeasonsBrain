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
    console.log("✅ /api/orders/customer HIT");
    const body = await req.json();
    console.log("✅ body =", body);

    const orderId = String(body.orderId || "");
    if (!orderId) return NextResponse.json({ error: "Missing orderId" }, { status: 400 });

    const customerName = String(body.customerName ?? body.customer_name ?? "").trim() || null;
    const customerPhone = body.customerPhone ?? body.customer_phone ?? null;

    const customerEmailRaw = String(body.customerEmail ?? body.customer_email ?? "").trim();
    const customerEmail = customerEmailRaw ? customerEmailRaw.toLowerCase() : null;
    
    const smsOptIn = !!(body.smsOptIn ?? body.sms_opt_in);

    if (customerEmail && !customerEmail.includes("@")) {
      return NextResponse.json({ error: "Invalid customerEmail" }, { status: 400 });
    }

    const supabase = createClient(
      must("NEXT_PUBLIC_SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    console.log("✅ parsed:", { orderId, customerName, customerPhone, smsOptIn });
    // 1) update ORDERS (source of truth)
    const patchOrders: any = {
    customer_phone: customerPhone,
    sms_opt_in: smsOptIn,
    };
    if (customerName) patchOrders.customer_name = customerName;
    if (customerEmail) patchOrders.customer_email = customerEmail;

    const { data: orderRow, error: ordErr } = await supabase
    .from("orders")
    .update(patchOrders)
    .eq("id", orderId)
    .select("id, order_number, customer_name, customer_phone, customer_email, sms_opt_in")
    .single();

    console.log("✅ orders updated:", orderRow, "err:", ordErr?.message);

    if (ordErr) {
    return NextResponse.json({ error: ordErr.message }, { status: 400 });
    }

    // 2) sync KDS ticket (ONLY if it exists already)
    await supabase
    .from("kds_tickets")
    .update({
        customer_name: orderRow.customer_name,
        customer_phone: orderRow.customer_phone,
    })
    .eq("order_id", orderId);

    return NextResponse.json({ ok: true, updated: orderRow });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}