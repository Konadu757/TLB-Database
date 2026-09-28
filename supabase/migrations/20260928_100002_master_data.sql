-- Canonical master data: units, categories, suppliers, products, customers.
-- Suppliers are created before products so preferred_supplier_id can be a
-- real foreign key on the initial products table.
-- Prototype public.products and public.customers are not altered.

-- ---------------------------------------------------------------------------
-- Read helpers used by RLS policies in this migration
-- ---------------------------------------------------------------------------

create or replace function tlb.can_read_products()
returns boolean
language plpgsql
stable
security definer
set search_path = tlb, pg_temp
as $$
begin
  return tlb.has_permission('stock.view')
    or tlb.has_permission('stock.receive')
    or tlb.has_permission('orders.create')
    or tlb.has_permission('quotations.view')
    or tlb.has_permission('supply.create');
end;
$$;

create or replace function tlb.can_read_customers()
returns boolean
language plpgsql
stable
security definer
set search_path = tlb, pg_temp
as $$
begin
  return tlb.has_permission('customers.manage');
end;
$$;

create or replace function tlb.can_read_suppliers()
returns boolean
language plpgsql
stable
security definer
set search_path = tlb, pg_temp
as $$
begin
  return tlb.has_permission('suppliers.manage')
    or tlb.has_permission('stock.receive');
end;
$$;

revoke all on function tlb.can_read_products() from public;
revoke all on function tlb.can_read_customers() from public;
revoke all on function tlb.can_read_suppliers() from public;

comment on function tlb.can_read_products() is
  'Product catalog read. Uses existing permissions so Sales can see products without stock.view.';

-- ---------------------------------------------------------------------------
-- Units of measure
-- ---------------------------------------------------------------------------

create table tlb.units_of_measure (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_of_measure_code_unique unique (code),
  constraint units_of_measure_code_not_blank check (length(btrim(code)) > 0),
  constraint units_of_measure_name_not_blank check (length(btrim(name)) > 0)
);

comment on table tlb.units_of_measure is
  'Seeded reference units. Product.unit in the frontend maps to code, not to this uuid.';

insert into tlb.units_of_measure (code, name) values
  ('EA', 'Each'),
  ('KG', 'Kilogram'),
  ('G', 'Gram'),
  ('L', 'Litre'),
  ('ML', 'Millilitre'),
  ('DRUM', 'Drum'),
  ('BAG', 'Bag');

create trigger trg_units_of_measure_set_updated_at
before update on tlb.units_of_measure
for each row execute function tlb.set_updated_at();

-- ---------------------------------------------------------------------------
-- Product categories
-- ---------------------------------------------------------------------------

create table tlb.product_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references tlb.profiles (id) on delete set null,
  deleted_reason text,
  constraint product_categories_code_unique unique (code),
  constraint product_categories_code_not_blank check (length(btrim(code)) > 0),
  constraint product_categories_name_not_blank check (length(btrim(name)) > 0),
  constraint product_categories_soft_delete_shape check (
    deleted_at is not null
    or (deleted_by is null and deleted_reason is null)
  )
);

comment on table tlb.product_categories is
  'Optional classification. Not seeded: the frontend stores category as free text.';

create unique index product_categories_live_name_uidx
  on tlb.product_categories (lower(name))
  where deleted_at is null;

create trigger trg_product_categories_set_updated_at
before update on tlb.product_categories
for each row execute function tlb.set_updated_at();

-- ---------------------------------------------------------------------------
-- Suppliers, then products.preferred_supplier_id
-- ---------------------------------------------------------------------------

create table tlb.suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_number text not null,
  name text not null,
  category text not null,
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  tin text,
  payment_terms_days integer not null default 30,
  notes text,
  preferred boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references tlb.profiles (id) on delete set null,
  deleted_reason text,
  constraint suppliers_supplier_number_unique unique (supplier_number),
  constraint suppliers_supplier_number_not_blank check (length(btrim(supplier_number)) > 0),
  constraint suppliers_name_not_blank check (length(btrim(name)) > 0),
  constraint suppliers_category_chk check (
    category in ('Chemical', 'Packaging', 'Equipment', 'Logistics', 'Other')
  ),
  constraint suppliers_payment_terms_days_chk check (
    payment_terms_days >= 0 and payment_terms_days <= 3650
  ),
  constraint suppliers_soft_delete_shape check (
    deleted_at is not null
    or (deleted_by is null and deleted_reason is null)
  )
);

comment on table tlb.suppliers is
  'Canonical suppliers. There is no public.suppliers prototype table. supplier_number replaces frontend code.';

comment on column tlb.suppliers.payment_terms_days is
  'Integer days. Frontend PaymentTerms map: COD=0, Net 7=7, Net 15=15, Net 30=30, Net 45=45, Net 60=60.';

create index suppliers_live_name_idx
  on tlb.suppliers (name)
  where deleted_at is null;

create trigger trg_suppliers_set_updated_at
before update on tlb.suppliers
for each row execute function tlb.set_updated_at();

create table tlb.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  name text not null,
  uom_id uuid not null references tlb.units_of_measure (id) on delete restrict,
  category_id uuid references tlb.product_categories (id) on delete restrict,
  active boolean not null default true,
  issue_strategy text not null default 'FEFO',
  allow_negative_stock boolean not null default false,
  min_qty numeric(18, 4),
  max_qty numeric(18, 4),
  reorder_point numeric(18, 4),
  reorder_qty numeric(18, 4),
  lead_time_days integer,
  standard_cost numeric(18, 2),
  preferred_supplier_id uuid references tlb.suppliers (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references tlb.profiles (id) on delete set null,
  deleted_reason text,
  constraint products_sku_unique unique (sku),
  constraint products_sku_not_blank check (length(btrim(sku)) > 0),
  constraint products_name_not_blank check (length(btrim(name)) > 0),
  constraint products_issue_strategy_chk check (issue_strategy in ('FIFO', 'LIFO', 'FEFO')),
  constraint products_min_qty_chk check (min_qty is null or min_qty >= 0),
  constraint products_max_qty_chk check (max_qty is null or max_qty >= 0),
  constraint products_reorder_point_chk check (reorder_point is null or reorder_point >= 0),
  constraint products_reorder_qty_chk check (reorder_qty is null or reorder_qty >= 0),
  constraint products_qty_bounds_chk check (
    min_qty is null or max_qty is null or max_qty >= min_qty
  ),
  constraint products_lead_time_days_chk check (
    lead_time_days is null or lead_time_days >= 0
  ),
  constraint products_standard_cost_chk check (
    standard_cost is null or standard_cost >= 0
  ),
  constraint products_soft_delete_shape check (
    deleted_at is not null
    or (deleted_by is null and deleted_reason is null)
  )
);

comment on table tlb.products is
  'Canonical products. public.products is the untouched prototype. SKU is the business key, not the uuid.';

comment on column tlb.products.issue_strategy is
  'FIFO, LIFO, or FEFO. Default FEFO matches the frontend fallback in recommendBatches.';

comment on column tlb.products.allow_negative_stock is
  'Stored for parity with the frontend. tlb.inventory_balances still rejects negative on-hand.';

comment on column tlb.products.preferred_supplier_id is
  'Optional FK added with the products table, after tlb.suppliers exists.';

comment on column tlb.products.standard_cost is
  'Money numeric(18,2). Quantities on this table are numeric(18,4).';

create index products_uom_id_idx on tlb.products (uom_id);
create index products_category_id_idx on tlb.products (category_id);
create index products_preferred_supplier_id_idx on tlb.products (preferred_supplier_id);
create index products_live_name_idx on tlb.products (name) where deleted_at is null;

create trigger trg_products_set_updated_at
before update on tlb.products
for each row execute function tlb.set_updated_at();

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

create table tlb.customers (
  id uuid primary key default gen_random_uuid(),
  customer_number text not null,
  name text not null,
  category text not null,
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  tin text,
  credit_limit numeric(18, 2) not null default 0,
  payment_terms_days integer not null default 30,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references tlb.profiles (id) on delete set null,
  deleted_reason text,
  constraint customers_customer_number_unique unique (customer_number),
  constraint customers_customer_number_not_blank check (length(btrim(customer_number)) > 0),
  constraint customers_name_not_blank check (length(btrim(name)) > 0),
  constraint customers_category_chk check (
    category in (
      'Hospital', 'Laboratory', 'Distributor', 'Industrial', 'Educational', 'Other'
    )
  ),
  constraint customers_credit_limit_chk check (credit_limit >= 0),
  constraint customers_payment_terms_days_chk check (
    payment_terms_days >= 0 and payment_terms_days <= 3650
  ),
  constraint customers_soft_delete_shape check (
    deleted_at is not null
    or (deleted_by is null and deleted_reason is null)
  )
);

comment on table tlb.customers is
  'Canonical customers. public.customers is the untouched prototype. customer_number replaces frontend code.';

comment on column tlb.customers.customer_number is
  'Business number such as TLB-CUS-2026-000125. Not the primary key.';

comment on column tlb.customers.credit_limit is
  'numeric(18,2). Zero means no credit limit in the frontend creditPosition helper, not a ban on credit.';

comment on column tlb.customers.payment_terms_days is
  'Integer days. Frontend PaymentTerms map: COD=0, Net 7=7, Net 15=15, Net 30=30, Net 45=45, Net 60=60.';

create index customers_live_name_idx
  on tlb.customers (name)
  where deleted_at is null;

create trigger trg_customers_set_updated_at
before update on tlb.customers
for each row execute function tlb.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: SELECT only
-- ---------------------------------------------------------------------------

alter table tlb.units_of_measure enable row level security;
alter table tlb.product_categories enable row level security;
alter table tlb.suppliers enable row level security;
alter table tlb.products enable row level security;
alter table tlb.customers enable row level security;

create policy units_of_measure_select
on tlb.units_of_measure
for select
to authenticated
using (tlb.can_read_products());

create policy product_categories_select
on tlb.product_categories
for select
to authenticated
using (tlb.can_read_products());

create policy products_select
on tlb.products
for select
to authenticated
using (tlb.can_read_products());

create policy suppliers_select
on tlb.suppliers
for select
to authenticated
using (tlb.can_read_suppliers());

create policy customers_select
on tlb.customers
for select
to authenticated
using (tlb.can_read_customers());
