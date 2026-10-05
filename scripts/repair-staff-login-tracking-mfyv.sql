-- Repair Owner Users login tracking on mfyvhpwjrpjcxdlsqgit.
-- 1) Expire leftover live invites when a profile already exists for that email.
-- 2) Backfill user.login activity_events from auth.users.last_sign_in_at when missing.
-- 3) Re-assert list_staff_access_status profile ⇒ not Pending.
--
-- Apply: npx supabase db query --linked -f scripts/repair-staff-login-tracking-mfyv.sql

-- ---------------------------------------------------------------------------
-- Expire stuck live invites (profile already provisioned)
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
-- Backfill login activity for Auth users who have signed in but have no event
-- ---------------------------------------------------------------------------
insert into tlb.activity_events (
  actor_id,
  actor_email,
  actor_name,
  actor_role,
  action,
  entity_type,
  entity_id,
  summary,
  meta,
  created_at
)
select
  u.id,
  lower(btrim(u.email)),
  coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(u.email), ''), 'User'),
  (
    select r.code
      from tlb.user_roles ur
      join tlb.roles r on r.id = ur.role_id
     where ur.user_id = u.id
       and r.deleted_at is null
     order by case when r.code = 'OWNER' then 0 else 1 end, r.code
     limit 1
  ),
  'user.login',
  'user',
  u.id::text,
  coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(u.email), ''), 'User')
    || ' signed in'
    || coalesce(
      ' (' || (
        select r.code
          from tlb.user_roles ur
          join tlb.roles r on r.id = ur.role_id
         where ur.user_id = u.id
           and r.deleted_at is null
         order by case when r.code = 'OWNER' then 0 else 1 end, r.code
         limit 1
      ) || ')',
      ''
    ),
  jsonb_build_object(
    'email', lower(btrim(u.email)),
    'backfilled', true,
    'source', 'auth.users.last_sign_in_at'
  ),
  u.last_sign_in_at
from auth.users u
left join tlb.profiles p on p.id = u.id
where u.last_sign_in_at is not null
  and u.email is not null
  and btrim(u.email) <> ''
  and not exists (
    select 1
      from tlb.activity_events ae
     where ae.action = 'user.login'
       and (
         ae.actor_id = u.id
         or lower(btrim(coalesce(ae.actor_email, ''))) = lower(btrim(u.email))
       )
  );

-- ---------------------------------------------------------------------------
-- Re-apply list_staff_access_status (profile never Pending)
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
        (
          select ae.created_at
            from tlb.activity_events ae
           where ae.action = 'user.login'
             and (
               ae.actor_id = p.id
               or lower(btrim(coalesce(ae.actor_email, ''))) = lower(btrim(p.email))
             )
           order by ae.created_at desc
           limit 1
        ),
        p.created_at
      ) as invite_accepted_at,
      coalesce(
        (
          select u.last_sign_in_at
            from auth.users u
           where u.id = p.id
        ),
        (
          select ae.created_at
            from tlb.activity_events ae
           where ae.action = 'user.login'
             and (
               ae.actor_id = p.id
               or lower(btrim(coalesce(ae.actor_email, ''))) = lower(btrim(p.email))
             )
           order by ae.created_at desc
           limit 1
        )
      ) as last_sign_in_at
    from tlb.profiles p
    where p.email is not null
      and btrim(p.email) <> ''

    union all

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

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
select jsonb_pretty(jsonb_build_object(
  'staff_status', public.list_staff_access_status(),
  'login_events', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'actor_email', ae.actor_email,
      'summary', ae.summary,
      'created_at', ae.created_at,
      'backfilled', ae.meta->>'backfilled'
    ) order by ae.created_at desc), '[]'::jsonb)
    from tlb.activity_events ae
    where ae.action = 'user.login'
  ),
  'auth_sign_ins', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'email', u.email,
      'last_sign_in_at', u.last_sign_in_at
    ) order by u.email), '[]'::jsonb)
    from auth.users u
  )
));
