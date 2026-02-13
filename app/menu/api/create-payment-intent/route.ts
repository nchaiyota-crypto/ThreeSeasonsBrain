import { NextResponse } from "next/server";
import Stripe from "stripe";

// IMPORTANT: adjust this import path to match where your menuData lives.
// If menuData.ts is at: app/menu/menuData.ts  -> use "../../menuData"
import { menuItems } from "../../menuData";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
});

type IncomingItem = {
  id?: string;
  itemId?: string;
  qty: number;
  unitPrice?: number; // dollars (includes add-ons)
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const items: IncomingItem[] = Array.isArray(body?.items) ? body.items : [];

    if (items.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    // Build a lookup table from menuItems
    const byId = new Map(menuItems.map((m) => [m.id, m]));

    // Validate + compute subtotal (in cents)
    let subtotalCents = 0;

    for (const it of items as any[]) {
      const id = String(it.id ?? it.itemId ?? "");
      const qty = Number(it.qty);

      if (!id || !Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json({ error: "Invalid cart item" }, { status: 400 });
      }

      const menuItem = byId.get(id);
      if (!menuItem) {
        return NextResponse.json({ error: `Unknown item id: ${id}` }, { status: 400 });
      }

      // base price from menu (dollars -> cents)
      const baseCents = Math.round(menuItem.price * 100);

      // if client sends unitPrice (dollars), use it (includes add-ons)
      const sentUnitPrice = Number(it.unitPrice);
      const unitCents =
        Number.isFinite(sentUnitPrice) && sentUnitPrice > 0
          ? Math.round(sentUnitPrice * 100)
          : baseCents;

      // safety: never allow price lower than menu base price
      if (unitCents < baseCents) {
        return NextResponse.json({ error: "Invalid price" }, { status: 400 });
      }

      subtotalCents += unitCents * qty;
    }

    // Tax (10.75%) in cents
    const TAX_RATE = 0.1075;
    const taxCents = Math.round(subtotalCents * TAX_RATE);

    const totalCents = subtotalCents + taxCents;

    // Stripe requires amount in cents (integer)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        source: "3-seasons-test",
        subtotal_cents: String(subtotalCents),
        tax_cents: String(taxCents),
      },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: totalCents,
      subtotal: subtotalCents,
      tax: taxCents,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}