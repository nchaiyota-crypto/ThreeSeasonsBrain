


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."order_status" AS ENUM (
    'new',
    'cooking',
    'done'
);


ALTER TYPE "public"."order_status" OWNER TO "postgres";


CREATE TYPE "public"."wait_status" AS ENUM (
    'normal',
    'busy',
    'very_busy'
);


ALTER TYPE "public"."wait_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_order_with_kds"("p_source" "text", "p_order_type" "text", "p_station" "text", "p_items" "jsonb", "p_tax_bps" integer DEFAULT 1075) RETURNS TABLE("order_id" "uuid", "ticket_id" "uuid")
    LANGUAGE "plpgsql"
    AS $$declare
  v_order_id uuid;
  v_ticket_id uuid;
  v_item jsonb;
  v_order_item_id uuid;
  v_name text;
  v_qty int;
  v_base int;
  v_notes text;
  v_order_number bigint;
begin
  -- 1) create order (status must match your orders_status_check)
  insert into public.orders (source, order_type, status, tax_bps)
  values (p_source, p_order_type, 'draft', p_tax_bps)
  returning id, order_number into v_order_id, v_order_number;

  -- 2) create KDS ticket (status must match kds status enum/check)
  insert into public.kds_tickets (order_id, order_number, station, status)
  values (v_order_id, v_order_number, p_station, 'new')
  returning id into v_ticket_id;

  -- 3) items loop
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_name  := coalesce(v_item->>'menu_item_name', v_item->>'name');
    v_qty   := coalesce((v_item->>'qty')::int, 1);
    v_base  := coalesce((v_item->>'base_price_cents')::int, 0);
    v_notes := v_item->>'special_instructions';

    -- create order_item first (because kds_ticket_items.order_item_id is NOT NULL)
    insert into public.order_items (
      order_id,
      menu_item_id,
      menu_item_name,
      qty,
      base_price_cents,
      line_subtotal_cents,
      special_instructions
    )
    values (
      v_order_id,
      null,
      v_name,
      v_qty,
      v_base,
      v_base * v_qty,
      v_notes
    )
    returning id into v_order_item_id;

    -- create kds_ticket_item linked to the order_item
    insert into public.kds_ticket_items (
      kds_ticket_id,
      order_item_id,
      display_name,
      qty,
      status,
      instructions_text
    )
    values (
      v_ticket_id,
      v_order_item_id,
      v_name,
      v_qty,
      'new',
      v_notes
    );
  end loop;

  return query select v_order_id, v_ticket_id;
end;$$;


ALTER FUNCTION "public"."create_order_with_kds"("p_source" "text", "p_order_type" "text", "p_station" "text", "p_items" "jsonb", "p_tax_bps" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_order_lock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- Allow privileged RPC routines to bypass lock safely
  if current_setting('app.bypass_order_lock', true) = '1' then
    return new;
  end if;

  -- If order is locked (paid/refunded/voided), block edits
  if (old.voided_at is not null)
     or (old.payment_status in ('paid', 'refunded')) then
    raise exception 'Order % is locked (paid/refunded/voided) and cannot be edited', old.id
      using errcode = '45000';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_order_lock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_paid_order_lock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- If order is refunded/voided, lock everything
  if coalesce(old.payment_status,'') in ('refunded','voided') then
    raise exception 'Order % is locked (%), and cannot be edited', old.id, old.payment_status;
  end if;

  -- If order is PAID
  if coalesce(old.payment_status,'') = 'paid' then

    -- Allowed fields after paid
    if
      new.accepted_at        is distinct from old.accepted_at
      or new.kitchen_minutes is distinct from old.kitchen_minutes
      or new.estimated_ready_at is distinct from old.estimated_ready_at
      or new.status          is distinct from old.status
      or new.customer_name   is distinct from old.customer_name
      or new.customer_phone  is distinct from old.customer_phone
      or new.sms_opt_in      is distinct from old.sms_opt_in
    then
      return new;
    else
      raise exception 'Order % is locked (paid) and cannot be edited', old.id;
    end if;

  end if;

  -- Not paid/refunded/voided
  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_paid_order_lock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_order"("p_order_id" "uuid") RETURNS TABLE("out_order_id" "uuid", "out_order_number" bigint, "out_subtotal_cents" integer, "out_tax_cents" integer, "out_total_cents" integer, "out_print_job_id" "uuid", "out_print_status" "text")
    LANGUAGE "plpgsql"
    AS $$
declare
  v_tax_bps int;
  v_ord_num bigint;
  v_subtotal int;
  v_tax int;
  v_total int;
  v_payload text;
  v_print_job_id uuid;
  v_idem_key text := 'order:' || p_order_id::text || ':original:v1';
  v_order_type text;
  v_source text;
  v_table int;
  v_guests int;
  v_name text;
  v_has_items boolean;
begin
  select o.tax_bps,
         o.order_number,
         o.order_type,
         o.source,
         o.table_number,
         o.guest_count,
         o.customer_name
    into v_tax_bps,
         v_ord_num,
         v_order_type,
         v_source,
         v_table,
         v_guests,
         v_name
  from orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  select exists(select 1 from order_items where order_id = p_order_id)
    into v_has_items;

  if not v_has_items then
    raise exception 'Order % has no items', p_order_id;
  end if;

  update order_items oi
  set line_subtotal_cents =
      (oi.base_price_cents
       + coalesce((
          select sum(oim.price_delta_cents)
          from order_item_modifiers oim
          where oim.order_item_id = oi.id
        ), 0)
      ) * oi.qty
  where oi.order_id = p_order_id;

  select coalesce(sum(line_subtotal_cents),0)::int
    into v_subtotal
  from order_items
  where order_id = p_order_id;

  v_tax := ((v_subtotal::bigint * v_tax_bps::bigint) + 5000) / 10000;
  v_total := v_subtotal + v_tax;

  update orders o
  set subtotal_cents = v_subtotal,
      tax_cents = v_tax,
      total_cents = v_total,
      status = case when o.status = 'draft' then 'sent' else o.status end,
      updated_at = now()
  where o.id = p_order_id;

  v_payload :=
    '3 SEASONS THAI BISTRO' || E'\n' ||
    'KITCHEN TICKET' || E'\n' ||
    '-------------------------------' || E'\n' ||
    'ORDER:  ' || lpad(v_ord_num::text, 6, '0') || E'\n' ||
    'SOURCE: ' || v_source || E'\n' ||
    'TYPE:   ' || upper(replace(v_order_type, '_', '-')) || E'\n' ||
    case when v_order_type = 'dine_in' then
      'TABLE:  ' || coalesce(v_table::text,'') || '        GUESTS: ' || coalesce(v_guests::text,'') || E'\n'
    else
      case when v_name is not null and length(trim(v_name)) > 0 then
        'NAME:   ' || v_name || E'\n'
      else
        ''
      end
    end ||
    'TIME:   ' || to_char(now(), 'YYYY-MM-DD HH24:MI') || E'\n' ||
    '-------------------------------' || E'\n';

  if exists(select 1 from order_allergies where order_id=p_order_id and scope='whole_order') then
    v_payload := v_payload ||
      '*** ALLERGY ALERT (WHOLE ORDER) ***' || E'\n' ||
      (select string_agg(allergy_text, ' / ')
         from order_allergies
        where order_id=p_order_id and scope='whole_order') || E'\n' ||
      '---------------------------------' || E'\n\n';
  end if;

  if exists(select 1 from order_allergies where order_id=p_order_id and scope='item_specific') then
    v_payload := v_payload ||
      '*** ALLERGY ALERT (ITEM-SPECIFIC) ***' || E'\n' ||
      (select string_agg(a.allergy_text || ' -> ' || oi.menu_item_name, E'\n')
         from order_allergies a
         join order_allergy_items ai on ai.order_allergy_id = a.id
         join order_items oi on oi.id = ai.order_item_id
        where a.order_id=p_order_id and a.scope='item_specific') || E'\n' ||
      '---------------------------------' || E'\n\n';
  end if;

  v_payload := v_payload || (
    select string_agg(item_block, E'\n\n')
    from (
      select
        (oi.qty::text || 'x ' || upper(oi.menu_item_name) || E'\n' ||
         coalesce((
           select string_agg('   - ' || upper(modifier_name), E'\n')
           from order_item_modifiers
           where order_item_id = oi.id and modifier_type='required'
         ), '') ||
         case when exists(
           select 1 from order_item_modifiers where order_item_id=oi.id and modifier_type='optional'
         ) then E'\n' else '' end ||
         coalesce((
           select string_agg('   + ' || upper(modifier_name), E'\n')
           from order_item_modifiers
           where order_item_id = oi.id and modifier_type='optional'
         ), '') ||
         case when oi.special_instructions is not null and length(trim(oi.special_instructions)) > 0
           then E'\n   ! ' || oi.special_instructions else '' end
        ) as item_block
      from order_items oi
      where oi.order_id = p_order_id
      order by oi.created_at
    ) x
  );

  insert into print_jobs (order_id, job_type, station, idempotency_key, printer_name, payload_text, status)
  values (p_order_id, 'original', 'kitchen', v_idem_key, 'kitchen_printer', v_payload, 'queued')
  on conflict (idempotency_key) do update
    set payload_text = excluded.payload_text
  returning id into v_print_job_id;

  insert into order_events(order_id, event_type, detail)
  values (p_order_id, 'sent_to_kitchen', jsonb_build_object('print_job_id', v_print_job_id, 'idempotency_key', v_idem_key));

  return query
  select p_order_id, v_ord_num, v_subtotal, v_tax, v_total, v_print_job_id,
         (select status from print_jobs where id=v_print_job_id);

end;
$$;


ALTER FUNCTION "public"."finalize_order"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_order_to_kds"("p_order_id" "uuid") RETURNS TABLE("out_order_id" "uuid", "out_kds_ticket_id" "uuid", "out_kds_status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_ticket_id uuid;
  v_status text;
begin
  -- Confirm order exists (force public schema)
  select o.status
    into v_status
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;

  -- Create KDS ticket (one per order)
  insert into public.kds_tickets (order_id, station, status)
  values (p_order_id, 'kitchen', 'new')
  on conflict (order_id) do update
    set status = public.kds_tickets.status
  returning id, status into v_ticket_id, out_kds_status;

  -- Rebuild ticket lines
  delete from public.kds_ticket_items where kds_ticket_id = v_ticket_id;

  insert into public.kds_ticket_items (
    kds_ticket_id, order_item_id, display_name, qty, modifiers_text, instructions_text, status
  )
  select
    v_ticket_id,
    oi.id,
    upper(oi.menu_item_name),
    oi.qty,
    trim(both E'\n' from
      coalesce((
        select string_agg('- ' || upper(modifier_name), E'\n')
        from public.order_item_modifiers
        where order_item_id = oi.id and modifier_type='required'
      ), '')
      ||
      case when exists(
        select 1 from public.order_item_modifiers where order_item_id=oi.id and modifier_type='optional'
      ) then E'\n' else '' end
      ||
      coalesce((
        select string_agg('+ ' || upper(modifier_name), E'\n')
        from public.order_item_modifiers
        where order_item_id = oi.id and modifier_type='optional'
      ), '')
    ) as modifiers_text,
    nullif(trim(coalesce(oi.special_instructions,'')), '') as instructions_text,
    'new'
  from public.order_items oi
  where oi.order_id = p_order_id
  order by oi.created_at;

  insert into public.order_events(order_id, event_type, detail)
  values (p_order_id, 'sent_to_kds', jsonb_build_object('kds_ticket_id', v_ticket_id, 'order_status', v_status));

  return query
  select p_order_id, v_ticket_id, out_kds_status;
end;
$$;


ALTER FUNCTION "public"."finalize_order_to_kds"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_kds_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select auth.email() = any (array[
    'narin@3seasonsthaibistro.com'
    -- add more admin emails here
  ]);
$$;


ALTER FUNCTION "public"."is_kds_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kds_accept_ticket"("p_ticket_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  update public.kds_tickets
  set status = 'in_progress',
      accepted_at = coalesce(accepted_at, now())
  where id = p_ticket_id
    and status = 'new';

  if not found then
    raise exception 'Ticket % not found or not NEW', p_ticket_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."kds_accept_ticket"("p_ticket_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kds_complete_ticket"("p_ticket_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  update public.kds_tickets
  set status = 'done',
      completed_at = coalesce(completed_at, now())
  where id = p_ticket_id
    and status = 'in_progress';

  if not found then
    raise exception 'Ticket % not found or not IN_PROGRESS', p_ticket_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."kds_complete_ticket"("p_ticket_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kds_mark_done_if_all_items_done"("p_ticket_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  if not exists (
    select 1
    from public.kds_ticket_items
    where kds_ticket_id = p_ticket_id
      and status <> 'done'
  ) then
    update public.kds_tickets
    set status = 'done',
        completed_at = coalesce(completed_at, now())
    where id = p_ticket_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."kds_mark_done_if_all_items_done"("p_ticket_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kds_start_ticket"("p_ticket_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  update public.kds_tickets
  set started_at = coalesce(started_at, now())
  where id = p_ticket_id
    and status = 'in_progress';

  if not found then
    raise exception 'Ticket % not found or not IN_PROGRESS', p_ticket_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."kds_start_ticket"("p_ticket_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kds_ticket_fill_customer"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update public.kds_tickets t
  set customer_name  = o.customer_name,
      customer_phone = o.customer_phone,
      sms_opt_in     = o.sms_opt_in
  from public.orders o
  where o.id = new.order_id
    and t.id = new.id;

  return new;
end;
$$;


ALTER FUNCTION "public"."kds_ticket_fill_customer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kds_ticket_sync_customer_from_order"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.order_id is not null then
    select o.customer_name, o.customer_phone
      into new.customer_name, new.customer_phone
    from public.orders o
    where o.id = new.order_id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."kds_ticket_sync_customer_from_order"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."orders_push_customer_to_ticket"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if (new.customer_name is distinct from old.customer_name)
     or (new.customer_phone is distinct from old.customer_phone) then
    update public.kds_tickets
      set customer_name = new.customer_name,
          customer_phone = new.customer_phone
    where order_id = new.id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."orders_push_customer_to_ticket"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refund_order"("p_order_id" "uuid", "p_refund_amount_cents" integer DEFAULT NULL::integer, "p_reason" "text" DEFAULT NULL::"text", "p_source" "text" DEFAULT NULL::"text", "p_actor" "text" DEFAULT NULL::"text") RETURNS TABLE("order_id" "uuid", "refunded_at" timestamp with time zone, "refund_amount_cents" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_now timestamptz := now();
  v_total integer;
  v_payment_status text;
  v_voided_at timestamptz;
  v_refunded_at timestamptz;
begin
  select o.total_cents, o.payment_status, o.voided_at, o.refunded_at
    into v_total, v_payment_status, v_voided_at, v_refunded_at
  from public.orders o
  where o.id = p_order_id;

  if v_total is null then
    raise exception 'Order % not found', p_order_id using errcode = '45000';
  end if;

  -- must be paid
  if v_payment_status <> 'paid' then
    raise exception 'Order % is not paid, cannot refund', p_order_id using errcode = '45000';
  end if;

  -- cannot refund voided orders
  if v_voided_at is not null then
    raise exception 'Order % is voided and cannot be refunded', p_order_id using errcode = '45000';
  end if;

  -- cannot refund twice
  if v_refunded_at is not null then
    raise exception 'Order % already refunded', p_order_id using errcode = '45000';
  end if;

  -- bypass lock ONLY inside this function call
  perform set_config('app.bypass_order_lock','1', true);

  update public.orders o
     set payment_status = 'refunded',
         refunded_at = v_now,
         refund_reason = p_reason,
         refund_amount_cents = coalesce(p_refund_amount_cents, v_total),
         refunded_by_source = p_source,
         refunded_by = p_actor,
         updated_at = v_now
   where o.id = p_order_id;

  return query
  select p_order_id, v_now, coalesce(p_refund_amount_cents, v_total);
end;
$$;


ALTER FUNCTION "public"."refund_order"("p_order_id" "uuid", "p_refund_amount_cents" integer, "p_reason" "text", "p_source" "text", "p_actor" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_kds_ticket_items"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  insert into public.kds_ticket_items (
    kds_ticket_id,
    order_item_id,
    display_name,
    qty,
    instructions_text,
    status
  )
  select
    new.id,
    oi.id,
    coalesce(oi.menu_item_name, 'Item'),
    coalesce(oi.qty, 1),
    oi.special_instructions,
    'new'
  from public.order_items oi
  where oi.order_id = new.order_id
  on conflict (kds_ticket_id, order_item_id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."seed_kds_ticket_items"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_order_to_kds"("p_order_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_ticket_id uuid;
begin
  -- 1) Must be editable + in draft
  if not exists (
    select 1
    from orders
    where id = p_order_id
      and status = 'draft'
      and paid_at is null
      and refunded_at is null
      and voided_at is null
  ) then
    raise exception 'Order % is locked or not in draft state', p_order_id;
  end if;

  -- 2) Mark order as sent
  update orders
  set status = 'sent'
  where id = p_order_id;

  -- 3) Create KDS ticket
  insert into kds_tickets (order_id, status)
  values (p_order_id, 'new')
  returning id into v_ticket_id;

  -- 4) Create KDS ticket items (IMPORTANT: use kds_ticket_id)
  insert into kds_ticket_items (
    kds_ticket_id,
    order_item_id,
    display_name,
    qty,
    modifiers_text
  )
  select
    v_ticket_id,
    oi.id,
    oi.menu_item_name,
    oi.qty,
    coalesce(oi.special_instructions, '')
  from order_items oi
  where oi.order_id = p_order_id;

end;
$$;


ALTER FUNCTION "public"."submit_order_to_kds"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_kds_ticket_customer"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update public.kds_tickets
  set
    customer_name = new.customer_name,
    customer_phone = new.customer_phone
  where order_id = new.id;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_kds_ticket_customer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_ticket_customer_from_order"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update public.kds_tickets
  set customer_name  = new.customer_name,
      customer_phone = new.customer_phone,
      sms_opt_in     = new.sms_opt_in
  where order_id = new.id;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_ticket_customer_from_order"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."void_order"("p_order_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("order_id" "uuid", "ticket_id" "uuid", "final_order_status" "text", "final_ticket_status" "text")
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_ticket_id uuid;
BEGIN
  -- find any existing ticket
  SELECT id
    INTO v_ticket_id
  FROM public.kds_tickets
  WHERE order_id = p_order_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_ticket_id IS NULL THEN
    -- Cancel (never hit kitchen)
    UPDATE public.orders
    SET status = 'cancelled',
        voided_at = now(),
        void_reason = p_reason,
        updated_at = now()
    WHERE id = p_order_id;

    RETURN QUERY
    SELECT p_order_id, NULL::uuid, 'cancelled'::text, NULL::text;

  ELSE
    -- Void (already hit kitchen)
    UPDATE public.orders
    SET status = 'voided',
        voided_at = now(),
        void_reason = p_reason,
        updated_at = now()
    WHERE id = p_order_id;

    UPDATE public.kds_tickets
    SET status = 'voided',
        voided_at = now(),
        void_reason = p_reason
    WHERE id = v_ticket_id;

    RETURN QUERY
    SELECT p_order_id, v_ticket_id, 'voided'::text, 'voided'::text;
  END IF;
END;
$$;


ALTER FUNCTION "public"."void_order"("p_order_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."void_order"("p_order_id" "uuid", "p_reason" "text", "p_source" "text") RETURNS TABLE("out_order_id" "uuid", "voided_at" timestamp with time zone, "ticket_ids" "uuid"[])
    LANGUAGE "plpgsql"
    AS $$
declare
  v_now timestamptz := now();
  v_ticket_ids uuid[];
begin
  -- 1) Mark order as voided
  update public.orders o
  set
    status = 'voided',
    voided_at = v_now,
    void_reason = p_reason,
    voided_by_source = p_source,
    updated_at = v_now
  where o.id = p_order_id;

  -- 2) Collect related KDS tickets (QUALIFY COLUMN!)
  select array_agg(t.id)
  into v_ticket_ids
  from public.kds_tickets t
  where t.order_id = p_order_id;

  -- 3) Close KDS tickets
  update public.kds_tickets t
  set
    status = 'done',
    completed_at = coalesce(t.completed_at, v_now),
    closed_reason = 'voided'
  where t.order_id = p_order_id;

  -- 4) Stop all KDS ticket items
  update public.kds_ticket_items i
  set status = 'done'
  where i.kds_ticket_id = any(coalesce(v_ticket_ids, array[]::uuid[]));

  return query
  select p_order_id as out_order_id,
         v_now as voided_at,
         coalesce(v_ticket_ids, array[]::uuid[]) as ticket_ids;
end;
$$;


ALTER FUNCTION "public"."void_order"("p_order_id" "uuid", "p_reason" "text", "p_source" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sms_enabled" boolean DEFAULT false NOT NULL,
    "sms_send_order_confirmed" boolean DEFAULT true NOT NULL,
    "sms_send_order_ready" boolean DEFAULT true NOT NULL,
    "sms_send_delivery_out_for_delivery" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sms_send_order_accepted" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


ALTER TABLE "public"."categories" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."kds_ticket_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kds_ticket_id" "uuid" NOT NULL,
    "order_item_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "qty" integer NOT NULL,
    "modifiers_text" "text",
    "instructions_text" "text",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ticket_id" "uuid",
    CONSTRAINT "kds_ticket_items_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'started'::"text", 'done'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."kds_ticket_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kds_ticket_order_number_seq"
    START WITH 1000
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kds_ticket_order_number_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kds_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "station" "text" DEFAULT 'kitchen'::"text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "order_number" bigint DEFAULT "nextval"('"public"."kds_ticket_order_number_seq"'::"regclass"),
    "voided_at" timestamp with time zone,
    "void_reason" "text",
    "voided_by" "text",
    "closed_reason" "text",
    "accepted_at" timestamp with time zone,
    "table_name" "text",
    "guest_count" integer,
    "customer_name" "text",
    "customer_phone" "text",
    "sms_opt_in" boolean DEFAULT false,
    CONSTRAINT "kds_tickets_closed_reason_check" CHECK (("closed_reason" = ANY (ARRAY['completed'::"text", 'voided'::"text"]))),
    CONSTRAINT "kds_tickets_station_check" CHECK (("station" = ANY (ARRAY['kitchen'::"text", 'drink'::"text", 'dessert'::"text", 'cold'::"text", 'wok'::"text", 'grill'::"text", 'fry'::"text"]))),
    CONSTRAINT "kds_tickets_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'in_progress'::"text", 'done'::"text", 'voided'::"text"])))
);


ALTER TABLE "public"."kds_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kitchen_wait_settings" (
    "id" integer DEFAULT 1 NOT NULL,
    "status" "public"."wait_status" DEFAULT 'normal'::"public"."wait_status" NOT NULL,
    "normal_minutes" integer DEFAULT 15 NOT NULL,
    "busy_minutes" integer DEFAULT 25 NOT NULL,
    "very_busy_minutes" integer DEFAULT 35 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "text",
    "accepting_orders" boolean DEFAULT true NOT NULL,
    "paused" boolean DEFAULT true NOT NULL,
    "pause_message" "text" DEFAULT 'We are currently not accepting new online orders. Please call the restaurant.'::"text" NOT NULL,
    "wait_updated_at" timestamp with time zone DEFAULT "now"(),
    "settings_updated_at" timestamp with time zone DEFAULT "now"(),
    "minutes" integer DEFAULT 15
);


ALTER TABLE "public"."kitchen_wait_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kitchen_wait_status" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "status" "text" NOT NULL,
    "minutes" integer NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepting_orders" boolean DEFAULT true NOT NULL,
    CONSTRAINT "kitchen_wait_status_status_check" CHECK (("status" = ANY (ARRAY['normal'::"text", 'busy'::"text", 'very_busy'::"text"])))
);


ALTER TABLE "public"."kitchen_wait_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."menu_categories" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."menu_categories" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."menu_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."menu_categories_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."menu_categories_id_seq" OWNED BY "public"."menu_categories"."id";



CREATE TABLE IF NOT EXISTS "public"."menu_item_modifier_rules" (
    "id" bigint NOT NULL,
    "menu_item_id" bigint NOT NULL,
    "modifier_id" bigint NOT NULL,
    "rule_type" "text" NOT NULL,
    "max_qty" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "menu_item_modifier_rules_max_qty_check" CHECK (("max_qty" >= 1)),
    CONSTRAINT "menu_item_modifier_rules_rule_type_check" CHECK (("rule_type" = ANY (ARRAY['required'::"text", 'optional'::"text"])))
);


ALTER TABLE "public"."menu_item_modifier_rules" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."menu_item_modifier_rules_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."menu_item_modifier_rules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."menu_item_modifier_rules_id_seq" OWNED BY "public"."menu_item_modifier_rules"."id";



CREATE TABLE IF NOT EXISTS "public"."menu_items" (
    "id" bigint NOT NULL,
    "category_id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "base_price_cents" integer NOT NULL,
    "requires_protein" boolean DEFAULT false NOT NULL,
    "station" "text" DEFAULT 'kitchen'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "category" "text" DEFAULT 'Main'::"text",
    CONSTRAINT "menu_items_base_price_cents_check" CHECK (("base_price_cents" >= 0)),
    CONSTRAINT "menu_items_station_check" CHECK (("station" = ANY (ARRAY['kitchen'::"text", 'drink'::"text", 'dessert'::"text", 'cold'::"text", 'wok'::"text", 'grill'::"text", 'fry'::"text"])))
);


ALTER TABLE "public"."menu_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."menu_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."menu_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."menu_items_id_seq" OWNED BY "public"."menu_items"."id";



CREATE TABLE IF NOT EXISTS "public"."modifiers" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "modifier_group" "text" NOT NULL,
    "price_delta_cents" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "modifiers_modifier_group_check" CHECK (("modifier_group" = ANY (ARRAY['protein'::"text", 'addon'::"text", 'prep'::"text"]))),
    CONSTRAINT "modifiers_price_delta_cents_check" CHECK (("price_delta_cents" >= 0))
);


ALTER TABLE "public"."modifiers" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."modifiers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."modifiers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."modifiers_id_seq" OWNED BY "public"."modifiers"."id";



CREATE TABLE IF NOT EXISTS "public"."order_allergies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "scope" "text" NOT NULL,
    "allergy_text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "order_allergies_scope_check" CHECK (("scope" = ANY (ARRAY['whole_order'::"text", 'item_specific'::"text"])))
);


ALTER TABLE "public"."order_allergies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_allergy_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_allergy_id" "uuid" NOT NULL,
    "order_item_id" "uuid" NOT NULL
);


ALTER TABLE "public"."order_allergy_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "reason" "text",
    "actor_source" "text",
    "actor_id" "text",
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "order_audit_log_action_check" CHECK (("action" = ANY (ARRAY['void'::"text", 'unvoid'::"text", 'cancel'::"text", 'refund'::"text"]))),
    CONSTRAINT "order_audit_log_actor_source_check" CHECK (("actor_source" = ANY (ARRAY['ipad'::"text", 'ai'::"text", 'online'::"text", 'staff'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."order_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "detail" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."order_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_item_modifiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_item_id" "uuid" NOT NULL,
    "modifier_id" "uuid",
    "modifier_name" "text" NOT NULL,
    "modifier_type" "text" NOT NULL,
    "price_delta_cents" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "order_item_modifiers_modifier_type_check" CHECK (("modifier_type" = ANY (ARRAY['required'::"text", 'optional'::"text"])))
);


ALTER TABLE "public"."order_item_modifiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "menu_item_id" "uuid",
    "menu_item_name" "text" NOT NULL,
    "qty" integer NOT NULL,
    "base_price_cents" integer NOT NULL,
    "line_subtotal_cents" integer DEFAULT 0 NOT NULL,
    "special_instructions" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "options_summary" "text",
    CONSTRAINT "order_items_base_price_cents_check" CHECK (("base_price_cents" >= 0)),
    CONSTRAINT "order_items_qty_check" CHECK (("qty" > 0))
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."order_number_seq"
    START WITH 1000
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."order_number_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_sms_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "event" "text" NOT NULL,
    "to_phone" "text",
    "message" "text",
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "twilio_sid" "text",
    CONSTRAINT "order_sms_events_event_check" CHECK (("event" = ANY (ARRAY['accepted'::"text", 'ready'::"text"])))
);


ALTER TABLE "public"."order_sms_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."orders_order_number_seq"
    START WITH 1202600001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."orders_order_number_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_number" bigint DEFAULT "nextval"('"public"."orders_order_number_seq"'::"regclass") NOT NULL,
    "source" "text" DEFAULT 'ipad'::"text" NOT NULL,
    "order_type" "text" NOT NULL,
    "table_number" integer,
    "guest_count" integer,
    "customer_name" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "tax_bps" integer DEFAULT 1075 NOT NULL,
    "subtotal_cents" integer DEFAULT 0 NOT NULL,
    "tax_cents" integer DEFAULT 0 NOT NULL,
    "total_cents" integer DEFAULT 0 NOT NULL,
    "payment_status" "text" DEFAULT 'unpaid'::"text" NOT NULL,
    "payment_amount_cents" integer,
    "payment_idempotency_key" "text",
    "payment_ref" "text",
    "paid_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "voided_at" timestamp with time zone,
    "void_reason" "text",
    "voided_by" "text",
    "voided_by_source" "text",
    "refunded_at" timestamp with time zone,
    "refund_reason" "text",
    "refund_amount_cents" integer,
    "refunded_by_source" "text",
    "refunded_by" "text",
    "subtotal" numeric,
    "tax" numeric,
    "total" numeric,
    "deleted_at" timestamp with time zone,
    "stripe_payment_intent_id" "text",
    "stripe_checkout_session_id" "text",
    "stripe_session_id" "text",
    "items_json" "jsonb",
    "accepted_at" timestamp with time zone,
    "prep_minutes" integer,
    "estimated_ready_at" timestamp with time zone,
    "webhook_processing_at" timestamp with time zone,
    "accepted_by" "text",
    "rejected_at" timestamp with time zone,
    "reject_reason" "text",
    "kitchen_minutes" integer,
    "ready_at" timestamp with time zone,
    "ticket_number" integer,
    "stripe_client_secret" "text",
    "customer_phone" "text",
    "sms_opt_in" boolean DEFAULT true,
    "service_fee_cents" integer DEFAULT 0 NOT NULL,
    "printed_at" timestamp without time zone,
    "print_attempts" integer DEFAULT 0,
    "tip_cents" integer DEFAULT 0 NOT NULL,
    "sms_confirmed_sent_at" timestamp with time zone,
    "sms_ready_sent_at" timestamp with time zone,
    "sms_accepted_sent_at" timestamp with time zone,
    CONSTRAINT "orders_guest_count_check" CHECK ((("guest_count" IS NULL) OR ("guest_count" > 0))),
    CONSTRAINT "orders_order_type_check" CHECK (("order_type" = ANY (ARRAY['dine_in'::"text", 'takeout'::"text", 'phone'::"text"]))),
    CONSTRAINT "orders_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['unpaid'::"text", 'pending'::"text", 'paid'::"text", 'failed'::"text", 'refunded'::"text"]))),
    CONSTRAINT "orders_ready_requires_paid_check" CHECK ((("status" <> 'ready'::"text") OR ("payment_status" = 'paid'::"text"))),
    CONSTRAINT "orders_source_check" CHECK (("source" = ANY (ARRAY['ipad'::"text", 'ai'::"text", 'online'::"text", 'staff'::"text"]))),
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'paid'::"text", 'accepted'::"text", 'ready'::"text", 'cancelled'::"text", 'voided'::"text"]))),
    CONSTRAINT "orders_tax_bps_range_check" CHECK ((("tax_bps" >= 0) AND ("tax_bps" <= 3000))),
    CONSTRAINT "orders_total_math_check" CHECK (("total_cents" = (("subtotal_cents" + "tax_cents") + COALESCE("service_fee_cents", 0))))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."print_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "job_type" "text" NOT NULL,
    "station" "text" DEFAULT 'kitchen'::"text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "printer_name" "text" DEFAULT 'kitchen_printer'::"text" NOT NULL,
    "payload_text" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "printed_at" timestamp with time zone,
    "kind" "text",
    "ticket_id" "uuid",
    "payload" "jsonb",
    CONSTRAINT "print_jobs_job_type_check" CHECK (("job_type" = ANY (ARRAY['original'::"text", 'addon'::"text", 'cancel'::"text", 'reprint'::"text"]))),
    CONSTRAINT "print_jobs_station_check" CHECK (("station" = ANY (ARRAY['kitchen'::"text", 'drink'::"text", 'dessert'::"text", 'cold'::"text", 'wok'::"text", 'grill'::"text", 'fry'::"text"]))),
    CONSTRAINT "print_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'printing'::"text", 'printed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."print_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."printers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "connection" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."printers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."station_printers" (
    "station" "text" NOT NULL,
    "printer_id" "uuid" NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    CONSTRAINT "station_printers_station_check" CHECK (("station" = ANY (ARRAY['kitchen'::"text", 'drink'::"text", 'dessert'::"text", 'cold'::"text", 'wok'::"text", 'grill'::"text", 'fry'::"text"])))
);


ALTER TABLE "public"."station_printers" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_kds_ticket_board" AS
 SELECT "t"."id" AS "kds_ticket_id",
    "t"."station",
    "t"."status" AS "kds_status",
    "t"."created_at" AS "ticket_created_at",
    "t"."started_at",
    "t"."completed_at",
    "o"."id" AS "order_id",
    "o"."order_number",
    "o"."source",
    "o"."order_type",
    "o"."table_number",
    "o"."guest_count",
    "o"."customer_name",
    "o"."subtotal_cents",
    "o"."tax_cents",
    "o"."total_cents",
    ( SELECT "count"(*) AS "count"
           FROM "public"."kds_ticket_items" "i"
          WHERE ("i"."kds_ticket_id" = "t"."id")) AS "item_count"
   FROM ("public"."kds_tickets" "t"
     JOIN "public"."orders" "o" ON (("o"."id" = "t"."order_id")));


ALTER VIEW "public"."v_kds_ticket_board" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_kds_ticket_detail" AS
 SELECT "kds_ticket_id",
    "id" AS "kds_ticket_item_id",
    "status" AS "item_status",
    "display_name",
    "qty",
    "modifiers_text",
    "instructions_text",
    "created_at"
   FROM "public"."kds_ticket_items" "i";


ALTER VIEW "public"."v_kds_ticket_detail" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_order_lock_state" AS
 SELECT "id" AS "order_id",
    "status",
    "payment_status",
    "voided_at",
    "void_reason",
    ("voided_at" IS NOT NULL) AS "is_voided",
    ("voided_at" IS NOT NULL) AS "is_locked",
    (("voided_at" IS NULL) AND ("payment_status" = 'unpaid'::"text")) AS "can_charge",
    ("voided_at" IS NULL) AS "can_edit",
    ("voided_at" IS NULL) AS "can_send_to_kds"
   FROM "public"."orders" "o";


ALTER VIEW "public"."v_order_lock_state" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_order_ui_state" AS
 SELECT "id" AS "order_id",
    "status",
    "payment_status",
    "voided_at",
    "void_reason",
    "voided_by_source",
    "voided_by",
    "refunded_at",
    "refund_reason",
    "refund_amount_cents",
    "refunded_by_source",
    "refunded_by",
    ("voided_at" IS NOT NULL) AS "is_voided",
    ("payment_status" = 'paid'::"text") AS "is_paid",
    ("refunded_at" IS NOT NULL) AS "is_refunded",
    (("voided_at" IS NOT NULL) OR ("payment_status" = ANY (ARRAY['paid'::"text", 'refunded'::"text"])) OR ("refunded_at" IS NOT NULL)) AS "is_locked"
   FROM "public"."orders" "o";


ALTER VIEW "public"."v_order_ui_state" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_orders_all" AS
 SELECT "id",
    "order_number",
    "source",
    "order_type",
    "table_number",
    "guest_count",
    "customer_name",
    "status",
    "tax_bps",
    "subtotal_cents",
    "tax_cents",
    "total_cents",
    "payment_status",
    "payment_amount_cents",
    "payment_idempotency_key",
    "payment_ref",
    "paid_at",
    "notes",
    "created_at",
    "updated_at",
    "voided_at",
    "void_reason",
    "voided_by",
    "voided_by_source"
   FROM "public"."orders";


ALTER VIEW "public"."v_orders_all" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_orders_reporting" AS
 SELECT "id",
    "order_number",
    "source",
    "order_type",
    "table_number",
    "guest_count",
    "customer_name",
    "status",
    "tax_bps",
    "subtotal_cents",
    "tax_cents",
    "total_cents",
    "payment_status",
    "payment_amount_cents",
    "payment_idempotency_key",
    "payment_ref",
    "paid_at",
    "notes",
    "created_at",
    "updated_at",
    "voided_at",
    "void_reason",
    "voided_by",
    "voided_by_source"
   FROM "public"."orders" "o"
  WHERE ("voided_at" IS NULL);


ALTER VIEW "public"."v_orders_reporting" OWNER TO "postgres";


ALTER TABLE ONLY "public"."menu_categories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."menu_categories_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."menu_item_modifier_rules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."menu_item_modifier_rules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."menu_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."menu_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."modifiers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."modifiers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kds_ticket_items"
    ADD CONSTRAINT "kds_ticket_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kds_ticket_items"
    ADD CONSTRAINT "kds_ticket_items_ticket_order_item_unique" UNIQUE ("kds_ticket_id", "order_item_id");



ALTER TABLE ONLY "public"."kds_tickets"
    ADD CONSTRAINT "kds_tickets_order_id_key" UNIQUE ("order_id");



ALTER TABLE ONLY "public"."kds_tickets"
    ADD CONSTRAINT "kds_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kitchen_wait_settings"
    ADD CONSTRAINT "kitchen_wait_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kitchen_wait_status"
    ADD CONSTRAINT "kitchen_wait_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_categories"
    ADD CONSTRAINT "menu_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."menu_categories"
    ADD CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_item_modifier_rules"
    ADD CONSTRAINT "menu_item_modifier_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."modifiers"
    ADD CONSTRAINT "modifiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_allergies"
    ADD CONSTRAINT "order_allergies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_allergy_items"
    ADD CONSTRAINT "order_allergy_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_audit_log"
    ADD CONSTRAINT "order_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_events"
    ADD CONSTRAINT "order_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_sms_events"
    ADD CONSTRAINT "order_sms_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_order_number_key" UNIQUE ("order_number");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_payment_idempotency_key_key" UNIQUE ("payment_idempotency_key");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."print_jobs"
    ADD CONSTRAINT "print_jobs_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."print_jobs"
    ADD CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."printers"
    ADD CONSTRAINT "printers_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."printers"
    ADD CONSTRAINT "printers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."station_printers"
    ADD CONSTRAINT "station_printers_pkey" PRIMARY KEY ("station");



CREATE INDEX "idx_item_rules" ON "public"."menu_item_modifier_rules" USING "btree" ("menu_item_id", "rule_type");



CREATE INDEX "idx_kds_ticket_items_ticket" ON "public"."kds_ticket_items" USING "btree" ("kds_ticket_id", "created_at");



CREATE INDEX "idx_kds_tickets_order_id" ON "public"."kds_tickets" USING "btree" ("order_id");



CREATE INDEX "idx_kds_tickets_status" ON "public"."kds_tickets" USING "btree" ("status", "created_at");



CREATE INDEX "idx_menu_items_category" ON "public"."menu_items" USING "btree" ("category_id", "sort_order");



CREATE INDEX "idx_modifiers_group" ON "public"."modifiers" USING "btree" ("modifier_group", "sort_order");



CREATE INDEX "idx_oim_order_item" ON "public"."order_item_modifiers" USING "btree" ("order_item_id");



CREATE INDEX "idx_order_allergies_order" ON "public"."order_allergies" USING "btree" ("order_id");



CREATE INDEX "idx_order_audit_log_order_id" ON "public"."order_audit_log" USING "btree" ("order_id");



CREATE INDEX "idx_order_events_order" ON "public"."order_events" USING "btree" ("order_id", "created_at");



CREATE INDEX "idx_order_items_order" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "idx_order_items_order_id" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "idx_orders_created_at" ON "public"."orders" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_orders_estimated_ready_at" ON "public"."orders" USING "btree" ("estimated_ready_at");



CREATE INDEX "idx_orders_id" ON "public"."orders" USING "btree" ("id");



CREATE INDEX "idx_orders_lock_state" ON "public"."orders" USING "btree" ("payment_status", "voided_at", "refunded_at");



CREATE INDEX "idx_orders_status" ON "public"."orders" USING "btree" ("status");



CREATE INDEX "idx_orders_voided_at" ON "public"."orders" USING "btree" ("voided_at");



CREATE INDEX "idx_print_jobs_order" ON "public"."print_jobs" USING "btree" ("order_id", "created_at" DESC);



CREATE INDEX "idx_print_jobs_status" ON "public"."print_jobs" USING "btree" ("status", "created_at");



CREATE INDEX "order_items_order_id_idx" ON "public"."order_items" USING "btree" ("order_id");



CREATE UNIQUE INDEX "order_sms_events_unique" ON "public"."order_sms_events" USING "btree" ("order_id", "event");



CREATE INDEX "orders_created_at_idx" ON "public"."orders" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "orders_order_number_unique" ON "public"."orders" USING "btree" ("order_number");



CREATE INDEX "orders_status_idx" ON "public"."orders" USING "btree" ("status");



CREATE INDEX "print_jobs_status_created_idx" ON "public"."print_jobs" USING "btree" ("status", "created_at");



CREATE UNIQUE INDEX "uq_allergy_item_link" ON "public"."order_allergy_items" USING "btree" ("order_allergy_id", "order_item_id");



CREATE UNIQUE INDEX "uq_item_modifier_rule" ON "public"."menu_item_modifier_rules" USING "btree" ("menu_item_id", "modifier_id");



CREATE OR REPLACE TRIGGER "lock_paid_orders" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_paid_order_lock"();



CREATE OR REPLACE TRIGGER "trg_enforce_order_lock" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_paid_order_lock"();



CREATE OR REPLACE TRIGGER "trg_kds_ticket_fill_customer" AFTER INSERT ON "public"."kds_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."kds_ticket_fill_customer"();



CREATE OR REPLACE TRIGGER "trg_kds_ticket_sync_customer_from_order" BEFORE INSERT OR UPDATE OF "order_id" ON "public"."kds_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."kds_ticket_sync_customer_from_order"();



CREATE OR REPLACE TRIGGER "trg_kitchen_wait_settings_updated_at" BEFORE UPDATE ON "public"."kitchen_wait_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_orders_push_customer_to_ticket" AFTER UPDATE OF "customer_name", "customer_phone" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."orders_push_customer_to_ticket"();



CREATE OR REPLACE TRIGGER "trg_seed_kds_ticket_items" AFTER INSERT ON "public"."kds_tickets" FOR EACH ROW EXECUTE FUNCTION "public"."seed_kds_ticket_items"();



CREATE OR REPLACE TRIGGER "trg_sync_kds_ticket_customer" AFTER UPDATE OF "customer_name", "customer_phone" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."sync_kds_ticket_customer"();



CREATE OR REPLACE TRIGGER "trg_sync_ticket_customer_from_order" AFTER UPDATE OF "customer_name", "customer_phone", "sms_opt_in" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."sync_ticket_customer_from_order"();



ALTER TABLE ONLY "public"."kds_ticket_items"
    ADD CONSTRAINT "kds_ticket_items_kds_ticket_id_fkey" FOREIGN KEY ("kds_ticket_id") REFERENCES "public"."kds_tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kds_ticket_items"
    ADD CONSTRAINT "kds_ticket_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kds_ticket_items"
    ADD CONSTRAINT "kds_ticket_items_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."kds_tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kds_tickets"
    ADD CONSTRAINT "kds_tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_item_modifier_rules"
    ADD CONSTRAINT "menu_item_modifier_rules_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."menu_item_modifier_rules"
    ADD CONSTRAINT "menu_item_modifier_rules_modifier_id_fkey" FOREIGN KEY ("modifier_id") REFERENCES "public"."modifiers"("id");



ALTER TABLE ONLY "public"."menu_items"
    ADD CONSTRAINT "menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."order_allergies"
    ADD CONSTRAINT "order_allergies_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_allergy_items"
    ADD CONSTRAINT "order_allergy_items_order_allergy_id_fkey" FOREIGN KEY ("order_allergy_id") REFERENCES "public"."order_allergies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_allergy_items"
    ADD CONSTRAINT "order_allergy_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_audit_log"
    ADD CONSTRAINT "order_audit_log_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_events"
    ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_sms_events"
    ADD CONSTRAINT "order_sms_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."print_jobs"
    ADD CONSTRAINT "print_jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."station_printers"
    ADD CONSTRAINT "station_printers_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id");



CREATE POLICY "allow read order_items for paid online" ON "public"."order_items" FOR SELECT TO "authenticated", "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_items"."order_id") AND ("o"."source" = 'online'::"text") AND ("o"."payment_status" = 'paid'::"text")))));



CREATE POLICY "kds_ticket_items_admin_read" ON "public"."kds_ticket_items" FOR SELECT TO "authenticated" USING ("public"."is_kds_admin"());



CREATE POLICY "kds_ticket_items_read_all" ON "public"."kds_ticket_items" FOR SELECT TO "anon" USING (true);



CREATE POLICY "kds_tickets_admin_read" ON "public"."kds_tickets" FOR SELECT TO "authenticated" USING ("public"."is_kds_admin"());



CREATE POLICY "kds_tickets_admin_update" ON "public"."kds_tickets" FOR UPDATE TO "authenticated" USING ("public"."is_kds_admin"()) WITH CHECK ("public"."is_kds_admin"());



CREATE POLICY "kds_tickets_read_all" ON "public"."kds_tickets" FOR SELECT TO "anon" USING (true);



CREATE POLICY "kds_tickets_update_status" ON "public"."kds_tickets" FOR UPDATE TO "anon" USING (true) WITH CHECK (true);



ALTER TABLE "public"."kitchen_wait_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kitchen_wait_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_items_admin_read" ON "public"."order_items" FOR SELECT TO "authenticated" USING ("public"."is_kds_admin"());



CREATE POLICY "order_items_auth_insert" ON "public"."order_items" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "order_items_public_insert" ON "public"."order_items" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "orders_admin_read" ON "public"."orders" FOR SELECT TO "authenticated" USING ("public"."is_kds_admin"());



CREATE POLICY "orders_admin_update" ON "public"."orders" FOR UPDATE TO "authenticated" USING ("public"."is_kds_admin"()) WITH CHECK ("public"."is_kds_admin"());



CREATE POLICY "orders_auth_insert" ON "public"."orders" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "orders_public_insert" ON "public"."orders" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "public read wait settings" ON "public"."kitchen_wait_settings" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public read wait status" ON "public"."kitchen_wait_settings" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public_read_wait_settings" ON "public"."kitchen_wait_settings" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public_read_wait_status" ON "public"."kitchen_wait_status" FOR SELECT TO "authenticated", "anon" USING (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."kds_ticket_items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."kds_tickets";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."kitchen_wait_status";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."orders";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."print_jobs";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."create_order_with_kds"("p_source" "text", "p_order_type" "text", "p_station" "text", "p_items" "jsonb", "p_tax_bps" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."create_order_with_kds"("p_source" "text", "p_order_type" "text", "p_station" "text", "p_items" "jsonb", "p_tax_bps" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_order_with_kds"("p_source" "text", "p_order_type" "text", "p_station" "text", "p_items" "jsonb", "p_tax_bps" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_order_lock"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_order_lock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_order_lock"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_paid_order_lock"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_paid_order_lock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_paid_order_lock"() TO "service_role";



GRANT ALL ON FUNCTION "public"."finalize_order"("p_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_order"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_order"("p_order_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."finalize_order_to_kds"("p_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."finalize_order_to_kds"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_order_to_kds"("p_order_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_kds_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_kds_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_kds_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."kds_accept_ticket"("p_ticket_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."kds_accept_ticket"("p_ticket_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."kds_accept_ticket"("p_ticket_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."kds_complete_ticket"("p_ticket_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."kds_complete_ticket"("p_ticket_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."kds_complete_ticket"("p_ticket_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."kds_mark_done_if_all_items_done"("p_ticket_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."kds_mark_done_if_all_items_done"("p_ticket_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."kds_mark_done_if_all_items_done"("p_ticket_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."kds_start_ticket"("p_ticket_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."kds_start_ticket"("p_ticket_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."kds_start_ticket"("p_ticket_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."kds_ticket_fill_customer"() TO "anon";
GRANT ALL ON FUNCTION "public"."kds_ticket_fill_customer"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."kds_ticket_fill_customer"() TO "service_role";



GRANT ALL ON FUNCTION "public"."kds_ticket_sync_customer_from_order"() TO "anon";
GRANT ALL ON FUNCTION "public"."kds_ticket_sync_customer_from_order"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."kds_ticket_sync_customer_from_order"() TO "service_role";



GRANT ALL ON FUNCTION "public"."orders_push_customer_to_ticket"() TO "anon";
GRANT ALL ON FUNCTION "public"."orders_push_customer_to_ticket"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."orders_push_customer_to_ticket"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refund_order"("p_order_id" "uuid", "p_refund_amount_cents" integer, "p_reason" "text", "p_source" "text", "p_actor" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."refund_order"("p_order_id" "uuid", "p_refund_amount_cents" integer, "p_reason" "text", "p_source" "text", "p_actor" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refund_order"("p_order_id" "uuid", "p_refund_amount_cents" integer, "p_reason" "text", "p_source" "text", "p_actor" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_kds_ticket_items"() TO "anon";
GRANT ALL ON FUNCTION "public"."seed_kds_ticket_items"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_kds_ticket_items"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_order_to_kds"("p_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_order_to_kds"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_order_to_kds"("p_order_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_kds_ticket_customer"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_kds_ticket_customer"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_kds_ticket_customer"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_ticket_customer_from_order"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_ticket_customer_from_order"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_ticket_customer_from_order"() TO "service_role";



GRANT ALL ON FUNCTION "public"."void_order"("p_order_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."void_order"("p_order_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."void_order"("p_order_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."void_order"("p_order_id" "uuid", "p_reason" "text", "p_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."void_order"("p_order_id" "uuid", "p_reason" "text", "p_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."void_order"("p_order_id" "uuid", "p_reason" "text", "p_source" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kds_ticket_items" TO "anon";
GRANT ALL ON TABLE "public"."kds_ticket_items" TO "authenticated";
GRANT ALL ON TABLE "public"."kds_ticket_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kds_ticket_order_number_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kds_ticket_order_number_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kds_ticket_order_number_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kds_tickets" TO "anon";
GRANT ALL ON TABLE "public"."kds_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."kds_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."kitchen_wait_settings" TO "anon";
GRANT ALL ON TABLE "public"."kitchen_wait_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."kitchen_wait_settings" TO "service_role";



GRANT ALL ON TABLE "public"."kitchen_wait_status" TO "anon";
GRANT ALL ON TABLE "public"."kitchen_wait_status" TO "authenticated";
GRANT ALL ON TABLE "public"."kitchen_wait_status" TO "service_role";



GRANT ALL ON TABLE "public"."menu_categories" TO "anon";
GRANT ALL ON TABLE "public"."menu_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."menu_categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."menu_categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."menu_categories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."menu_item_modifier_rules" TO "anon";
GRANT ALL ON TABLE "public"."menu_item_modifier_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_item_modifier_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."menu_item_modifier_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."menu_item_modifier_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."menu_item_modifier_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."menu_items" TO "anon";
GRANT ALL ON TABLE "public"."menu_items" TO "authenticated";
GRANT ALL ON TABLE "public"."menu_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."menu_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."menu_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."menu_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."modifiers" TO "anon";
GRANT ALL ON TABLE "public"."modifiers" TO "authenticated";
GRANT ALL ON TABLE "public"."modifiers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."modifiers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."modifiers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."modifiers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_allergies" TO "anon";
GRANT ALL ON TABLE "public"."order_allergies" TO "authenticated";
GRANT ALL ON TABLE "public"."order_allergies" TO "service_role";



GRANT ALL ON TABLE "public"."order_allergy_items" TO "anon";
GRANT ALL ON TABLE "public"."order_allergy_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_allergy_items" TO "service_role";



GRANT ALL ON TABLE "public"."order_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."order_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."order_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."order_events" TO "anon";
GRANT ALL ON TABLE "public"."order_events" TO "authenticated";
GRANT ALL ON TABLE "public"."order_events" TO "service_role";



GRANT ALL ON TABLE "public"."order_item_modifiers" TO "anon";
GRANT ALL ON TABLE "public"."order_item_modifiers" TO "authenticated";
GRANT ALL ON TABLE "public"."order_item_modifiers" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "anon";
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."order_number_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_number_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_number_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_sms_events" TO "anon";
GRANT ALL ON TABLE "public"."order_sms_events" TO "authenticated";
GRANT ALL ON TABLE "public"."order_sms_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."orders_order_number_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."orders_order_number_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."orders_order_number_seq" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."print_jobs" TO "anon";
GRANT ALL ON TABLE "public"."print_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."print_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."printers" TO "anon";
GRANT ALL ON TABLE "public"."printers" TO "authenticated";
GRANT ALL ON TABLE "public"."printers" TO "service_role";



GRANT ALL ON TABLE "public"."station_printers" TO "anon";
GRANT ALL ON TABLE "public"."station_printers" TO "authenticated";
GRANT ALL ON TABLE "public"."station_printers" TO "service_role";



GRANT ALL ON TABLE "public"."v_kds_ticket_board" TO "anon";
GRANT ALL ON TABLE "public"."v_kds_ticket_board" TO "authenticated";
GRANT ALL ON TABLE "public"."v_kds_ticket_board" TO "service_role";



GRANT ALL ON TABLE "public"."v_kds_ticket_detail" TO "anon";
GRANT ALL ON TABLE "public"."v_kds_ticket_detail" TO "authenticated";
GRANT ALL ON TABLE "public"."v_kds_ticket_detail" TO "service_role";



GRANT ALL ON TABLE "public"."v_order_lock_state" TO "anon";
GRANT ALL ON TABLE "public"."v_order_lock_state" TO "authenticated";
GRANT ALL ON TABLE "public"."v_order_lock_state" TO "service_role";



GRANT ALL ON TABLE "public"."v_order_ui_state" TO "anon";
GRANT ALL ON TABLE "public"."v_order_ui_state" TO "authenticated";
GRANT ALL ON TABLE "public"."v_order_ui_state" TO "service_role";



GRANT ALL ON TABLE "public"."v_orders_all" TO "anon";
GRANT ALL ON TABLE "public"."v_orders_all" TO "authenticated";
GRANT ALL ON TABLE "public"."v_orders_all" TO "service_role";



GRANT ALL ON TABLE "public"."v_orders_reporting" TO "anon";
GRANT ALL ON TABLE "public"."v_orders_reporting" TO "authenticated";
GRANT ALL ON TABLE "public"."v_orders_reporting" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

drop policy "public read wait settings" on "public"."kitchen_wait_settings";

drop policy "public read wait status" on "public"."kitchen_wait_settings";

drop policy "public_read_wait_settings" on "public"."kitchen_wait_settings";

drop policy "public_read_wait_status" on "public"."kitchen_wait_status";

drop policy "allow read order_items for paid online" on "public"."order_items";


  create policy "public read wait settings"
  on "public"."kitchen_wait_settings"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "public read wait status"
  on "public"."kitchen_wait_settings"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "public_read_wait_settings"
  on "public"."kitchen_wait_settings"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "public_read_wait_status"
  on "public"."kitchen_wait_status"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "allow read order_items for paid online"
  on "public"."order_items"
  as permissive
  for select
  to anon, authenticated
using ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND (o.source = 'online'::text) AND (o.payment_status = 'paid'::text)))));



