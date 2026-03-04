// supabase/functions/sms-order-event/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ── Types ─────────────────────────────────────────────────────────────────────

type ReqBody = {
  // Mode 1: direct send (used by order-intake route for immediate confirmations)
  directSend?: boolean;
  to?: string;
  message?: string;

  // Mode 2: order event (used by iPad KDS after accept / ready)
  orderId?: string;
  event?: "accepted" | "ready";
  kitchenMinutes?: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function mustEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function json(data: unknown, status = 200) {
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

/** Normalise any phone string to E.164 (+1XXXXXXXXXX for US) */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`; // pass through, Twilio will reject if invalid
}

async function sendTwilioSMS(to: string, body: string) {
  const accountSid = mustEnv("TWILIO_ACCOUNT_SID");
  const authToken  = mustEnv("TWILIO_AUTH_TOKEN");
  const fromNumber = mustEnv("TWILIO_FROM_NUMBER");

  const phone = normalizePhone(to);
  const url   = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const creds = btoa(`${accountSid}:${authToken}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization:  `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To:   phone,
      // Use MessagingServiceSid if value starts with "MG" (registered campaign)
      // otherwise fall back to direct From number
      ...(fromNumber.startsWith("MG")
        ? { MessagingServiceSid: fromNumber }
        : { From: fromNumber }),
      Body: body,
    }).toString(),
  });

  const result = await res.json();
  if (!res.ok) {
    throw new Error(
      `Twilio error ${res.status}: ${result?.message ?? JSON.stringify(result)}`
    );
  }
  console.log(`✅ Twilio SMS sent → ${phone} (sid: ${result.sid})`);
  return result as { sid: string };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST")
    return json({ ok: false, error: "POST only" }, 405);

  try {
    const body = (await req.json()) as ReqBody;
    console.log("📱 sms-order-event body =", JSON.stringify(body));

    // ── Mode 1: Direct send ─────────────────────────────────────────────────
    // Used by order-intake route to send immediate order confirmations.
    // Payload: { directSend: true, to: "+15105551234", message: "Hi John! ..." }
    if (body.directSend === true) {
      if (!body.to?.trim())
        return json({ ok: false, error: "Missing 'to'" }, 400);
      if (!body.message?.trim())
        return json({ ok: false, error: "Missing 'message'" }, 400);

      const result = await sendTwilioSMS(body.to.trim(), body.message.trim());
      return json({ ok: true, sid: result.sid, mode: "direct" });
    }

    // ── Mode 2: Order event ─────────────────────────────────────────────────
    // Used by iPad KDS after marking an order accepted or ready.
    // Payload: { orderId: "uuid", event: "accepted", kitchenMinutes: 20 }
    const orderId = (body.orderId ?? "").trim();
    const event   = body.event;

    if (!orderId)
      return json({ ok: false, error: "Missing orderId" }, 400);
    if (event !== "accepted" && event !== "ready")
      return json({ ok: false, error: "event must be 'accepted' or 'ready'" }, 400);

    // Look up order so we can get the customer phone + name
    const supabase = createClient(
      mustEnv("SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, order_number, customer_name, customer_phone")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) {
      console.error("❌ order not found:", orderErr?.message);
      return json(
        { ok: false, error: `Order not found: ${orderErr?.message ?? ""}` },
        404
      );
    }

    const phone = (order.customer_phone ?? "").trim();
    if (!phone) {
      console.log("⚠️ No customer_phone for order", orderId, "— skipping SMS");
      return json({ ok: true, skipped: true, reason: "no_phone" });
    }

    const name     = (order.customer_name ?? "").trim() || "there";
    const orderNum = order.order_number ?? "";

    let message = "";

    if (event === "accepted") {
      const mins = body.kitchenMinutes ?? 20;
      message =
        `Hi ${name}! ✅ Your 3 Seasons Thai Bistro order #${orderNum} has been accepted. ` +
        `Estimated ready in ~${mins} minutes. We'll text you when it's ready! 🍜`;
    } else {
      // event === "ready"
      message =
        `Hi ${name}! 🎉 Your 3 Seasons Thai Bistro order #${orderNum} is READY for pickup. ` +
        `Please come to the counter. See you soon! 🍜`;
    }

    const result = await sendTwilioSMS(phone, message);
    return json({ ok: true, sid: result.sid, event, to: phone, mode: "event" });

  } catch (err: any) {
    console.error("❌ sms-order-event fatal:", err?.message ?? err);
    return json({ ok: false, error: err?.message ?? String(err) }, 500);
  }
});
