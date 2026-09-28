-- Canonical inventory ledger.
-- inventory_movements is append-only. inventory_balances and batch
-- quantity_remaining are projections maintained by triggers.
-- Reservation and release are not ledger rows; they live on
-- inventory_reservations. postStockMovement in the frontend also skips
-- physical updates for those two types.

-- ---------------------------------------------------------------------------
-- Batches
-- ---------------------------------------------------------------------------

create table tlb.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  batch_number text not null,
  product_id uuid not null references tlb.products (id) on delete restrict,
  warehouse_id uuid not null references tlb.warehouses (id) on delete restrict,
  supplier_id uuid references tlb.suppliers (id) on delete restrict,
  quantity_received numeric(18, 4) not null,
  quantity_remaining numeric(18, 4) not null,
  unit_cost numeric(18, 2) not null default 0,
  manufactured_at date,
  expires_at date,
  received_at timestamptz not null,
  status text not null default 'Open',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_batches_batch_number_unique unique (batch_number),
  constraint inventory_batches_batch_number_not_blank check (length(btrim(batch_number)) > 0),
  constraint inventory_batches_received_positive check (quantity_received > 0),
  constraint inventory_batches_remaining_nonnegative check (quantity_remaining >= 0),
  constraint inventory_batches_remaining_lte_received check (
    quantity_remaining <= quantity_received
  ),
  constraint inventory_batches_unit_cost_nonnegative check (unit_cost >= 0),
  constraint inventory_batches_status_chk check (
    status in ('Open', 'Closed', 'Quarantine', 'Expired', 'Damaged')
  )
);

comment on table tlb.inventory_batches is
  'Lot record. quantity_remaining is a projection of movements that name the batch. No soft delete.';

comment on column tlb.inventory_batches.expires_at is
  'Calendar date used by a future FEFO picker. Null means no expiry.';

comment on column tlb.inventory_batches.quantity_remaining is
  'Insert at 0, then post an inbound movement. Direct updates are rejected.';

create index inventory_batches_product_warehouse_idx
  on tlb.inventory_batches (product_id, warehouse_id);

create index inventory_batches_expiry_idx
  on tlb.inventory_batches (product_id, warehouse_id, expires_at, received_at)
  where status = 'Open' and quantity_remaining > 0;

create index inventory_batches_received_idx
  on tlb.inventory_batches (product_id, warehouse_id, received_at);

-- ---------------------------------------------------------------------------
-- Balances (projection)
-- ---------------------------------------------------------------------------

create table tlb.inventory_balances (
  product_id uuid not null references tlb.products (id) on delete restrict,
  warehouse_id uuid not null references tlb.warehouses (id) on delete restrict,
  quantity_on_hand numeric(18, 4) not null default 0,
  quantity_reserved numeric(18, 4) not null default 0,
  quantity_damaged numeric(18, 4) not null default 0,
  quantity_expired numeric(18, 4) not null default 0,
  quantity_quarantine numeric(18, 4) not null default 0,
  quantity_in_transit numeric(18, 4) not null default 0,
  quantity_allocated numeric(18, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, warehouse_id),
  constraint inventory_balances_on_hand_nonnegative check (quantity_on_hand >= 0),
  constraint inventory_balances_reserved_nonnegative check (quantity_reserved >= 0),
  constraint inventory_balances_damaged_nonnegative check (quantity_damaged >= 0),
  constraint inventory_balances_expired_nonnegative check (quantity_expired >= 0),
  constraint inventory_balances_quarantine_nonnegative check (quantity_quarantine >= 0),
  constraint inventory_balances_in_transit_nonnegative check (quantity_in_transit >= 0),
  constraint inventory_balances_allocated_nonnegative check (quantity_allocated >= 0),
  constraint inventory_balances_unavailable_within_on_hand check (
    quantity_reserved + quantity_damaged + quantity_expired + quantity_quarantine
      <= quantity_on_hand
  )
);

comment on table tlb.inventory_balances is
  'Projection. Composite primary key. quantity_on_hand follows movements. quantity_reserved follows active reservations. No surrogate id.';

-- ---------------------------------------------------------------------------
-- Movements (immutable ledger)
-- ---------------------------------------------------------------------------

create table tlb.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_number text not null,
  movement_type text not null,
  direction smallint not null,
  quantity numeric(18, 4) not null,
  product_id uuid not null references tlb.products (id) on delete restrict,
  warehouse_id uuid not null references tlb.warehouses (id) on delete restrict,
  batch_id uuid references tlb.inventory_batches (id) on delete restrict,
  qty_before numeric(18, 4) not null,
  qty_after numeric(18, 4) not null,
  reason text,
  reference_type text,
  reference_id text,
  reference_number text,
  notes text,
  actor_id uuid references tlb.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint inventory_movements_number_unique unique (movement_number),
  constraint inventory_movements_number_not_blank check (length(btrim(movement_number)) > 0),
  constraint inventory_movements_direction_chk check (direction in (-1, 1)),
  constraint inventory_movements_quantity_positive check (quantity > 0),
  constraint inventory_movements_qty_before_nonnegative check (qty_before >= 0),
  constraint inventory_movements_qty_after_nonnegative check (qty_after >= 0),
  constraint inventory_movements_qty_chain_chk check (
    qty_after = qty_before + (direction::numeric * quantity)
  ),
  constraint inventory_movements_type_chk check (
    movement_type in (
      'opening',
      'grn',
      'issue',
      'transfer_out',
      'transfer_in',
      'adjustment_plus',
      'adjustment_minus',
      'return_customer',
      'return_supplier',
      'damage',
      'expiry',
      'production',
      'sample',
      'supply'
    )
  ),
  constraint inventory_movements_direction_matches_type check (
    (
      direction = 1
      and movement_type in (
        'opening', 'grn', 'transfer_in', 'adjustment_plus', 'return_customer', 'production'
      )
    )
    or (
      direction = -1
      and movement_type in (
        'issue', 'transfer_out', 'adjustment_minus', 'return_supplier',
        'damage', 'expiry', 'sample', 'supply'
      )
    )
  )
);

comment on table tlb.inventory_movements is
  'Append-only physical ledger. direction is -1 or 1 and quantity is always positive. No updated_at and no soft delete.';

comment on column tlb.inventory_movements.direction is
  '1 inbound, -1 outbound. Signed quantity is direction * quantity and is not stored.';

comment on column tlb.inventory_movements.qty_before is
  'On-hand immediately before this row. The projection trigger rejects a value that does not match the balance.';

create index inventory_movements_product_warehouse_at_idx
  on tlb.inventory_movements (product_id, warehouse_id, created_at);

create index inventory_movements_batch_id_idx
  on tlb.inventory_movements (batch_id)
  where batch_id is not null;

create index inventory_movements_created_at_idx
  on tlb.inventory_movements (created_at);

-- ---------------------------------------------------------------------------
-- Reservations
-- ---------------------------------------------------------------------------

create table tlb.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references tlb.products (id) on delete restrict,
  warehouse_id uuid not null references tlb.warehouses (id) on delete restrict,
  batch_id uuid references tlb.inventory_batches (id) on delete restrict,
  quantity numeric(18, 4) not null,
  status text not null default 'active',
  reference_type text,
  reference_id text,
  reserved_at timestamptz not null default now(),
  reserved_by uuid references tlb.profiles (id) on delete restrict,
  expires_at timestamptz,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_reservations_quantity_positive check (quantity > 0),
  constraint inventory_reservations_status_chk check (
    status in ('active', 'released', 'consumed', 'expired')
  ),
  constraint inventory_reservations_active_shape check (
    status <> 'active' or released_at is null
  )
);

comment on table tlb.inventory_reservations is
  'Stock holds. Not a ledger row and not tied to sales orders yet. reference_type/reference_id are the future link. No hard delete.';

create index inventory_reservations_active_idx
  on tlb.inventory_reservations (product_id, warehouse_id)
  where status = 'active';

create index inventory_reservations_batch_id_idx
  on tlb.inventory_reservations (batch_id)
  where batch_id is not null;

-- ---------------------------------------------------------------------------
-- Projection triggers
-- ---------------------------------------------------------------------------

create or replace function tlb.guard_inventory_balance()
returns trigger
language plpgsql
set search_path = tlb, pg_temp
as $$
begin
  if current_setting('tlb.inventory_projection', true) = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.quantity_on_hand = 0
       and new.quantity_reserved = 0
       and new.quantity_damaged = 0
       and new.quantity_expired = 0
       and new.quantity_quarantine = 0
       and new.quantity_in_transit = 0
       and new.quantity_allocated = 0 then
      return new;
    end if;
    raise exception 'inventory_balances is a projection and cannot be inserted directly'
      using errcode = '42501';
  end if;

  if new.quantity_on_hand is distinct from old.quantity_on_hand
     or new.quantity_reserved is distinct from old.quantity_reserved
     or new.quantity_damaged is distinct from old.quantity_damaged
     or new.quantity_expired is distinct from old.quantity_expired
     or new.quantity_quarantine is distinct from old.quantity_quarantine
     or new.quantity_in_transit is distinct from old.quantity_in_transit
     or new.quantity_allocated is distinct from old.quantity_allocated
     or new.product_id is distinct from old.product_id
     or new.warehouse_id is distinct from old.warehouse_id then
    raise exception 'inventory_balances quantities are projections and cannot be updated directly'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function tlb.guard_inventory_balance() from public;

create or replace function tlb.guard_inventory_batch_qty()
returns trigger
language plpgsql
set search_path = tlb, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.quantity_received is distinct from old.quantity_received then
      raise exception 'quantity_received is immutable'
        using errcode = '42501';
    end if;
    if new.quantity_remaining is distinct from old.quantity_remaining
       and current_setting('tlb.inventory_projection', true) is distinct from 'on' then
      raise exception 'quantity_remaining is a projection of inventory movements'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- INSERT: let the CHECK constraints report remaining < 0 or remaining > received.
  if new.quantity_remaining <> 0
     and current_setting('tlb.inventory_projection', true) is distinct from 'on'
     and new.quantity_remaining >= 0
     and new.quantity_remaining <= new.quantity_received then
    raise exception 'insert inventory batches with quantity_remaining = 0; post a movement to receive stock'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function tlb.guard_inventory_batch_qty() from public;

create or replace function tlb.reject_row_mutation()
returns trigger
language plpgsql
set search_path = tlb, pg_temp
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = '55000';
end;
$$;

revoke all on function tlb.reject_row_mutation() from public;

create or replace function tlb.apply_inventory_movement()
returns trigger
language plpgsql
set search_path = tlb, pg_temp
as $$
declare
  v_before numeric(18, 4);
  v_after numeric(18, 4);
  v_remaining numeric(18, 4);
  v_received numeric(18, 4);
  v_status text;
  v_product uuid;
  v_warehouse uuid;
begin
  perform set_config('tlb.inventory_projection', 'on', true);

  insert into tlb.inventory_balances (product_id, warehouse_id)
  values (new.product_id, new.warehouse_id)
  on conflict (product_id, warehouse_id) do nothing;

  select b.quantity_on_hand
    into v_before
  from tlb.inventory_balances b
  where b.product_id = new.product_id
    and b.warehouse_id = new.warehouse_id
  for update;

  if v_before is null then
    raise exception 'inventory balance row missing'
      using errcode = '55000';
  end if;

  if new.qty_before <> v_before then
    raise exception 'qty_before % does not match on-hand %', new.qty_before, v_before
      using errcode = '23514';
  end if;

  v_after := v_before + (new.direction::numeric * new.quantity);

  if new.qty_after <> v_after then
    raise exception 'qty_after % does not match projected %', new.qty_after, v_after
      using errcode = '23514';
  end if;

  if v_after < 0 then
    raise exception 'movement would make on-hand negative'
      using errcode = '23514';
  end if;

  update tlb.inventory_balances
     set quantity_on_hand = v_after
   where product_id = new.product_id
     and warehouse_id = new.warehouse_id;

  if new.batch_id is not null then
    select product_id, warehouse_id, quantity_remaining, quantity_received, status
      into v_product, v_warehouse, v_remaining, v_received, v_status
    from tlb.inventory_batches
    where id = new.batch_id
    for update;

    if not found then
      raise exception 'inventory batch % not found', new.batch_id
        using errcode = '23503';
    end if;

    if v_product <> new.product_id or v_warehouse <> new.warehouse_id then
      raise exception 'inventory batch does not match movement product and warehouse'
        using errcode = '23514';
    end if;

    v_remaining := v_remaining + (new.direction::numeric * new.quantity);

    if v_remaining < 0 or v_remaining > v_received then
      raise exception 'batch remaining quantity would leave the allowed range'
        using errcode = '23514';
    end if;

    if v_remaining = 0 and v_status = 'Open' then
      v_status := 'Closed';
    elsif v_remaining > 0 and v_status = 'Closed' then
      v_status := 'Open';
    end if;

    update tlb.inventory_batches
       set quantity_remaining = v_remaining,
           status = v_status
     where id = new.batch_id;
  end if;

  perform set_config('tlb.inventory_projection', 'off', true);
  return null;
end;
$$;

revoke all on function tlb.apply_inventory_movement() from public;

create or replace function tlb.recompute_quantity_reserved(
  p_product_id uuid,
  p_warehouse_id uuid
)
returns void
language plpgsql
set search_path = tlb, pg_temp
as $$
declare
  v_reserved numeric(18, 4);
  v_on_hand numeric(18, 4);
  v_unavailable numeric(18, 4);
begin
  perform set_config('tlb.inventory_projection', 'on', true);

  insert into tlb.inventory_balances (product_id, warehouse_id)
  values (p_product_id, p_warehouse_id)
  on conflict (product_id, warehouse_id) do nothing;

  select b.quantity_on_hand,
         b.quantity_damaged + b.quantity_expired + b.quantity_quarantine
    into v_on_hand, v_unavailable
  from tlb.inventory_balances b
  where b.product_id = p_product_id
    and b.warehouse_id = p_warehouse_id
  for update;

  select coalesce(sum(r.quantity), 0)
    into v_reserved
  from tlb.inventory_reservations r
  where r.product_id = p_product_id
    and r.warehouse_id = p_warehouse_id
    and r.status = 'active';

  if v_reserved + v_unavailable > v_on_hand then
    raise exception 'reservation exceeds available stock'
      using errcode = '23514';
  end if;

  update tlb.inventory_balances
     set quantity_reserved = v_reserved
   where product_id = p_product_id
     and warehouse_id = p_warehouse_id;

  perform set_config('tlb.inventory_projection', 'off', true);
end;
$$;

revoke all on function tlb.recompute_quantity_reserved(uuid, uuid) from public;

create or replace function tlb.sync_reservation_projection()
returns trigger
language plpgsql
set search_path = tlb, pg_temp
as $$
begin
  perform tlb.recompute_quantity_reserved(new.product_id, new.warehouse_id);

  if tg_op = 'UPDATE'
     and (old.product_id <> new.product_id or old.warehouse_id <> new.warehouse_id) then
    perform tlb.recompute_quantity_reserved(old.product_id, old.warehouse_id);
  end if;

  return null;
end;
$$;

revoke all on function tlb.sync_reservation_projection() from public;

create trigger trg_inventory_batches_set_updated_at
before update on tlb.inventory_batches
for each row execute function tlb.set_updated_at();

create trigger trg_inventory_batches_guard_qty
before insert or update on tlb.inventory_batches
for each row execute function tlb.guard_inventory_batch_qty();

create trigger trg_inventory_balances_set_updated_at
before update on tlb.inventory_balances
for each row execute function tlb.set_updated_at();

create trigger trg_inventory_balances_guard
before insert or update on tlb.inventory_balances
for each row execute function tlb.guard_inventory_balance();

create trigger trg_inventory_movements_immutable
before update or delete on tlb.inventory_movements
for each row execute function tlb.reject_row_mutation();

create trigger trg_inventory_movements_no_truncate
before truncate on tlb.inventory_movements
for each statement execute function tlb.reject_row_mutation();

create trigger trg_inventory_movements_apply
after insert on tlb.inventory_movements
for each row execute function tlb.apply_inventory_movement();

create trigger trg_inventory_reservations_set_updated_at
before update on tlb.inventory_reservations
for each row execute function tlb.set_updated_at();

create trigger trg_inventory_reservations_no_delete
before delete on tlb.inventory_reservations
for each row execute function tlb.reject_row_mutation();

create trigger trg_inventory_reservations_no_truncate
before truncate on tlb.inventory_reservations
for each statement execute function tlb.reject_row_mutation();

create trigger trg_inventory_reservations_sync
after insert or update on tlb.inventory_reservations
for each row execute function tlb.sync_reservation_projection();

-- ---------------------------------------------------------------------------
-- RLS: SELECT only, warehouse-scoped
-- ---------------------------------------------------------------------------

create or replace function tlb.can_read_stock()
returns boolean
language plpgsql
stable
security definer
set search_path = tlb, pg_temp
as $$
begin
  return tlb.has_permission('stock.view');
end;
$$;

revoke all on function tlb.can_read_stock() from public;

alter table tlb.inventory_batches enable row level security;
alter table tlb.inventory_balances enable row level security;
alter table tlb.inventory_movements enable row level security;
alter table tlb.inventory_reservations enable row level security;

create policy inventory_batches_select
on tlb.inventory_batches
for select
to authenticated
using (
  tlb.can_read_stock()
  and tlb.can_access_warehouse(warehouse_id)
);

create policy inventory_balances_select
on tlb.inventory_balances
for select
to authenticated
using (
  tlb.can_read_stock()
  and tlb.can_access_warehouse(warehouse_id)
);

create policy inventory_movements_select
on tlb.inventory_movements
for select
to authenticated
using (
  tlb.can_read_stock()
  and tlb.can_access_warehouse(warehouse_id)
);

create policy inventory_reservations_select
on tlb.inventory_reservations
for select
to authenticated
using (
  tlb.can_read_stock()
  and tlb.can_access_warehouse(warehouse_id)
);
