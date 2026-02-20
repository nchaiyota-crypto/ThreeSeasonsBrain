import { NextResponse } from "next/server";
import { menuItems } from "../../menu/menuData";

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
  const categoriesMap = new Map<string, ApiMenuItem[]>();

  for (const item of menuItems as any[]) {
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