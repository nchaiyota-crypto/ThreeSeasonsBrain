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
    { id: "vegetable", name: "Vegetable", priceDelta: 0 },
    { id: "chicken", name: "Chicken", priceDelta: 2 },
    { id: "beef", name: "Beef", priceDelta: 2 },
    { id: "pork", name: "Pork", priceDelta: 2 },
    { id: "shrimp", name: "Shrimp", priceDelta: 4 },
    { id: "squid", name: "Squid", priceDelta: 4 },
    { id: "scallop", name: "Scallop", priceDelta: 4 },
    { id: "combo_seafood", name: "Combination Seafood", priceDelta: 6 },
    { id: "roasted_duck", name: "Roasted Duck", priceDelta: 6 },
  ],
};

// 2) Vegetable add-on choice ($2 each)
export const OPT_VEGETABLE_ADDON: MenuOption = {
  id: "veg_addon",
  name: "Vegetable Add-On Choice",
  required: false,
  minSelect: 0,
  maxSelect: 5,
  choices: [
    { id: "broccoli", name: "Broccoli", priceDelta: 2 },
    { id: "baby_corn", name: "Baby Corn", priceDelta: 2 },
    { id: "bok_choy", name: "Bok Choy", priceDelta: 2 },
    { id: "bamboo_shoots", name: "Bamboo Shoots", priceDelta: 2 },
    { id: "basil", name: "Basil", priceDelta: 2 },
    { id: "bean_sprout", name: "Bean Sprout", priceDelta: 2 },
    { id: "bell_pepper", name: "Bell Pepper", priceDelta: 2 },
    { id: "cashew_nut", name: "Cashew Nut", priceDelta: 2 },
    { id: "cucumber", name: "Cucumber", priceDelta: 2 },
    { id: "cilantro", name: "Cilantro", priceDelta: 2 },
    { id: "carrot", name: "Carrot", priceDelta: 2 },
    { id: "eggplant", name: "Eggplant", priceDelta: 2 },
    { id: "garlic", name: "Garlic", priceDelta: 2 },
    { id: "ginger", name: "Ginger", priceDelta: 2 },
    { id: "green_bean", name: "Green Bean", priceDelta: 2 },
    { id: "green_onion", name: "Green Onion", priceDelta: 2 },
    { id: "mushroom", name: "Mushroom", priceDelta: 2 },
    { id: "yellow_onion", name: "Yellow Onion", priceDelta: 2 },
    { id: "peanut", name: "Peanut", priceDelta: 2 },
    { id: "pineapple", name: "Pineapple", priceDelta: 2 },
    { id: "potatoes", name: "Potatoes", priceDelta: 2 },
    { id: "spinach", name: "Spinach", priceDelta: 2 },
    { id: "tomatoes", name: "Tomatoes", priceDelta: 2 },
    { id: "pumpkin", name: "Pumpkin", priceDelta: 2 },
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
    { id: "fried_tofu", name: "Fried Tofu", priceDelta: 2 },
    { id: "soft_tofu", name: "Soft Tofu", priceDelta: 2 },
    { id: "egg", name: "Egg", priceDelta: 2 },
    { id: "chicken", name: "Chicken", priceDelta: 3 },
    { id: "beef", name: "Beef", priceDelta: 3 },
    { id: "pork", name: "Pork", priceDelta: 3 },
    { id: "shrimp", name: "Shrimp", priceDelta: 3 },
    { id: "squid", name: "Squid", priceDelta: 3 },
    { id: "scallop", name: "Scallop", priceDelta: 3 },

    { id: "combo_seafood", name: "Combination Seafood", priceDelta: 6 },
    { id: "roasted_duck", name: "Roasted Duck", priceDelta: 6 },
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
    { id: "chicken", name: "Chicken", priceDelta: 2 },
    { id: "prawns", name: "Prawns", priceDelta: 4 },
    { id: "seafood", name: "Seafood", priceDelta: 6 },
  ],
} satisfies MenuOption;