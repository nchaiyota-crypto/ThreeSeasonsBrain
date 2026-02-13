import type { MenuOption } from "../../app/menu/menuData";

// 1) Protein choice (required) — you can adjust prices anytime
export const OPT_PROTEIN_REQUIRED: MenuOption = {
  id: "protein",
  name: "Protein",
  required: true,
  minSelect: 1,
  maxSelect: 1,
  choices: [
    { id: "fried_tofu", name: "Fried Tofu", priceDelta: 0 },
    { id: "soft_tofu", name: "Soft Tofu", priceDelta: 0 },
    { id: "egg", name: "Egg", priceDelta: 0 },
    { id: "chicken", name: "Chicken", priceDelta: 0 },
    { id: "beef", name: "Beef", priceDelta: 0 },
    { id: "pork", name: "Pork", priceDelta: 0 },
    { id: "shrimp", name: "Shrimp", priceDelta: 0 },
    { id: "squid", name: "Squid", priceDelta: 0 },
    { id: "scallop", name: "Scallop", priceDelta: 0 },
    { id: "combo_seafood", name: "Combination Seafood", priceDelta: 0 },
    { id: "roasted_duck", name: "Roasted Duck", priceDelta: 0 },
  ],
};

// 2) Vegetable add-on choice ($2 each)
export const OPT_VEGETABLE_ADDON: MenuOption = {
  id: "veg_addon",
  name: "Vegetable Add-On Choice",
  required: false,
  minSelect: 0,
  maxSelect: 20,
  choices: [
    { id: "broccoli", name: "Broccoli", priceDelta: 200 },
    { id: "baby_corn", name: "Baby Corn", priceDelta: 200 },
    { id: "bok_choy", name: "Bok Choy", priceDelta: 200 },
    { id: "bamboo_shoots", name: "Bamboo Shoots", priceDelta: 200 },
    { id: "basil", name: "Basil", priceDelta: 200 },
    { id: "bean_sprout", name: "Bean Sprout", priceDelta: 200 },
    { id: "bell_pepper", name: "Bell Pepper", priceDelta: 200 },
    { id: "cashew_nut", name: "Cashew Nut", priceDelta: 200 },
    { id: "cucumber", name: "Cucumber", priceDelta: 200 },
    { id: "cilantro", name: "Cilantro", priceDelta: 200 },
    { id: "carrot", name: "Carrot", priceDelta: 200 },
    { id: "eggplant", name: "Eggplant", priceDelta: 200 },
    { id: "garlic", name: "Garlic", priceDelta: 200 },
    { id: "ginger", name: "Ginger", priceDelta: 200 },
    { id: "green_bean", name: "Green Bean", priceDelta: 200 },
    { id: "green_onion", name: "Green Onion", priceDelta: 200 },
    { id: "mushroom", name: "Mushroom", priceDelta: 200 },
    { id: "yellow_onion", name: "Yellow Onion", priceDelta: 200 },
    { id: "peanut", name: "Peanut", priceDelta: 200 },
    { id: "pineapple", name: "Pineapple", priceDelta: 200 },
    { id: "potatoes", name: "Potatoes", priceDelta: 200 },
    { id: "spinach", name: "Spinach", priceDelta: 200 },
    { id: "tomatoes", name: "Tomatoes", priceDelta: 200 },
    { id: "pumpkin", name: "Pumpkin", priceDelta: 200 },
  ],
};

// 3) Protein add-on choice (matches your screenshot prices)
export const OPT_PROTEIN_ADDON: MenuOption = {
  id: "protein_addon",
  name: "Protein Add-On Choice",
  required: false,
  minSelect: 0,
  maxSelect: 5,
  choices: [
    { id: "fried_tofu", name: "Fried Tofu", priceDelta: 200 },
    { id: "soft_tofu", name: "Soft Tofu", priceDelta: 200 },
    { id: "egg", name: "Egg", priceDelta: 200 },

    { id: "chicken", name: "Chicken", priceDelta: 300 },
    { id: "beef", name: "Beef", priceDelta: 300 },
    { id: "pork", name: "Pork", priceDelta: 300 },
    { id: "shrimp", name: "Shrimp", priceDelta: 300 },
    { id: "squid", name: "Squid", priceDelta: 300 },
    { id: "scallop", name: "Scallop", priceDelta: 300 },

    { id: "combo_seafood", name: "Combination Seafood", priceDelta: 600 },
    { id: "roasted_duck", name: "Roasted Duck", priceDelta: 600 },
  ],
};

// Soup protein required (Tom Yum + Tom Kha)
// We define it locally so we don't need to edit optionTemplates.
const OPT_SOUP_PROTEIN_REQUIRED = {
  ...OPT_PROTEIN_REQUIRED,
  id: "protein_required_soup",
  name: "Protein Choice",
  required: true,
  minSelect: 1,
  maxSelect: 1,
  choices: [
    { id: "vegetable", name: "Vegetable", priceDelta: 0 },
    { id: "soft_tofu", name: "Soft Tofu", priceDelta: 0 },
    { id: "chicken", name: "Chicken", priceDelta: 200 },
    { id: "prawns", name: "Prawns", priceDelta: 400 },
    { id: "seafood", name: "Seafood", priceDelta: 600 },
  ],
} satisfies MenuOption;