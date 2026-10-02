-- Portal activity trail + last-login visibility for Owner Settings → Users.
-- Every successful sign-in writes tlb.activity_events; Owner hydrates via list_activity_events.
-- list_staff_access_status also returns auth.users.last_sign_in_at for the Users table.
--
-- Apply on mfyvhpwjrpjcxdlsqgit (SQL Editor or: npx supabase db query --linked -f …).

-- ---------------------------------------------------------------------------
-- activity_events (append-only cloud trail)
-- ---------------------------------------------------------------------------

create table if not exists tlb.activity_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references tlb.profiles (id) on delete set null,
  actor_email text,
  actor_name text,
  actor_role text,
  action text not null,
  entity_type text not null default 'user',
  entity_id text,
  summary text not null,
  meta jsonb,
  created_at timestamptz not null default now(),
  constraint activity_events_action_not_blank check (
    length(btrim(action)) > 0 and length(action) <= 80
  ),
  constraint activity_events_entity_type_not_blank check (
    length(btrim(entity_type)) > 0 and length(entity_type) <= 80
  ),
  constraint activity_events_summary_not_blank check (
    length(btrim(summary)) > 0 and length(summary) <= 500
  ),
  constraint activity_events_meta_object check (
    meta is null or jsonb_typeof(meta) = 'object'
  )
);

comment on table tlb.activity_events is
  'Durable portal activity: logins, invites, role changes. Survives browser refresh.';

create index if not exists activity_events_created_at_idx
  on tlb.activity_events (created_at desc);

create index if not exists activity_events_actor_id_idx
  on tlb.activity_events (actor_id);

create index if not exists activity_events_action_idx
  on tlb.activity_events (action, created_at desc);

-- Immutability (reuse reject helper when present)
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tlb' and p.proname = 'reject_row_mutation'
  ) then
    drop trigger if exists trg_activity_events_no_update on tlb.activity_events;
    create trigger trg_activity_events_no_update
      before update or delete on tlb.activity_events
      for each row execute function tlb.reject_row_mutation();

    drop trigger if exists trg_activity_events_no_truncate on tlb.activity_events;
    create trigger trg_activity_events_no_truncate
      before truncate on tlb.activity_events
      for each statement execute function tlb.reject_row_mutation();
  end if;
end;
$$;

alter table tlb.activity_events enable row level security;

drop policy if exists activity_events_select on tlb.activity_events;
create policy activity_events_select
on tlb.activity_events
for select
to authenticated
using (
  tlb.has_permission('audit.view')
  or tlb.has_permission('users.manage')
  or actor_id = auth.uid()
);

-- No direct table INSERT for authenticated — go through record_activity_event / record_portal_login.

revoke all on table tlb.activity_events from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on table tlb.activity_events to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table tlb.activity_events to service_role';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- record helpers
-- ---------------------------------------------------------------------------

create or replace function tlb.record_activity_event(
  p_action text,
  p_summary text,
  p_entity_type text default 'user',
  p_entity_id text default null,
  p_meta jsonb default null,
  p_actor_id uuid default null,
  p_actor_email text default null,
  p_actor_name text default null,
  p_actor_role text default null
)
returns uuid
language plpgsql
security definer
set search_path = tlb, public, pg_temp
as $$
declare
  v_actor uuid;
  v_email text;
  v_name text;
  v_role text;
  v_id uuid;
begin
  v_actor := coalesce(p_actor_id, auth.uid());

  if v_actor is not null then
    select p.email, p.full_name
      into v_email, v_name
    from tlb.profiles p
    where p.id = v_actor;

    select r.code
      into v_role
    from tlb.user_roles ur
    join tlb.roles r on r.id = ur.role_id
    where ur.user_id = v_actor
      and r.deleted_at is null
    order by case when r.code = 'OWNER' then 0 else 1 end, r.code
    limit 1;
  end if;

  v_email := coalesce(nullif(btrim(p_actor_email), ''), v_email);
  v_name := coalesce(nullif(btrim(p_actor_name), ''), v_name);
  v_role := coalesce(nullif(btrim(p_actor_role), ''), v_role);

  insert into tlb.activity_events (
    actor_id, actor_email, actor_name, actor_role,
    action, entity_type, entity_id, summary, meta
  )
  values (
    v_actor,
    v_email,
    v_name,
    v_role,
    p_action,
    coalesce(nullif(btrim(p_entity_type), ''), 'user'),
    nullif(btrim(p_entity_id), ''),
    p_summary,
    case when p_meta is null or jsonb_typeof(p_meta) = 'object' then p_meta else null end
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function tlb.record_activity_event(text, text, text, text, jsonb, uuid, text, text, text) from public;

comment on function tlb.record_activity_event(text, text, text, text, jsonb, uuid, text, text, text) is
  'Insert one activity_events row. Used by login RPC, invite triggers, and Owner-facing callers.';

-- Portal login: authenticated user records their own successful sign-in.
create or replace function tlb.record_portal_login(
  p_user_agent text default null,
  p_ip text default null
)
returns uuid
language plpgsql
security definer
set search_path = tlb, public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  v_role text;
  v_summary text;
  v_meta jsonb;
begin
  if v_uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  select p.email, p.full_name
    into v_email, v_name
  from tlb.profiles p
  where p.id = v_uid;

  if v_email is null then
    -- Profile may lag briefly after invite accept; still record Auth identity.
    select u.email, coalesce(u.raw_user_meta_data->>'full_name', u.email)
      into v_email, v_name
    from auth.users u
    where u.id = v_uid;
  end if;

  select r.code
    into v_role
  from tlb.user_roles ur
  join tlb.roles r on r.id = ur.role_id
  where ur.user_id = v_uid
    and r.deleted_at is null
  order by case when r.code = 'OWNER' then 0 else 1 end, r.code
  limit 1;

  v_summary := coalesce(nullif(btrim(v_name), ''), nullif(btrim(v_email), ''), 'User')
    || ' signed in'
    || case when v_role is not null then ' (' || v_role || ')' else '' end;

  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'user_agent', nullif(btrim(p_user_agent), ''),
    'ip', nullif(btrim(p_ip), ''),
    'role', v_role,
    'email', v_email
  ));

  return tlb.record_activity_event(
    'user.login',
    v_summary,
    'user',
    v_uid::text,
    v_meta,
    v_uid,
    v_email,
    v_name,
    v_role
  );
end;
$$;

revoke all on function tlb.record_portal_login(text, text) from public;

create or replace function public.record_portal_login(
  p_user_agent text default null,
  p_ip text default null
)
returns uuid
language sql
security definer
set search_path = tlb, public, pg_temp
as $$
  select tlb.record_portal_login(p_user_agent, p_ip);
$$;

revoke all on function public.record_portal_login(text, text) from public;

comment on function public.record_portal_login(text, text) is
  'Data API RPC: record a successful portal sign-in for auth.uid().';

-- Owner (or audit.view) lists recent activity for hydrate.
create or replace function tlb.list_activity_events(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = tlb, public, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_rows jsonb := '[]'::jsonb;
  v_uid uuid := auth.uid();
begin
  -- Allow service_role / missing auth for linked SQL checks; for JWT require permission or self.
  if v_uid is not null
     and not (
       tlb.has_permission('audit.view')
       or tlb.has_permission('users.manage')
     )
  then
    -- Staff may only see their own activity rows.
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
      into v_rows
    from (
      select
        ae.id::text as id,
        ae.created_at,
        ae.actor_id::text as actor_id,
        ae.actor_email,
        ae.actor_name,
        ae.actor_role,
        ae.action,
        ae.entity_type,
        ae.entity_id,
        ae.summary,
        ae.meta
      from tlb.activity_events ae
      where ae.actor_id = v_uid
      order by ae.created_at desc
      limit v_limit
    ) q;
    return v_rows;
  end if;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select
      ae.id::text as id,
      ae.created_at,
      ae.actor_id::text as actor_id,
      ae.actor_email,
      ae.actor_name,
      ae.actor_role,
      ae.action,
      ae.entity_type,
      ae.entity_id,
      ae.summary,
      ae.meta
    from tlb.activity_events ae
    order by ae.created_at desc
    limit v_limit
  ) q;

  return v_rows;
end;
$$;

revoke all on function tlb.list_activity_events(integer) from public;

create or replace function public.list_activity_events(p_limit integer default 100)
returns jsonb
language sql
stable
security definer
set search_path = tlb, public, pg_temp
as $$
  select tlb.list_activity_events(p_limit);
$$;

revoke all on function public.list_activity_events(integer) from public;

comment on function public.list_activity_events(integer) is
  'Data API RPC: recent portal activity for Owner hydrate / Audit.';

-- ---------------------------------------------------------------------------
-- Invite activity triggers (issued / accepted)
-- ---------------------------------------------------------------------------

create or replace function tlb.invites_record_activity()
returns trigger
language plpgsql
security definer
set search_path = tlb, public, pg_temp
as $$
declare
  v_role text;
  v_summary text;
begin
  select r.code into v_role
  from tlb.roles r
  where r.id = new.role_id;

  if tg_op = 'INSERT' then
    v_summary := coalesce(nullif(btrim(new.full_name), ''), new.email)
      || ' invited'
      || case when v_role is not null then ' as ' || v_role else '' end;
    perform tlb.record_activity_event(
      'user.invite_issued',
      v_summary,
      'invite',
      new.id::text,
      jsonb_build_object('email', new.email, 'role', v_role),
      new.created_by,
      null,
      null,
      null
    );
  elsif tg_op = 'UPDATE'
        and new.consumed_at is not null
        and (old.consumed_at is null) then
    v_summary := coalesce(nullif(btrim(new.full_name), ''), new.email)
      || ' accepted invite'
      || case when v_role is not null then ' (' || v_role || ')' else '' end;
    perform tlb.record_activity_event(
      'user.invite_accepted',
      v_summary,
      'invite',
      new.id::text,
      jsonb_build_object(
        'email', new.email,
        'role', v_role,
        'profile_id', new.consumed_by
      ),
      new.consumed_by,
      new.email,
      new.full_name,
      v_role
    );
  end if;

  return new;
end;
$$;

drop trigger if exists invites_record_activity on tlb.invites;
create trigger invites_record_activity
  after insert or update of consumed_at on tlb.invites
  for each row
  execute function tlb.invites_record_activity();

-- ---------------------------------------------------------------------------
-- list_staff_access_status — include last_sign_in_at from Auth
-- ---------------------------------------------------------------------------

create or replace function tlb.list_staff_access_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = tlb, public, auth, pg_temp
as $$
declare
  v_rows jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(q) order by q.email, q.profile_id nulls last), '[]'::jsonb)
    into v_rows
  from (
    -- Accepted (or provisioned) staff profiles
    select
      lower(btrim(p.email)) as email,
      p.full_name,
      p.id::text as profile_id,
      p.active,
      (
        select r.code
          from tlb.user_roles ur
          join tlb.roles r on r.id = ur.role_id
         where ur.user_id = p.id
           and r.deleted_at is null
         order by case when r.code = 'OWNER' then 0 else 1 end, r.code
         limit 1
      ) as role_code,
      exists (
        select 1
          from tlb.invites i
         where lower(btrim(i.email)) = lower(btrim(p.email))
           and i.consumed_at is null
           and i.expires_at > now()
      ) as invite_pending,
      (
        select i.consumed_at
          from tlb.invites i
         where lower(btrim(i.email)) = lower(btrim(p.email))
           and i.consumed_at is not null
         order by i.consumed_at desc
         limit 1
      ) as invite_accepted_at,
      (
        select u.last_sign_in_at
          from auth.users u
         where u.id = p.id
      ) as last_sign_in_at
    from tlb.profiles p
    where p.email is not null
      and btrim(p.email) <> ''

    union all

    -- Live invites that do not yet have a profile (still Pending for Owner)
    select
      lower(btrim(i.email)) as email,
      i.full_name,
      null::text as profile_id,
      true as active,
      r.code as role_code,
      true as invite_pending,
      null::timestamptz as invite_accepted_at,
      null::timestamptz as last_sign_in_at
    from tlb.invites i
    join tlb.roles r on r.id = i.role_id
    where i.consumed_at is null
      and i.expires_at > now()
      and not exists (
        select 1
          from tlb.profiles p
         where p.email is not null
           and lower(btrim(p.email)) = lower(btrim(i.email))
      )
  ) q;

  return v_rows;
end;
$$;

revoke all on function tlb.list_staff_access_status() from public;

comment on function tlb.list_staff_access_status() is
  'Staff emails with invite status, profile_id, and auth last_sign_in_at for Owner Users hydrate.';

create or replace function public.list_staff_access_status()
returns jsonb
language sql
stable
security definer
set search_path = tlb, public, pg_temp
as $$
  select tlb.list_staff_access_status();
$$;

revoke all on function public.list_staff_access_status() from public;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.list_staff_access_status() to anon';
    execute 'revoke all on function tlb.list_staff_access_status() from anon';
    execute 'revoke all on function public.record_portal_login(text, text) from anon';
    execute 'revoke all on function public.list_activity_events(integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.list_staff_access_status() to authenticated';
    execute 'revoke all on function tlb.list_staff_access_status() from authenticated';
    execute 'grant execute on function public.record_portal_login(text, text) to authenticated';
    execute 'revoke all on function tlb.record_portal_login(text, text) from authenticated';
    execute 'grant execute on function public.list_activity_events(integer) to authenticated';
    execute 'revoke all on function tlb.list_activity_events(integer) from authenticated';
    execute 'grant execute on function tlb.record_activity_event(text, text, text, text, jsonb, uuid, text, text, text) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.list_staff_access_status() to service_role';
    execute 'grant execute on function tlb.list_staff_access_status() to service_role';
    execute 'grant execute on function public.record_portal_login(text, text) to service_role';
    execute 'grant execute on function tlb.record_portal_login(text, text) to service_role';
    execute 'grant execute on function public.list_activity_events(integer) to service_role';
    execute 'grant execute on function tlb.list_activity_events(integer) to service_role';
    execute 'grant execute on function tlb.record_activity_event(text, text, text, text, jsonb, uuid, text, text, text) to service_role';
  end if;
end;
$$;

-- Smoke: functions exist
select
  to_regprocedure('public.record_portal_login(text, text)') as record_portal_login,
  to_regprocedure('public.list_activity_events(integer)') as list_activity_events,
  to_regprocedure('public.list_staff_access_status()') as list_staff_access_status;
