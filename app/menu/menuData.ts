import {
  OPT_PROTEIN_REQUIRED,
  OPT_VEGETABLE_ADDON,
  OPT_PROTEIN_ADDON,
} from "../../src/lib/optionTemplates";

/* =========================
   Types (single source of truth)
========================= */

export type MenuChoice = {
  id: string;
  name: string;
  priceDelta?: number; // dollars (ex: 2 = +$2.00)
};

export type MenuOption = {
  id: string;
  name: string;
  required: boolean;
  minSelect?: number; // default 0/1
  maxSelect?: number; // default 1 for radio, or many for checkboxes
  choices: MenuChoice[];
};

export type MenuItem = {
  id: string;
  name: string;
  description?: string;
  price: number; // dollars
  category: string;
  imageUrl?: string;
  options?: MenuOption[]; // <-- NEW unified options
};

/* =========================
   Helpers
========================= */

const MENU_IMAGE_BASE = "/images/menu/";
const makeItem = (item: Omit<MenuItem, "imageUrl"> & { imageUrl?: string }): MenuItem => ({
  ...item,
  imageUrl: item.imageUrl ?? `/images/menu/${item.id}.jpg`,
});

/**
 * Soup protein required template (Tom Yum + Tom Kha)
 * Matches your screenshot:
 * Vegetable, Soft Tofu, Chicken +2, Prawns +4, Seafood +6
 */
const OPT_SOUP_PROTEIN_REQUIRED: MenuOption = {
  id: "protein_required_soup",
  name: "Protein Choice",
  required: true,
  minSelect: 1,
  maxSelect: 1,
  choices: [
    { id: "vegetable", name: "Vegetable", priceDelta: 0 },
    { id: "soft_tofu", name: "Soft Tofu", priceDelta: 0 },
    { id: "chicken", name: "Chicken", priceDelta: 2 },
    { id: "prawns", name: "Prawns", priceDelta: 4 },
    { id: "seafood", name: "Seafood", priceDelta: 6 },
  ],
};

const REQUIRED_SOUP_IDS = new Set(["tom_yum_soup", "coconut_milk_soup"]); // Tom Yum + Tom Kha
const REGULAR_PROTEIN_REQUIRED_CATEGORIES = new Set(["Entrée", "Curry", "Noodle/Fried Rice"]);

/**
 * Default options:
 * - Soup:
 *   - Tom Yum / Tom Kha -> soup protein required + protein addon + veg addon
 *   - Wonton soup / other soups -> no required protein, but allow protein addon + veg addon
 * - Entrée/Curry/Noodle -> protein required + protein addon + veg addon
 * - Everything else -> no options by default
 */
function getDefaultOptionsForItem(item: MenuItem): MenuOption[] {
  // Soups
  if (item.category === "Soup") {
    if (REQUIRED_SOUP_IDS.has(item.id)) {
      return [OPT_SOUP_PROTEIN_REQUIRED, OPT_PROTEIN_ADDON, OPT_VEGETABLE_ADDON];
    }
    // Wonton soup (not required), but can add add-on protein/veg
    return [OPT_PROTEIN_ADDON, OPT_VEGETABLE_ADDON];
  }

  // Entrée/Curry/Noodle/Fried Rice
  if (REGULAR_PROTEIN_REQUIRED_CATEGORIES.has(item.category)) {
    return [OPT_PROTEIN_REQUIRED, OPT_PROTEIN_ADDON, OPT_VEGETABLE_ADDON];
  }

  // Default: none
  return [];
}

/* =========================
   Menu Items
========================= */

const RAW_MENU_ITEMS: MenuItem[] = [
  makeItem({
    id: "tom_yum_soup",
    name: "Lemongrass Soup (Tom Yum)",
    description: "Hot & sour soup with choice of protein, mushroom, tomato, onion and cilantro",
    price: 13.95,
    category: "Soup",
  }),

  makeItem({
    id: "cream_cheese_wonton",
    name: "Cream Cheese Wonton (7 pcs)",
    description: "Crispy wonton stuffed with crab meat, cream cheese, green onion",
    price: 10.95,
    category: "Appetizer",
  }),

  makeItem({
    id: "chicken_satay",
    name: "Chicken Satay (4 pcs)",
    description: "Grilled chicken skewers with peanut sauce and cucumber salad",
    price: 12.95,
    category: "Appetizer",
  }),

  makeItem({
    id: "crispy_imperial_roll",
    name: "Crispy Imperial Roll (4 pcs)",
    description: "Vegetable, glass noodle, egg pastry, sweet & sour sauce",
    price: 12.95,
    category: "Appetizer",
  }),

  makeItem({
    id: "pot_sticker",
    name: "Pot Sticker (7 pcs)",
    description: "Fresh chicken dumpling with soy vinaigrette",
    price: 10.95,
    category: "Appetizer",
  }),

  makeItem({
    id: "fresh_spring_roll",
    name: "Fresh Spring Roll (Shrimp or Tofu)",
    description: "Mixed vegetables wrapped in rice paper with peanut sauce",
    price: 12.95,
    category: "Appetizer",
  }),

  makeItem({
    id: "thai_puff",
    name: "Thai Puff (4 pcs)",
    description: "Fried puff pastry with chicken or taro, sweet & sour sauce",
    price: 12.95,
    category: "Appetizer",
  }),

  makeItem({
    id: "three_season_chicken_wings",
    name: "3 Season Chicken Wings (7 pcs)",
    description: "Chicken wings with homemade sweet & sour sauce",
    price: 12.95,
    category: "Appetizer",
  }),

  makeItem({
    id: "green_papaya_salad",
    name: "Green Papaya Salad (Som Tum)",
    description: "Shredded papaya, carrot, tomato, garlic, ground peanut tossed with lime dressing",
    price: 12.95,
    category: "Salad",
  }),

  makeItem({
    id: "chicken_salad",
    name: "Chicken Salad (Larb Gai)",
    description:
      "Ground chicken, red onion, cilantro, green onion, rice powder mixed with lime dressing",
    price: 13.95,
    category: "Salad",
  }),

  makeItem({
    id: "mango_salad",
    name: "Mango Salad",
    description:
      "Sliced mango, onion, cilantro, carrot, cucumber, cashew nut mixed with lime dressing, topped with steamed prawns",
    price: 13.95,
    category: "Salad",
  }),

  makeItem({
    id: "coconut_milk_soup",
    name: "Coconut Milk Soup (Tom Kha)",
    description: "Coconut milk in sour soup base with choice of protein, mushroom, onion and cilantro",
    price: 13.95,
    category: "Soup",
  }),

  makeItem({
    id: "won_ton_soup",
    name: "Won Ton Soup",
    description:
      "Marinated ground pork and shrimp in egg wonton wrapper with bok choy, garlic and green onion in clear broth",
    price: 13.95,
    category: "Soup",
  }),

  makeItem({
    id: "peanut_sauce_lover",
    name: "Peanut Sauce Lover",
    description: "Carrot, broccoli, spinach topped with Thai peanut sauce",
    price: 14.95,
    category: "Entrée",
  }),

  makeItem({
    id: "spicy_basil_entree",
    name: "Spicy Basil",
    description: "Onion, bell pepper, green bean, red chili flake, basil",
    price: 14.95,
    category: "Entrée",
  }),

  makeItem({
    id: "fresh_ginger",
    name: "Fresh Ginger",
    description: "Onion, bell pepper, mushroom and ginger",
    price: 14.95,
    category: "Entrée",
  }),

  makeItem({
    id: "pad_prik_khing",
    name: "Pad Prik Khing",
    description: "Bell pepper, green bean, prik khing paste and kaffir leaf",
    price: 14.95,
    category: "Entrée",
  }),

  makeItem({
    id: "fresh_broccoli_delight",
    name: "Fresh Broccoli Delight",
    description: "Carrot and broccoli",
    price: 14.95,
    category: "Entrée",
  }),

  makeItem({
    id: "pad_thai",
    name: "Pad Thai",
    description: "Rice noodle, egg, bean sprout, green onion, ground peanut",
    price: 14.95,
    category: "Noodle/Fried Rice",
  }),

  makeItem({
    id: "pad_see_ew",
    name: "Pad See Ew",
    description: "Flat rice noodle, egg, Chinese broccoli, sweet soy sauce",
    price: 15.95,
    category: "Noodle/Fried Rice",
  }),

  makeItem({
    id: "drunken_noodle",
    name: "Drunken Noodle",
    description: "Flat rice noodle, egg, onion, bell pepper, basil, chili",
    price: 15.95,
    category: "Noodle/Fried Rice",
  }),

  makeItem({
    id: "pineapple_fried_rice",
    name: "Pineapple Fried Rice",
    description: "pineapple, jasmine rice, egg, onion, cashew nut, raisin curry powder",
    price: 15.95,
    category: "Noodle/Fried Rice",
  }),

  makeItem({
    id: "thai_fried_rice",
    name: "Thai Fried Rice",
    description: "Jasmine rice, egg, onion, carrot and green onion",
    price: 14.95,
    category: "Noodle/Fried Rice",
  }),

    makeItem({
    id: "crab_fried_rice",
    name: "Crab Fried Rice",
    description: "Crab meat, jasmine rice, egg, onion, carrot and green onion",
    price: 14.95,
    category: "Noodle/Fried Rice",
  }),

  makeItem({
    id: "green_curry",
    name: "Green Curry",
    description: "Green curry sauce, bamboo shoots, bell pepper, eggplant, and basil",
    price: 14.95,
    category: "Curry",
  }),

  makeItem({
    id: "yellow_curry",
    name: "Yellow Curry",
    description: "Yellow curry sauce, onion, carrot",
    price: 14.95,
    category: "Curry",
  }),

  makeItem({
    id: "massamun_curry",
    name: "Massamun Curry",
    description: "Massamun curry sauce, onion, carrot and peanut",
    price: 14.95,
    category: "Curry",
  }),

  makeItem({
    id: "panang_curry",
    name: "Panang Curry",
    description: "Panang curry sauce, bell pepper, green bean, and kaffir lime leaf",
    price: 14.95,
    category: "Curry",
  }),

  makeItem({
    id: "pumpkin_curry",
    name: "Pumpkin Curry",
    description: "Red curry sauce, onion, bell pepper, basil and pumpkin",
    price: 14.95,
    category: "Curry",
  }),

  makeItem({
    id: "cilantro_pork",
    name: "Cilantro Pork",
    description: "Boneless pork marinated with exotic Thai herb and cilantro served with mango salad",
    price: 19.95,
    category: "Grill",
  }),

  makeItem({
    id: "herbal_chicken",
    name: "Herbal Chicken",
    description: "Boneless chicken marinated with exotic Thai herb served with papaya salad",
    price: 19.95,
    category: "Grill",
  }),

  makeItem({
    id: "panang_salmon",
    name: "Panang Salmon",
    description: "Grilled salmon fillet with panang curry sauce, coconut milk, red bell pepper and kaffir leaf",
    price: 21.95,
    category: "Seafood",
  }),

  makeItem({
    id: "lemongrass_wings",
    name: "Lemongrass Wings (10 pcs)",
    description: "Golden fried flat wings topped with crispy lemongrass and kaffir lime leaves",
    price: 18.0,
    category: "House Specials",
  }),

  makeItem({
    id: "fruit_medley_salad",
    name: "Fruit Medley Salad",
    description: "Seasonal fruit with carrot, onion, cashew nut, mint and lime dressing",
    price: 16.0,
    category: "House Specials",
  }),

  makeItem({
    id: "coconut_cream_salmon",
    name: "Coconut Cream Salmon",
    description: "Sous-vide salmon with mushrooms, tomatoes and spinach in tom kha cream sauce",
    price: 24.0,
    category: "House Specials",
    imageUrl: "/images/menu/coconut_cream_salmon.jpg",
  }),

  makeItem({
    id: "grilled_ribeye_thai_salad",
    name: "Grilled Ribeye Thai Salad",
    description: "Grilled ribeye with grape, red onion, toasted rice powder and fresh mint",
    price: 27.0,
    category: "House Specials",
  }),

  makeItem({
    id: "gai_yang_isan",
    name: "Gai Yang Isan",
    description: "Baked Cornish hen served with green papaya and grape salad",
    price: 32.0,
    category: "House Specials",
  }),

  makeItem({
    id: "beef_stew_mussamun",
    name: "Beef Stew Mussamun Curry",
    description: "Tender beef in mussamun curry with onion, potato and peanut",
    price: 28.0,
    category: "House Specials",
    imageUrl: "/images/menu/beef_stew_mussamun_curry.jpg",
  }),

  makeItem({
    id: "crispy_fried_pompano",
    name: "Crispy Fried Pompano",
    description: "Golden pompano fillet with fruit salad and tangy lime dressing",
    price: 28.0,
    category: "House Specials",
    imageUrl: "/images/menu/crispy_fried_pompano.jpg",
  }),

  makeItem({
    id: "khao_soi_duck_confit",
    name: "Khao Soi Duck Confit",
    description: "Duck confit leg with egg noodles in northern Thai curry",
    price: 29.0,
    category: "House Specials",
  }),

  makeItem({
    id: "kanom_jeen_crab_curry",
    name: "Kanom Jeen (Crab Curry)",
    description: "Crab meat and spinach in yellow curry with thin rice noodles",
    price: 28.0,
    category: "House Specials",
  }),

  makeItem({
    id: "thai_red_curry_roasted_duck",
    name: "Thai Red Curry Roasted Duck",
    description: "Roasted duck breast with red curry, pineapple and Thai basil",
    price: 28.0,
    category: "House Specials",
  }),

  makeItem({
    id: "duck_confit_noodle_soup",
    name: "Duck Confit Noodle Soup",
    description: "Duck confit leg with rice noodles, bok choy and cilantro",
    price: 27.0,
    category: "House Specials",
    imageUrl: "/images/menu/duck_confit_noodle_soup.jpg",
  }),

  makeItem({
    id: "lobster_pad_thai",
    name: "Lobster Pad Thai",
    description: "Sous-vide lobster with rice noodles, bean sprouts and egg",
    price: 35.0,
    category: "House Specials",
  }),

  makeItem({
    id: "lobster_khao_soi",
    name: "Lobster Khao Soi",
    description: "Sous-vide lobster with Egg noodles in Northern Thai curry style and topped with Crispy egg noodle",
    price: 38.0,
    category: "House Specials",
  }),

  makeItem({
    id: "ribeye_spicy_basil",
    name: "Ribeye Steak with Spicy Basil Sauce",
    description: "Grilled ribeye served with spicy basil sauce, green beans and potatoes",
    price: 38.0,
    category: "House Specials",
  }),

  makeItem({
    id: "white_rice",
    name: "White Rice",
    price: 3.25,
    category: "Side Order",
  }),

  makeItem({
    id: "sticky_rice",
    name: "Sticky Rice",
    price: 4.25,
    category: "Side Order",
  }),

  makeItem({
    id: "peanut_sauce",
    name: "Peanut Sauce",
    price: 4.5,
    category: "Side Order",
  }),

  makeItem({
    id: "steamed_noodle",
    name: "Steamed Noodle",
    price: 4.5,
    category: "Side Order",
  }),

  makeItem({
    id: "cucumber_salad",
    name: "Cucumber Salad",
    price: 4.5,
    category: "Side Order",
  }),

  makeItem({
    id: "brown_rice",
    name: "Brown Rice",
    price: 3.75,
    category: "Side Order",
  }),

  makeItem({
    id: "mango_sticky_rice",
    name: "Sweet Sticky Rice with Mango",
    description: "Sweet sticky rice served with fresh mango",
    price: 7.95,
    category: "Dessert",
  }),

  makeItem({
    id: "roti",
    name: "Roti",
    price: 5.95,
    category: "Dessert",
  }),

  makeItem({
    id: "thai_iced_tea",
    name: "Thai Iced Tea",
    price: 5.5,
    category: "Beverage",
  }),

  makeItem({
    id: "soda",
    name: "Soda",
    price: 2.75,
    category: "Beverage",
  }),

  makeItem({
    id: "lemonade",
    name: "Lemonade",
    price: 4.5,
    category: "Beverage",
  }),

  makeItem({
    id: "lemonade_ice_tea",
    name: "Lemonade Ice Tea",
    price: 4.5,
    category: "Beverage",
  }),
];

export const menuItems: MenuItem[] = RAW_MENU_ITEMS.map((item) => ({
  ...item,
  options: item.options && item.options.length
    ? item.options
    : getDefaultOptionsForItem(item),
}));