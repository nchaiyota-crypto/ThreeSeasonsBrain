# VAPI AI Phone Setup — 3 Seasons Thai Bistro

## 1. Environment Variables to Add

Add these to your Next.js project (Vercel → Settings → Environment Variables):

```
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
VAPI_SERVER_SECRET=pick_any_random_secret_string    # optional but recommended
```

Add these to Supabase Edge Function Secrets (supabase secrets set):

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_FROM_NUMBER=+15105551234   # your Twilio phone number
```

---

## 2. VAPI Assistant System Prompt

Paste this into your VAPI assistant's System Prompt:

```
You are the friendly AI phone ordering assistant for 3 Seasons Thai Bistro,
a Thai restaurant located at 1506 Leimert Blvd, Oakland, CA 94602.

Your job is to:
1. Help customers place takeout orders over the phone
2. Answer questions about the menu
3. Check order status for customers

IMPORTANT RULES:
- Always greet callers warmly: "Thank you for calling 3 Seasons Thai Bistro, this is your AI ordering assistant. How can I help you today?"
- Before taking any order, ALWAYS call get_wait_time first to check if the kitchen is open and available.
- If the kitchen is paused, apologize and tell the customer we are not accepting orders right now.
- When taking an order, confirm each item clearly with the customer before placing it.
- Always confirm the customer's name and phone number before placing the order.
- For payment, ask if they prefer to pay at pickup (no card needed) or pay online now (you'll text/email them a link).
- Only ask for email if they choose "pay online now".
- After confirming all items, read back the full order summary and total price before calling create_order.
- Prices include tax will be added at checkout (10.75% Oakland sales tax).
- Business hours: Tuesday–Sunday 11:30am–9pm. Closed Mondays.
- If asked anything you can't handle, politely offer to transfer to the restaurant at (510) 555-1234.
- Keep responses concise and natural-sounding for phone conversation.
- Do not read out long lists all at once — offer categories first, then details if asked.
```

---

## 3. VAPI Tool Definitions

In VAPI, go to Tools → Add Tool for each of these:

### Tool 1: get_menu
- **Type:** Function
- **Name:** `get_menu`
- **Description:** Get the restaurant menu. Call this when a customer asks what's on the menu or about specific items.
- **Server URL:** `https://your-domain.com/api/vapi/tool`
- **Parameters:**
```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "description": "Optional menu category to filter by (e.g. 'Appetizers', 'Noodles', 'Curries', 'Rice Dishes'). Leave empty to get the full menu."
    }
  }
}
```

---

### Tool 2: get_wait_time
- **Type:** Function
- **Name:** `get_wait_time`
- **Description:** Check the current kitchen wait time and whether the restaurant is accepting orders. Always call this before taking an order.
- **Server URL:** `https://your-domain.com/api/vapi/tool`
- **Parameters:**
```json
{
  "type": "object",
  "properties": {}
}
```

---

### Tool 3: create_order
- **Type:** Function
- **Name:** `create_order`
- **Description:** Place a takeout order. Call this only after confirming all items, the customer's name, phone, and payment preference with the customer.
- **Server URL:** `https://your-domain.com/api/vapi/tool`
- **Parameters:**
```json
{
  "type": "object",
  "required": ["customer_name", "payment_choice", "pickup_mode", "items"],
  "properties": {
    "customer_name": {
      "type": "string",
      "description": "Customer's first and last name"
    },
    "customer_phone": {
      "type": "string",
      "description": "Customer's phone number (e.g. +15105551234)"
    },
    "customer_email": {
      "type": "string",
      "description": "Customer's email address — required only if payment_choice is pay_now"
    },
    "payment_choice": {
      "type": "string",
      "enum": ["pay_at_pickup", "pay_now"],
      "description": "pay_at_pickup = customer pays cash/card when they arrive. pay_now = send them a Stripe payment link via text/email."
    },
    "pickup_mode": {
      "type": "string",
      "enum": ["asap", "scheduled"],
      "description": "asap = as soon as possible. scheduled = pick a specific time."
    },
    "pickup_scheduled_at": {
      "type": "string",
      "description": "ISO 8601 datetime string for scheduled pickup (e.g. '2025-03-01T19:30:00-08:00'). Required only if pickup_mode is scheduled."
    },
    "items": {
      "type": "array",
      "description": "List of items in the order",
      "items": {
        "type": "object",
        "required": ["name", "qty", "unit_price_cents"],
        "properties": {
          "name": { "type": "string", "description": "Menu item name" },
          "qty": { "type": "number", "description": "Quantity" },
          "unit_price_cents": { "type": "number", "description": "Price in cents (e.g. 1500 for $15.00)" },
          "menu_item_id": { "type": "string", "description": "Menu item ID from get_menu" },
          "modifiers": { "type": "string", "description": "Protein choice or add-ons (e.g. 'Protein: Chicken | Add-ons: Extra Spicy')" },
          "notes": { "type": "string", "description": "Special instructions for this item" }
        }
      }
    }
  }
}
```

---

### Tool 4: check_order_status
- **Type:** Function
- **Name:** `check_order_status`
- **Description:** Check the status of an existing order. Use when a customer calls to ask where their order is.
- **Server URL:** `https://your-domain.com/api/vapi/tool`
- **Parameters:**
```json
{
  "type": "object",
  "properties": {
    "phone": {
      "type": "string",
      "description": "Customer's phone number to look up their most recent order"
    },
    "order_number": {
      "type": "number",
      "description": "Order number if the customer knows it"
    }
  }
}
```

---

## 4. VAPI Phone Number Setup

1. In VAPI dashboard → Phone Numbers → Buy a Number (or import your Twilio number)
2. Assign the number to your assistant
3. Test by calling the number

---

## 5. Quick Test Conversation Flow

1. Call comes in → AI greets customer
2. Customer: "I'd like to order some pad thai"
3. AI calls `get_wait_time` (silently) → tells customer current wait
4. AI calls `get_menu` with category "Noodles" → describes noodle options with prices
5. Customer confirms: "Yes, I'll have the Pad Thai with chicken"
6. AI: "What's your name and phone number?"
7. AI: "Would you like to pay when you arrive, or shall I text you a payment link?"
8. AI confirms full order + total
9. AI calls `create_order` → customer gets SMS confirmation
10. AI: "Your order #123 is confirmed! We'll text you when it's ready. Anything else?"

---

## 6. Tip: Add VAPI Caller Phone to Order

VAPI can inject the caller's phone number into tool calls automatically.
In your VAPI assistant settings, add this to the tool's request body template:

```json
{
  "customer_phone": "{{call.customer.number}}"
}
```

This way the AI doesn't have to ask for the phone number — it's captured automatically from the incoming call.
