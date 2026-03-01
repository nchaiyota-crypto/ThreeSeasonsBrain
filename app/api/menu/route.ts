import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { menuItems } from "../../menu/menuData";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Fetch out-of-stock item IDs from Supabase menu_86 table
async function fetchOutOfStockIds(): Promise<Set<string>> {
  try {
    const supabase = createClient(
      must("NEXT_PUBLIC_SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );
    const { data, error } = await supabase
      .from("menu_86")
      .select("item_id");
    if (error || !data) return new Set();
    return new Set(data.map((r: any) => String(r.item_id)));
  } catch {
    // If table doesn't exist yet, fail gracefully — show all items
    return new Set();
  }
}

// Types returned to iPad
type ApiMenuChoice = { id: string; name: string; priceDeltaCents: number };
type ApiMenuOptionGroup = {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  choices: ApiMenuChoice[];
};

type ApiMenuItem = {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  imageUrl?: string;
  optionGroups: ApiMenuOptionGroup[];
};

type ApiMenuCategory = { name: string; items: ApiMenuItem[] };

export async function GET() {
  // Get 86'd item IDs — items in this set are filtered out of the response
  const outOfStockIds = await fetchOutOfStockIds();

  const categoriesMap = new Map<string, ApiMenuItem[]>();

  for (const item of menuItems as any[]) {
    // Skip 86'd items entirely
    if (outOfStockIds.has(String(item.id))) continue;

    const category = String(item.category ?? "Other");

    const optionGroups: ApiMenuOptionGroup[] = (item.options ?? []).map((opt: any) => ({
      id: String(opt.id),
      name: String(opt.name),
      required: !!opt.required,
      minSelect: typeof opt.minSelect === "number" ? opt.minSelect : (opt.required ? 1 : 0),
      maxSelect: typeof opt.maxSelect === "number" ? opt.maxSelect : 1,
      choices: (opt.choices ?? []).map((c: any) => ({
        id: String(c.id),
        name: String(c.name),
        // menuData uses dollars in priceDelta → convert to cents
        priceDeltaCents: Math.round(Number(c.priceDelta ?? 0) * 100),
      })),
    }));

    const apiItem: ApiMenuItem = {
      id: String(item.id),
      name: String(item.name),
      description: item.description ? String(item.description) : undefined,
      // menuData uses dollars in price → convert to cents
      priceCents: Math.round(Number(item.price ?? 0) * 100),
      imageUrl: item.imageUrl ? String(item.imageUrl) : undefined,
      optionGroups,
    };

    if (!categoriesMap.has(category)) categoriesMap.set(category, []);
    categoriesMap.get(category)!.push(apiItem);
  }

  const categories: ApiMenuCategory[] = Array.from(categoriesMap.entries()).map(([name, items]) => ({
    name,
    items,
  }));

  const body = {
    updatedAt: new Date().toISOString(), // ✅ matches MenuResponse.updatedAt (String)
    categories,                          // ✅ matches MenuResponse.categories
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}