-- Staff access status for Owner Settings → Users.
-- Pending vs Active must follow tlb.invites.consumed_at + tlb.profiles, not only
-- the browser's localStorage / auth_directory snapshot from when the invite was issued.
--
-- Apply on mfyvhpwjrpjcxdlsqgit (SQL Editor or: npx supabase db query --linked -f …).

create or replace function tlb.list_staff_access_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = tlb, public, pg_temp
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
      ) as invite_accepted_at
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
      null::timestamptz as invite_accepted_at
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
  'Returns staff emails with invite_pending / invite_accepted_at / profile_id for Owner UI hydrate.';

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

comment on function public.list_staff_access_status() is
  'Data API RPC: staff invite/profile status for Owner Settings Users hydrate.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.list_staff_access_status() to anon';
    execute 'revoke all on function tlb.list_staff_access_status() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.list_staff_access_status() to authenticated';
    execute 'revoke all on function tlb.list_staff_access_status() from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.list_staff_access_status() to service_role';
    execute 'grant execute on function tlb.list_staff_access_status() to service_role';
  end if;
end;
$$;

-- When one invite is consumed, expire any other live invites for the same email
-- so Owner hydrate cannot stay Pending on a leftover re-issue row.
create or replace function tlb.invites_expire_siblings()
returns trigger
language plpgsql
security definer
set search_path = tlb, public, pg_temp
as $$
begin
  if new.consumed_at is not null and (old.consumed_at is null) then
    update tlb.invites i
       set expires_at = least(i.expires_at, now())
     where lower(btrim(i.email)) = lower(btrim(new.email))
       and i.id is distinct from new.id
       and i.consumed_at is null
       and i.expires_at > now();
  end if;
  return new;
end;
$$;

drop trigger if exists invites_expire_siblings on tlb.invites;
create trigger invites_expire_siblings
  after update of consumed_at on tlb.invites
  for each row
  execute function tlb.invites_expire_siblings();
