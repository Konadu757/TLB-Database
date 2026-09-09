-- P2: allow app string ids (seed uses text like cus-demo) + soft-delete columns.
-- Additive only — converts uuid columns to text, does not truncate data.
-- Safe to re-run: drops dependent views first, drops FKs before recreate.

-- Views/rules block ALTER TYPE; drop before any column type changes.
drop view if exists public.v_outstanding_customer_supplies cascade;

do $$
declare
  r record;
begin
  -- Drop all FKs targeting / from P0+P1 tables so type changes can proceed.
  for r in
    select con.conname, rel.relname as table_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and con.contype = 'f'
      and rel.relname in (
        'warehouses','products','stock_balances','customers','customer_purchase_orders',
        'customer_order_lines','supplies','supply_lines','audit_events','document_counters',
        'vat_rates','invoices','invoice_lines','receipts','receipt_lines','deliveries',
        'delivery_items','payments','notifications','stock_reservations'
      )
  loop
    execute format('alter table public.%I drop constraint if exists %I', r.table_name, r.conname);
  end loop;
end $$;

-- Only alter uuid → text when the column is still uuid (re-run safe).
do $$
declare
  stmt text;
begin
  for stmt in
    select format(
      'alter table public.%I alter column %I type text using %I::text',
      c.table_name,
      c.column_name,
      c.column_name
    )
    from (
      values
        ('warehouses','id'),
        ('products','id'),
        ('stock_balances','id'),
        ('stock_balances','product_id'),
        ('stock_balances','warehouse_id'),
        ('customers','id'),
        ('customer_purchase_orders','id'),
        ('customer_purchase_orders','customer_id'),
        ('customer_order_lines','id'),
        ('customer_order_lines','order_id'),
        ('customer_order_lines','product_id'),
        ('customer_order_lines','warehouse_id'),
        ('supplies','id'),
        ('supplies','order_id'),
        ('supply_lines','id'),
        ('supply_lines','supply_id'),
        ('supply_lines','order_line_id'),
        ('supply_lines','product_id'),
        ('supply_lines','warehouse_id'),
        ('audit_events','id'),
        ('vat_rates','id'),
        ('invoices','id'),
        ('invoices','customer_id'),
        ('invoices','order_id'),
        ('invoices','supply_id'),
        ('invoices','vat_rate_id'),
        ('invoice_lines','id'),
        ('invoice_lines','invoice_id'),
        ('invoice_lines','product_id'),
        ('invoice_lines','vat_rate_id'),
        ('invoice_lines','order_line_id'),
        ('invoice_lines','supply_line_id'),
        ('receipts','id'),
        ('receipts','customer_id'),
        ('receipts','order_id'),
        ('receipts','invoice_id'),
        ('receipt_lines','id'),
        ('receipt_lines','receipt_id'),
        ('receipt_lines','product_id'),
        ('deliveries','id'),
        ('deliveries','customer_id'),
        ('deliveries','order_id'),
        ('deliveries','supply_id'),
        ('delivery_items','id'),
        ('delivery_items','delivery_id'),
        ('delivery_items','product_id'),
        ('delivery_items','supply_line_id'),
        ('delivery_items','order_line_id'),
        ('payments','id'),
        ('payments','customer_id'),
        ('payments','order_id'),
        ('payments','invoice_id'),
        ('payments','receipt_id'),
        ('notifications','id'),
        ('notifications','order_id'),
        ('notifications','product_id'),
        ('stock_reservations','id'),
        ('stock_reservations','order_line_id'),
        ('stock_reservations','product_id'),
        ('stock_reservations','warehouse_id')
    ) as c(table_name, column_name)
    join information_schema.columns ic
      on ic.table_schema = 'public'
     and ic.table_name = c.table_name
     and ic.column_name = c.column_name
     and ic.data_type = 'uuid'
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

-- Recreate FKs (drop-if-exists first so re-runs are safe)
alter table public.stock_balances drop constraint if exists stock_balances_product_id_fkey;
alter table public.stock_balances drop constraint if exists stock_balances_warehouse_id_fkey;
alter table public.stock_balances
  add constraint stock_balances_product_id_fkey foreign key (product_id) references public.products(id),
  add constraint stock_balances_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id);

alter table public.customer_purchase_orders drop constraint if exists customer_purchase_orders_customer_id_fkey;
alter table public.customer_purchase_orders
  add constraint customer_purchase_orders_customer_id_fkey foreign key (customer_id) references public.customers(id);

alter table public.customer_order_lines drop constraint if exists customer_order_lines_order_id_fkey;
alter table public.customer_order_lines drop constraint if exists customer_order_lines_product_id_fkey;
alter table public.customer_order_lines drop constraint if exists customer_order_lines_warehouse_id_fkey;
alter table public.customer_order_lines
  add constraint customer_order_lines_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id) on delete cascade,
  add constraint customer_order_lines_product_id_fkey foreign key (product_id) references public.products(id),
  add constraint customer_order_lines_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id);

alter table public.supplies drop constraint if exists supplies_order_id_fkey;
alter table public.supplies
  add constraint supplies_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id);

alter table public.supply_lines drop constraint if exists supply_lines_supply_id_fkey;
alter table public.supply_lines drop constraint if exists supply_lines_order_line_id_fkey;
alter table public.supply_lines drop constraint if exists supply_lines_product_id_fkey;
alter table public.supply_lines drop constraint if exists supply_lines_warehouse_id_fkey;
alter table public.supply_lines
  add constraint supply_lines_supply_id_fkey foreign key (supply_id) references public.supplies(id) on delete restrict,
  add constraint supply_lines_order_line_id_fkey foreign key (order_line_id) references public.customer_order_lines(id),
  add constraint supply_lines_product_id_fkey foreign key (product_id) references public.products(id),
  add constraint supply_lines_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id);

alter table public.invoices drop constraint if exists invoices_customer_id_fkey;
alter table public.invoices drop constraint if exists invoices_order_id_fkey;
alter table public.invoices drop constraint if exists invoices_supply_id_fkey;
alter table public.invoices drop constraint if exists invoices_vat_rate_id_fkey;
alter table public.invoices
  add constraint invoices_customer_id_fkey foreign key (customer_id) references public.customers(id),
  add constraint invoices_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
  add constraint invoices_supply_id_fkey foreign key (supply_id) references public.supplies(id),
  add constraint invoices_vat_rate_id_fkey foreign key (vat_rate_id) references public.vat_rates(id);

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

alter table public.receipts drop constraint if exists receipts_customer_id_fkey;
alter table public.receipts drop constraint if exists receipts_order_id_fkey;
alter table public.receipts drop constraint if exists receipts_invoice_id_fkey;
alter table public.receipts
  add constraint receipts_customer_id_fkey foreign key (customer_id) references public.customers(id),
  add constraint receipts_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
  add constraint receipts_invoice_id_fkey foreign key (invoice_id) references public.invoices(id);

alter table public.receipt_lines drop constraint if exists receipt_lines_receipt_id_fkey;
alter table public.receipt_lines drop constraint if exists receipt_lines_product_id_fkey;
alter table public.receipt_lines
  add constraint receipt_lines_receipt_id_fkey foreign key (receipt_id) references public.receipts(id) on delete restrict,
  add constraint receipt_lines_product_id_fkey foreign key (product_id) references public.products(id);

alter table public.deliveries drop constraint if exists deliveries_customer_id_fkey;
alter table public.deliveries drop constraint if exists deliveries_order_id_fkey;
alter table public.deliveries drop constraint if exists deliveries_supply_id_fkey;
alter table public.deliveries
  add constraint deliveries_customer_id_fkey foreign key (customer_id) references public.customers(id),
  add constraint deliveries_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
  add constraint deliveries_supply_id_fkey foreign key (supply_id) references public.supplies(id);

alter table public.delivery_items drop constraint if exists delivery_items_delivery_id_fkey;
alter table public.delivery_items drop constraint if exists delivery_items_product_id_fkey;
alter table public.delivery_items drop constraint if exists delivery_items_supply_line_id_fkey;
alter table public.delivery_items drop constraint if exists delivery_items_order_line_id_fkey;
alter table public.delivery_items
  add constraint delivery_items_delivery_id_fkey foreign key (delivery_id) references public.deliveries(id) on delete restrict,
  add constraint delivery_items_product_id_fkey foreign key (product_id) references public.products(id),
  add constraint delivery_items_supply_line_id_fkey foreign key (supply_line_id) references public.supply_lines(id),
  add constraint delivery_items_order_line_id_fkey foreign key (order_line_id) references public.customer_order_lines(id);

alter table public.payments drop constraint if exists payments_customer_id_fkey;
alter table public.payments drop constraint if exists payments_order_id_fkey;
alter table public.payments drop constraint if exists payments_invoice_id_fkey;
alter table public.payments drop constraint if exists payments_receipt_id_fkey;
alter table public.payments
  add constraint payments_customer_id_fkey foreign key (customer_id) references public.customers(id),
  add constraint payments_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
  add constraint payments_invoice_id_fkey foreign key (invoice_id) references public.invoices(id),
  add constraint payments_receipt_id_fkey foreign key (receipt_id) references public.receipts(id);

alter table public.notifications drop constraint if exists notifications_order_id_fkey;
alter table public.notifications drop constraint if exists notifications_product_id_fkey;
alter table public.notifications
  add constraint notifications_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
  add constraint notifications_product_id_fkey foreign key (product_id) references public.products(id);

alter table public.stock_reservations drop constraint if exists stock_reservations_order_line_id_fkey;
alter table public.stock_reservations drop constraint if exists stock_reservations_product_id_fkey;
alter table public.stock_reservations drop constraint if exists stock_reservations_warehouse_id_fkey;
alter table public.stock_reservations
  add constraint stock_reservations_order_line_id_fkey foreign key (order_line_id) references public.customer_order_lines(id),
  add constraint stock_reservations_product_id_fkey foreign key (product_id) references public.products(id),
  add constraint stock_reservations_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id);

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

-- Anon/authenticated read-write for live app (RLS not enabled on these tables).
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.v_outstanding_customer_supplies to anon, authenticated;
