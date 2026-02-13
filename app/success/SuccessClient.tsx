"use client";

import { useEffect } from "react";

const CART_KEY = "three_seasons_cart_v1";
const PICKUP_KEY = "three_seasons_pickup_v1";

export default function SuccessClient() {
  useEffect(() => {
    // ✅ Clear cart + pickup selection after successful payment
    try {
      localStorage.removeItem(CART_KEY);
      localStorage.removeItem(PICKUP_KEY);
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
  localStorage.removeItem("CART_KEY");
}, []);

  return null; // no UI, just side-effect
}