-- P2: allow app string ids (seed uses text like cus-demo) + soft-delete columns.
-- Additive only — converts uuid columns to text, does not truncate data.

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

alter table if exists public.warehouses alter column id type text using id::text;
alter table if exists public.products alter column id type text using id::text;
alter table if exists public.stock_balances
  alter column id type text using id::text,
  alter column product_id type text using product_id::text,
  alter column warehouse_id type text using warehouse_id::text;
alter table if exists public.customers alter column id type text using id::text;
alter table if exists public.customer_purchase_orders
  alter column id type text using id::text,
  alter column customer_id type text using customer_id::text;
alter table if exists public.customer_order_lines
  alter column id type text using id::text,
  alter column order_id type text using order_id::text,
  alter column product_id type text using product_id::text,
  alter column warehouse_id type text using warehouse_id::text;
alter table if exists public.supplies
  alter column id type text using id::text,
  alter column order_id type text using order_id::text;
alter table if exists public.supply_lines
  alter column id type text using id::text,
  alter column supply_id type text using supply_id::text,
  alter column order_line_id type text using order_line_id::text,
  alter column product_id type text using product_id::text,
  alter column warehouse_id type text using warehouse_id::text;
alter table if exists public.audit_events alter column id type text using id::text;
alter table if exists public.vat_rates alter column id type text using id::text;
alter table if exists public.invoices
  alter column id type text using id::text,
  alter column customer_id type text using customer_id::text,
  alter column order_id type text using order_id::text,
  alter column supply_id type text using supply_id::text,
  alter column vat_rate_id type text using vat_rate_id::text;
alter table if exists public.invoice_lines
  alter column id type text using id::text,
  alter column invoice_id type text using invoice_id::text,
  alter column product_id type text using product_id::text,
  alter column vat_rate_id type text using vat_rate_id::text,
  alter column order_line_id type text using order_line_id::text,
  alter column supply_line_id type text using supply_line_id::text;
alter table if exists public.receipts
  alter column id type text using id::text,
  alter column customer_id type text using customer_id::text,
  alter column order_id type text using order_id::text,
  alter column invoice_id type text using invoice_id::text;
alter table if exists public.receipt_lines
  alter column id type text using id::text,
  alter column receipt_id type text using receipt_id::text,
  alter column product_id type text using product_id::text;
alter table if exists public.deliveries
  alter column id type text using id::text,
  alter column customer_id type text using customer_id::text,
  alter column order_id type text using order_id::text,
  alter column supply_id type text using supply_id::text;
alter table if exists public.delivery_items
  alter column id type text using id::text,
  alter column delivery_id type text using delivery_id::text,
  alter column product_id type text using product_id::text,
  alter column supply_line_id type text using supply_line_id::text,
  alter column order_line_id type text using order_line_id::text;
alter table if exists public.payments
  alter column id type text using id::text,
  alter column customer_id type text using customer_id::text,
  alter column order_id type text using order_id::text,
  alter column invoice_id type text using invoice_id::text,
  alter column receipt_id type text using receipt_id::text;
alter table if exists public.notifications
  alter column id type text using id::text,
  alter column order_id type text using order_id::text,
  alter column product_id type text using product_id::text;
alter table if exists public.stock_reservations
  alter column id type text using id::text,
  alter column order_line_id type text using order_line_id::text,
  alter column product_id type text using product_id::text,
  alter column warehouse_id type text using warehouse_id::text;

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

-- Recreate FKs
alter table public.stock_balances
  add constraint stock_balances_product_id_fkey foreign key (product_id) references public.products(id),
  add constraint stock_balances_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id);
alter table public.customer_purchase_orders
  add constraint customer_purchase_orders_customer_id_fkey foreign key (customer_id) references public.customers(id);
alter table public.customer_order_lines
  add constraint customer_order_lines_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id) on delete cascade,
  add constraint customer_order_lines_product_id_fkey foreign key (product_id) references public.products(id),
  add constraint customer_order_lines_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id);
alter table public.supplies
  add constraint supplies_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id);
alter table public.supply_lines
  add constraint supply_lines_supply_id_fkey foreign key (supply_id) references public.supplies(id) on delete restrict,
  add constraint supply_lines_order_line_id_fkey foreign key (order_line_id) references public.customer_order_lines(id),
  add constraint supply_lines_product_id_fkey foreign key (product_id) references public.products(id),
  add constraint supply_lines_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id);
alter table public.invoices
  add constraint invoices_customer_id_fkey foreign key (customer_id) references public.customers(id),
  add constraint invoices_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
  add constraint invoices_supply_id_fkey foreign key (supply_id) references public.supplies(id),
  add constraint invoices_vat_rate_id_fkey foreign key (vat_rate_id) references public.vat_rates(id);
alter table public.invoice_lines
  add constraint invoice_lines_invoice_id_fkey foreign key (invoice_id) references public.invoices(id) on delete restrict,
  add constraint invoice_lines_product_id_fkey foreign key (product_id) references public.products(id),
  add constraint invoice_lines_vat_rate_id_fkey foreign key (vat_rate_id) references public.vat_rates(id),
  add constraint invoice_lines_order_line_id_fkey foreign key (order_line_id) references public.customer_order_lines(id),
  add constraint invoice_lines_supply_line_id_fkey foreign key (supply_line_id) references public.supply_lines(id);
alter table public.receipts
  add constraint receipts_customer_id_fkey foreign key (customer_id) references public.customers(id),
  add constraint receipts_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
  add constraint receipts_invoice_id_fkey foreign key (invoice_id) references public.invoices(id);
alter table public.receipt_lines
  add constraint receipt_lines_receipt_id_fkey foreign key (receipt_id) references public.receipts(id) on delete restrict,
  add constraint receipt_lines_product_id_fkey foreign key (product_id) references public.products(id);
alter table public.deliveries
  add constraint deliveries_customer_id_fkey foreign key (customer_id) references public.customers(id),
  add constraint deliveries_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
  add constraint deliveries_supply_id_fkey foreign key (supply_id) references public.supplies(id);
alter table public.delivery_items
  add constraint delivery_items_delivery_id_fkey foreign key (delivery_id) references public.deliveries(id) on delete restrict,
  add constraint delivery_items_product_id_fkey foreign key (product_id) references public.products(id),
  add constraint delivery_items_supply_line_id_fkey foreign key (supply_line_id) references public.supply_lines(id),
  add constraint delivery_items_order_line_id_fkey foreign key (order_line_id) references public.customer_order_lines(id);
alter table public.payments
  add constraint payments_customer_id_fkey foreign key (customer_id) references public.customers(id),
  add constraint payments_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
  add constraint payments_invoice_id_fkey foreign key (invoice_id) references public.invoices(id),
  add constraint payments_receipt_id_fkey foreign key (receipt_id) references public.receipts(id);
alter table public.notifications
  add constraint notifications_order_id_fkey foreign key (order_id) references public.customer_purchase_orders(id),
  add constraint notifications_product_id_fkey foreign key (product_id) references public.products(id);
alter table public.stock_reservations
  add constraint stock_reservations_order_line_id_fkey foreign key (order_line_id) references public.customer_order_lines(id),
  add constraint stock_reservations_product_id_fkey foreign key (product_id) references public.products(id),
  add constraint stock_reservations_warehouse_id_fkey foreign key (warehouse_id) references public.warehouses(id);

-- Anon/authenticated read-write for live app (RLS not enabled on these tables).
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage on schema public to anon, authenticated;
