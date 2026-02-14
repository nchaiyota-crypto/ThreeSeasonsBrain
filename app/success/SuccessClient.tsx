"use client";

import { useEffect } from "react";

const CART_KEY = "three_seasons_cart_v1";
const PICKUP_KEY = "three_seasons_pickup_v1";

export default function SuccessClient() {
  useEffect(() => {
    try {
      // ✅ clear cart right away
      localStorage.removeItem(CART_KEY);

      // ✅ keep pickup + last_order for a moment so Success page can display estimate time
      // then clear pickup shortly after
      setTimeout(() => {
        try {
          localStorage.removeItem(PICKUP_KEY);
        } catch {}
      }, 30_000);
    } catch {
      // ignore
    }
  }, []);

  return null;
}