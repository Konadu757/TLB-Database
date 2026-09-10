-- P2: allow app string ids (seed uses text like cus-demo) + soft-delete columns.
-- Additive only — converts uuid columns to text on TLB tables only.
-- Safe to re-run. Does NOT touch unrelated public tables (e.g. experiments / RLS).

-- Views/rules block ALTER TYPE; drop before any column type changes.
drop view if exists public.v_outstanding_customer_supplies cascade;

do $$
declare
  -- Core TLB tables + optional inventory extras (converted only if they exist).
  allowlist text[] := array[
    'warehouses',
    'products',
    'stock_balances',
    'customers',
    'customer_purchase_orders',
    'customer_order_lines',
    'supplies',
    'supply_lines',
    'audit_events',
    'document_counters',
    'app_settings',
    'vat_rates',
    'invoices',
    'invoice_lines',
    'receipts',
    'receipt_lines',
    'deliveries',
    'delivery_items',
    'payments',
    'notifications',
    'stock_reservations',
    -- inventory extras (IF EXISTS via to_regclass / information_schema)
    'stock_movements',
    'batches',
    'goods_receipts',
    'goods_receipt_lines',
    'stock_issues',
    'stock_issue_lines',
    'warehouse_transfers',
    'warehouse_transfer_lines',
    'stock_adjustments',
    'stock_adjustment_lines'
  ];
  r record;
  stmt text;
begin
  -- Drop FKs only where either side is an allowlisted TLB table.
  -- Never drop constraints on unrelated tables (e.g. experiments).
  for r in
    select con.conname, rel.relname as table_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_class frel on frel.oid = con.confrelid
    join pg_namespace fnsp on fnsp.oid = frel.relnamespace
    where nsp.nspname = 'public'
      and fnsp.nspname = 'public'
      and con.contype = 'f'
      and (
        rel.relname = any (allowlist)
        or frel.relname = any (allowlist)
      )
  loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      r.table_name,
      r.conname
    );
  end loop;

  -- Convert uuid id / *_id only on allowlisted tables that exist and still have uuid cols.
  for stmt in
    select format(
      'alter table public.%I alter column %I type text using %I::text',
      c.table_name,
      c.column_name,
      c.column_name
    )
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
     and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.table_name = any (allowlist)
      and to_regclass(format('public.%I', c.table_name)) is not null
      and c.data_type = 'uuid'
      and (
        c.column_name = 'id'
        or c.column_name like '%\_id' escape '\'
      )
    order by
      case when c.column_name = 'id' then 1 else 0 end,
      c.table_name,
      c.column_name
  loop
    execute stmt;
  end loop;
end $$;

-- Soft-delete metadata (domain SoftDeleteFields)
alter table if exists public.warehouses
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text;
alter table if exists public.products
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text;
alter table if exists public.customers
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text;
alter table if exists public.customer_purchase_orders
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deleted_reason text;

-- Recreate FKs for known P0/P1 graph (drop-if-exists first so re-runs are safe)
do $$
begin
  if to_regclass('public.stock_balances') is not null then
    alter table public.stock_balances drop constraint if exists stock_balances_product_id_fkey;
    alter table public.stock_balances drop constraint if exists stock_balances_warehouse_id_fkey;
    alter table public.stock_balances
      add constraint stock_balances_product_id_fkey foreign key (product_id) references public.products(id),
      add constraint stock_balances_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id);
  end if;

  if to_regclass('public.customer_purchase_orders') is not null then
    alter table public.customer_purchase_orders drop constraint if exists customer_purchase_orders_customer_id_fkey;
    alter table public.customer_purchase_orders
      add constraint customer_purchase_orders_customer_id_fkey foreign key (customer_id) references public.customers(id);
  end if;

  if to_regclass('public.customer_order_lines') is not null then
    alter table public.customer_order_lines drop constraint if exists customer_order_lines_order_id_fkey;
    alter table public.customer_order_lines drop constraint if exists customer_order_lines_product_id_fkey;
    alter table public.customer_order_lines drop constraint if exists customer_order_lines_warehouse_id_fkey;
    alter table public.customer_order_lines
      add constraint customer_order_lines_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id) on delete cascade,
      add constraint customer_order_lines_product_id_fkey foreign key (product_id) references public.products(id),
      add constraint customer_order_lines_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id);
  end if;

  if to_regclass('public.supplies') is not null then
    alter table public.supplies drop constraint if exists supplies_order_id_fkey;
    alter table public.supplies
      add constraint supplies_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id);
  end if;

  if to_regclass('public.supply_lines') is not null then
    alter table public.supply_lines drop constraint if exists supply_lines_supply_id_fkey;
    alter table public.supply_lines drop constraint if exists supply_lines_order_line_id_fkey;
    alter table public.supply_lines drop constraint if exists supply_lines_product_id_fkey;
    alter table public.supply_lines drop constraint if exists supply_lines_warehouse_id_fkey;
    alter table public.supply_lines
      add constraint supply_lines_supply_id_fkey foreign key (supply_id) references public.supplies(id) on delete restrict,
      add constraint supply_lines_order_line_id_fkey foreign key (order_line_id) references public.customer_order_lines(id),
      add constraint supply_lines_product_id_fkey foreign key (product_id) references public.products(id),
      add constraint supply_lines_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id);
  end if;

  if to_regclass('public.invoices') is not null then
    alter table public.invoices drop constraint if exists invoices_customer_id_fkey;
    alter table public.invoices drop constraint if exists invoices_order_id_fkey;
    alter table public.invoices drop constraint if exists invoices_supply_id_fkey;
    alter table public.invoices drop constraint if exists invoices_vat_rate_id_fkey;
    alter table public.invoices
      add constraint invoices_customer_id_fkey foreign key (customer_id) references public.customers(id),
      add constraint invoices_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
      add constraint invoices_supply_id_fkey foreign key (supply_id) references public.supplies(id),
      add constraint invoices_vat_rate_id_fkey foreign key (vat_rate_id) references public.vat_rates(id);
  end if;

  if to_regclass('public.invoice_lines') is not null then
    alter table public.invoice_lines drop constraint if exists invoice_lines_invoice_id_fkey;
    alter table public.invoice_lines drop constraint if exists invoice_lines_product_id_fkey;
    alter table public.invoice_lines drop constraint if exists invoice_lines_vat_rate_id_fkey;
    alter table public.invoice_lines drop constraint if exists invoice_lines_order_line_id_fkey;
    alter table public.invoice_lines drop constraint if exists invoice_lines_supply_line_id_fkey;
    alter table public.invoice_lines
      add constraint invoice_lines_invoice_id_fkey foreign key (invoice_id) references public.invoices(id) on delete restrict,
      add constraint invoice_lines_product_id_fkey foreign key (product_id) references public.products(id),
      add constraint invoice_lines_vat_rate_id_fkey foreign key (vat_rate_id) references public.vat_rates(id),
      add constraint invoice_lines_order_line_id_fkey foreign key (order_line_id) references public.customer_order_lines(id),
      add constraint invoice_lines_supply_line_id_fkey foreign key (supply_line_id) references public.supply_lines(id);
  end if;

  if to_regclass('public.receipts') is not null then
    alter table public.receipts drop constraint if exists receipts_customer_id_fkey;
    alter table public.receipts drop constraint if exists receipts_order_id_fkey;
    alter table public.receipts drop constraint if exists receipts_invoice_id_fkey;
    alter table public.receipts
      add constraint receipts_customer_id_fkey foreign key (customer_id) references public.customers(id),
      add constraint receipts_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
      add constraint receipts_invoice_id_fkey foreign key (invoice_id) references public.invoices(id);
  end if;

  if to_regclass('public.receipt_lines') is not null then
    alter table public.receipt_lines drop constraint if exists receipt_lines_receipt_id_fkey;
    alter table public.receipt_lines drop constraint if exists receipt_lines_product_id_fkey;
    alter table public.receipt_lines
      add constraint receipt_lines_receipt_id_fkey foreign key (receipt_id) references public.receipts(id) on delete restrict,
      add constraint receipt_lines_product_id_fkey foreign key (product_id) references public.products(id);
  end if;

  if to_regclass('public.deliveries') is not null then
    alter table public.deliveries drop constraint if exists deliveries_customer_id_fkey;
    alter table public.deliveries drop constraint if exists deliveries_order_id_fkey;
    alter table public.deliveries drop constraint if exists deliveries_supply_id_fkey;
    alter table public.deliveries
      add constraint deliveries_customer_id_fkey foreign key (customer_id) references public.customers(id),
      add constraint deliveries_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
      add constraint deliveries_supply_id_fkey foreign key (supply_id) references public.supplies(id);
  end if;

  if to_regclass('public.delivery_items') is not null then
    alter table public.delivery_items drop constraint if exists delivery_items_delivery_id_fkey;
    alter table public.delivery_items drop constraint if exists delivery_items_product_id_fkey;
    alter table public.delivery_items drop constraint if exists delivery_items_supply_line_id_fkey;
    alter table public.delivery_items drop constraint if exists delivery_items_order_line_id_fkey;
    alter table public.delivery_items
      add constraint delivery_items_delivery_id_fkey foreign key (delivery_id) references public.deliveries(id) on delete restrict,
      add constraint delivery_items_product_id_fkey foreign key (product_id) references public.products(id),
      add constraint delivery_items_supply_line_id_fkey foreign key (supply_line_id) references public.supply_lines(id),
      add constraint delivery_items_order_line_id_fkey foreign key (order_line_id) references public.customer_order_lines(id);
  end if;

  if to_regclass('public.payments') is not null then
    alter table public.payments drop constraint if exists payments_customer_id_fkey;
    alter table public.payments drop constraint if exists payments_order_id_fkey;
    alter table public.payments drop constraint if exists payments_invoice_id_fkey;
    alter table public.payments drop constraint if exists payments_receipt_id_fkey;
    alter table public.payments
      add constraint payments_customer_id_fkey foreign key (customer_id) references public.customers(id),
      add constraint payments_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
      add constraint payments_invoice_id_fkey foreign key (invoice_id) references public.invoices(id),
      add constraint payments_receipt_id_fkey foreign key (receipt_id) references public.receipts(id);
  end if;

  if to_regclass('public.notifications') is not null then
    alter table public.notifications drop constraint if exists notifications_order_id_fkey;
    alter table public.notifications drop constraint if exists notifications_product_id_fkey;
    alter table public.notifications
      add constraint notifications_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
      add constraint notifications_product_id_fkey foreign key (product_id) references public.products(id);
  end if;

  if to_regclass('public.stock_reservations') is not null then
    alter table public.stock_reservations drop constraint if exists stock_reservations_order_line_id_fkey;
    alter table public.stock_reservations drop constraint if exists stock_reservations_product_id_fkey;
    alter table public.stock_reservations drop constraint if exists stock_reservations_warehouse_id_fkey;
    alter table public.stock_reservations
      add constraint stock_reservations_order_line_id_fkey foreign key (order_line_id) references public.customer_order_lines(id),
      add constraint stock_reservations_product_id_fkey foreign key (product_id) references public.products(id),
      add constraint stock_reservations_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id);
  end if;

  -- Best-effort: restore common FKs on extra inventory tables if present
  if to_regclass('public.stock_movements') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'product_id'
    ) and to_regclass('public.products') is not null then
      execute 'alter table public.stock_movements drop constraint if exists stock_movements_product_id_fkey';
      execute 'alter table public.stock_movements add constraint stock_movements_product_id_fkey foreign key (product_id) references public.products(id)';
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'warehouse_id'
    ) and to_regclass('public.warehouses') is not null then
      execute 'alter table public.stock_movements drop constraint if exists stock_movements_warehouse_id_fkey';
      execute 'alter table public.stock_movements add constraint stock_movements_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id)';
    end if;
  end if;
end $$;

-- Recreate outstanding view (canonical definition from 20260909_customer_orders.sql)
drop view if exists public.v_outstanding_customer_supplies cascade;

create view public.v_outstanding_customer_supplies as
select
  o.id as order_id,
  o.number as order_number,
  o.status as order_status,
  o.order_date,
  o.confirmed_at,
  c.id as customer_id,
  c.name as customer_name,
  l.id as line_id,
  p.id as product_id,
  p.name as product_name,
  p.sku as product_sku,
  w.id as warehouse_id,
  w.name as warehouse_name,
  l.ordered_qty,
  l.supplied_qty,
  l.cancelled_qty,
  greatest(l.ordered_qty - l.supplied_qty - l.cancelled_qty, 0) as outstanding_qty,
  l.reserved_qty,
  greatest(sb.physical_qty - sb.reserved_qty, 0) as available_qty,
  l.line_status,
  l.unit_price
from public.customer_order_lines l
join public.customer_purchase_orders o on o.id = l.order_id
join public.customers c on c.id = o.customer_id
join public.products p on p.id = l.product_id
join public.warehouses w on w.id = l.warehouse_id
left join public.stock_balances sb
  on sb.product_id = l.product_id and sb.warehouse_id = l.warehouse_id
where greatest(l.ordered_qty - l.supplied_qty - l.cancelled_qty, 0) > 0
  and o.status not in ('Draft', 'Cancelled');

-- Grants on TLB tables only (never blanket-grant all public tables).
do $$
declare
  allowlist text[] := array[
    'warehouses',
    'products',
    'stock_balances',
    'customers',
    'customer_purchase_orders',
    'customer_order_lines',
    'supplies',
    'supply_lines',
    'audit_events',
    'document_counters',
    'app_settings',
    'vat_rates',
    'invoices',
    'invoice_lines',
    'receipts',
    'receipt_lines',
    'deliveries',
    'delivery_items',
    'payments',
    'notifications',
    'stock_reservations',
    'stock_movements',
    'batches',
    'goods_receipts',
    'goods_receipt_lines',
    'stock_issues',
    'stock_issue_lines',
    'warehouse_transfers',
    'warehouse_transfer_lines',
    'stock_adjustments',
    'stock_adjustment_lines'
  ];
  t text;
begin
  execute 'grant usage on schema public to anon, authenticated';
  foreach t in array allowlist loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format(
        'grant select, insert, update, delete on table public.%I to anon, authenticated',
        t
      );
    end if;
  end loop;
end $$;

grant select on public.v_outstanding_customer_supplies to anon, authenticated;
