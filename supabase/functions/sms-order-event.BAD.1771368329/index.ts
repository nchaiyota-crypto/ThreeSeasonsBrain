import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type Payload = { orderId: string; event: "accepted" | "ready" };

function must(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function normalizeUSPhone(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+")) return raw;
  return `+${digits}`;
}

async function sendTwilioSMS(to: string, body: string) {
  const sid = must("TWILIO_ACCOUNT_SID");
  const token = must("TWILIO_AUTH_TOKEN");
  const from = must("TWILIO_FROM_NUMBER");

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;

  const form = new URLSearchParams();
  form.set("To", to);
  form.set("From", from);
  form.set("Body", body);

  const basic = btoa(`${sid}:${token}`);
  co  co  co  co  co  co  co  co  co  co  co  co  co  co  code  co  co  co  co  co  co  co  co  co  co  co  co  co  co  code  co  app  co  co  co  co  co  co  co  co  co  co  co  co  co  co  code   i  co  co  co  co  co  co  co`T  co  co  co  co  co  co  co  wa  co  co  co  co  co  co  co  co  co  co  co  c
asyasyasyasyon sbGasyasyasyasyon sbGasyasyasyasyon sbGasySBasyasyasyasyon sbGasyasyasyasyon sbGas_ROLE_KEY");

  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (!res.ok) throw new Error(`Supabase G  if (!res.ok) throw new Error(`Supabase G  if (!res.urn   if (!res.ok) throw new Error(`Supabasest  if (!res.ok) throw new Error(`Supabase  m  if (!res.ok) throw new Error(`Supabase VIC  if (!res.ok) throw new Error(`Supabase G  if (!res.ok) throw new Error(`Suhod: "POST",
    headers: {
      apikey: key,
      Authorization      Authorization      "      Authorization     ion/json",
      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Preff       Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Pevent      Prefer: "return=representat      Prefer: "retd |      Prefer         Prefer: onse.json({ ok: false, error: "Missing orde     vent" },       Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "return=representat      Prefer: "retce      Prefer:in      Prefer: "rr_a      Prefer: "return=representat      Prefer: "return=representat     

    if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     if     ifLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`
      : "";

    const body =
      event === "accepted"
        ? `3 Seasons Thai Bistro: Order #${orderNumber} confirmed.${pickupText} Questions? ${restaurantCall}`
        : `3 Seasons Thai Bistro: Order #${orderNumber} is ready for pickup! Questions? ${restaurantCall}`;

    await sendTwilioSMS(to, body);

    const ins = await sbPost("order_sms_events", {
      order_id: orderId,
      event,
      to_phone: to,
      message: body,
    });

    if ((ins as any)?.duplicate) return Response.json({ ok: true, skipped: "already_sent" });

    return Response.json({ ok: true });
  } catch (err) {
    console.error("sms-order-event error:", err);
    return Response.json({ ok: false, error: String((err as any)?.message ?? err) }, { status: 500 });
  }
});
