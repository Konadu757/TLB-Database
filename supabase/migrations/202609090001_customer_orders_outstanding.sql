-- TLB Enterprise — customer order & outstanding supply schema
-- Prefer applying via Supabase migrations when backend is connected.
-- The app currently uses a typed local domain store that mirrors these tables.

create extension if not exists "pgcrypto";

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  unit text not null default 'unit',
  category text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_balances (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  quantity_on_hand numeric(18,4) not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved numeric(18,4) not null default 0 check (quantity_reserved >= 0),
  unique (product_id, warehouse_id)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null,
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  tin text,
  credit_limit numeric(18,2) not null default 0,
  payment_terms text not null default 'Net 30',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Distinct from supplier procurement POs
create table if not exists public.customer_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references public.customers(id),
  warehouse_id uuid not null references public.warehouses(id),
  status text not null,
  order_date date not null default current_date,
  required_date date,
  notes text not null default '',
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.customer_purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  quantity_ordered numeric(18,4) not null check (quantity_ordered > 0),
  quantity_supplied numeric(18,4) not null default 0 check (quantity_supplied >= 0),
  quantity_cancelled numeric(18,4) not null default 0 check (quantity_cancelled >= 0),
  quantity_reserved numeric(18,4) not null default 0 check (quantity_reserved >= 0),
  unit_price numeric(18,2) not null default 0,
  line_status text not null,
  notes text,
  constraint outstanding_non_negative check (
    quantity_ordered - quantity_supplied - quantity_cancelled >= 0
  )
);

create table if not exists public.supply_records (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  order_id uuid not null references public.customer_purchase_orders(id),
  warehouse_id uuid not null references public.warehouses(id),
  supplied_at timestamptz not null default now(),
  supplied_by text not null,
  notes text not null default ''
);

create table if not exists public.supply_record_lines (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supply_records(id) on delete cascade,
  order_line_id uuid not null references public.customer_purchase_order_lines(id),
  product_id uuid not null references public.products(id),
  quantity numeric(18,4) not null check (quantity > 0)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  summary text not null,
  meta jsonb
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null
);

insert into public.app_settings (key, value)
values ('outstanding_ageing', '{"normalMaxDays":2,"attentionMaxDays":7}'::jsonb)
on conflict (key) do nothing;

create or replace view public.v_outstanding_customer_supplies as
select
  l.id as order_line_id,
  o.id as order_id,
  o.number as order_number,
  c.id as customer_id,
  c.name as customer_name,
  p.id as product_id,
  p.name as product_name,
  p.sku as product_sku,
  w.id as warehouse_id,
  w.name as warehouse_name,
  l.quantity_ordered,
  l.quantity_supplied,
  l.quantity_cancelled,
  greatest(l.quantity_ordered - l.quantity_supplied - l.quantity_cancelled, 0) as quantity_outstanding,
  l.quantity_reserved,
  l.line_status,
  o.status as order_status,
  o.order_date
from public.customer_purchase_order_lines l
join public.customer_purchase_orders o on o.id = l.order_id
join public.customers c on c.id = o.customer_id
join public.products p on p.id = l.product_id
join public.warehouses w on w.id = l.warehouse_id
where greatest(l.quantity_ordered - l.quantity_supplied - l.quantity_cancelled, 0) > 0
  and o.status not in ('Cancelled', 'Draft');
