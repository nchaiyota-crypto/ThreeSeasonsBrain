create table public.orders (
  id uuid not null default gen_random_uuid (),
  order_number bigint not null default nextval('order_number_seq'::regclass),
  source text not null default 'ipad'::text,
  order_type text not null,
  table_number integer null,
  guest_count integer null,
  customer_name text null,
  status text not null default 'draft'::text,
  tax_bps integer not null default 1075,
  subtotal_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null default 0,
  payment_status text not null default 'unpaid'::text,
  payment_amount_cents integer null,
  payment_idempotency_key text null,
  payment_ref text null,
  paid_at timestamp with time zone null,
  notes text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  voided_at timestamp with time zone null,
  void_reason text null,
  voided_by text null,
  voided_by_source text null,
  refunded_at timestamp with time zone null,
  refund_reason text null,
  refund_amount_cents integer null,
  refunded_by_source text null,
  refunded_by text null,
  subtotal numeric null,
  tax numeric null,
  total numeric null,
  deleted_at timestamp with time zone null,
  stripe_payment_intent_id text null,
  stripe_checkout_session_id text null,
  stripe_session_id text null,
  items_json jsonb null,
  constraint orders_pkey primary key (id),
  constraint orders_payment_idempotency_key_key unique (payment_idempotency_key),
  constraint orders_order_number_key unique (order_number),
  constraint orders_ready_requires_paid_check check (
    (
      (status <> 'ready'::text)
      or (payment_status = 'paid'::text)
    )
  ),
  constraint orders_source_check check (
    (
      source = any (
        array[
          'ipad'::text,
          'ai'::text,
          'online'::text,
          'staff'::text
        ]
      )
    )
  ),
  constraint orders_status_check check (
    (
      status = any (
        array[
          'draft'::text,
          'sent'::text,
          'paid'::text,
          'cancelled'::text,
          'voided'::text
        ]
      )
    )
  ),
  constraint orders_tax_bps_range_check check (
    (
      (tax_bps >= 0)
      and (tax_bps <= 3000)
    )
  ),
  constraint orders_guest_count_check check (
    (
      (guest_count is null)
      or (guest_count > 0)
    )
  ),
  constraint orders_total_math_check check ((total_cents = (subtotal_cents + tax_cents))),
  constraint orders_order_type_check check (
    (
      order_type = any (
        array['dine_in'::text, 'takeout'::text, 'phone'::text]
      )
    )
  ),
  constraint orders_payment_status_check check (
    (
      payment_status = any (
        array[
          'unpaid'::text,
          'pending'::text,
          'paid'::text,
          'failed'::text,
          'refunded'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_orders_created_at on public.orders using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_orders_status on public.orders using btree (status) TABLESPACE pg_default;

create index IF not exists idx_orders_voided_at on public.orders using btree (voided_at) TABLESPACE pg_default;

create index IF not exists orders_created_at_idx on public.orders using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists orders_status_idx on public.orders using btree (status) TABLESPACE pg_default;

create index IF not exists idx_orders_id on public.orders using btree (id) TABLESPACE pg_default;

create index IF not exists idx_orders_lock_state on public.orders using btree (payment_status, voided_at, refunded_at) TABLESPACE pg_default;

create trigger trg_enforce_order_lock BEFORE
update on orders for EACH row
execute FUNCTION enforce_order_lock ();