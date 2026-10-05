-- =============================================================================
-- TLB (mfyvhpwjrpjcxdlsqgit) — repair Finance staff role / auth_directory
-- =============================================================================
-- Permanent rule: only aa9ba161-… / mccaesartechsolutions@gmail.com is Owner.
-- Every other profile invited as FINANCE must not keep OWNER in tlb.user_roles
-- or public.app_settings.auth_directory.
-- Safe to re-run.
-- =============================================================================

do $$
declare
  v_owner_id uuid := 'aa9ba161-56b9-49fc-9ca5-c46070fa3d87';
  v_owner_email text := 'mccaesartechsolutions@gmail.com';
  v_owner_role_id uuid;
  v_finance_role_id uuid;
  v_dir jsonb;
  v_user jsonb;
  v_id text;
  v_email text;
  v_role_id text;
  v_cloud_code text;
  v_kept jsonb := '[]'::jsonb;
  v_fixed int := 0;
  v_mapped_role text;
begin
  select r.id into v_owner_role_id
    from tlb.roles r
   where r.code = 'OWNER' and r.is_system and r.active and r.deleted_at is null;

  select r.id into v_finance_role_id
    from tlb.roles r
   where r.code = 'FINANCE' and r.is_system and r.active and r.deleted_at is null;

  if v_owner_role_id is null then
    raise exception 'OWNER system role missing';
  end if;
  if v_finance_role_id is null then
    raise exception 'FINANCE system role missing';
  end if;

  -- Strip OWNER from every non-Owner Auth profile.
  delete from tlb.user_roles ur
   using tlb.roles r
   where ur.role_id = r.id
     and r.code = 'OWNER'
     and ur.user_id <> v_owner_id;

  -- Ensure every profile that accepted / holds a FINANCE invite has FINANCE.
  insert into tlb.user_roles (user_id, role_id)
  select distinct p.id, v_finance_role_id
    from tlb.profiles p
    join tlb.invites i
      on lower(btrim(i.email)) = lower(btrim(p.email))
    join tlb.roles r on r.id = i.role_id
   where r.code = 'FINANCE'
     and p.id <> v_owner_id
     and lower(btrim(coalesce(p.email, ''))) <> v_owner_email
     and not exists (
       select 1 from tlb.user_roles ur
        where ur.user_id = p.id and ur.role_id = v_finance_role_id
     );

  -- Heal auth_directory roleIds from live tlb.user_roles / invites.
  if to_regclass('public.app_settings') is not null then
    select s.value into v_dir
      from public.app_settings s
     where s.key = 'auth_directory';

    if v_dir is not null and jsonb_typeof(v_dir -> 'users') = 'array' then
      for v_user in
        select value from jsonb_array_elements(v_dir -> 'users')
      loop
        v_id := coalesce(v_user ->> 'id', '');
        v_email := lower(btrim(coalesce(v_user ->> 'email', '')));
        v_role_id := coalesce(v_user ->> 'roleId', '');
        v_cloud_code := null;
        v_mapped_role := null;

        if v_id = v_owner_id::text or v_email = v_owner_email then
          v_user := jsonb_set(v_user, '{roleId}', to_jsonb('role-owner'::text), true);
          v_user := jsonb_set(v_user, '{name}', to_jsonb('TLB Owner'::text), true);
          v_user := jsonb_set(v_user, '{email}', to_jsonb(v_owner_email), true);
          v_kept := v_kept || jsonb_build_array(v_user);
          continue;
        end if;

        if v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
          select r.code into v_cloud_code
            from tlb.user_roles ur
            join tlb.roles r on r.id = ur.role_id
           where ur.user_id = v_id::uuid
             and r.deleted_at is null
           order by case when r.code = 'OWNER' then 1 else 0 end, r.code
           limit 1;
        end if;

        if v_cloud_code is null and v_email <> '' then
          select r.code into v_cloud_code
            from tlb.profiles p
            join tlb.user_roles ur on ur.user_id = p.id
            join tlb.roles r on r.id = ur.role_id
           where lower(btrim(p.email)) = v_email
             and r.deleted_at is null
           order by case when r.code = 'OWNER' then 1 else 0 end, r.code
           limit 1;
        end if;

        if v_cloud_code is null and v_email <> '' then
          select r.code into v_cloud_code
            from tlb.invites i
            join tlb.roles r on r.id = i.role_id
           where lower(btrim(i.email)) = v_email
           order by i.created_at desc nulls last
           limit 1;
        end if;

        if v_cloud_code is not null then
          v_mapped_role := 'role-' || lower(v_cloud_code);
        elsif v_role_id = 'role-owner' then
          v_mapped_role := 'role-admin';
        end if;

        if v_mapped_role is not null and v_mapped_role <> v_role_id then
          v_user := jsonb_set(v_user, '{roleId}', to_jsonb(v_mapped_role), true);
          v_fixed := v_fixed + 1;
        end if;

        v_kept := v_kept || jsonb_build_array(v_user);
      end loop;

      v_dir := jsonb_set(v_dir, '{users}', v_kept, true);
      insert into public.app_settings (key, value)
      values ('auth_directory', v_dir)
      on conflict (key) do update
        set value = excluded.value;
    end if;
  end if;

  raise notice 'finance staff role repair complete; auth_directory rows fixed=%', v_fixed;
end $$;

select p.id,
       p.email,
       p.full_name,
       r.code as role_code
  from tlb.profiles p
  left join tlb.user_roles ur on ur.user_id = p.id
  left join tlb.roles r on r.id = ur.role_id and r.deleted_at is null
 where p.active
 order by case when p.id = 'aa9ba161-56b9-49fc-9ca5-c46070fa3d87' then 0 else 1 end,
          p.email;
