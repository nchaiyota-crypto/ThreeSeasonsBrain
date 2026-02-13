export const CART_KEYS = [
  "three_seasons_cart_v1",
];

export const ORDER_KEYS = [
  "three_seasons_last_order_v1",
  "last_order",
];

export const PAID_KEYS = [
  "last_paid_order",
];

export function clearCartStorage() {
  CART_KEYS.forEach((k) => localStorage.removeItem(k));
}

export function clearOrderStorage() {
  ORDER_KEYS.forEach((k) => localStorage.removeItem(k));
}

export function clearAllCheckoutStorage() {
  clearCartStorage();
  clearOrderStorage();
  // IMPORTANT: do NOT clear last_paid_order here
}

export function readLastOrderRaw() {
  return (
    localStorage.getItem("three_seasons_last_order_v1") ||
    localStorage.getItem("last_order") ||
    null
  );
}

export function writeLastPaidOrder(order: any) {
  localStorage.setItem("last_paid_order", JSON.stringify(order));
}

export function writeLastOrder(order: any) {
  const s = JSON.stringify(order);
  // keep both keys temporarily for compatibility
  localStorage.setItem("three_seasons_last_order_v1", s);
  localStorage.setItem("last_order", s);
}