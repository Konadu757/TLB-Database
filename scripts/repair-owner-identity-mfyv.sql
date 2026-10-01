-- =============================================================================
-- TLB (mfyvhpwjrpjcxdlsqgit) — repair Owner Auth identity after Finance overlap
-- =============================================================================
-- Owner Auth: aa9ba161-56b9-49fc-9ca5-c46070fa3d87 / mccaesartechsolutions@gmail.com
-- Safe to re-run. Does not print secrets.
-- =============================================================================

do $$
declare
  v_owner_role_id uuid;
  v_owner_id uuid := 'aa9ba161-56b9-49fc-9ca5-c46070fa3d87';
  v_owner_email text := 'mccaesartechsolutions@gmail.com';
  v_owner_name text := 'TLB Owner';
  v_dir jsonb;
  v_users jsonb := '[]'::jsonb;
  v_user jsonb;
  v_id text;
  v_email text;
  v_kept jsonb := '[]'::jsonb;
  v_has_auth boolean := false;
  v_has_seed boolean := false;
begin
  select r.id into v_owner_role_id
  from tlb.roles r
  where r.code = 'OWNER' and r.is_system and r.active and r.deleted_at is null;

  if v_owner_role_id is null then
    raise exception 'OWNER system role missing';
  end if;

  insert into tlb.profiles (id, full_name, email, active)
  values (v_owner_id, v_owner_name, v_owner_email, true)
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        active = true,
        updated_at = now();

  insert into tlb.user_roles (user_id, role_id)
  values (v_owner_id, v_owner_role_id)
  on conflict do nothing;

  -- Drop non-OWNER role rows for the Owner Auth profile.
  delete from tlb.user_roles ur
  where ur.user_id = v_owner_id
    and ur.role_id <> v_owner_role_id;

  -- Consume leftover invites that reused the Owner email.
  update tlb.invites
     set consumed_at = coalesce(consumed_at, now())
   where lower(btrim(email)) = v_owner_email
     and consumed_at is null;

  -- app_settings / auth_directory may be absent on canonical-only DBs.
  -- Staff directory then lives in browser localStorage; client heal covers it.
  if to_regclass('public.app_settings') is not null then
    select s.value into v_dir
    from public.app_settings s
    where s.key = 'auth_directory';

    if v_dir is null or jsonb_typeof(v_dir) <> 'object' then
      v_dir := '{}'::jsonb;
    end if;

    if jsonb_typeof(v_dir->'users') = 'array' then
      v_users := v_dir->'users';
    end if;

    for v_user in select * from jsonb_array_elements(v_users)
    loop
      v_id := coalesce(v_user->>'id', '');
      v_email := lower(btrim(coalesce(v_user->>'email', '')));
      if v_id = 'aa9ba161-56b9-49fc-9ca5-c46070fa3d87' then
        v_has_auth := true;
        v_kept := v_kept || jsonb_build_array(
          jsonb_build_object(
            'id', v_id,
            'name', v_owner_name,
            'email', v_owner_email,
            'roleId', 'role-owner',
            'active', true
          )
        );
      elsif v_id = 'user-owner' then
        v_has_seed := true;
        v_kept := v_kept || jsonb_build_array(
          jsonb_build_object(
            'id', v_id,
            'name', v_owner_name,
            'email', v_owner_email,
            'roleId', 'role-owner',
            'active', true
          )
        );
      elsif v_email = v_owner_email then
        continue;
      else
        v_kept := v_kept || jsonb_build_array(v_user);
      end if;
    end loop;

    if not v_has_auth then
      v_kept := v_kept || jsonb_build_array(
        jsonb_build_object(
          'id', 'aa9ba161-56b9-49fc-9ca5-c46070fa3d87',
          'name', v_owner_name,
          'email', v_owner_email,
          'roleId', 'role-owner',
          'active', true
        )
      );
    end if;
    if not v_has_seed then
      v_kept := v_kept || jsonb_build_array(
        jsonb_build_object(
          'id', 'user-owner',
          'name', v_owner_name,
          'email', v_owner_email,
          'roleId', 'role-owner',
          'active', true
        )
      );
    end if;

    v_dir := jsonb_set(v_dir, '{users}', v_kept, true);

    insert into public.app_settings (key, value)
    values ('auth_directory', v_dir)
    on conflict (key) do update
      set value = excluded.value;
  end if;

  raise notice 'repair_owner_identity: profile+OWNER role repaired';
end;
$$;

select p.id, p.email, p.full_name, r.code as role_code
from tlb.profiles p
left join tlb.user_roles ur on ur.user_id = p.id
left join tlb.roles r on r.id = ur.role_id
where p.id = 'aa9ba161-56b9-49fc-9ca5-c46070fa3d87';
