-- Permission-checked stock posting and document numbers for authenticated users.
-- Forward-only. Does not change 20260928_100001 through 20260928_100004.
--
-- There is still no INSERT policy on tlb.inventory_movements. The only write
-- path is tlb.post_movement(), which inserts one ledger row. Existing
-- triggers project inventory_balances and batch quantity_remaining.
--
-- The Data API exposes schema public, not tlb. Authenticated clients call:
--   POST /rest/v1/rpc/post_movement
--   POST /rest/v1/rpc/issue_document_number
-- Those are the only new functions granted to authenticated.
-- The client does not pass the next integer or qty_before / qty_after.

-- ---------------------------------------------------------------------------
-- Ledger post
-- ---------------------------------------------------------------------------

create or replace function tlb.post_movement(
  p_movement_type text,
  p_product_id uuid,
  p_warehouse_id uuid,
  p_quantity numeric,
  p_batch_id uuid default null,
  p_reason text default null,
  p_reference_type text default null,
  p_reference_id text default null,
  p_reference_number text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = tlb, pg_temp
as $$
declare
  v_actor uuid;
  v_type text;
  v_direction smallint;
  v_permission text;
  v_qty numeric(18, 4);
  v_before numeric(18, 4);
  v_after numeric(18, 4);
  v_number text;
  v_row tlb.inventory_movements;
begin
  v_actor := auth.uid();

  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if not tlb.is_active_profile() then
    raise exception 'active profile required'
      using errcode = '42501';
  end if;

  v_type := lower(btrim(coalesce(p_movement_type, '')));

  v_direction := case v_type
    when 'opening' then 1
    when 'grn' then 1
    when 'transfer_in' then 1
    when 'adjustment_plus' then 1
    when 'return_customer' then 1
    when 'production' then 1
    when 'issue' then -1
    when 'transfer_out' then -1
    when 'adjustment_minus' then -1
    when 'return_supplier' then -1
    when 'damage' then -1
    when 'expiry' then -1
    when 'sample' then -1
    when 'supply' then -1
    else null
  end;

  if v_direction is null then
    raise exception 'bad movement direction for type %', p_movement_type
      using errcode = '22023';
  end if;

  v_qty := p_quantity;
  if v_qty is null or v_qty <= 0 then
    raise exception 'movement quantity must be greater than zero'
      using errcode = '23514';
  end if;

  v_permission := case
    when v_type in ('opening', 'grn', 'return_customer', 'production') then 'stock.receive'
    when v_type in ('issue', 'return_supplier', 'damage', 'expiry', 'sample', 'supply') then 'stock.issue'
    when v_type in ('transfer_in', 'transfer_out') then 'stock.transfer'
    when v_type in ('adjustment_plus', 'adjustment_minus') then 'stock.adjust'
    else null
  end;

  if v_permission is null or not tlb.has_permission(v_permission) then
    raise exception 'missing permission %', coalesce(v_permission, 'stock')
      using errcode = '42501';
  end if;

  if not tlb.can_access_warehouse(p_warehouse_id) then
    raise exception 'warehouse access required'
      using errcode = '42501';
  end if;

  insert into tlb.inventory_balances (product_id, warehouse_id)
  values (p_product_id, p_warehouse_id)
  on conflict (product_id, warehouse_id) do nothing;

  select b.quantity_on_hand
    into v_before
  from tlb.inventory_balances b
  where b.product_id = p_product_id
    and b.warehouse_id = p_warehouse_id
  for update;

  if v_before is null then
    raise exception 'inventory balance row missing'
      using errcode = '55000';
  end if;

  v_after := v_before + (v_direction::numeric * v_qty);

  if v_after < 0 then
    raise exception 'movement would make on-hand negative'
      using errcode = '23514';
  end if;

  -- Number is allocated here. Callers cannot pass the next integer.
  v_number := tlb.next_document_number('MV');

  insert into tlb.inventory_movements (
    movement_number,
    movement_type,
    direction,
    quantity,
    product_id,
    warehouse_id,
    batch_id,
    qty_before,
    qty_after,
    reason,
    reference_type,
    reference_id,
    reference_number,
    notes,
    actor_id
  ) values (
    v_number,
    v_type,
    v_direction,
    v_qty,
    p_product_id,
    p_warehouse_id,
    p_batch_id,
    v_before,
    v_after,
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_reference_type, '')), ''),
    nullif(btrim(coalesce(p_reference_id, '')), ''),
    nullif(btrim(coalesce(p_reference_number, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_actor
  )
  returning * into v_row;

  return to_jsonb(v_row) || jsonb_build_object(
    'signed_qty', v_direction::numeric * v_qty
  );
end;
$$;

revoke all on function tlb.post_movement(
  text, uuid, uuid, numeric, uuid, text, text, text, text, text
) from public;

comment on function tlb.post_movement(
  text, uuid, uuid, numeric, uuid, text, text, text, text, text
) is
  'Inserts one inventory movement for the current active profile. Checks stock permission and warehouse access. Rejects unknown direction, zero quantity, and negative on-hand. Allocates movement_number via next_document_number. Not granted to authenticated; call public.post_movement.';

-- ---------------------------------------------------------------------------
-- Document numbers
-- ---------------------------------------------------------------------------

create or replace function tlb.issue_document_number(p_document_type text)
returns text
language plpgsql
security definer
set search_path = tlb, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if not tlb.is_active_profile() then
    raise exception 'active profile required'
      using errcode = '42501';
  end if;

  if p_document_type is null or length(btrim(p_document_type)) = 0 then
    raise exception 'document type is required'
      using errcode = '22023';
  end if;

  -- Year and the next integer stay inside next_document_number.
  return tlb.next_document_number(p_document_type);
end;
$$;

revoke all on function tlb.issue_document_number(text) from public;

comment on function tlb.issue_document_number(text) is
  'Issues one document number for the current active profile. The client passes a document type only, never the next integer. Not granted to authenticated; call public.issue_document_number.';

-- ---------------------------------------------------------------------------
-- public wrappers. These are the Data API RPC names.
-- ---------------------------------------------------------------------------

create or replace function public.post_movement(
  p_movement_type text,
  p_product_id uuid,
  p_warehouse_id uuid,
  p_quantity numeric,
  p_batch_id uuid default null,
  p_reason text default null,
  p_reference_type text default null,
  p_reference_id text default null,
  p_reference_number text default null,
  p_notes text default null
)
returns jsonb
language sql
security definer
set search_path = tlb, pg_temp
as $$
  select tlb.post_movement(
    p_movement_type,
    p_product_id,
    p_warehouse_id,
    p_quantity,
    p_batch_id,
    p_reason,
    p_reference_type,
    p_reference_id,
    p_reference_number,
    p_notes
  );
$$;

revoke all on function public.post_movement(
  text, uuid, uuid, numeric, uuid, text, text, text, text, text
) from public;

comment on function public.post_movement(
  text, uuid, uuid, numeric, uuid, text, text, text, text, text
) is
  'Data API RPC post_movement. Thin SECURITY DEFINER wrapper around tlb.post_movement. Granted to authenticated only.';

create or replace function public.issue_document_number(p_document_type text)
returns text
language sql
security definer
set search_path = tlb, pg_temp
as $$
  select tlb.issue_document_number(p_document_type);
$$;

revoke all on function public.issue_document_number(text) from public;

comment on function public.issue_document_number(text) is
  'Data API RPC issue_document_number. Thin SECURITY DEFINER wrapper around tlb.issue_document_number. Granted to authenticated only.';

-- Read path for the Data API. security_invoker so tlb SELECT policies apply.
-- No insert, update, or delete grant.

create or replace view public.tlb_inventory_movements
with (security_invoker = true) as
select
  id,
  movement_number,
  movement_type,
  direction,
  quantity,
  product_id,
  warehouse_id,
  batch_id,
  qty_before,
  qty_after,
  reason,
  reference_type,
  reference_id,
  reference_number,
  notes,
  actor_id,
  created_at
from tlb.inventory_movements;

comment on view public.tlb_inventory_movements is
  'Authenticated read of tlb.inventory_movements. security_invoker. Writes stay on public.post_movement.';

create or replace view public.tlb_inventory_balances
with (security_invoker = true) as
select
  product_id,
  warehouse_id,
  quantity_on_hand,
  quantity_reserved,
  quantity_damaged,
  quantity_expired,
  quantity_quarantine,
  quantity_in_transit,
  quantity_allocated,
  created_at,
  updated_at
from tlb.inventory_balances;

comment on view public.tlb_inventory_balances is
  'Authenticated read of tlb.inventory_balances. security_invoker. Quantities stay a projection of movements.';

revoke all on table public.tlb_inventory_movements from public;
revoke all on table public.tlb_inventory_balances from public;

-- The wrapper owner must be able to execute the tlb functions after PUBLIC
-- execute is revoked. authenticated is not granted those tlb functions.
do $$
begin
  execute format(
    'grant execute on function tlb.post_movement(text, uuid, uuid, numeric, uuid, text, text, text, text, text) to %I',
    current_user
  );
  execute format(
    'grant execute on function tlb.issue_document_number(text) to %I',
    current_user
  );
  execute format(
    'grant execute on function tlb.next_document_number(text, integer) to %I',
    current_user
  );
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function tlb.post_movement(text, uuid, uuid, numeric, uuid, text, text, text, text, text) from anon';
    execute 'revoke all on function tlb.issue_document_number(text) from anon';
    execute 'revoke all on function public.post_movement(text, uuid, uuid, numeric, uuid, text, text, text, text, text) from anon';
    execute 'revoke all on function public.issue_document_number(text) from anon';
    execute 'revoke all on table public.tlb_inventory_movements from anon';
    execute 'revoke all on table public.tlb_inventory_balances from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function tlb.post_movement(text, uuid, uuid, numeric, uuid, text, text, text, text, text) from authenticated';
    execute 'revoke all on function tlb.issue_document_number(text) from authenticated';
    execute 'revoke all on function tlb.next_document_number(text, integer) from authenticated';

    execute 'grant execute on function public.post_movement(text, uuid, uuid, numeric, uuid, text, text, text, text, text) to authenticated';
    execute 'grant execute on function public.issue_document_number(text) to authenticated';
    execute 'grant select on table public.tlb_inventory_movements to authenticated';
    execute 'grant select on table public.tlb_inventory_balances to authenticated';
  end if;
end;
$$;
