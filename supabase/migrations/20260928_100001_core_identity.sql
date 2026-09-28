-- Canonical identity foundation for TLB.
-- Forward-only. Does not alter or drop prototype tables in public
-- (warehouses, products, customers, audit_events, and the rest of the
-- historical migrations). Those names already exist in public, so the
-- canonical model lives in schema tlb.
--
-- RLS is enabled and restrictive. There are SELECT policies only.
-- Writes are denied for authenticated/anon until a later migration adds
-- least-privilege SECURITY DEFINER commands. See docs/architecture/database.
--
-- SECURITY DEFINER helpers deliberately do not FORCE ROW LEVEL SECURITY.
-- They rely on the owning role bypassing RLS. Forcing RLS on the owner
-- would recurse through the policies that call those helpers.

create extension if not exists pgcrypto;

create schema if not exists tlb;

revoke all on schema tlb from public;

comment on schema tlb is
  'Canonical TLB schema. Prototype tables remain in public and are not the source of truth for new work.';

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

create or replace function tlb.set_updated_at()
returns trigger
language plpgsql
set search_path = tlb, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function tlb.set_updated_at() from public;

comment on function tlb.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at. Not security definer.';

create or replace function tlb.protect_system_role()
returns trigger
language plpgsql
set search_path = tlb, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'system roles cannot be deleted'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if old.is_system then
    if new.code is distinct from old.code
       or new.is_system is distinct from old.is_system
       or new.name is distinct from old.name
       or new.deleted_at is not null then
      raise exception 'system role code, name, and system flag are immutable'
        using errcode = '42501';
    end if;
  end if;

  if not old.is_system and new.is_system then
    raise exception 'custom roles cannot be promoted to system roles'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function tlb.protect_system_role() from public;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table tlb.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_not_blank check (length(btrim(full_name)) > 0)
);

comment on table tlb.profiles is
  'Application profile for auth.users. Passwords stay in GoTrue. Frontend seed ids such as user-owner are not identities.';

comment on column tlb.profiles.id is
  'Same uuid as auth.users.id. Not a localStorage user id.';

create table tlb.roles (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  description text not null default '',
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references tlb.profiles (id) on delete set null,
  deleted_reason text,
  constraint roles_code_unique unique (code),
  constraint roles_name_not_blank check (length(btrim(name)) > 0),
  constraint roles_code_format check (
    code is null or code ~ '^[A-Z][A-Z0-9_]{0,31}$'
  ),
  constraint roles_system_shape check (
    (
      is_system
      and code in (
        'OWNER', 'ADMIN', 'MANAGER', 'SALES', 'WAREHOUSE',
        'FINANCE', 'DRIVER', 'REQUESTER', 'RECEIVER'
      )
    )
    or (
      not is_system
      and (
        code is null
        or code not in (
          'OWNER', 'ADMIN', 'MANAGER', 'SALES', 'WAREHOUSE',
          'FINANCE', 'DRIVER', 'REQUESTER', 'RECEIVER'
        )
      )
    )
  ),
  constraint roles_soft_delete_shape check (
    deleted_at is not null
    or (deleted_by is null and deleted_reason is null)
  )
);

comment on table tlb.roles is
  'System roles use stable codes. Custom roles leave code null or use a non-system code. Frontend ids such as role-owner are not stored.';

comment on column tlb.roles.code is
  'OWNER ADMIN MANAGER SALES WAREHOUSE FINANCE DRIVER REQUESTER RECEIVER, or null for a custom role.';

create unique index roles_live_name_uidx
  on tlb.roles (lower(name))
  where deleted_at is null;

create table tlb.permissions (
  code text primary key,
  module text not null,
  label text not null,
  created_at timestamptz not null default now(),
  constraint permissions_code_format check (code ~ '^[a-z][a-z0-9_.]*$'),
  constraint permissions_module_not_blank check (length(btrim(module)) > 0),
  constraint permissions_label_not_blank check (length(btrim(label)) > 0)
);

comment on table tlb.permissions is
  'Full permission vocabulary from src/lib/domain/permissions.ts. Do not shrink this catalog.';

create table tlb.role_permissions (
  role_id uuid not null references tlb.roles (id) on delete restrict,
  permission_code text not null references tlb.permissions (code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_code)
);

comment on table tlb.role_permissions is
  'Composite primary key. System-role rows are immutable after seed.';

create index role_permissions_permission_code_idx
  on tlb.role_permissions (permission_code);

create table tlb.user_roles (
  user_id uuid not null references tlb.profiles (id) on delete restrict,
  role_id uuid not null references tlb.roles (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references tlb.profiles (id) on delete set null,
  primary key (user_id, role_id)
);

comment on table tlb.user_roles is
  'Many-to-many role assignment. The frontend AppUser.roleId is a single role and is not copied here.';

create index user_roles_role_id_idx
  on tlb.user_roles (role_id);

create table tlb.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  location text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references tlb.profiles (id) on delete set null,
  deleted_reason text,
  constraint warehouses_code_unique unique (code),
  constraint warehouses_code_not_blank check (length(btrim(code)) > 0),
  constraint warehouses_name_not_blank check (length(btrim(name)) > 0),
  constraint warehouses_soft_delete_shape check (
    deleted_at is not null
    or (deleted_by is null and deleted_reason is null)
  )
);

comment on table tlb.warehouses is
  'Canonical warehouses. public.warehouses is the untouched prototype table.';

create index warehouses_live_idx
  on tlb.warehouses (name)
  where deleted_at is null;

create table tlb.user_warehouse_access (
  user_id uuid not null references tlb.profiles (id) on delete restrict,
  warehouse_id uuid not null references tlb.warehouses (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references tlb.profiles (id) on delete set null,
  primary key (user_id, warehouse_id)
);

comment on table tlb.user_warehouse_access is
  'Explicit warehouse visibility. A stock.view grant does not imply access to every warehouse.';

create index user_warehouse_access_warehouse_id_idx
  on tlb.user_warehouse_access (warehouse_id);

create index profiles_email_idx
  on tlb.profiles (email)
  where email is not null;

-- ---------------------------------------------------------------------------
-- updated_at + system-role protection
-- ---------------------------------------------------------------------------

create trigger trg_profiles_set_updated_at
before update on tlb.profiles
for each row execute function tlb.set_updated_at();

create trigger trg_roles_set_updated_at
before update on tlb.roles
for each row execute function tlb.set_updated_at();

create trigger trg_roles_protect_system
before update or delete on tlb.roles
for each row execute function tlb.protect_system_role();

create trigger trg_warehouses_set_updated_at
before update on tlb.warehouses
for each row execute function tlb.set_updated_at();

create trigger trg_user_warehouse_access_set_updated_at
before update on tlb.user_warehouse_access
for each row execute function tlb.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed permission vocabulary (ALL_PERMISSIONS + PERMISSION_LABELS)
-- ---------------------------------------------------------------------------

insert into tlb.permissions (code, module, label) values
  ('dashboard.view', 'Dashboard', 'View dashboard'),
  ('customers.manage', 'Customers', 'Manage customers'),
  ('suppliers.manage', 'Suppliers', 'Manage suppliers'),
  ('quotations.view', 'Quotations', 'View quotations'),
  ('orders.create', 'Sales Orders', 'Create orders'),
  ('orders.confirm', 'Sales Orders', 'Confirm orders'),
  ('orders.cancel_line', 'Sales Orders', 'Cancel order lines'),
  ('supply.create', 'Outstanding Supplies', 'Create supplies'),
  ('stock.view', 'Stock', 'View stock & inventory'),
  ('stock.receive', 'Stock', 'Receive stock / GRN'),
  ('stock.reserve', 'Stock', 'Reserve stock'),
  ('stock.issue', 'Stock', 'Issue / goods out'),
  ('stock.transfer', 'Stock', 'Warehouse transfers'),
  ('stock.adjust', 'Stock', 'Adjustments & counts'),
  ('stock.approve', 'Stock', 'Approve stock variances'),
  ('approvals.manage', 'Approvals', 'Manage approvals'),
  ('bi.view', 'Ask TLB', 'Business intelligence presets'),
  ('invoice.create', 'Finance', 'Create invoices'),
  ('receipt.create', 'Finance', 'Create receipts'),
  ('delivery.manage', 'Deliveries', 'Manage deliveries'),
  ('payment.record', 'Finance', 'Record payments'),
  ('finance.view', 'Finance', 'View finance'),
  ('reports.view', 'Reports', 'View reports'),
  ('settings.manage', 'Settings', 'Manage company settings'),
  ('audit.view', 'Audit', 'View audit log'),
  ('tin.update', 'Settings', 'Update TIN fields'),
  ('users.manage', 'Users & Roles', 'Manage users and roles'),
  ('trash.view', 'Trash', 'View trash'),
  ('records.delete', 'Trash', 'Move records to trash'),
  ('trash.purge', 'Trash', 'Permanently delete from trash'),
  ('records.edit', 'Records', 'Edit master & document records'),
  ('ops.request', 'Communication Hub', 'Create / submit requests'),
  ('ops.approve', 'Communication Hub', 'Approve ops requests'),
  ('ops.warehouse', 'Communication Hub', 'Warehouse review / release'),
  ('ops.dispatch', 'Communication Hub', 'Dispatch & assign drivers'),
  ('ops.drive', 'Communication Hub', 'Driver job actions'),
  ('ops.receive', 'Communication Hub', 'Confirm delivery receipt'),
  ('ops.communicate', 'Communication Hub', 'Request communication'),
  ('ops.view', 'Communication Hub', 'View communication hub');

insert into tlb.roles (code, name, description, is_system, active) values
  ('OWNER', 'Owner', 'Full access — create roles, assign users, and manage the workspace.', true, true),
  ('ADMIN', 'Admin', 'Full operational access including users and roles.', true, true),
  ('MANAGER', 'Manager', 'Cross-module operations without user/role administration.', true, true),
  ('SALES', 'Sales', 'Customers, quotations, orders, and commercial documents.', true, true),
  ('WAREHOUSE', 'Warehouse', 'Stock, supplies, and deliveries.', true, true),
  ('FINANCE', 'Finance', 'Invoices, receipts, payments, and financial reports.', true, true),
  ('DRIVER', 'Driver', 'Driver jobs — collect, transit, and delivery confirmation.', true, true),
  ('REQUESTER', 'Requester', 'Create and track operational requests.', true, true),
  ('RECEIVER', 'Receiver', 'Confirm delivery receipts and report discrepancies.', true, true);

-- Owner and Admin receive the entire catalog. No extra codes are invented.
insert into tlb.role_permissions (role_id, permission_code)
select r.id, p.code
from tlb.roles r
cross join tlb.permissions p
where r.code in ('OWNER', 'ADMIN');

-- SYSTEM_ROLE_PERMISSIONS for every other system role, copied without additions.
insert into tlb.role_permissions (role_id, permission_code)
select r.id, v.permission_code
from (
  values
    ('MANAGER', 'dashboard.view'),
    ('MANAGER', 'customers.manage'),
    ('MANAGER', 'suppliers.manage'),
    ('MANAGER', 'quotations.view'),
    ('MANAGER', 'orders.create'),
    ('MANAGER', 'orders.confirm'),
    ('MANAGER', 'orders.cancel_line'),
    ('MANAGER', 'supply.create'),
    ('MANAGER', 'stock.view'),
    ('MANAGER', 'stock.receive'),
    ('MANAGER', 'stock.reserve'),
    ('MANAGER', 'stock.issue'),
    ('MANAGER', 'stock.transfer'),
    ('MANAGER', 'stock.adjust'),
    ('MANAGER', 'stock.approve'),
    ('MANAGER', 'approvals.manage'),
    ('MANAGER', 'bi.view'),
    ('MANAGER', 'invoice.create'),
    ('MANAGER', 'receipt.create'),
    ('MANAGER', 'delivery.manage'),
    ('MANAGER', 'payment.record'),
    ('MANAGER', 'finance.view'),
    ('MANAGER', 'tin.update'),
    ('MANAGER', 'reports.view'),
    ('MANAGER', 'settings.manage'),
    ('MANAGER', 'audit.view'),
    ('MANAGER', 'records.edit'),
    ('MANAGER', 'ops.request'),
    ('MANAGER', 'ops.approve'),
    ('MANAGER', 'ops.warehouse'),
    ('MANAGER', 'ops.dispatch'),
    ('MANAGER', 'ops.receive'),
    ('MANAGER', 'ops.communicate'),
    ('MANAGER', 'ops.view'),
    ('SALES', 'dashboard.view'),
    ('SALES', 'customers.manage'),
    ('SALES', 'suppliers.manage'),
    ('SALES', 'quotations.view'),
    ('SALES', 'orders.create'),
    ('SALES', 'orders.confirm'),
    ('SALES', 'orders.cancel_line'),
    ('SALES', 'tin.update'),
    ('SALES', 'invoice.create'),
    ('SALES', 'receipt.create'),
    ('SALES', 'finance.view'),
    ('SALES', 'bi.view'),
    ('SALES', 'reports.view'),
    ('SALES', 'audit.view'),
    ('SALES', 'records.edit'),
    ('SALES', 'ops.request'),
    ('SALES', 'ops.communicate'),
    ('SALES', 'ops.view'),
    ('SALES', 'ops.receive'),
    ('WAREHOUSE', 'dashboard.view'),
    ('WAREHOUSE', 'supply.create'),
    ('WAREHOUSE', 'stock.view'),
    ('WAREHOUSE', 'stock.receive'),
    ('WAREHOUSE', 'stock.reserve'),
    ('WAREHOUSE', 'stock.issue'),
    ('WAREHOUSE', 'stock.transfer'),
    ('WAREHOUSE', 'stock.adjust'),
    ('WAREHOUSE', 'delivery.manage'),
    ('WAREHOUSE', 'bi.view'),
    ('WAREHOUSE', 'audit.view'),
    ('WAREHOUSE', 'records.edit'),
    ('WAREHOUSE', 'ops.warehouse'),
    ('WAREHOUSE', 'ops.dispatch'),
    ('WAREHOUSE', 'ops.communicate'),
    ('WAREHOUSE', 'ops.view'),
    ('FINANCE', 'dashboard.view'),
    ('FINANCE', 'invoice.create'),
    ('FINANCE', 'receipt.create'),
    ('FINANCE', 'payment.record'),
    ('FINANCE', 'finance.view'),
    ('FINANCE', 'tin.update'),
    ('FINANCE', 'approvals.manage'),
    ('FINANCE', 'bi.view'),
    ('FINANCE', 'reports.view'),
    ('FINANCE', 'audit.view'),
    ('FINANCE', 'records.edit'),
    ('FINANCE', 'ops.approve'),
    ('FINANCE', 'ops.view'),
    ('DRIVER', 'dashboard.view'),
    ('DRIVER', 'ops.drive'),
    ('DRIVER', 'ops.communicate'),
    ('DRIVER', 'ops.view'),
    ('DRIVER', 'delivery.manage'),
    ('REQUESTER', 'dashboard.view'),
    ('REQUESTER', 'ops.request'),
    ('REQUESTER', 'ops.communicate'),
    ('REQUESTER', 'ops.view'),
    ('REQUESTER', 'ops.receive'),
    ('REQUESTER', 'bi.view'),
    ('RECEIVER', 'dashboard.view'),
    ('RECEIVER', 'ops.receive'),
    ('RECEIVER', 'ops.communicate'),
    ('RECEIVER', 'ops.view'),
    ('RECEIVER', 'delivery.manage')
) as v(role_code, permission_code)
join tlb.roles r on r.code = v.role_code;

create or replace function tlb.protect_system_role_permissions()
returns trigger
language plpgsql
set search_path = tlb, pg_temp
as $$
declare
  v_role_id uuid;
  v_system boolean;
begin
  if current_setting('tlb.allow_system_role_write', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_role_id := case when tg_op = 'DELETE' then old.role_id else new.role_id end;

  select r.is_system
    into v_system
  from tlb.roles r
  where r.id = v_role_id;

  if coalesce(v_system, false) then
    raise exception 'system role permissions are immutable'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function tlb.protect_system_role_permissions() from public;

create trigger trg_role_permissions_protect_system
before insert or update or delete on tlb.role_permissions
for each row execute function tlb.protect_system_role_permissions();

create or replace function tlb.protect_permission_catalog()
returns trigger
language plpgsql
set search_path = tlb, pg_temp
as $$
begin
  if current_setting('tlb.allow_system_role_write', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception 'permission catalog is immutable'
    using errcode = '42501';
end;
$$;

revoke all on function tlb.protect_permission_catalog() from public;

create trigger trg_permissions_protect_catalog
before update or delete on tlb.permissions
for each row execute function tlb.protect_permission_catalog();

-- ---------------------------------------------------------------------------
-- RLS helpers. SECURITY DEFINER, fixed search_path, no dynamic SQL.
-- ---------------------------------------------------------------------------

create or replace function tlb.is_active_profile()
returns boolean
language plpgsql
stable
security definer
set search_path = tlb, pg_temp
as $$
begin
  return exists (
    select 1
    from tlb.profiles p
    where p.id = auth.uid()
      and p.active
  );
end;
$$;

create or replace function tlb.is_self(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = tlb, pg_temp
as $$
begin
  return p_user_id is not null and p_user_id = auth.uid();
end;
$$;

create or replace function tlb.has_role(p_role_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = tlb, pg_temp
as $$
begin
  return exists (
    select 1
    from tlb.user_roles ur
    join tlb.roles r on r.id = ur.role_id
    join tlb.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role_id = p_role_id
      and r.active
      and r.deleted_at is null
      and p.active
  );
end;
$$;

create or replace function tlb.has_permission(p_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = tlb, pg_temp
as $$
begin
  return exists (
    select 1
    from tlb.user_roles ur
    join tlb.roles r on r.id = ur.role_id
    join tlb.role_permissions rp on rp.role_id = r.id
    join tlb.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and rp.permission_code = p_code
      and r.active
      and r.deleted_at is null
      and p.active
  );
end;
$$;

create or replace function tlb.can_access_warehouse(p_warehouse_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = tlb, pg_temp
as $$
begin
  if p_warehouse_id is null then
    return false;
  end if;

  if tlb.has_permission('users.manage') then
    return true;
  end if;

  return exists (
    select 1
    from tlb.user_warehouse_access a
    join tlb.profiles p on p.id = a.user_id
    join tlb.warehouses w on w.id = a.warehouse_id
    where a.user_id = auth.uid()
      and a.warehouse_id = p_warehouse_id
      and p.active
      and w.deleted_at is null
  );
end;
$$;

revoke all on function tlb.is_active_profile() from public;
revoke all on function tlb.is_self(uuid) from public;
revoke all on function tlb.has_role(uuid) from public;
revoke all on function tlb.has_permission(text) from public;
revoke all on function tlb.can_access_warehouse(uuid) from public;

comment on function tlb.has_permission(text) is
  'True when the current auth user holds p_code through an active role. Does not accept a user id argument.';

comment on function tlb.can_access_warehouse(uuid) is
  'Warehouse row visibility: users.manage, or an explicit user_warehouse_access row. stock.view alone is not enough.';

-- ---------------------------------------------------------------------------
-- RLS: enable now, SELECT only. No INSERT/UPDATE/DELETE/ALL policies.
-- Deferred writes are documented in 20260928_100004 and the database docs.
-- ---------------------------------------------------------------------------

alter table tlb.profiles enable row level security;
alter table tlb.roles enable row level security;
alter table tlb.permissions enable row level security;
alter table tlb.role_permissions enable row level security;
alter table tlb.user_roles enable row level security;
alter table tlb.warehouses enable row level security;
alter table tlb.user_warehouse_access enable row level security;

create policy profiles_select
on tlb.profiles
for select
to authenticated
using (tlb.is_self(id) or tlb.has_permission('users.manage'));

create policy roles_select
on tlb.roles
for select
to authenticated
using (tlb.has_permission('users.manage') or tlb.has_role(id));

create policy permissions_select
on tlb.permissions
for select
to authenticated
using (tlb.is_active_profile());

create policy role_permissions_select
on tlb.role_permissions
for select
to authenticated
using (tlb.has_permission('users.manage') or tlb.has_role(role_id));

create policy user_roles_select
on tlb.user_roles
for select
to authenticated
using (tlb.is_self(user_id) or tlb.has_permission('users.manage'));

create policy warehouses_select
on tlb.warehouses
for select
to authenticated
using (tlb.can_access_warehouse(id));

create policy user_warehouse_access_select
on tlb.user_warehouse_access
for select
to authenticated
using (tlb.is_self(user_id) or tlb.has_permission('users.manage'));

-- Profile row for each new GoTrue user. No password is copied.
create or replace function tlb.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = tlb, pg_temp
as $$
begin
  insert into tlb.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'User'
    ),
    nullif(btrim(new.email), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function tlb.handle_new_auth_user() from public;

create trigger tlb_on_auth_user_created
after insert on auth.users
for each row execute function tlb.handle_new_auth_user();

comment on function tlb.handle_new_auth_user() is
  'Creates tlb.profiles from auth.users. Does not read or store a password.';
