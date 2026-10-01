-- =============================================================================
-- TLB Database (mfyvhpwjrpjcxdlsqgit) — bootstrap Owner → users.manage
-- =============================================================================
-- Why: portal Owners sign in with Supabase Auth. create_invite requires
-- tlb.has_permission('users.manage'). That only returns true when auth.uid()
-- has an Owner/Admin role row in tlb.user_roles. The first Auth user is often
-- created in the dashboard without that assignment, so Re-issue fails with
-- "users.manage required to issue an invite" and nothing is written to
-- tlb.invites — accept_invite then returns "invalid invite".
--
-- Safe to re-run. Does not print secrets. Does not touch passwords.
-- =============================================================================

do $$
declare
  v_owner_role_id uuid;
  v_uid uuid;
  v_email text;
  v_name text;
  v_has_manage boolean;
  v_granted int := 0;
  v_ensured_profile int := 0;
begin
  select r.id
    into v_owner_role_id
  from tlb.roles r
  where r.code = 'OWNER'
    and r.is_system
    and r.active
    and r.deleted_at is null;

  if v_owner_role_id is null then
    raise exception 'OWNER system role is missing in tlb.roles';
  end if;

  -- Belt-and-suspenders: Owner must carry users.manage (seed should already).
  insert into tlb.role_permissions (role_id, permission_code)
  select v_owner_role_id, 'users.manage'
  where not exists (
    select 1
    from tlb.role_permissions rp
    where rp.role_id = v_owner_role_id
      and rp.permission_code = 'users.manage'
  );

  select exists (
    select 1
    from tlb.user_roles ur
    join tlb.roles r on r.id = ur.role_id
    join tlb.role_permissions rp on rp.role_id = r.id
    join tlb.profiles p on p.id = ur.user_id
    where rp.permission_code = 'users.manage'
      and r.active
      and r.deleted_at is null
      and p.active
  )
  into v_has_manage;

  -- Ensure every Auth user has an active profile (handle_new_auth_user may have
  -- run already; upsert keeps the row alive).
  for v_uid, v_email, v_name in
    select
      u.id,
      lower(nullif(btrim(u.email), '')),
      coalesce(
        nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
        nullif(btrim(u.raw_user_meta_data->>'name'), ''),
        nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
        'Owner'
      )
    from auth.users u
    order by u.created_at nulls last, u.id
  loop
    insert into tlb.profiles (id, full_name, email, active)
    values (v_uid, v_name, v_email, true)
    on conflict (id) do update
      set active = true,
          email = coalesce(excluded.email, tlb.profiles.email),
          full_name = case
            when length(btrim(tlb.profiles.full_name)) = 0 then excluded.full_name
            else tlb.profiles.full_name
          end,
          updated_at = now();
    v_ensured_profile := v_ensured_profile + 1;

    -- If nobody can manage users yet, grant OWNER to Auth users that have no
    -- role assignment (typically the dashboard-created Owner account).
    if not v_has_manage then
      if not exists (
        select 1 from tlb.user_roles ur where ur.user_id = v_uid
      ) then
        insert into tlb.user_roles (user_id, role_id)
        values (v_uid, v_owner_role_id);
        v_granted := v_granted + 1;
      end if;
    end if;
  end loop;

  -- If manage still missing (e.g. profiles had other roles without the perm),
  -- force-assign OWNER to the earliest Auth user.
  select exists (
    select 1
    from tlb.user_roles ur
    join tlb.role_permissions rp on rp.role_id = ur.role_id
    where rp.permission_code = 'users.manage'
  )
  into v_has_manage;

  if not v_has_manage then
    select u.id
      into v_uid
    from auth.users u
    order by u.created_at nulls last, u.id
    limit 1;

    if v_uid is null then
      raise exception 'No auth.users row found — create the Owner Auth user first, then re-run';
    end if;

    insert into tlb.user_roles (user_id, role_id)
    values (v_uid, v_owner_role_id)
    on conflict do nothing;
    v_granted := v_granted + 1;
  end if;

  raise notice 'bootstrap_owner profiles_ensured=% roles_granted=%',
    v_ensured_profile, v_granted;
end;
$$;

-- Verification (no secrets): who can issue invites?
select
  p.id as profile_id,
  p.email,
  r.code as role_code,
  exists (
    select 1
    from tlb.role_permissions rp
    where rp.role_id = r.id
      and rp.permission_code = 'users.manage'
  ) as has_users_manage
from tlb.profiles p
join tlb.user_roles ur on ur.user_id = p.id
join tlb.roles r on r.id = ur.role_id
where r.code = 'OWNER'
order by p.created_at;
