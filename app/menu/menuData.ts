export type MenuItem = {
  id: string;
  name: string;
  description?: string;
  price: number;      // dollars, e.g. 14.50
  category: string;   // e.g. "Noodles"
};

export const menuItems: MenuItem[] = [
  {
    id: "pad_thai",
    name: "Pad Thai",
    description: "Rice noodles, egg, tofu, peanuts",
    price: 14.5,
    category: "Noodles",
  },
  {
    id: "green_curry",
    name: "Green Curry",
    description: "Coconut milk, Thai basil",
    price: 15.0,
    category: "Curry",
  },
  {
    id: "fried_rice",
    name: "Fried Rice",
    description: "Egg, onion, tomato",
    price: 13.0,
    category: "Rice",
  },
];