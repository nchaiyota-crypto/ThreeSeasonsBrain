// lib/printFormat.ts

export type TicketItemInput = {
  qty: number;
  name: string;
  modifiers?: string[];
};

export type KitchenInput = {
  customerName?: string;
  table?: string;
  guestCount?: number;
  terminalName?: string;
  orderNumber: string | number;
  createdAtISO: string;
  items: TicketItemInput[];
  topGapLines?: number; // default 4
};

export type ReceiptItemInput = {
  qty: number;
  name: string;
  price_cents?: number;
  modifiers?: string[];
};

export type ReceiptInput = {
  restaurantName: string;
  addressLines: string[];
  phone?: string;

  table?: string;
  server?: string;
  guestCount?: number;

  orderNumber: string | number;
  createdAtISO: string;

  items: ReceiptItemInput[];

  subtotal_cents?: number;
  tax_cents?: number;
  total_cents?: number;
  salesTaxRateText?: string;
};

const WIDTH = 42;

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function lr(left: string, right: string) {
  const space = Math.max(1, WIDTH - left.length - right.length);
  return left + " ".repeat(space) + right;
}

function wrap(text: string, indentSpaces = 0): string[] {
  const indent = " ".repeat(indentSpaces);
  const words = String(text ?? "").trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  const max = WIDTH - indentSpaces;

  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length <= max) line = next;
    else {
      if (line) lines.push(indent + line);
      line = w;
    }
  }
  if (line) lines.push(indent + line);
  return lines.length ? lines : [indent];
}

function topPad(L: string[], n: number) {
  for (let i = 0; i < n; i++) L.push("");
}

/** Shared item rendering (NO prices) */
function renderItemsNoPrice(L: string[], items: TicketItemInput[]) {
  for (const it of items) {
    const qty = Math.max(1, Number(it.qty || 1));
    const name = String(it.name || "Item");

    const nameLines = wrap(name, 4);
    L.push(`${qty}`.padEnd(3) + nameLines[0].trim());
    for (let i = 1; i < nameLines.length; i++) {
      L.push(" ".repeat(3) + nameLines[i].trim());
    }

    if (it.modifiers?.length) {
      for (const m of it.modifiers) {
        for (const ml of wrap(String(m), 6)) {
          L.push(" ".repeat(3) + ml.trim());
        }
      }
    }
  }
}

/** Helps “separate” tickets even if the printer doesn’t cut */
function endTicketBlock(L: string[]) {
  L.push("");
  L.push("-".repeat(WIDTH));
  L.push("");
  L.push("");
}

/**
 * Optional: try to cut (works if your CUPS queue is RAW / passes ESC/POS)
 * If it prints weird characters, remove it.
 */
function escposCut(): string {
  return "\x1dV\x00"; // GS V 0 (full cut)
}

/** ✅ Kitchen ticket (NO prices) */
export function buildKitchenTicketText(input: KitchenInput) {
  const L: string[] = [];
  topPad(L, input.topGapLines ?? 4);

  L.push("3 Seasons Thai Bistro");
  L.push("KITCHEN TICKET");
  L.push("-".repeat(WIDTH));

  if (input.table) L.push(`Table: ${input.table}`);
  if (typeof input.guestCount === "number") L.push(`Guest: ${input.guestCount}`);
  if (input.terminalName) L.push(`Terminal: ${input.terminalName}`);
  if (input.customerName) L.push(`Name: ${input.customerName}`);

  L.push(`Order: ${input.orderNumber}`);
  L.push(`Time: ${new Date(input.createdAtISO).toLocaleString()}`);
  L.push("-".repeat(WIDTH));

  renderItemsNoPrice(L, input.items);
  endTicketBlock(L);

  // If RAW works, this forces a cut per ticket:
  // return L.join("\n") + escposCut();

  return L.join("\n");
}

/** ✅ Checker ticket (NO prices) */
export function buildCheckerTicketText(input: KitchenInput) {
  const L: string[] = [];
  topPad(L, input.topGapLines ?? 4);

  L.push("3 Seasons Thai Bistro");
  L.push("CHECKER TICKET");
  L.push("-".repeat(WIDTH));

  if (input.table) L.push(`Table: ${input.table}`);
  if (typeof input.guestCount === "number") L.push(`Guest: ${input.guestCount}`);
  if (input.terminalName) L.push(`Terminal: ${input.terminalName}`);

  L.push(`Order: ${input.orderNumber}`);
  L.push(`Time: ${new Date(input.createdAtISO).toLocaleString()}`);
  L.push("-".repeat(WIDTH));

  renderItemsNoPrice(L, input.items);

  L.push("");
  L.push("CHECKED BY: ____________");
  endTicketBlock(L);

  // If RAW works:
  // return L.join("\n") + escposCut();

  return L.join("\n");
}

/** ✅ Customer receipt (WITH prices + totals) */
export function buildReceiptText(input: ReceiptInput) {
  const L: string[] = [];
  L.push(input.restaurantName);
  for (const a of input.addressLines) L.push(a);
  if (input.phone) L.push(input.phone);
  L.push("");

  const topLeft = `Table ${input.table ?? "-"}`;
  const topRight = `Order# ${input.orderNumber}`;
  L.push(lr(topLeft, topRight));

  const meta: string[] = [];
  if (input.server) meta.push(`Server# ${input.server}`);
  if (typeof input.guestCount === "number") meta.push(`Guest ${input.guestCount}`);
  if (meta.length) L.push(meta.join("   "));

  L.push(new Date(input.createdAtISO).toLocaleString());
  L.push("-".repeat(WIDTH));

  for (const it of input.items) {
    const qty = Math.max(1, Number(it.qty || 1));
    const name = String(it.name || "Item");
    const lineTotal = it.price_cents != null ? money(it.price_cents * qty) : "";

    const nameLines = wrap(name, 4);
    const firstLeft = `${qty}`.padEnd(3) + nameLines[0].trim();
    L.push(lr(firstLeft, lineTotal));

    for (let i = 1; i < nameLines.length; i++) {
      L.push(" ".repeat(3) + nameLines[i].trim());
    }

    if (it.modifiers?.length) {
      for (const m of it.modifiers) {
        for (const ml of wrap(String(m), 6)) {
          L.push(" ".repeat(3) + ml.trim());
        }
      }
    }
  }

  L.push("-".repeat(WIDTH));

  if (typeof input.subtotal_cents === "number") L.push(lr("SubTotal", money(input.subtotal_cents)));

  if (typeof input.tax_cents === "number") {
    const label = input.salesTaxRateText ? `Sales Tax (${input.salesTaxRateText})` : "Sales Tax";
    L.push(lr(label, money(input.tax_cents)));
  }

  if (typeof input.total_cents === "number") {
    L.push("");
    L.push(lr("Total Due", money(input.total_cents)));
  }

  L.push("");
  L.push("THANK YOU");
  L.push("");
  L.push("");
  return L.join("\n");
}