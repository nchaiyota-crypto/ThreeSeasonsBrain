// supabase/functions/send-order-email/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type EmailType = "paid" | "accepted" | "ready";

type ReqBody = {
  orderId?: string;          // UUID
  order_id?: string;         // legacy support

  // ✅ accept either
  type?: EmailType;
  event?: EmailType;

  kitchenMinutes?: number;
  kitchen_minutes?: number;  // ✅ accept either
};

function mustEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function money(cents?: number | null) {
  const v = (cents ?? 0) / 100;
  return `$${v.toFixed(2)}`;
}

function formatPickup(pickupScheduledAt?: string | null) {
  if (!pickupScheduledAt) return "ASAP";

  const d = new Date(pickupScheduledAt);
  if (Number.isNaN(d.getTime())) return `Scheduled: ${pickupScheduledAt}`;

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });

  return `Scheduled: ${fmt.format(d)}`;
}

function buildSubject(type: EmailType, orderNumber: string) {
  const safe = orderNumber?.trim() ? orderNumber : "(unknown)";
  if (type === "paid") return `Receipt for Order #${safe} — 3 Seasons Thai Bistro`;
  if (type === "accepted") return `Order #${safe} accepted — 3 Seasons Thai Bistro`;
  return `Order #${safe} is ready — 3 Seasons Thai Bistro`;
}

function buildTextEmail(params: {
  type: EmailType;
  orderNumber: string;
  customerName?: string | null;
  pickupScheduledAt?: string | null;
  kitchenMinutes?: number;
  items: Array<{ qty: number; name: string; options?: string | null; note?: string | null }>;
  subtotalCents?: number | null;
  taxCents?: number | null;
  serviceFeeCents?: number | null;
  tipCents?: number | null;
  totalCents?: number | null;
}) {
  const {
    type,
    orderNumber,
    customerName,
    pickupScheduledAt,
    kitchenMinutes,
    items,
    subtotalCents,
    taxCents,
    serviceFeeCents,
    tipCents,
    totalCents,
  } = params;

  const greeting = customerName?.trim() ? `Hi ${customerName.trim()},` : "Hi,";
  const pickup = formatPickup(pickupScheduledAt);

  // 🔹 READY EMAIL (short + clean)
    // 🔹 READY EMAIL (short + clean + pickup/ready time)
  if (type === "ready") {
  return [
    greeting,
    "",
    `✅ Your order #${orderNumber} is ready for pickup.`,
    "",
    "Please come to the counter when you arrive.",
    "",
    "Thank you for choosing 3 Seasons Thai Bistro!",
    "",
    "3 Seasons Thai Bistro",
    "1506 Leimert Blvd. Oakland, CA 94602",
  ].join("\n");
}

  // 🔹 PAID + ACCEPTED (full details)
  const statusLine =
    type === "paid"
      ? `✅ Payment received. Here is your receipt.`
      : `✅ Your order has been accepted and is now being prepared.${
          kitchenMinutes ? ` Estimated time: ${kitchenMinutes} minutes.` : ""
        }`;

  const itemLines = (items ?? [])
    .map((it) => {
      const lines: string[] = [];
      lines.push(`${it.qty}x ${it.name}`);
      if (it.options?.trim()) lines.push(`  - ${it.options.trim().replaceAll("\n", " | ")}`);
      if (it.note?.trim()) lines.push(`  - Note: ${it.note.trim()}`);
      return lines.join("\n");
    })
    .join("\n");

  const totals: string[] = [
    `Subtotal: ${money(subtotalCents)}`,
    `Tax: ${money(taxCents)}`,
    `Service Fee: ${money(serviceFeeCents)}`,
  ];
  if ((tipCents ?? 0) > 0) totals.push(`Tip: ${money(tipCents)}`);
  totals.push(`Total: ${money(totalCents)}`);

  return [
    greeting,
    "",
    statusLine,
    "",
    `Order: #${orderNumber}`,
    `Pickup: ${pickup}`,
    "",
    "Items:",
    itemLines || "(No items found)",
    "",
    totals.join("\n"),
    "",
    "3 Seasons Thai Bistro",
    "1506 Leimert Blvd. Oakland, CA 94602",
    "If you did not place this order, please reply to this email.",
  ].join("\n");
}

async function sendResendEmail(args: { to: string; subject: string; text: string }) {
  const apiKey = mustEnv("RESEND_API_KEY");
  const from = mustEnv("RESEND_FROM_EMAIL"); // e.g. "3 Seasons Thai Bistro <orders@3seasonsthaibistro.com>"

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      text: args.text,
    }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`Resend failed (${res.status}): ${body}`);
  return body;
}

/**
 * Atomic "claim" to prevent double-send:
 * - sets the correct sent_at column ONLY if it is currently NULL
 * - returns claimed=false if already set
 */
async function claimEmailSend(params: {
  supabase: any;
  orderId: string;
  type: EmailType;
}) {
  const col =
    params.type === "paid"
      ? "email_paid_sent_at"
      : params.type === "accepted"
      ? "email_accepted_sent_at"
      : "email_ready_sent_at";

  const nowIso = new Date().toISOString();
  const patch: Record<string, any> = { [col]: nowIso };

  const { data, error } = await params.supabase
    .from("orders")
    .update(patch)
    .eq("id", params.orderId)
    .is(col, null)
    .select("id");

  if (error) throw error;

  const claimed = Array.isArray(data) && data.length > 0;
  return { claimed, col, nowIso };
}

/**
 * If sending fails AFTER claim, rollback the claim so retries can send.
 * (only rollback if the column still equals the exact iso we set)
 */
async function rollbackClaim(params: {
  supabase: any;
  orderId: string;
  col: string;
  nowIso: string;
}) {
  await params.supabase
    .from("orders")
    .update({ [params.col]: null })
    .eq("id", params.orderId)
    .eq(params.col, params.nowIso);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

   try {
    const body = (await req.json()) as ReqBody;

    // ✅ DEBUG #1: see exactly what iPad sends
    console.log("📩 send-order-email body =", body);

    const orderId = (body.orderId ?? body.order_id ?? "").trim();
    const type = (body.type ?? body.event) as EmailType;
    const kitchenMinutes = body.kitchenMinutes ?? body.kitchen_minutes;

    // ✅ DEBUG #2 and #3: confirm parsing worked
    console.log("✅ parsed orderId =", orderId);
    console.log("✅ parsed type =", type);
    console.log("✅ parsed kitchenMinutes =", kitchenMinutes);

    if (!orderId) return json({ ok: false, error: "Missing orderId" }, 400);
    if (type !== "paid" && type !== "accepted" && type !== "ready") {
      return json({ ok: false, error: "type must be 'paid', 'accepted', or 'ready'" }, 400);
    }
    // ✅ Use SERVICE ROLE on Edge Function (never anon)
    // Make sure these exist in Supabase Edge Secrets:
    // - SUPABASE_URL
    // - SUPABASE_SERVICE_ROLE_KEY
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    console.log("✅ env ok: SUPABASE_URL + SERVICE_ROLE loaded");

    const supabase = createClient(supabaseUrl, serviceKey);

    // ✅ 1) Claim first (dedupe, atomic)
    const { claimed, col, nowIso } = await claimEmailSend({ supabase, orderId, type });
    console.log("✅ claim result:", { claimed, col, nowIso });

    if (!claimed) {
      return json({ ok: true, skipped: true, reason: "already_sent", type }, 200);
    }

    // ✅ 2) Load order (after claim)
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(
        `
        id,
        order_number,
        customer_name,
        customer_email,
        pickup_scheduled_at,
        subtotal_cents,
        tax_cents,
        service_fee_cents,
        tip_cents,
        total_cents
      `
      )
      .eq("id", orderId)
      .single();
    console.log("✅ order loaded:", { hasOrder: !!order, orderErr: orderErr?.message });
    if (orderErr || !order) {
      await rollbackClaim({ supabase, orderId, col, nowIso });
      return json({ ok: false, error: `Order not found: ${orderErr?.message ?? ""}` }, 404);
    }

    const customerEmail = (order.customer_email ?? "").trim();
    if (!customerEmail) {
      console.log("⚠️ missing customer_email for order", orderId);
      await rollbackClaim({ supabase, orderId, col, nowIso });
      return json({ ok: false, error: "Order missing customer_email" }, 400);
    }

    // ✅ 3) Load items
    const { data: itemsRows, error: itemsErr } = await supabase
      .from("order_items")
      .select("qty, menu_item_name, options_summary, special_instructions, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (itemsErr) {
      await rollbackClaim({ supabase, orderId, col, nowIso });
      return json({ ok: false, error: `order_items error: ${itemsErr.message}` }, 500);
    }

    const items = (itemsRows ?? []).map((r: any) => ({
      qty: r.qty ?? 1,
      name: r.menu_item_name ?? "Item",
      options: r.options_summary ?? null,
      note: r.special_instructions ?? null,
    }));

    // ✅ 4) Compose + send (if send fails, rollback claim)
    const orderNumber = String(order.order_number ?? "");
    const subject = buildSubject(type, orderNumber);
    const text = buildTextEmail({
      type,
      orderNumber,
      customerName: order.customer_name,
      pickupScheduledAt: order.pickup_scheduled_at,
      kitchenMinutes,
      items,
      subtotalCents: order.subtotal_cents,
      taxCents: order.tax_cents,
      serviceFeeCents: order.service_fee_cents,
      tipCents: order.tip_cents,
      totalCents: order.total_cents,
    });
    console.log("📧 sending email to:", customerEmail);

    let resendResp = "";
    try {
      resendResp = await sendResendEmail({ to: customerEmail, subject, text });
      console.log("✅ resend success:", resendResp);
    } catch (e: any) {
      console.log("❌ resend failed:", e?.message ?? e);
      await rollbackClaim({ supabase, orderId, col, nowIso });
      throw e;
    }

    return json({ ok: true, sent: true, type, to: customerEmail, resendResp }, 200);
  } catch (err: any) {
    console.log("❌ send-order-email fatal:", err?.stack ?? err?.message ?? err);
    return json({ ok: false, error: err?.message ?? String(err) }, 500);
  }
});
