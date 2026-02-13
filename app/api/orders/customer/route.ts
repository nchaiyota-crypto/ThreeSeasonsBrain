import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const { orderId, customerName, customerPhone, smsOptIn } = await req.json();

    if (!orderId) return NextResponse.json({ error: "Missing orderId" }, { status: 400 });

    const supabase = createClient(
      must("NEXT_PUBLIC_SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY")
    );

    const { error } = await supabase
      .from("orders")
      .update({
        customer_name: customerName ?? null,
        customer_phone: customerPhone ?? null,
        sms_opt_in: !!smsOptIn,
      })
      .eq("id", orderId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}