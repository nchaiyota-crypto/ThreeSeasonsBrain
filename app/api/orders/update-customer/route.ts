import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // SERVER ONLY
);

export async function POST(req: Request) {
  try {
    const { orderId, customerName, customerPhone, smsOptIn } = await req.json();

    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    const { data, error } = await supabase
    .from("orders")
    .update({
        customer_name: customerName ?? null,
        customer_phone: customerPhone ?? null,
        sms_opt_in: typeof smsOptIn === "boolean" ? smsOptIn : null,
    })
    .eq("id", orderId)
    .select("id, order_number, customer_name, customer_phone")
    .maybeSingle();

    if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
    // ✅ This is the real bug: orderId didn't match any row
    return NextResponse.json(
        { error: "No order updated. orderId did not match orders.id", orderId },
        { status: 404 }
    );
    }

    return NextResponse.json({ ok: true, updated: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}