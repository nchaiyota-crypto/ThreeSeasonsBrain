"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { menuItems, type MenuItem, type MenuOption } from "./menuData";
import { useRouter } from "next/navigation";
import { fetchWaitStatus, type GetWaitStatusResponse } from "@/lib/waitStatus";

type CartLine = {
  key: string; // unique per option combo
  itemId: string;
  name: string;
  unitPrice: number; // dollars
  qty: number;
  category: string;
  imageUrl?: string;
  optionsSummary?: string;
  note?: string;
};

const TAX_RATE = 0.1075; // Oakland 10.75%
const SERVICE_FEE_RATE = 0.035; // must match your backend (example: 3.25 -> 0.42)
const CART_KEY = "three_seasons_cart_v1";
const CART_TTL_MS = 60 * 60 * 1000; // 1 hours
const PICKUP_KEY = "three_seasons_pickup_v1";

const SLOT_INTERVAL_MIN = 15;
const MIN_ADVANCE_MIN = 60; // schedule must be at least 1 hour ahead
const MAX_DAYS_AHEAD = 3; // today + 3 days
const DEFAULT_ESTIMATE_MIN = 35;

// ✅ Business hours (Oakland local)
type DayKey = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sun=0 ... Sat=6
type Hours = { closed?: boolean; open: string; close: string };

const BUSINESS_HOURS: Record<DayKey, Hours> = {
  0: { open: "11:00", close: "21:00" }, // Sun
  1: { closed: true, open: "00:00", close: "00:00" }, // Mon CLOSED
  2: { open: "16:00", close: "21:00" }, // Tue
  3: { open: "16:00", close: "21:00" }, // Wed
  4: { open: "16:00", close: "21:00" }, // Thu
  5: { open: "11:00", close: "21:00" }, // Fri
  6: { open: "11:00", close: "21:00" }, // Sat
};

function parseHHMM(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return { h, m };
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60 * 1000);
}

function roundUpToInterval(d: Date, minutes: number) {
  const ms = d.getTime();
  const interval = minutes * 60 * 1000;
  return new Date(Math.ceil(ms / interval) * interval);
}

function money(n: number) {
  return n.toFixed(2);
}

// true if right now is inside business hours
function isStoreOpenNow() {
  const now = new Date();
  const dayKey = now.getDay() as DayKey;
  const hours = BUSINESS_HOURS[dayKey];
  if (hours.closed) return false;

  const { h: oh, m: om } = parseHHMM(hours.open);
  const { h: ch, m: cm } = parseHHMM(hours.close);

  const openTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), oh, om, 0, 0);
  const closeTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), ch, cm, 0, 0);

  return now >= openTime && now <= closeTime;
}

function buildCategoryOrder(categories: string[]) {
  const unique = Array.from(new Set(categories));

  const preferred = [
    "House Specials",
    "Appetizer",
    "Soup",
    "Salad",
    "Entrée",
    "Curry",
    "Noodle/Fried Rice",
    "Seafood",
    "Grill",
    "Beverage",
    "Side Order",
    "Dessert",
  ];

  const ordered: string[] = [];
  for (const p of preferred) if (unique.includes(p)) ordered.push(p);
  for (const c of unique) if (!ordered.includes(c)) ordered.push(c);

  const seafoodIndex = ordered.indexOf("Seafood");
  const grillIndex = ordered.indexOf("Grill");
  if (seafoodIndex !== -1 && grillIndex !== -1 && grillIndex !== seafoodIndex + 1) {
    ordered.splice(grillIndex, 1);
    ordered.splice(seafoodIndex + 1, 0, "Grill");
  }
  return ordered;
}

/** ---------------------------
 * Option helpers (robust, no hardcoded IDs)
 * -------------------------- */
function isRequiredProteinOption(opt: MenuOption) {
  return opt.required && opt.maxSelect === 1 && opt.name.toLowerCase().includes("protein");
}
function isRequiredSingleOption(opt: MenuOption) {
  return opt.required && (opt.maxSelect ?? 1) === 1;
}

function isProteinAddonOption(opt: MenuOption) {
  const n = opt.name.toLowerCase();
  const id = opt.id.toLowerCase();
  return (
    !opt.required &&
    (n.includes("protein add") ||
      n.includes("add-on protein") ||
      id.includes("protein_addon") ||
      id.includes("protein-addon"))
  );
}

function isVegAddonOption(opt: MenuOption) {
  const n = opt.name.toLowerCase();
  const id = opt.id.toLowerCase();
  return (
    !opt.required &&
    (n.includes("vegetable") || n.includes("veggie") || id.includes("vegetable_addon") || id.includes("vegetable-addon"))
  );
}

function choiceById(opt: MenuOption, choiceId: string | null) {
  if (!choiceId) return null;
  return opt.choices.find((c) => c.id === choiceId) ?? null;
}

function sumSelectedDeltaDollars(item: MenuItem, selected: Record<string, string[]>) {
  let dollars = 0;
  for (const opt of item.options ?? []) {
    const picked = selected[opt.id] ?? [];
    for (const cid of picked) {
      const ch = opt.choices.find((c) => c.id === cid);
      if (ch) dollars += Number(ch.priceDelta ?? 0);
    }
  }
  return dollars;
}

function buildOptionsSummary(item: MenuItem, selected: Record<string, string[]>) {
  const parts: string[] = [];

  const reqProtein = (item.options ?? []).find(isRequiredProteinOption);
  if (reqProtein) {
    const cid = (selected[reqProtein.id] ?? [])[0] ?? null;
    const ch = choiceById(reqProtein, cid);
    if (ch) {
      const extra = ch.priceDelta ? ` (+$${money(ch.priceDelta)})` : "";
      parts.push(`Protein: ${ch.name}${extra}`);
    }
  }

  const proteinAdd = (item.options ?? []).find(isProteinAddonOption);
  if (proteinAdd) {
    const picked = selected[proteinAdd.id] ?? [];
    if (picked.length) {
      const label = picked
        .map((cid) => {
          const ch = choiceById(proteinAdd, cid);
          return ch ? `${ch.name} (+$${money(Number(ch.priceDelta ?? 0))})` : null;
        })
        .filter(Boolean)
        .join(", ");
      if (label) parts.push(`Add-on protein: ${label}`);
    }
  }

      // ✅ Other required singles (ex: Filling)
    for (const opt of item.options ?? []) {
      if (!isRequiredSingleOption(opt)) continue;
      if (isRequiredProteinOption(opt)) continue; // already handled above

      const cid = (selected[opt.id] ?? [])[0] ?? null;
      const ch = choiceById(opt, cid);
      if (ch) {
        const extra = ch.priceDelta ? ` (+$${money(ch.priceDelta)})` : "";
        parts.push(`${opt.name}: ${ch.name}${extra}`);
      }
    }

  const vegAdd = (item.options ?? []).find(isVegAddonOption);
  if (vegAdd) {
    const picked = selected[vegAdd.id] ?? [];
    if (picked.length) {
      const label = picked
        .map((cid) => {
          const ch = choiceById(vegAdd, cid);
          return ch ? `${ch.name} (+$${money(Number(ch.priceDelta ?? 0))})` : null;
        })
        .filter(Boolean)
        .join(", ");
      if (label) parts.push(`Veg add-on: ${label}`);
    }
  }

  return parts.join(" • ") || undefined;
}

/** ---------------------------
 * Wizard steps
 * -------------------------- */
type Step =
  | { kind: "required_single"; option: MenuOption }
  | { kind: "required_protein"; option: MenuOption }
  | { kind: "protein_addon"; option: MenuOption }
  | { kind: "veg_addon"; option: MenuOption }
  | { kind: "qty" };

function buildSteps(item: MenuItem): Step[] {
  const opts = item.options ?? [];
  const steps: Step[] = [];

  // ✅ Add ANY required single-select option first (ex: Filling)
  const requiredSingles = opts.filter(isRequiredSingleOption);

  for (const opt of requiredSingles) {
    if (isRequiredProteinOption(opt)) {
      steps.push({ kind: "required_protein", option: opt });
    } else {
      steps.push({ kind: "required_single", option: opt });
    }
  }

  const proteinAdd = opts.find(isProteinAddonOption);
  const vegAdd = opts.find(isVegAddonOption);

  if (proteinAdd) steps.push({ kind: "protein_addon", option: proteinAdd });
  if (vegAdd) steps.push({ kind: "veg_addon", option: vegAdd });

  steps.push({ kind: "qty" });
  return steps;
}

//fuction pickupSceduleAt
function localValueToISOString(localValue: string) {
  const [datePart, timePart] = localValue.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
  return dt.toISOString();
}

/** ---------------------------
 * Schedule helpers (uses BUSINESS_HOURS)
 * -------------------------- */
function buildDateOptions() {
  const days: string[] = [];
  const now = new Date();

  for (let i = 0; i <= MAX_DAYS_AHEAD; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// Build a LOCAL datetime string like "2026-02-10T16:15"
function toLocalDateTimeValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Parse "YYYY-MM-DD" safely in LOCAL time (Safari-safe)
function parseLocalDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

function maxDate(a: Date, b: Date) {
  return a.getTime() >= b.getTime() ? a : b;
}

function buildTimeSlotsForDate(dateStr: string) {
  if (!dateStr) return [];

  const base = parseLocalDate(dateStr); // ✅ Safari-safe local date
  const dayKey = base.getDay() as DayKey;
  const hours = BUSINESS_HOURS[dayKey];
  if (hours.closed) return [];

  const OPENING_BUFFER_MIN = 15;

  const { h: oh, m: om } = parseHHMM(hours.open);
  const { h: ch, m: cm } = parseHHMM(hours.close);

  const openTime = new Date(base.getFullYear(), base.getMonth(), base.getDate(), oh, om, 0, 0);
  const closeTime = new Date(base.getFullYear(), base.getMonth(), base.getDate(), ch, cm, 0, 0);

  const earliest = addMinutes(openTime, OPENING_BUFFER_MIN);

  const now = new Date();
  let start = earliest;

  // today: must also be >= now + MIN_ADVANCE
  if (isSameDay(base, now)) {
    start = maxDate(start, addMinutes(now, MIN_ADVANCE_MIN));
  }

  start = roundUpToInterval(start, SLOT_INTERVAL_MIN);
  if (start >= closeTime) return [];

  const out: string[] = [];
  for (let t = start; t < closeTime; t = addMinutes(t, SLOT_INTERVAL_MIN)) {
    if (t < earliest) continue; // ✅ never allow before open+15
    out.push(toLocalDateTimeValue(t)); // ✅ LOCAL value (no UTC)
  }
  return out;
}

function formatSlot(localValue: string) {
  // localValue like "2026-02-10T16:15"
  const [datePart, timePart] = localValue.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);

  return dt.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
// visible waiting status
function getEffectiveWaitMinutes(ws: GetWaitStatusResponse | null, fallback: number, paused: boolean) {
  if (!ws) return fallback;
  if (paused) return fallback;

  // 1) override minutes wins
  if (typeof ws.minutes === "number" && !Number.isNaN(ws.minutes)) return ws.minutes;

  // 2) otherwise use status defaults from iPad settings
  if (ws.status === "normal") return ws.normal_minutes;
  if (ws.status === "busy") return ws.busy_minutes;
  return ws.very_busy_minutes;
}

function toBool(v: unknown) {
  return v === true || v === "true" || v === 1 || v === "1";
}

/** ---------------------------
 * Money helpers (tax-safe)
 * -------------------------- */
function toCents(n: number) {
  return Math.round(n * 100);
}

function calcTaxCents(subtotalCents: number) {
  return Math.round(subtotalCents * TAX_RATE);
}

export default function MenuPage() {
  // ---------------------------
  // Left filters
  // ---------------------------
  const allCategories = useMemo(() => buildCategoryOrder(menuItems.map((i) => i.category)), []);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>(allCategories[0] ?? "House Specials");
  const router = useRouter();

  // ---------------------------
  // Modal/Wizard state
  // ---------------------------
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  // ✅ Special instructions (per item)
  const [note, setNote] = useState("");
  
  // ---------------------------
  // Pickup + Cart state
  // ---------------------------
  const [pickupMode, setPickupMode] = useState<"asap" | "schedule">("asap");
  const [pickupDate, setPickupDate] = useState<string>("");
  const [pickupTimeISO, setPickupTimeISO] = useState<string>("");
  const [timeSlots, setTimeSlots] = useState<string[]>([]);
  const [estimateMin, setEstimateMin] = useState<number>(DEFAULT_ESTIMATE_MIN);
  const [ws, setWs] = useState<GetWaitStatusResponse | null>(null);
  const pausedRaw =
    (ws as any)?.paused ??
    (ws as any)?.pause_online_ordering ??
    (ws as any)?.pauseOnlineOrdering ??
    (ws as any)?.is_paused;

  const orderingPaused = toBool(pausedRaw);
  
  useEffect(() => {
    console.log("ENV CHECK:", {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "set" : "missing",
      admin: process.env.NEXT_PUBLIC_ADMIN_TOKEN ? "set" : "missing",
    });
    console.log("RAW ADMIN TOKEN:", process.env.NEXT_PUBLIC_ADMIN_TOKEN);
  }, []);

  const [lastWaitFetchAt, setLastWaitFetchAt] = useState<string>("");
  const [waitFetchError, setWaitFetchError] = useState<string>("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const didLoadCart = useRef(false);

  const openNow = isStoreOpenNow();
  const isStoreClosedNow = !openNow;
  const scheduleSelected = pickupMode === "schedule" && !!pickupTimeISO;
  const scheduleTimeIsValid = pickupMode !== "schedule" ? true : timeSlots.includes(pickupTimeISO);

  // ✅ Checkout rules
  const canCheckout =
    cart.length > 0 &&
    !orderingPaused &&
    (pickupMode === "asap" ? !isStoreClosedNow : scheduleSelected && scheduleTimeIsValid);
  
    //Mobile friendly
  const [isMobile, setIsMobile] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // If user switches to desktop, close the bottom sheet
  useEffect(() => {
    if (!isMobile) setCartOpen(false);
  }, [isMobile]);

  // ✅ Restore cart on first load
  useEffect(() => {
    if (didLoadCart.current) return;
    didLoadCart.current = true;

    try {
      const raw = localStorage.getItem(CART_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as { savedAt?: number; cart?: CartLine[] };

      if (parsed?.savedAt && Date.now() - parsed.savedAt > CART_TTL_MS) {
        localStorage.removeItem(CART_KEY);
        return;
      }

      if (Array.isArray(parsed.cart)) setCart(parsed.cart);
    } catch {
      // ignore
    }
  }, []);

  // ✅ Save cart whenever it changes
  useEffect(() => {
    if (!didLoadCart.current) return;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ savedAt: Date.now(), cart }));
    } catch {}
  }, [cart]);

  // ✅ Load wait/paused status from iPad (Supabase Edge Function) + polling
  useEffect(() => {
    let alive = true;

      async function load() {
        try {
          const data = await fetchWaitStatus();
          if (!alive) return;

          console.log("✅ waitStatus:", data);
          console.log("✅ pausedRaw:", (data as any)?.paused, "-> orderingPaused:", toBool((data as any)?.paused));

          setWs(data);
          const paused =
            (data as any)?.paused === true ||
            (data as any)?.paused === "true" ||
            (data as any)?.paused === 1 ||
            (data as any)?.paused === "1";

          const effective = getEffectiveWaitMinutes(data, DEFAULT_ESTIMATE_MIN, paused);
          setEstimateMin(effective);

          setLastWaitFetchAt(new Date().toLocaleTimeString());
          setWaitFetchError("");
        } catch (e: any) {
          setWaitFetchError(e?.message ?? "fetchWaitStatus failed");
        }
      }

    load(); // first load
    const id = setInterval(load, 10_000); // ✅ every 10 seconds

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // ✅ If paused, keep mode stable
  useEffect(() => {
    if (orderingPaused) setPickupMode("asap");
  }, [orderingPaused]);

  // ✅ Default pickup date
  useEffect(() => {
    const dates = buildDateOptions();
    if (!pickupDate && dates.length) setPickupDate(dates[0]);
  }, [pickupDate]);

  // ✅ Time slots for selected date
  useEffect(() => {
    if (!pickupDate) return;

    const daySlots = buildTimeSlotsForDate(pickupDate);
    setTimeSlots(daySlots);

    // ✅ validate whenever pickupDate OR pickupTimeISO changes
    if (!daySlots.length) {
      if (pickupTimeISO) setPickupTimeISO("");
      return;
    }

    if (!daySlots.includes(pickupTimeISO)) {
      setPickupTimeISO(daySlots[0]);
    }
  }, [pickupDate, pickupTimeISO]);

  // ✅ Restore pickup (do NOT restore estimateMin — it comes from iPad status)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PICKUP_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        pickupMode?: "asap" | "schedule";
        pickupTimeISO?: string;
      };
      if (parsed.pickupMode) setPickupMode(parsed.pickupMode);
      if (typeof parsed.pickupTimeISO === "string") setPickupTimeISO(parsed.pickupTimeISO);
    } catch {}
  }, []);

  // ✅ Save pickup (do NOT save estimateMin)
  useEffect(() => {
    try {
      localStorage.setItem(PICKUP_KEY, JSON.stringify({ pickupMode, pickupTimeISO }));
    } catch {}
  }, [pickupMode, pickupTimeISO]);

  const filteredItems = useMemo(() => {
    const s = search.trim().toLowerCase();
    return menuItems.filter((item) => {
      const inCategory = item.category === activeCategory;
      if (!inCategory) return false;
      if (!s) return true;
      const hay = `${item.name} ${item.description ?? ""}`.toLowerCase();
      return hay.includes(s);
    });
  }, [search, activeCategory]);

  function addDirectToCart(item: MenuItem) {
    const key = `${item.id}|no-options`;
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          key,
          itemId: item.id,
          name: item.name,
          unitPrice: item.price,
          qty: 1,
          category: item.category,
          imageUrl: item.imageUrl,
        },
      ];
    });
  }

  function openWizard(item: MenuItem) {
    console.log("OPTIONS FOR", item.id, item.options);

    const hasOptions = (item.options?.length ?? 0) > 0;
    if (!hasOptions) {
      addDirectToCart(item);
      return;
    }
    console.log("STEPS FOR", item.id, buildSteps(item));

    const s = buildSteps(item);
    setActiveItem(item);
    setSteps(s);
    setStepIndex(0);
    setQty(1);
    setSelected({});
    setNote(""); // ✅ reset special instructions
    setCartOpen(false);
    setIsModalOpen(true);
  }

  function closeWizard() {
    setIsModalOpen(false);
    setActiveItem(null);
    setSteps([]);
    setStepIndex(0);
    setQty(1);
    setSelected({});
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function changeLineQty(key: string, delta: number) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx === -1) return prev;

      const copy = [...prev];
      const nextQty = copy[idx].qty + delta;

      if (nextQty <= 0) {
        copy.splice(idx, 1);
        return copy;
      }

      copy[idx] = { ...copy[idx], qty: nextQty };
      return copy;
    });
  }

  const subtotalCents = useMemo(
    () => cart.reduce((sum, l) => sum + toCents(l.unitPrice) * l.qty, 0),
    [cart]
  );

  const taxCents = useMemo(() => calcTaxCents(subtotalCents), [subtotalCents]);

  const serviceFeeCents = useMemo(
    () => Math.round(subtotalCents * SERVICE_FEE_RATE),
    [subtotalCents]
  );

  // ✅ total BEFORE tip = subtotal + tax + service fee
  const totalCents = subtotalCents + taxCents + serviceFeeCents;

  const subtotal = subtotalCents / 100;
  const tax = taxCents / 100;
  const serviceFee = serviceFeeCents / 100;
  const total = totalCents / 100;

  const modalUnitPrice = useMemo(() => {
    if (!activeItem) return 0;
    const delta = sumSelectedDeltaDollars(activeItem, selected);
    return activeItem.price + delta;
  }, [activeItem, selected]);

  function prevStep() {
    setStepIndex((i) => Math.max(0, i - 1));
  }
  function canGoNext() {
    if (!activeItem) return false;
    const step = steps[stepIndex];
    if (!step) return false;

    if (step.kind === "required_protein" || step.kind === "required_single") {
      const picked = selected[step.option.id] ?? [];
      return picked.length === 1;
    }
    return true;
  }

  function nextStep() {
    if (!canGoNext()) {
      const step = steps[stepIndex];
      const label =
        step && (step.kind === "required_protein" || step.kind === "required_single")
          ? step.option.name
          : "an option";
      alert(`Please select ${label}.`);
      return;
    }
    setStepIndex((i) => Math.min(steps.length - 1, i + 1));
  }

  function toggleMulti(optionId: string, choiceId: string) {
    setSelected((prev) => {
      const current = prev[optionId] ?? [];
      const has = current.includes(choiceId);
      const next = has ? current.filter((x) => x !== choiceId) : [...current, choiceId];
      return { ...prev, [optionId]: next };
    });
  }

  function setSingle(optionId: string, choiceId: string) {
    setSelected((prev) => ({ ...prev, [optionId]: [choiceId] }));
  }

  function confirmAddToCart() {
    if (!activeItem) return;

    for (const opt of activeItem.options ?? []) {
      if (isRequiredSingleOption(opt)) {
        const picked = selected[opt.id] ?? [];
        if (picked.length !== 1) {
          alert(`Please select ${opt.name}.`);
          return;
        }
      }
    }

    const delta = sumSelectedDeltaDollars(activeItem, selected);
    const unitPrice = activeItem.price + delta;
    const optionsSummary = buildOptionsSummary(activeItem, selected);
    const noteText = note.trim() || undefined;

    const optKey = (activeItem.options ?? [])
      .map((opt) => {
        const picked = (selected[opt.id] ?? []).slice().sort().join(",");
        return `${opt.id}=${picked}`;
      })
      .sort()
      .join("|");

    const noteKey = (note || "").trim();
    const key = `${activeItem.id}|${optKey || "no-options"}|note=${encodeURIComponent(noteKey)}`;

    setCart((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + qty };
        return copy;
      }
      return [
        ...prev,
        {
          key,
          itemId: activeItem.id,
          name: activeItem.name,
          unitPrice,
          qty,
          category: activeItem.category,
          imageUrl: activeItem.imageUrl,
          optionsSummary,
          note: noteText,
        },
      ];
    });

    closeWizard();
  }

  const LAST_ORDER_KEY = "last_order";

  function saveLastOrder() {
    const orderNumber = "TS-" + Date.now().toString().slice(-6);

    const pickupScheduledAt =
      pickupMode === "schedule" && pickupTimeISO
        ? localValueToISOString(pickupTimeISO)
        : null;

    const payload = {
      orderNumber,
      items: cart,

      subtotal,
      tax,
      serviceFee,
      total,

      pickupMode,

      // ✅ THIS is what backend needs
      pickupScheduledAt,

      // optional (keep if you want)
      pickupDate,
      pickupTimeISO,

      // backend reads waitMinutes or etaMinutes
      waitMinutes: estimateMin,

      createdAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(payload));
      console.log("✅ Saved last_order:", payload);
    } catch (e) {
      console.error("❌ Failed to save last_order", e);
    }
  }

  const totalQtyInCart = useMemo(() => cart.reduce((sum, l) => sum + l.qty, 0), [cart]);

  return (
  <div style={{ minHeight: "100dvh", background: "#f6f6f6" }}>
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: 18,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900 }}>3 Seasons Thai Bistro</div>
          <div style={{ opacity: 0.7, marginTop: 4 }}>Menu (MVP) — step-by-step options wizard</div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (cart.length > 0) {
              const ok = confirm("Go back to Home? Your cart will stay saved.");
              if (!ok) return;
            }
            router.push("/");
          }}
          style={{
            height: 40,
            padding: "0 14px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--foreground)",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          ← Home
        </button>
      </div>

      {/* 3-column layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "260px 1fr 280px",
          gap: 14,
          alignItems: "start",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* LEFT (desktop only) */}
        {!isMobile && (
          <div
            style={{
              borderRadius: 16,
              background: "var(--card)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
              padding: 14,
              paddingBottom: 90,
              height: "100%",
              overflowY: "auto",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Search</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search menu"
              style={{
                width: "100%",
                height: 40,
                borderRadius: 12,
                border: "1px solid #e1e1e1",
                padding: "0 12px",
                outline: "none",
              }}
            />

            <div style={{ fontWeight: 900, marginTop: 14, marginBottom: 8 }}>Categories</div>
            <div style={{ display: "grid", gap: 8 }}>
              {allCategories.map((cat) => {
                const isActive = cat === activeCategory;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    style={{
                      textAlign: "left",
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #e1e1e1",
                      background: isActive
                        ? "var(--btn)"
                        : "var(--card)",

                      color: isActive
                        ? "var(--btnText)"
                        : "var(--foreground)",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* CENTER */}
        <div
          style={{
            borderRadius: 16,
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--foreground)",
            padding: 14,
            paddingBottom: 90,
            height: "100%",
            overflowY: "auto",
          }}
        >
          {isMobile ? (
            <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search menu"
                style={{
                  width: "100%",
                  height: 42,
                  borderRadius: 12,
                  border: "1px solid #e1e1e1",
                  padding: "0 12px",
                  outline: "none",
                }}
              />

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setCatOpen(true)}
                  style={{
                    height: 40,
                    padding: "0 14px",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    color: "var(--foreground)",
                    fontWeight: 900,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Categories
                </button>

                <div
                  style={{
                    fontWeight: 900,
                    fontSize: 18,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {activeCategory}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>{activeCategory}</div>
          )}

          {/* ✅ PUT YOUR MENU LIST HERE */}
          <div style={{ display: "grid", gap: 12 }}>
            {filteredItems.map((item) => (
              <div
                key={item.id}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 16,
                  padding: 12,
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    style={{ width: 72, height: 72, borderRadius: 14, objectFit: "cover", background: "#f2f2f2" }}
                  />
                ) : (
                  <div style={{ width: 72, height: 72, borderRadius: 14, background: "#f2f2f2" }} />
                )}

                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 900 }}>{item.name}</div>
                  {item.description ? (
                    <div style={{ marginTop: 4, fontSize: 13, opacity: 0.75 }}>{item.description}</div>
                  ) : null}
                  <div style={{ marginTop: 6, fontWeight: 900 }}>${money(item.price)}</div>
                </div>

                <button
                  type="button"
                  onClick={() => openWizard(item)}
                  style={{
                    height: 42,
                    padding: "0 14px",
                    borderRadius: 12,
                    border: "none",
                    background: "var(--btn)",
                    color: "var(--btnText)",
                    fontWeight: 900,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT (desktop only) */}
        {!isMobile && (
          <div
            style={{
              borderRadius: 16,
              background: "var(--card)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            {/* Scrollable body */}
            <div
              style={{
                padding: 14,
                overflowY: "auto",
                minHeight: 0,
                flex: 1,
              }}
            >
              {/* Cart header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 900, fontSize: 18 }}>Cart</div>
                <div
                  style={{
                    minWidth: 26,
                    height: 26,
                    borderRadius: 999,
                    background: "var(--btn)",
                    color: "var(--btnText)",
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 900,
                    fontSize: 12,
                    padding: "0 8px",
                  }}
                >
                  {totalQtyInCart}
                </div>
              </div>

              {/* CART CONTENT */}
              {cart.length === 0 ? (
                <div style={{ marginTop: 10, opacity: 0.7 }}>Your cart is empty.</div>
              ) : (
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {cart.map((line) => (
                    <div
                      key={line.key}
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 14,
                      padding: 10,
                      color: "var(--foreground)",
                    }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontWeight: 900 }}>{line.name}</div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontWeight: 900,
                            opacity: 0.6,
                          }}
                          aria-label="Remove"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>

                      {line.optionsSummary ? (
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>{line.optionsSummary}</div>
                      ) : null}
                      {line.note ? (
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                          <b>Note:</b> {line.note}
                        </div>
                      ) : null}

                      <div
                        style={{
                          marginTop: 10,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => changeLineQty(line.key, -1)}
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: "var(--card)",
                              color: "var(--foreground)",
                              cursor: "pointer",
                              fontWeight: 900,
                            }}
                          >
                            –
                          </button>

                          <div style={{ minWidth: 18, textAlign: "center", fontWeight: 900 }}>{line.qty}</div>

                          <button
                            type="button"
                            onClick={() => changeLineQty(line.key, +1)}
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: "var(--card)",
                              color: "var(--foreground)",
                              cursor: "pointer",
                              fontWeight: 900,
                            }}
                          >
                            +
                          </button>
                        </div>

                        <div style={{ fontWeight: 900 }}>${money(line.unitPrice * line.qty)}</div>
                      </div>
                    </div>
                  ))}

                  {/* TOTALS */}
                  <div style={{ borderTop: "1px solid #eee", paddingTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ opacity: 0.75 }}>Subtotal</div>
                      <div style={{ fontWeight: 900 }}>${money(subtotal)}</div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ opacity: 0.75 }}>Tax</div>
                      <div style={{ fontWeight: 900 }}>${money(tax)}</div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ opacity: 0.75 }}>Online Service Fee</div>
                      <div style={{ fontWeight: 900 }}>${money(serviceFee)}</div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                      <div style={{ fontWeight: 900 }}>Total</div>
                      <div style={{ fontWeight: 900 }}>${money(total)}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* PICKUP UI */}
              <div style={{ borderTop: "1px solid #eee", paddingTop: 12, marginTop: 12 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Pickup</div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    disabled={isStoreClosedNow || orderingPaused}
                    onClick={() => setPickupMode("asap")}
                    style={{
                      flex: 1,
                      height: 40,
                      borderRadius: 12,
                      border: "1px solid #e1e1e1",
                      background:
                        pickupMode === "schedule"
                          ? "var(--btn)"
                          : "var(--card)",

                      color:
                        pickupMode === "schedule"
                          ? "var(--btnText)"
                          : "var(--foreground)",
                      fontWeight: 900,
                      cursor: "pointer",
                      opacity: isStoreClosedNow || orderingPaused ? 0.5 : 1,
                    }}
                  >
                    ASAP
                  </button>

                  <button
                    type="button"
                    disabled={orderingPaused}
                    onClick={() => {
                      setPickupMode("schedule");
                      if (!pickupTimeISO && timeSlots.length) setPickupTimeISO(timeSlots[0]);
                    }}
                    style={{
                      flex: 1,
                      height: 40,
                      borderRadius: 12,
                      border: "1px solid #e1e1e1",
                      background:
                        pickupMode === "schedule"
                          ? "var(--btn)"
                          : "var(--card)",

                      color:
                        pickupMode === "schedule"
                          ? "var(--btnText)"
                          : "var(--foreground)",
                      fontWeight: 900,
                      cursor: "pointer",
                      opacity: orderingPaused ? 0.5 : 1,
                    }}
                  >
                    Schedule
                  </button>
                </div>

                {orderingPaused ? (
                  <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
                    {ws?.pause_message ||
                      "Online ordering is temporarily paused because of high volume. Please try again later."}
                  </div>
                ) : pickupMode === "asap" ? (
                  <div style={{ marginTop: 8, marginBottom: 14, fontSize: 13, opacity: 0.8 }}>
                    {ws?.status === "busy" || ws?.status === "very_busy"
                      ? `We are currently busier than usual. Your order will be ready in ~${estimateMin} minutes.`
                      : `Your order will be ready in ~${estimateMin} minutes.`}
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>Select pickup day</div>

                    <input
                      type="date"
                      value={pickupDate}
                      min={buildDateOptions()[0] ?? undefined}
                      max={buildDateOptions()[buildDateOptions().length - 1] ?? undefined}
                      onChange={(e) => setPickupDate(e.target.value)}
                      style={{
                        width: "100%",
                        height: 42,
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        color: "var(--foreground)",
                        padding: "0 10px",
                        outline: "none",
                        fontWeight: 700,
                        
                      }}
                    />

                    <div style={{ marginTop: 10, fontWeight: 900, marginBottom: 6 }}>Select pickup time</div>

                    <select
                      value={pickupTimeISO}
                      onChange={(e) => setPickupTimeISO(e.target.value)}
                      style={{
                        width: "100%",
                        height: 42,
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        color: "var(--foreground)",
                        padding: "0 10px",
                        outline: "none",
                        fontWeight: 700,
                        
                      }}
                    >
                      {timeSlots.length === 0 ? (
                        <option value="">No times available</option>
                      ) : (
                        timeSlots.map((iso) => (
                          <option key={iso} value={iso}>
                            {formatSlot(iso)}
                          </option>
                        ))
                      )}
                    </select>

                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.65 }}>
                      Must be at least 1 hour ahead • Up to 3 days • Only business hours
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={!canCheckout}
                onClick={async () => {
                  saveLastOrder();

                  const raw = localStorage.getItem("last_order");
                  if (!raw) {
                    alert("Missing last_order");
                    return;
                  }
                  const payload = JSON.parse(raw);

                  console.log("🚀 create-order payload:", payload);
                  const res = await fetch("/api/create-order", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  });

                  let data: any = null;
                  let text = "";
                  try {
                    text = await res.text();
                    data = text ? JSON.parse(text) : null;
                  } catch {
                    data = { raw: text };
                  }

                  if (!res.ok) {
                    console.error("create-order failed:", { status: res.status, data });
                    alert(`Create order failed (${res.status}): ${data?.error ?? data?.raw ?? "Unknown"}`);
                    return;
                  }

                  payload.orderId = data.orderId;
                  localStorage.setItem("last_order", JSON.stringify(payload));

                  router.push("/checkout");
                }}
                style={{
                  width: "100%",
                  height: 48,
                  borderRadius: 14,
                  border: "none",
                  background: "var(--btn)",
                  color: "var(--btnText)",
                  fontWeight: 900,
                  cursor: canCheckout ? "pointer" : "not-allowed",
                  opacity: canCheckout ? 1 : 0.5,
                  marginTop: 12,
                }}
              >
                Checkout • ${money(total)}
              </button>
            </div>

            {/* Sticky footer */}
            <div style={{ padding: 14, borderTop: "1px solid var(--border)", background: "var(--background)"}}>
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.65 }}>
                {orderingPaused && "Online ordering is temporarily paused."}
                {pickupMode === "asap" && isStoreClosedNow && "Store is closed right now."}
                {pickupMode === "schedule" && !pickupTimeISO && "Please select a pickup time."}
                {pickupMode === "schedule" && pickupTimeISO && "Scheduled pickup ready."}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ✅ MOBILE CATEGORIES SHEET (OUTSIDE cartOpen) */}
      {isMobile && catOpen && (
        <div
          onClick={() => setCatOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 9500,
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 520,
              background: "var(--card)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              maxHeight: "70dvh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: 12, borderBottom: "1px solid #eee" }}>
              <div style={{ width: 44, height: 5, borderRadius: 999, background: "#ddd", margin: "0 auto 10px" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 900, fontSize: 18 }}>Categories</div>
                <button
                  type="button"
                  onClick={() => setCatOpen(false)}
                  style={{ border: "none", background: "transparent", fontWeight: 900, cursor: "pointer", opacity: 0.7 }}
                >
                  ✕
                </button>
              </div>
            </div>

            <div style={{ padding: 12, overflowY: "auto" }}>
              <div style={{ display: "grid", gap: 8 }}>
                {allCategories.map((cat) => {
                  const isActive = cat === activeCategory;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        setActiveCategory(cat);
                        setCatOpen(false);
                      }}
                      style={{
                        textAlign: "left",
                        width: "100%",
                        padding: "12px 12px",
                        borderRadius: 12,
                        border: "1px solid #e1e1e1",
                        background: isActive
                          ? "var(--btn)"
                          : "var(--card)",

                        color: isActive
                          ? "var(--btnText)"
                          : "var(--foreground)",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE CART BAR (sticky) */}
      {isMobile && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            padding: 12,
            background: "rgba(246,246,246,0.92)",
            backdropFilter: "blur(8px)",
            borderTop: "1px solid #e8e8e8",
            zIndex: 8000,
            pointerEvents: "auto",
          }}
        >
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            style={{
              width: "100%",
              height: 52,
              borderRadius: 16,
              border: "none",
              background: "var(--btn)",
              color: "var(--btnText)",
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 14px",
              cursor: "pointer",
            }}
          >
            <span>Cart ({totalQtyInCart})</span>
            <span>${money(total)}</span>
          </button>
        </div>
      )}

      {/* MOBILE CART SHEET */}
      {isMobile && cartOpen && (
        <div
          onClick={() => setCartOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 9000,
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 520,
              background: "var(--card)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              maxHeight: "85dvh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Grab handle + header */}
            <div style={{ padding: 12, borderBottom: "1px solid #eee" }}>
              <div style={{ width: 44, height: 5, borderRadius: 999, background: "#ddd", margin: "0 auto 10px" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 900, fontSize: 18 }}>Your Cart</div>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  style={{ border: "none", background: "transparent", fontWeight: 900, cursor: "pointer", opacity: 0.7 }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Scrollable cart body */}
            <div style={{ padding: 12, overflowY: "auto", flex: 1 }}>
              {cart.length === 0 ? (
                <div style={{ opacity: 0.7 }}>Your cart is empty.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {cart.map((line) => (
                    <div key={line.key} style={{  borderRadius: 14, padding: 10, borderTop: "1px solid var(--border)", background: "var(--background)"}}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontWeight: 900 }}>{line.name}</div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          style={{ border: "none", background: "transparent", cursor: "pointer", fontWeight: 900, opacity: 0.6 }}
                        >
                          ✕
                        </button>
                      </div>

                      {line.optionsSummary ? (
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>{line.optionsSummary}</div>
                      ) : null}
                      {line.note ? (
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                          <b>Note:</b> {line.note}
                        </div>
                      ) : null}

                      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => changeLineQty(line.key, -1)}
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: "var(--card)",
                              color: "var(--foreground)",
                              cursor: "pointer",
                              fontWeight: 900,
                            }}
                          >
                            –
                          </button>

                          <div style={{ minWidth: 18, textAlign: "center", fontWeight: 900 }}>{line.qty}</div>

                          <button
                            type="button"
                            onClick={() => changeLineQty(line.key, +1)}
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 10,
                              border: "1px solid var(--border)",
                              background: "var(--card)",
                              color: "var(--foreground)",
                              cursor: "pointer",
                              fontWeight: 900,
                            }}
                          >
                            +
                          </button>
                        </div>

                        <div style={{ fontWeight: 900 }}>${money(line.unitPrice * line.qty)}</div>
                      </div>
                    </div>
                  ))}

                  <div style={{ borderTop: "1px solid #eee", paddingTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ opacity: 0.75 }}>Subtotal</div>
                      <div style={{ fontWeight: 900 }}>${money(subtotal)}</div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ opacity: 0.75 }}>Tax</div>
                      <div style={{ fontWeight: 900 }}>${money(tax)}</div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ opacity: 0.75 }}>Online Service Fee</div>
                      <div style={{ fontWeight: 900 }}>${money(serviceFee)}</div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                      <div style={{ fontWeight: 900 }}>Total</div>
                      <div style={{ fontWeight: 900 }}>${money(total)}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

              {/* Sticky sheet footer */}
            <div style={{ padding: 12, borderTop: "1px solid var(--border)", background: "var(--background)"}}>
              {/* PICKUP UI (MOBILE) */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Pickup</div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    disabled={isStoreClosedNow || orderingPaused}
                    onClick={() => setPickupMode("asap")}
                    style={{
                      flex: 1,
                      height: 40,
                      borderRadius: 12,
                      border: "1px solid #e1e1e1",
                      background:
                        pickupMode === "schedule"
                          ? "var(--btn)"
                          : "var(--card)",

                      color:
                        pickupMode === "schedule"
                          ? "var(--btnText)"
                          : "var(--foreground)",
                      fontWeight: 900,
                      cursor: "pointer",
                      opacity: isStoreClosedNow || orderingPaused ? 0.5 : 1,
                    }}
                  >
                    ASAP
                  </button>

                  <button
                    type="button"
                    disabled={orderingPaused}
                    onClick={() => {
                      setPickupMode("schedule");
                      if (!pickupDate) {
                        const dates = buildDateOptions();
                        if (dates[0]) setPickupDate(dates[0]);
                      }
                      if (!pickupTimeISO && timeSlots.length) setPickupTimeISO(timeSlots[0]);
                    }}
                    style={{
                      flex: 1,
                      height: 40,
                      borderRadius: 12,
                      border: "1px solid #e1e1e1",
                      background:
                        pickupMode === "schedule"
                          ? "var(--btn)"
                          : "var(--card)",

                      color:
                        pickupMode === "schedule"
                          ? "var(--btnText)"
                          : "var(--foreground)",
                      fontWeight: 900,
                      cursor: "pointer",
                      opacity: orderingPaused ? 0.5 : 1,
                    }}
                  >
                    Schedule
                  </button>
                </div>

                {orderingPaused ? (
                  <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
                    {ws?.pause_message || "Online ordering is temporarily paused. Please try again later."}
                  </div>
                ) : pickupMode === "asap" ? (
                  <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
                    {isStoreClosedNow
                      ? "Store is closed right now. Please choose Schedule."
                      : `Your order will be ready in ~${estimateMin} minutes.`}
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>Select pickup day</div>

                    <input
                      type="date"
                      value={pickupDate}
                      min={buildDateOptions()[0] ?? undefined}
                      max={buildDateOptions()[buildDateOptions().length - 1] ?? undefined}
                      onChange={(e) => setPickupDate(e.target.value)}
                      style={{
                        width: "100%",
                        height: 42,
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        color: "var(--foreground)",
                        padding: "0 10px",
                        outline: "none",
                        fontWeight: 700,
                      }}
                    />

                    <div style={{ marginTop: 10, fontWeight: 900, marginBottom: 6 }}>Select pickup time</div>

                    <select
                      value={pickupTimeISO}
                      onChange={(e) => setPickupTimeISO(e.target.value)}
                      style={{
                        width: "100%",
                        height: 42,
                        borderRadius: 12,
                        border: "1px solid var(--border)",
                        background: "var(--card)",
                        color: "var(--foreground)",
                        padding: "0 10px",
                        outline: "none",
                        fontWeight: 700,
                      }}
                    >
                      {timeSlots.length === 0 ? (
                        <option value="">No times available</option>
                      ) : (
                        timeSlots.map((iso) => (
                          <option key={iso} value={iso}>
                            {formatSlot(iso)}
                          </option>
                        ))
                      )}
                    </select>

                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.65 }}>
                      Must be at least 1 hour ahead • Up to 3 days • Only business hours
                    </div>
                  </div>
                )}
              </div>

              {/* Checkout button */}
              <button
                type="button"
                disabled={!canCheckout}
                onClick={async () => {
                  saveLastOrder();

                  const raw = localStorage.getItem("last_order");
                  if (!raw) {
                    alert("Missing last_order");
                    return;
                  }

                  const payload = JSON.parse(raw);

                  console.log("🚀 create-order payload:", payload);
                  const res = await fetch("/api/create-order", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                  });

                  let data: any = null;
                  let text = "";
                  try {
                    text = await res.text();
                    data = text ? JSON.parse(text) : null;
                  } catch {
                    data = { raw: text };
                  }

                  if (!res.ok) {
                    console.error("create-order failed:", { status: res.status, data });
                    alert(`Create order failed (${res.status}): ${data?.error ?? data?.raw ?? "Unknown"}`);
                    return;
                  }

                  payload.orderId = data.orderId;
                  localStorage.setItem("last_order", JSON.stringify(payload));

                  setCartOpen(false);
                  router.push("/checkout");
                }}
                style={{
                  width: "100%",
                  height: 50,
                  borderRadius: 14,
                  border: "none",
                  background: "var(--btn)",
                  color: "var(--btnText)",
                  fontWeight: 900,
                  cursor: canCheckout ? "pointer" : "not-allowed",
                  opacity: canCheckout ? 1 : 0.5,
                }}
              >
                Ready to Checkout • ${money(total)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WIZARD MODAL (keep your existing modal here) */}
      {isModalOpen && activeItem && steps.length > 0 && (
        <div
          onClick={closeWizard}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(560px, 100%)",
                borderRadius: 18,
                overflow: "hidden",
                background: "var(--card)",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
              }}
            >
              {/* top image */}
              <div style={{ height: 220, background: "#f3f3f3" }}>
                {activeItem.imageUrl ? (
                  <img
                    src={activeItem.imageUrl}
                    alt={activeItem.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : null}
              </div>

              <div style={{ padding: 16 }}>
                {/* title + progress */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 18 }}>{activeItem.name}</div>
                    <div style={{ opacity: 0.75, marginTop: 4, fontSize: 13 }}>{activeItem.description}</div>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 999,
                      background: "#f1f1f1",
                      fontWeight: 900,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Step {stepIndex + 1} / {steps.length}
                  </div>
                </div>

                {/* step content */}
                <div style={{ marginTop: 16 }}>
                  {(() => {
                    const step = steps[stepIndex];

                    if (step.kind === "required_protein" || step.kind === "required_single") {
                      const opt = step.option;
                      const picked = (selected[opt.id] ?? [])[0] ?? "";
                      return (
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontWeight: 900, fontSize: 16 }}>{opt.name}</div>
                            <div style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "#eee" }}>
                              Required
                            </div>
                          </div>
                          <div
                            style={{
                              marginTop: 10,
                              display: "grid",
                              gap: 10,
                              maxHeight: 280,
                              overflowY: "auto",
                              paddingRight: 6,
                            }}
                          >
                            {opt.choices.map((c) => (
                              <label
                                key={c.id}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 10,
                                  alignItems: "center",
                                  padding: "10px 12px",
                                  border: "1px solid #eee",
                                  borderRadius: 14,
                                  cursor: "pointer",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <input
                                    type="radio"
                                    name={opt.id}
                                    checked={picked === c.id}
                                    onChange={() => setSingle(opt.id, c.id)}
                                  />
                                  <div style={{ fontWeight: 800 }}>{c.name}</div>
                                </div>
                                <div style={{ fontWeight: 900, opacity: 0.8 }}>
                                  {c.priceDelta ? `+$${money(c.priceDelta)}` : ""}
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    }

                    if (step.kind === "protein_addon" || step.kind === "veg_addon") {
                      const opt = step.option;
                      const picked = selected[opt.id] ?? [];
                      return (
                        <div>
                          <div style={{ fontWeight: 900, fontSize: 16 }}>{opt.name}</div>
                          <div style={{ marginTop: 10, display: "grid", gap: 10, maxHeight: 280, overflow: "auto" }}>
                            {opt.choices.map((c) => {
                              const checked = picked.includes(c.id);
                              return (
                                <label
                                  key={c.id}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    alignItems: "center",
                                    padding: "10px 12px",
                                    border: "1px solid #eee",
                                    borderRadius: 14,
                                    cursor: "pointer",
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <input type="checkbox" checked={checked} onChange={() => toggleMulti(opt.id, c.id)} />
                                    <div style={{ fontWeight: 800 }}>{c.name}</div>
                                  </div>
                                  <div style={{ fontWeight: 900, opacity: 0.8 }}>
                                    {c.priceDelta ? `+$${money(c.priceDelta)}` : ""}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    // qty step
                    return (
                      <div>
                        <div style={{ fontWeight: 900, fontSize: 16 }}>Quantity</div>
                        {/* ✅ Special Instructions */}
                        <div style={{ marginTop: 14 }}>
                          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 6 }}>
                            Special Instructions (Optional)
                          </div>

                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Ex: extra crispy, no sauce, allergy notes..."
                            style={{
                              width: "100%",
                              minHeight: 70,
                              borderRadius: 12,
                              border: "1px solid #e1e1e1",
                              padding: 10,
                              outline: "none",
                              resize: "vertical",
                              fontSize: 14,
                            }}
                          />
                        </div>
                        <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => setQty((q) => Math.max(1, q - 1))}
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 12,
                              border: "1px solid var(--border)",
                              background: "var(--card)",
                              color: "var(--foreground)",
                              cursor: "pointer",
                              fontWeight: 900,
                              fontSize: 18,
                            }}
                          >
                            –
                          </button>

                          <div style={{ minWidth: 30, textAlign: "center", fontWeight: 900, fontSize: 16 }}>{qty}</div>

                          <button
                            type="button"
                            onClick={() => setQty((q) => q + 1)}
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 12,
                              border: "1px solid var(--border)",
                              background: "var(--card)",
                              color: "var(--foreground)",
                              cursor: "pointer",
                              fontWeight: 900,
                              fontSize: 18,
                            }}
                          >
                            +
                          </button>

                          <div style={{ flex: 1 }} />

                          <div style={{ fontWeight: 900, fontSize: 16 }}>Item: ${money(modalUnitPrice)}</div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* footer controls */}
                <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={prevStep}
                    disabled={stepIndex === 0}
                    style={{
                      height: 44,
                      padding: "0 14px",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--btnAltBg)",
                      color: "var(--btnAltText)",
                      fontWeight: 900,
                      cursor: stepIndex === 0 ? "not-allowed" : "pointer",
                      opacity: stepIndex === 0 ? 0.4 : 1,
                    }}
                  >
                    Back
                  </button>

                  {stepIndex < steps.length - 1 ? (
                    <button
                      type="button"
                      onClick={nextStep}
                      style={{
                        flex: 1,
                        height: 44,
                        borderRadius: 12,
                        border: "none",
                        background: "var(--btn)",
                        color: "var(--btnText)",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={confirmAddToCart}
                      style={{
                        flex: 1,
                        height: 44,
                        borderRadius: 12,
                        border: "none",
                        background: "var(--btn)",
                        color: "var(--btnText)",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      Add to cart • ${money(modalUnitPrice * qty)}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={closeWizard}
                    style={{
                      height: 44,
                      padding: "0 14px",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--btnAltBg)",
                      color: "var(--btnAltText)",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                  {buildOptionsSummary(activeItem, selected) ? (
                    <>Selected: {buildOptionsSummary(activeItem, selected)}</>
                  ) : (
                    <>Selected: (none)</>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}