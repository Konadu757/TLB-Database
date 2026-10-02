-- Permanent Pending → Active fix for Owner Settings → Users.
-- Root cause: list_staff_access_status marked invite_pending=true whenever ANY
-- live (unconsumed, unexpired) invite existed for the email — even after the
-- invitee already had a tlb.profiles row and had signed in. Owner hydrate then
-- kept local inviteToken/inviteCode and showed Pending forever.
--
-- Rule: profile exists ⇒ not Pending. Pending only for live invites with no profile.
-- Also expire leftover live invites once a profile exists for that email.
--
-- Apply on mfyvhpwjrpjcxdlsqgit.

-- ---------------------------------------------------------------------------
-- Repair stuck live invites (profile already provisioned)
-- ---------------------------------------------------------------------------
update tlb.invites i
   set expires_at = least(i.expires_at, now())
 where i.consumed_at is null
   and i.expires_at > now()
   and exists (
     select 1
       from tlb.profiles p
      where p.email is not null
        and btrim(p.email) <> ''
        and lower(btrim(p.email)) = lower(btrim(i.email))
   );

-- ---------------------------------------------------------------------------
-- list_staff_access_status — profile ⇒ Active; pending only without profile
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
    -- Provisioned staff: never Pending. Auth last_sign_in_at feeds Last login.
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
      false as invite_pending,
      coalesce(
        (
          select i.consumed_at
            from tlb.invites i
           where lower(btrim(i.email)) = lower(btrim(p.email))
             and i.consumed_at is not null
           order by i.consumed_at desc
           limit 1
        ),
        (
          select u.last_sign_in_at
            from auth.users u
           where u.id = p.id
        ),
        p.created_at
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

    -- Live invites with no profile yet (true Pending for Owner)
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
  'Staff invite/profile status for Owner Users. Profile rows are never Pending; last_sign_in_at included.';

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
