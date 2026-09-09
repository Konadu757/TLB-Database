-- Customer orders / partial supply schema (Supabase-ready).
-- Apply when connecting the live data layer; the app currently uses a typed
-- local domain store with the same entity shapes.

create extension if not exists "pgcrypto";

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  unit text not null default 'ea',
  category text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_balances (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  physical_qty integer not null default 0 check (physical_qty >= 0),
  reserved_qty integer not null default 0 check (reserved_qty >= 0),
  unique (product_id, warehouse_id)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null,
  contact_name text,
  phone text,
  email text,
  address text,
  tin text,
  credit_limit numeric(14,2) not null default 0,
  payment_terms text not null default 'Net 30',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references public.customers(id),
  status text not null,
  order_date timestamptz not null default now(),
  required_date date,
  notes text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.customer_purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  ordered_qty integer not null check (ordered_qty > 0),
  supplied_qty integer not null default 0 check (supplied_qty >= 0),
  cancelled_qty integer not null default 0 check (cancelled_qty >= 0),
  reserved_qty integer not null default 0 check (reserved_qty >= 0),
  unit_price numeric(14,2) not null default 0,
  line_status text not null,
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by text,
  constraint customer_order_lines_qty_check check (supplied_qty + cancelled_qty <= ordered_qty)
);

create table if not exists public.supplies (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  order_id uuid not null references public.customer_purchase_orders(id),
  supplied_at timestamptz not null default now(),
  supplied_by text not null,
  notes text
);

create table if not exists public.supply_lines (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies(id) on delete restrict,
  order_line_id uuid not null references public.customer_order_lines(id),
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  quantity integer not null check (quantity > 0)
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

create table if not exists public.document_counters (
  id int primary key default 1 check (id = 1),
  order_seq integer not null default 0,
  supply_seq integer not null default 0,
  customer_seq integer not null default 0
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null
);

insert into public.app_settings(key, value)
values ('outstanding_ageing', '{"normalMaxDays":2,"attentionMaxDays":7}'::jsonb)
on conflict (key) do nothing;

insert into public.document_counters(id) values (1) on conflict do nothing;

-- Outstanding is calculated, never stored as source of truth:
-- outstanding = greatest(ordered_qty - supplied_qty - cancelled_qty, 0)
-- DROP first: CREATE OR REPLACE VIEW cannot remove/rename columns (42P16).
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
