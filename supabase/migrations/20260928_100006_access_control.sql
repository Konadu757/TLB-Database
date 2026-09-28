-- Access control: hosted invites, and narrower grants on prototype public tables.
-- Forward-only. Does not drop or alter prototype business data.
-- Does not disable RLS on tlb. Does not grant authenticated table DML on tlb.
--
-- Paste this file into the Supabase SQL editor after 20260928_100001 through
-- 20260928_100005. Then run supabase/tests/verify-canonical-db.sql.
-- Schema tlb stays off the Data API exposed-schema list. The browser calls
-- public.create_invite and public.accept_invite.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Invites. Raw tokens and passwords are not stored.
-- access_code is stored so Settings can show it again; the URL token is hashed.
-- ---------------------------------------------------------------------------

create table tlb.invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  access_code text not null,
  email text not null,
  full_name text not null,
  role_id uuid not null references tlb.roles (id) on delete restrict,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references tlb.profiles (id) on delete restrict,
  created_by uuid references tlb.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invites_token_hash_unique unique (token_hash),
  constraint invites_access_code_unique unique (access_code),
  constraint invites_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint invites_access_code_shape check (access_code ~ '^TLB-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  constraint invites_email_shape check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint invites_full_name_not_blank check (length(btrim(full_name)) > 0),
  constraint invites_consume_shape check (consumed_at is null or consumed_by is not null)
);

comment on table tlb.invites is
  'Staff invites. token_hash is sha256 of the URL token. access_code is the short code. No password is stored.';

comment on column tlb.invites.token_hash is
  'sha256 hex of the raw invite token. The raw token is never stored.';

comment on column tlb.invites.access_code is
  'Normalized access code (TLB-XXXX-XXXX). Not a password.';

create index invites_email_live_idx
  on tlb.invites (lower(email))
  where consumed_at is null;

create or replace function tlb.sha256_hex(p_value text)
returns text
language sql
immutable
set search_path = extensions, public, pg_temp
as $$
  select encode(digest(convert_to(p_value, 'utf8'), 'sha256'), 'hex');
$$;

revoke all on function tlb.sha256_hex(text) from public;

comment on function tlb.sha256_hex(text) is
  'sha256 hex digest for invite tokens. Not security definer.';

-- ---------------------------------------------------------------------------
-- create_invite
-- Signed-in callers must hold users.manage.
-- Anon is also granted execute because Settings still has no GoTrue session.
-- A live invite for the same email can be replaced by users.manage, or by
-- presenting the previous raw token. That stops a stranger from rotating
-- an invite they did not issue. The first invite for an email is still
-- creatable with the anon key — see the risk note at the bottom.
-- ---------------------------------------------------------------------------

create or replace function tlb.create_invite(
  p_email text,
  p_full_name text,
  p_role_code text,
  p_token text,
  p_access_code text,
  p_expires_at timestamptz default null,
  p_replaces_token text default null
)
returns uuid
language plpgsql
security definer
set search_path = tlb, extensions, public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_full_name text := btrim(coalesce(p_full_name, ''));
  v_role_code text := upper(btrim(coalesce(p_role_code, '')));
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_code text := nullif(
    upper(regexp_replace(btrim(coalesce(p_access_code, '')), '[[:space:]]+', '', 'g')),
    ''
  );
  v_replaces text := nullif(btrim(coalesce(p_replaces_token, '')), '');
  v_role_id uuid;
  v_created_by uuid;
  v_expires_at timestamptz;
  v_invite_id uuid;
  v_can_replace boolean := false;
begin
  if auth.uid() is not null and not tlb.has_permission('users.manage') then
    raise exception 'users.manage required to issue an invite'
      using errcode = '42501';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'a valid email is required'
      using errcode = '22023';
  end if;

  if length(v_full_name) = 0 then
    raise exception 'full name is required'
      using errcode = '22023';
  end if;

  if v_token is null or length(v_token) < 16 or length(v_token) > 200 then
    raise exception 'invite token is missing'
      using errcode = '22023';
  end if;

  if v_code is null or v_code !~ '^TLB-[A-Z0-9]{4}-[A-Z0-9]{4}$' then
    raise exception 'access code must look like TLB-XXXX-XXXX'
      using errcode = '22023';
  end if;

  select r.id
    into v_role_id
  from tlb.roles r
  where r.code = v_role_code
    and r.is_system
    and r.active
    and r.deleted_at is null;

  if v_role_id is null then
    raise exception 'role must be an active system role'
      using errcode = '22023';
  end if;

  v_expires_at := coalesce(p_expires_at, now() + interval '7 days');
  if v_expires_at <= now() then
    raise exception 'invite expiry must be in the future'
      using errcode = '22023';
  end if;

  if auth.uid() is not null then
    select p.id
      into v_created_by
    from tlb.profiles p
    where p.id = auth.uid();
  end if;

  if auth.uid() is not null and tlb.has_permission('users.manage') then
    v_can_replace := true;
  elsif v_replaces is not null and exists (
    select 1
    from tlb.invites i
    where lower(i.email) = v_email
      and i.consumed_at is null
      and i.expires_at > now()
      and i.token_hash = tlb.sha256_hex(v_replaces)
  ) then
    v_can_replace := true;
  end if;

  if exists (
    select 1
    from tlb.invites i
    where lower(i.email) = v_email
      and i.consumed_at is null
      and i.expires_at > now()
  ) then
    if not v_can_replace then
      raise exception 'a live invite already exists for this email'
        using errcode = '22023';
    end if;

    update tlb.invites
       set expires_at = now()
     where lower(email) = v_email
       and consumed_at is null
       and expires_at > now();
  end if;

  begin
    insert into tlb.invites (
      token_hash,
      access_code,
      email,
      full_name,
      role_id,
      expires_at,
      created_by
    ) values (
      tlb.sha256_hex(v_token),
      v_code,
      v_email,
      v_full_name,
      v_role_id,
      v_expires_at,
      v_created_by
    )
    returning id into v_invite_id;
  exception
    when unique_violation then
      raise exception 'invite token or access code already exists'
        using errcode = '22023';
  end;

  return v_invite_id;
end;
$$;

revoke all on function tlb.create_invite(text, text, text, text, text, timestamptz, text) from public;

comment on function tlb.create_invite(text, text, text, text, text, timestamptz, text) is
  'Stores an invite. Hashes the URL token. Does not store a password. Assigns a system role id only.';

-- ---------------------------------------------------------------------------
-- accept_invite
-- Marks the invite consumed once, assigns tlb.user_roles, returns the profile.
-- Does not mint a GoTrue session and does not read the service-role key.
-- A random password hash is written only so auth.users.encrypted_password is
-- non-empty; the raw value is never stored or returned, so password login
-- cannot be used.
-- ---------------------------------------------------------------------------

create or replace function tlb.accept_invite(
  p_token text default null,
  p_access_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = tlb, extensions, public, pg_temp
as $$
declare
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_code text := nullif(
    upper(regexp_replace(btrim(coalesce(p_access_code, '')), '[[:space:]]+', '', 'g')),
    ''
  );
  v_invite tlb.invites%rowtype;
  v_email text;
  v_full_name text;
  v_role_code text;
  v_user_id uuid;
  v_profile_id uuid;
  v_active boolean;
  v_instance_id uuid;
begin
  if v_token is null and v_code is null then
    raise exception 'invalid invite'
      using errcode = '22023';
  end if;

  if v_token is not null then
    select *
      into v_invite
    from tlb.invites
    where token_hash = tlb.sha256_hex(v_token)
    for update;
  else
    select *
      into v_invite
    from tlb.invites
    where access_code = v_code
    for update;
  end if;

  if not found then
    raise exception 'invalid invite'
      using errcode = '22023';
  end if;

  if v_token is not null and v_code is not null and v_invite.access_code is distinct from v_code then
    raise exception 'invite link and access code do not match'
      using errcode = '22023';
  end if;

  if v_invite.consumed_at is not null then
    raise exception 'invite already used'
      using errcode = '22023';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'invite expired'
      using errcode = '22023';
  end if;

  select r.code
    into v_role_code
  from tlb.roles r
  where r.id = v_invite.role_id
    and r.is_system
    and r.active
    and r.deleted_at is null;

  if v_role_code is null then
    raise exception 'invite role is not an active system role'
      using errcode = '22023';
  end if;

  v_email := v_invite.email;
  v_full_name := v_invite.full_name;

  select u.id
    into v_user_id
  from auth.users u
  where u.email is not null
    and lower(u.email) = v_email
  limit 1;

  if v_user_id is null then
    v_user_id := gen_random_uuid();
    select id
      into v_instance_id
    from auth.instances
    limit 1;
    v_instance_id := coalesce(v_instance_id, '00000000-0000-0000-0000-000000000000');

    -- Random hash so the column is populated. The plaintext is discarded here.
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      email_change_token_current,
      email_change_confirm_status,
      is_sso_user,
      is_anonymous
    ) values (
      v_instance_id,
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_full_name),
      now(),
      now(),
      '',
      '',
      '',
      '',
      '',
      0,
      false,
      false
    );
  end if;

  if auth.uid() is not null and auth.uid() is distinct from v_user_id then
    raise exception 'invite email does not match the signed-in user'
      using errcode = '42501';
  end if;

  select p.id, p.active
    into v_profile_id, v_active
  from tlb.profiles p
  where p.id = v_user_id;

  if v_profile_id is null then
    insert into tlb.profiles (id, full_name, email)
    values (v_user_id, v_full_name, v_email)
    on conflict (id) do nothing;

    select p.id, p.active
      into v_profile_id, v_active
    from tlb.profiles p
    where p.id = v_user_id;
  end if;

  if v_profile_id is null then
    raise exception 'profile was not created for invited user'
      using errcode = '55000';
  end if;

  if not coalesce(v_active, false) then
    raise exception 'user account is inactive'
      using errcode = '42501';
  end if;

  update tlb.profiles
     set full_name = v_full_name,
         email = v_email
   where id = v_profile_id;

  insert into tlb.user_roles (user_id, role_id, assigned_by)
  values (v_profile_id, v_invite.role_id, v_invite.created_by)
  on conflict (user_id, role_id) do nothing;

  update tlb.invites
     set consumed_at = now(),
         consumed_by = v_profile_id
   where id = v_invite.id
     and consumed_at is null
     and expires_at > now();

  if not found then
    raise exception 'invite already used'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'profile_id', v_profile_id,
    'email', v_email,
    'full_name', v_full_name,
    'role_code', v_role_code
  );
end;
$$;

revoke all on function tlb.accept_invite(text, text) from public;

comment on function tlb.accept_invite(text, text) is
  'Consumes one live invite, ensures a profile, and assigns tlb.user_roles. Does not create a GoTrue session or store a raw password.';

-- Data API wrappers. tlb itself is not an exposed schema.

create or replace function public.create_invite(
  p_email text,
  p_full_name text,
  p_role_code text,
  p_token text,
  p_access_code text,
  p_expires_at timestamptz default null,
  p_replaces_token text default null
)
returns uuid
language sql
security definer
set search_path = tlb, pg_temp
as $$
  select tlb.create_invite(
    p_email,
    p_full_name,
    p_role_code,
    p_token,
    p_access_code,
    p_expires_at,
    p_replaces_token
  );
$$;

revoke all on function public.create_invite(text, text, text, text, text, timestamptz, text) from public;

comment on function public.create_invite(text, text, text, text, text, timestamptz, text) is
  'Data API RPC create_invite. Thin wrapper around tlb.create_invite.';

create or replace function public.accept_invite(
  p_token text default null,
  p_access_code text default null
)
returns jsonb
language sql
security definer
set search_path = tlb, pg_temp
as $$
  select tlb.accept_invite(p_token, p_access_code);
$$;

revoke all on function public.accept_invite(text, text) from public;

comment on function public.accept_invite(text, text) is
  'Data API RPC accept_invite. Thin wrapper around tlb.accept_invite. Does not mint a session.';

-- ---------------------------------------------------------------------------
-- RLS stays on. SELECT only. Writes go through the functions above.
-- ---------------------------------------------------------------------------

alter table tlb.invites enable row level security;

create policy invites_select
on tlb.invites
for select
to authenticated
using (tlb.has_permission('users.manage') or tlb.is_self(consumed_by));

revoke all on table tlb.invites from public;

do $$
begin
  execute format('grant execute on function tlb.sha256_hex(text) to %I', current_user);
  execute format(
    'grant execute on function tlb.create_invite(text, text, text, text, text, timestamptz, text) to %I',
    current_user
  );
  execute format('grant execute on function tlb.accept_invite(text, text) to %I', current_user);
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table tlb.invites from anon';
    execute 'revoke all on function tlb.sha256_hex(text) from anon';
    execute 'revoke all on function tlb.create_invite(text, text, text, text, text, timestamptz, text) from anon';
    execute 'revoke all on function tlb.accept_invite(text, text) from anon';
    execute 'grant execute on function public.create_invite(text, text, text, text, text, timestamptz, text) to anon';
    execute 'grant execute on function public.accept_invite(text, text) to anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on table tlb.invites to authenticated';
    execute 'revoke insert, update, delete on table tlb.invites from authenticated';
    execute 'revoke truncate on table tlb.invites from authenticated';
    execute 'revoke all on function tlb.sha256_hex(text) from authenticated';
    execute 'revoke all on function tlb.create_invite(text, text, text, text, text, timestamptz, text) from authenticated';
    execute 'revoke all on function tlb.accept_invite(text, text) from authenticated';
    execute 'grant execute on function public.create_invite(text, text, text, text, text, timestamptz, text) to authenticated';
    execute 'grant execute on function public.accept_invite(text, text) to authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table tlb.invites to service_role';
    execute 'grant execute on function tlb.create_invite(text, text, text, text, text, timestamptz, text) to service_role';
    execute 'grant execute on function tlb.accept_invite(text, text) to service_role';
    execute 'grant execute on function public.create_invite(text, text, text, text, text, timestamptz, text) to service_role';
    execute 'grant execute on function public.accept_invite(text, text) to service_role';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prototype public grants from 20260909_p2_text_ids_and_soft_delete.sql.
--
-- KEPT for anon and authenticated (select/insert/update/delete). The live
-- hybrid repository still writes these with the publishable anon key, and
-- there is no tlb writer to replace that yet:
--   warehouses, products, vat_rates, customers, stock_balances,
--   customer_purchase_orders, customer_order_lines, supplies, supply_lines,
--   stock_reservations, invoices, invoice_lines, receipts, receipt_lines,
--   deliveries, delivery_items, payments, notifications, audit_events,
--   document_counters, app_settings
--
-- REVOKED anon and authenticated insert/update/delete. SELECT stays.
-- These names were opened by the 20260909 allowlist but the UI keeps them
-- in localStorage (SupabaseTlbRepository local-only slice). Missing tables
-- are skipped. public.v_outstanding_customer_supplies stays select-only.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  revoke_writes text[] := array[
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
begin
  foreach t in array revoke_writes loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke insert, update, delete on table public.%I from anon', t);
    end if;

    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke insert, update, delete on table public.%I from authenticated', t);
      execute format('grant select on table public.%I to authenticated', t);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

-- Risk: public.create_invite is executable by anon so Settings can insert a
-- row before any GoTrue session exists. Anyone with the anon key can create
-- the first live invite for an email, then public.accept_invite will assign
-- that system role. Revoke execute on public.create_invite from anon once
-- Settings calls it with a users.manage session. Do not grant anon DML on tlb.
