-- P1 documents: invoices, receipts, deliveries, payments, notifications, reservations, VAT rates
-- Additive only — does not drop or truncate existing P0 data.

alter table public.document_counters
  add column if not exists invoice_seq integer not null default 0,
  add column if not exists receipt_seq integer not null default 0,
  add column if not exists delivery_seq integer not null default 0,
  add column if not exists payment_seq integer not null default 0;

create table if not exists public.vat_rates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  rate_percent numeric(8,4) not null default 0 check (rate_percent >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references public.customers(id),
  order_id uuid not null references public.customer_purchase_orders(id),
  supply_id uuid references public.supplies(id),
  invoice_date timestamptz not null default now(),
  customer_po_number text,
  customer_tin text,
  billing_address text,
  vat_rate_id uuid references public.vat_rates(id),
  subtotal numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  payment_status text not null default 'Unpaid',
  amount_paid numeric(14,2) not null default 0,
  prepared_by text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  product_id uuid not null references public.products(id),
  description text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14,2) not null default 0,
  line_subtotal numeric(14,2) not null default 0,
  vat_rate_id uuid references public.vat_rates(id),
  vat_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,
  order_line_id uuid references public.customer_order_lines(id),
  supply_line_id uuid references public.supply_lines(id)
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references public.customers(id),
  order_id uuid references public.customer_purchase_orders(id),
  invoice_id uuid references public.invoices(id),
  receipt_date timestamptz not null default now(),
  payment_method text not null,
  amount numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,
  processed_by text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete restrict,
  product_id uuid references public.products(id),
  description text not null,
  quantity integer not null default 1,
  unit_price numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0
);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references public.customers(id),
  order_id uuid not null references public.customer_purchase_orders(id),
  supply_id uuid not null references public.supplies(id),
  delivery_date timestamptz not null default now(),
  address text not null,
  method text not null,
  vehicle text,
  driver text,
  receiver_name text,
  receiver_contact text,
  status text not null,
  confirmed_at timestamptz,
  confirmed_by text,
  notes text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.delivery_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete restrict,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  supply_line_id uuid references public.supply_lines(id),
  order_line_id uuid references public.customer_order_lines(id)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references public.customers(id),
  order_id uuid references public.customer_purchase_orders(id),
  invoice_id uuid references public.invoices(id),
  receipt_id uuid references public.receipts(id),
  payment_date timestamptz not null default now(),
  method text not null,
  amount numeric(14,2) not null check (amount > 0),
  reference text,
  recorded_by text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  body text not null,
  order_id uuid references public.customer_purchase_orders(id),
  product_id uuid references public.products(id),
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references public.customer_order_lines(id),
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  quantity integer not null check (quantity > 0),
  reserved_at timestamptz not null default now(),
  reserved_by text not null,
  expires_at timestamptz,
  released_at timestamptz,
  release_reason text
);

alter table public.customer_purchase_orders
  add column if not exists customer_po_number text;

insert into public.app_settings(key, value)
values
  ('company_profile', '{"legalName":"TLB Enterprise Limited","tradingName":"TLB Enterprise","address":"Industrial Area, Tema, Ghana","phone":"+233 30 200 0000","email":"accounts@tlb.gh"}'::jsonb),
  ('outstanding_ageing', '{"normalMaxDays":2,"attentionMaxDays":7,"extendedUnfulfilledDays":14,"expectedApproachingDays":2}'::jsonb)
on conflict (key) do nothing;

-- Audit events are insert-only; revoke deletes for authenticated roles when RLS is enabled.
-- create policy audit_no_delete on public.audit_events for delete using (false);
