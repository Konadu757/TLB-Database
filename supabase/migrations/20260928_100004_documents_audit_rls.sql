-- Document numbers, append-only audit, availability projection, and grants.
-- Write policies are intentionally absent. See the deferred-write section
-- at the bottom of this file and docs/architecture/database/README.md.

-- ---------------------------------------------------------------------------
-- Document sequences
-- ---------------------------------------------------------------------------

create table tlb.document_sequences (
  document_type text not null,
  period_year integer not null,
  last_value bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (document_type, period_year),
  constraint document_sequences_year_chk check (period_year between 2000 and 2200),
  constraint document_sequences_last_value_chk check (
    last_value >= 125 and last_value <= 999999
  ),
  constraint document_sequences_type_chk check (
    document_type in (
      'ORD', 'QTE', 'SUP', 'INV', 'RCT', 'DLV', 'PAY', 'VEN', 'PO', 'GRN',
      'SPAY', 'MV', 'ISS', 'TR', 'ADJ', 'BAT', 'CRT', 'SRT', 'NPO', 'IMP',
      'EXP', 'REQ', 'CUS'
    )
  )
);

comment on table tlb.document_sequences is
  'Per-type, per-UTC-year counter. last_value is the last issued number. First issue is 125 (TLB-ORD-2026-000125).';

comment on column tlb.document_sequences.last_value is
  'Matches MATURE_SEQUENCE_START in src/lib/domain/numbering.ts. The formatted year is four digits, not YYMM.';

create or replace function tlb.guard_document_sequence()
returns trigger
language plpgsql
set search_path = tlb, pg_temp
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.document_type is distinct from old.document_type
     or new.period_year is distinct from old.period_year then
    raise exception 'document sequence key is immutable'
      using errcode = '42501';
  end if;

  if new.last_value < old.last_value then
    raise exception 'document sequence cannot move backwards'
      using errcode = '42501';
  end if;

  if new.last_value > old.last_value + 1
     and current_setting('tlb.allow_sequence_jump', true) is distinct from 'on' then
    raise exception 'document sequence must advance by 1'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function tlb.guard_document_sequence() from public;

create trigger trg_document_sequences_guard
before update on tlb.document_sequences
for each row execute function tlb.guard_document_sequence();

create trigger trg_document_sequences_set_updated_at
before update on tlb.document_sequences
for each row execute function tlb.set_updated_at();

create trigger trg_document_sequences_no_delete
before delete on tlb.document_sequences
for each row execute function tlb.reject_row_mutation();

create trigger trg_document_sequences_no_truncate
before truncate on tlb.document_sequences
for each statement execute function tlb.reject_row_mutation();

-- Atomic issuer. INSERT ... ON CONFLICT DO UPDATE locks the sequence row.
-- First call in a year inserts 125. Later calls add 1. No dynamic SQL.
create or replace function tlb.next_document_number(
  p_document_type text,
  p_year integer default null
)
returns text
language plpgsql
security definer
set search_path = tlb, pg_temp
as $$
declare
  v_key text;
  v_type text;
  v_prefix text;
  v_year integer;
  v_seq bigint;
begin
  v_key := replace(replace(lower(btrim(coalesce(p_document_type, ''))), '-', '_'), ' ', '');

  v_type := case v_key
    when 'ord' then 'ORD'
    when 'order' then 'ORD'
    when 'qte' then 'QTE'
    when 'quotation' then 'QTE'
    when 'sup' then 'SUP'
    when 'supply' then 'SUP'
    when 'inv' then 'INV'
    when 'invoice' then 'INV'
    when 'rct' then 'RCT'
    when 'receipt' then 'RCT'
    when 'dlv' then 'DLV'
    when 'delivery' then 'DLV'
    when 'pay' then 'PAY'
    when 'payment' then 'PAY'
    when 'ven' then 'VEN'
    when 'supplier' then 'VEN'
    when 'po' then 'PO'
    when 'supplierpo' then 'PO'
    when 'supplier_po' then 'PO'
    when 'grn' then 'GRN'
    when 'supplierreceipt' then 'GRN'
    when 'supplier_receipt' then 'GRN'
    when 'spay' then 'SPAY'
    when 'supplierpayment' then 'SPAY'
    when 'supplier_payment' then 'SPAY'
    when 'mv' then 'MV'
    when 'stockmovement' then 'MV'
    when 'stock_movement' then 'MV'
    when 'iss' then 'ISS'
    when 'stockissue' then 'ISS'
    when 'stock_issue' then 'ISS'
    when 'tr' then 'TR'
    when 'transfer' then 'TR'
    when 'adj' then 'ADJ'
    when 'adjustment' then 'ADJ'
    when 'bat' then 'BAT'
    when 'batch' then 'BAT'
    when 'crt' then 'CRT'
    when 'customerreturn' then 'CRT'
    when 'customer_return' then 'CRT'
    when 'srt' then 'SRT'
    when 'supplierreturn' then 'SRT'
    when 'supplier_return' then 'SRT'
    when 'npo' then 'NPO'
    when 'nonpopurchase' then 'NPO'
    when 'non_po_purchase' then 'NPO'
    when 'imp' then 'IMP'
    when 'importshipment' then 'IMP'
    when 'import_shipment' then 'IMP'
    when 'exp' then 'EXP'
    when 'exportshipment' then 'EXP'
    when 'export_shipment' then 'EXP'
    when 'req' then 'REQ'
    when 'opsrequest' then 'REQ'
    when 'ops_request' then 'REQ'
    when 'cus' then 'CUS'
    when 'customer' then 'CUS'
    else null
  end;

  if v_type is null then
    raise exception 'unknown document type: %', p_document_type
      using errcode = '22023';
  end if;

  v_prefix := 'TLB-' || v_type;

  if p_year is null then
    v_year := extract(year from (timezone('utc', now())))::integer;
  else
    v_year := p_year;
  end if;

  insert into tlb.document_sequences (document_type, period_year, last_value)
  values (v_type, v_year, 125)
  on conflict (document_type, period_year)
  do update set last_value = tlb.document_sequences.last_value + 1
  returning last_value into v_seq;

  return v_prefix || '-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke all on function tlb.next_document_number(text, integer) from public;

comment on function tlb.next_document_number(text, integer) is
  'Returns TLB-ORD-2026-000125 style numbers. SECURITY DEFINER, search_path fixed, service_role execute only.';

-- ---------------------------------------------------------------------------
-- Audit (append-only)
-- ---------------------------------------------------------------------------

create table tlb.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references tlb.profiles (id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  summary text not null,
  meta jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_action_not_blank check (
    length(btrim(action)) > 0 and length(action) <= 80
  ),
  constraint audit_events_entity_type_not_blank check (
    length(btrim(entity_type)) > 0 and length(entity_type) <= 80
  ),
  constraint audit_events_entity_id_not_blank check (
    length(btrim(entity_id)) > 0 and length(entity_id) <= 200
  ),
  constraint audit_events_summary_not_blank check (
    length(btrim(summary)) > 0 and length(summary) <= 500
  ),
  constraint audit_events_meta_object check (
    meta is null or jsonb_typeof(meta) = 'object'
  )
);

comment on table tlb.audit_events is
  'Append-only audit. public.audit_events is the untouched prototype. created_at is AuditEvent.at. No soft delete.';

comment on column tlb.audit_events.actor_id is
  'Profile of the actor. Nullable only for service-role rows that are not tied to a session. record_audit_event() requires auth.uid().';

create index audit_events_created_at_idx
  on tlb.audit_events (created_at);

create index audit_events_entity_idx
  on tlb.audit_events (entity_type, entity_id);

create index audit_events_actor_id_idx
  on tlb.audit_events (actor_id);

create trigger trg_audit_events_no_update
before update or delete on tlb.audit_events
for each row execute function tlb.reject_row_mutation();

create trigger trg_audit_events_no_truncate
before truncate on tlb.audit_events
for each statement execute function tlb.reject_row_mutation();

create or replace function tlb.record_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_summary text,
  p_meta jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = tlb, pg_temp
as $$
declare
  v_actor uuid;
  v_id uuid;
begin
  v_actor := auth.uid();

  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from tlb.profiles p
    where p.id = v_actor
      and p.active
  ) then
    raise exception 'active profile required'
      using errcode = '42501';
  end if;

  insert into tlb.audit_events (actor_id, action, entity_type, entity_id, summary, meta)
  values (v_actor, p_action, p_entity_type, p_entity_id, p_summary, p_meta)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function tlb.record_audit_event(text, text, text, text, jsonb) from public;

comment on function tlb.record_audit_event(text, text, text, text, jsonb) is
  'Only authenticated write path in this foundation. Inserts one audit row for auth.uid(). No update or delete.';

-- ---------------------------------------------------------------------------
-- Availability is derived, matching calcAvailable in calculations.ts.
-- in_transit and allocated are stored but not subtracted.
-- ---------------------------------------------------------------------------

create view tlb.v_inventory_availability
with (security_invoker = true) as
select
  b.product_id,
  b.warehouse_id,
  b.quantity_on_hand,
  b.quantity_reserved,
  b.quantity_damaged,
  b.quantity_expired,
  b.quantity_quarantine,
  b.quantity_in_transit,
  b.quantity_allocated,
  greatest(
    0::numeric,
    b.quantity_on_hand
      - b.quantity_reserved
      - b.quantity_damaged
      - b.quantity_expired
      - b.quantity_quarantine
  ) as quantity_available
from tlb.inventory_balances b;

comment on view tlb.v_inventory_availability is
  'Derived available quantity. security_invoker so inventory_balances RLS applies. Not a stored balance.';

-- ---------------------------------------------------------------------------
-- RLS for the tables created here. SELECT only.
-- ---------------------------------------------------------------------------

alter table tlb.document_sequences enable row level security;
alter table tlb.audit_events enable row level security;

create policy document_sequences_select
on tlb.document_sequences
for select
to authenticated
using (tlb.has_permission('settings.manage'));

create policy audit_events_select
on tlb.audit_events
for select
to authenticated
using (tlb.has_permission('audit.view'));

-- ---------------------------------------------------------------------------
-- Grants. authenticated may read through RLS. It may not write tables.
-- service_role may write, and triggers still reject ledger/audit mutation.
-- ---------------------------------------------------------------------------

revoke all on schema tlb from public;
revoke all on all tables in schema tlb from public;
revoke all on all functions in schema tlb from public;

alter default privileges in schema tlb revoke all on tables from public;
alter default privileges in schema tlb revoke all on functions from public;

do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema tlb from anon';
    execute 'revoke all on all tables in schema tlb from anon';
    execute 'revoke all on all functions in schema tlb from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant usage on schema tlb to authenticated';
    execute 'grant select on all tables in schema tlb to authenticated';
    execute 'revoke insert, update, delete on all tables in schema tlb from authenticated';
    for v_table in
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tlb'
        and c.relkind = 'r'
    loop
      execute format('revoke truncate on table tlb.%I from authenticated', v_table);
    end loop;
    execute 'revoke all on all functions in schema tlb from authenticated';

    execute 'grant execute on function tlb.is_active_profile() to authenticated';
    execute 'grant execute on function tlb.is_self(uuid) to authenticated';
    execute 'grant execute on function tlb.has_role(uuid) to authenticated';
    execute 'grant execute on function tlb.has_permission(text) to authenticated';
    execute 'grant execute on function tlb.can_access_warehouse(uuid) to authenticated';
    execute 'grant execute on function tlb.can_read_products() to authenticated';
    execute 'grant execute on function tlb.can_read_customers() to authenticated';
    execute 'grant execute on function tlb.can_read_suppliers() to authenticated';
    execute 'grant execute on function tlb.can_read_stock() to authenticated';
    execute 'grant execute on function tlb.record_audit_event(text, text, text, text, jsonb) to authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema tlb to service_role';
    execute 'grant select, insert, update, delete on all tables in schema tlb to service_role';
    execute 'grant execute on all functions in schema tlb to service_role';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deferred write policies
--
-- No INSERT, UPDATE, DELETE, or ALL policies exist on tlb tables.
-- authenticated table privileges are SELECT only. Posting stock, editing
-- masters, assigning roles, and issuing document numbers from the browser
-- are intentionally not possible yet.
--
-- Planned later, each as its own SECURITY DEFINER function with search_path
-- fixed, permission checks, and no dynamic SQL:
--
--   profiles              self-service name/email update; admin deactivate
--   roles                 custom-role create/update/soft-delete (users.manage)
--   role_permissions      custom roles only; system rows stay trigger-locked
--   user_roles            assign/remove (users.manage); first owner is service-role SQL
--   warehouses            create/update/soft-delete (stock.receive or settings.manage)
--   user_warehouse_access grant/revoke (users.manage)
--   units_of_measure      admin maintenance
--   product_categories    create/update/soft-delete
--   products              create/update/soft-delete
--   customers             create/update/soft-delete (customers.manage)
--   suppliers             create/update/soft-delete (suppliers.manage)
--   inventory_batches     create the shell (remaining 0) inside a receipt function
--   inventory_movements   post_movement() checking stock.receive/issue/adjust/transfer
--   inventory_balances    never a direct policy; projection triggers only
--   inventory_reservations reserve/release (stock.reserve) via status update
--   document_sequences    stay behind next_document_number(); no table policy
--   audit_events          stay behind record_audit_event(); no update/delete ever
--
-- Do not add a policy USING (true) or WITH CHECK (true) for authenticated.
-- Do not grant anon anything on schema tlb.
-- Schema tlb is not added to the Supabase exposed-schema list in this change.
-- ---------------------------------------------------------------------------
