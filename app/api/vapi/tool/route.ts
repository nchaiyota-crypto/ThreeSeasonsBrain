// app/api/vapi/tool/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single VAPI tool endpoint — handles all AI phone tool calls:
//   • get_menu            → voice-friendly menu summary
//   • get_wait_time       → current wait time + paused status
//   • create_order        → place an order (pay_at_pickup or pay_now)
//   • check_order_status  → look up a customer's order by phone or order #
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { menuItems } from "../../../menu/menuData";

export const runtime = "nodejs";

// ── Env helpers ───────────────────────────────────────────────────────────────

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function supabaseAdmin() {
  return createClient(
    must("NEXT_PUBLIC_SUPABASE_URL"),
    must("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

// ── VAPI payload types ────────────────────────────────────────────────────────

type VapiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
};

type VapiRequest = {
  message?: {
    type: string;
    toolCallList?: VapiToolCall[];
  };
};

type ToolResult = {
  toolCallId: string;
  result: string;
};

// ── Tool implementations ──────────────────────────────────────────────────────

/**
 * get_menu
 * Returns a concise, voice-friendly menu summary so the AI can describe options.
 * Excludes any items that are currently 86'd.
 * Args: { category?: string }  — optional, filter to one category
 */
async function toolGetMenu(args: { category?: string }): Promise<string> {
  // Fetch 86'd item IDs
  const sb = supabaseAdmin();
  const { data: rows86 } = await sb.from("menu_86").select("item_id");
  const outOfStockIds = new Set((rows86 ?? []).map((r: any) => String(r.item_id)));

  const targetCategory = args.category?.trim().toLowerCase();

  // Build voice-friendly menu text
  const categoryMap = new Map<string, string[]>();

  for (const item of menuItems as any[]) {
    if (outOfStockIds.has(String(item.id))) continue; // skip 86'd items

    const cat = String(item.category ?? "Other");
    if (targetCategory && cat.toLowerCase() !== targetCategory) continue;

    const price = `$${Number(item.price ?? 0).toFixed(2)}`;
    const desc  = item.description ? ` — ${item.description}` : "";

    // Summarize protein/option choices if present
    const proteinGroup = (item.options ?? []).find(
      (o: any) => o.name?.toLowerCase().includes("protein")
    );
    const proteinChoices = proteinGroup
      ? ` (proteins: ${(proteinGroup.choices ?? []).map((c: any) => c.name).join(", ")})`
      : "";

    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(`${item.name} ${price}${desc}${proteinChoices}`);
  }

  if (categoryMap.size === 0) {
    return targetCategory
      ? `Sorry, I don't have any items in the "${args.category}" category right now.`
      : "The menu is not available right now. Please try again shortly.";
  }

  const lines: string[] = [];
  for (const [cat, items] of categoryMap) {
    lines.push(`${cat}: ${items.join("; ")}.`);
  }

  const header = targetCategory
    ? `Here are our ${args.category} options:`
    : `Here is our menu:`;

  return `${header} ${lines.join(" ")}`;
}

/**
 * get_wait_time
 * Returns current kitchen wait time and paused/busy status.
 * Args: {}
 */
async function toolGetWaitTime(): Promise<string> {
  const supabaseUrl = must("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/get_wait_status`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`get_wait_status returned ${res.status}`);
    const data = await res.json();

    if (data.paused) {
      const msg = data.pause_message?.trim();
      return msg
        ? `The kitchen is currently paused. ${msg}. We are not accepting new orders right now. Please call back later or place a scheduled order.`
        : "The kitchen is currently paused and not accepting new orders right now. Please call back later.";
    }

    const status = data.status ?? "normal";
    const waitMap: Record<string, { text: string; label: string }> = {
      normal:    { text: "about 15 minutes",    label: "normal" },
      busy:      { text: "about 30 to 40 minutes", label: "busy" },
      very_busy: { text: "about 45 to 55 minutes", label: "very_busy" },
      rush:      { text: "60 minutes or more",  label: "rush" },
    };
    const wait = waitMap[status] ?? { text: "about 15 minutes", label: "normal" };

    return `[STATUS:${wait.label}] The kitchen is open. Current wait time is ${wait.text} for takeout orders.`;
  } catch {
    return "[STATUS:normal] The kitchen is open. Current wait time is about 15 minutes for takeout orders.";
  }
}

/**
 * create_order
 * Places an order via the order-intake API.
 * Args: {
 *   customer_name: string,
 *   customer_phone?: string,
 *   customer_email?: string,
 *   payment_choice: "pay_at_pickup" | "pay_now",
 *   pickup_mode: "asap" | "scheduled",
 *   pickup_scheduled_at?: string,   // ISO string if scheduled
 *   items: Array<{
 *     name: string,
 *     qty: number,
 *     unit_price_cents: number,
 *     menu_item_id?: string,
 *     modifiers?: string,
 *     notes?: string
 *   }>
 * }
 */
async function toolCreateOrder(args: any): Promise<string> {
  const siteUrl = must("NEXT_PUBLIC_SITE_URL");

  const res = await fetch(`${siteUrl}/api/ai/order-intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });

  const data = await res.json();

  if (!data.ok) {
    // Surface the error to VAPI so the AI can handle it gracefully
    return `Sorry, I was unable to place your order. Reason: ${data.error ?? "unknown error"}. Please try again or call us directly.`;
  }

  const orderNum  = data.order_number ?? "";
  const payStatus = data.payment_status ?? "";

  if (payStatus === "needs_payment") {
    return (
      `Your order #${orderNum} has been placed successfully and is confirmed! ` +
      `You will pay when you arrive for pickup. ` +
      `You'll receive a text message with your order confirmation. ` +
      `Is there anything else I can help you with?`
    );
  }

  if (data.checkout_url) {
    return (
      `Your order #${orderNum} has been placed! ` +
      `I've sent a payment link to your email and phone. ` +
      `Please complete payment to confirm your order. ` +
      `Once paid, we'll start cooking right away! ` +
      `Is there anything else I can help you with?`
    );
  }

  return (
    `Your order #${orderNum} has been placed successfully! ` +
    `Is there anything else I can help you with?`
  );
}

/**
 * check_order_status
 * Looks up the most recent order for a customer by phone number or order number.
 * Args: { phone?: string, order_number?: number }
 */
async function toolCheckOrderStatus(args: {
  phone?: string;
  order_number?: number;
}): Promise<string> {
  const sb = supabaseAdmin();

  let query = sb
    .from("orders")
    .select("id, order_number, status, payment_status, estimated_ready_at, ready_at, accepted_at, created_at")
    .or("source.eq.online,source.eq.ai_phone")
    .order("created_at", { ascending: false })
    .limit(1);

  if (args.order_number) {
    query = query.eq("order_number", args.order_number);
  } else if (args.phone) {
    // Normalize phone: strip non-digits
    const digits = args.phone.replace(/\D/g, "");
    const normalized = digits.length === 10 ? `+1${digits}` : `+${digits}`;
    query = query.eq("customer_phone", normalized);
  } else {
    return "I need either your phone number or order number to look up your order. Could you provide one of those?";
  }

  const { data: orders, error } = await query;

  if (error || !orders || orders.length === 0) {
    return args.order_number
      ? `I could not find order #${args.order_number}. Please double-check the order number or call us at the restaurant.`
      : "I could not find any recent orders for that phone number. Please double-check the number or call us directly.";
  }

  const order = orders[0];
  const num   = order.order_number;
  const status = order.status ?? "unknown";
  const payStatus = order.payment_status ?? "";

  // Build a voice-friendly status message
  if (payStatus === "needs_payment" && status !== "accepted" && status !== "ready") {
    return `Your order #${num} is confirmed and waiting in the queue. You'll pay when you arrive for pickup.`;
  }

  if (status === "paid" || status === "new" || status === "sent") {
    return `Your order #${num} has been received and is waiting for the kitchen to accept it. We'll text you once it's accepted.`;
  }

  if (status === "accepted") {
    const eta = order.estimated_ready_at ? new Date(order.estimated_ready_at) : null;
    const now = new Date();
    if (eta && eta > now) {
      const minsLeft = Math.max(1, Math.round((eta.getTime() - now.getTime()) / 60000));
      return `Your order #${num} has been accepted and is being prepared. Estimated ready in about ${minsLeft} minute${minsLeft !== 1 ? "s" : ""}.`;
    }
    return `Your order #${num} has been accepted and is being prepared. It should be ready very soon!`;
  }

  if (status === "ready") {
    return `Great news! Your order #${num} is READY for pickup. Please come to the counter at 3 Seasons Thai Bistro. See you soon!`;
  }

  return `Your order #${num} has status: ${status}. If you have questions, please call us directly.`;
}

// ── Request handler ───────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    // Optional: verify VAPI secret header
    const vapiSecret = process.env.VAPI_SERVER_SECRET;
    if (vapiSecret) {
      const authHeader = req.headers.get("x-vapi-secret") ?? "";
      if (authHeader !== vapiSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = (await req.json()) as VapiRequest;
    const toolCalls = body?.message?.toolCallList ?? [];

    if (toolCalls.length === 0) {
      return NextResponse.json({ results: [] });
    }

    // Process all tool calls (usually just one at a time)
    const results: ToolResult[] = await Promise.all(
      toolCalls.map(async (call): Promise<ToolResult> => {
        const fnName = call.function.name;
        let argsRaw: any = {};
        try {
          argsRaw = JSON.parse(call.function.arguments || "{}");
        } catch {
          argsRaw = {};
        }

        console.log(`🔧 VAPI tool call: ${fnName}`, argsRaw);

        let result = "";
        try {
          switch (fnName) {
            case "get_menu":
              result = await toolGetMenu(argsRaw);
              break;
            case "get_wait_time":
              result = await toolGetWaitTime();
              break;
            case "create_order":
              result = await toolCreateOrder(argsRaw);
              break;
            case "check_order_status":
              result = await toolCheckOrderStatus(argsRaw);
              break;
            default:
              result = `Unknown tool: ${fnName}. Please try again.`;
          }
        } catch (err: any) {
          console.error(`❌ Tool ${fnName} error:`, err?.message ?? err);
          result = `Sorry, there was an error processing your request. Please try again or call us directly.`;
        }

        console.log(`✅ VAPI tool result for ${fnName}:`, result.slice(0, 120));
        return { toolCallId: call.id, result };
      })
    );

    return NextResponse.json({ results });

  } catch (err: any) {
    console.error("❌ VAPI tool endpoint error:", err?.message ?? err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
