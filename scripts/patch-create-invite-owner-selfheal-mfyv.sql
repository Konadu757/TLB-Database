-- =============================================================================
-- TLB Database — create_invite self-heal for first Owner Auth session
-- =============================================================================
-- When auth.uid() is set but nobody holds users.manage yet, assign OWNER to the
-- caller (if they have an active profile) before the permission check. Stops the
-- chicken-egg after GoTrue sign-in without a prior user_roles row.
-- Re-applies the same create_invite body as 100006 with that preamble.
-- =============================================================================

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
  v_owner_role_id uuid;
begin
  -- First Auth Owner: if signed in, profile exists, and no one holds users.manage,
  -- grant OWNER so invite issue can proceed (bootstrap without service-role UI).
  if auth.uid() is not null
     and not tlb.has_permission('users.manage')
     and exists (select 1 from tlb.profiles p where p.id = auth.uid() and p.active)
     and not exists (
       select 1
       from tlb.user_roles ur
       join tlb.role_permissions rp on rp.role_id = ur.role_id
       where rp.permission_code = 'users.manage'
     )
  then
    select r.id
      into v_owner_role_id
    from tlb.roles r
    where r.code = 'OWNER'
      and r.is_system
      and r.active
      and r.deleted_at is null;

    if v_owner_role_id is not null then
      insert into tlb.role_permissions (role_id, permission_code)
      select v_owner_role_id, 'users.manage'
      where not exists (
        select 1
        from tlb.role_permissions rp
        where rp.role_id = v_owner_role_id
          and rp.permission_code = 'users.manage'
      );

      insert into tlb.user_roles (user_id, role_id)
      values (auth.uid(), v_owner_role_id)
      on conflict do nothing;
    end if;
  end if;

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

comment on function tlb.create_invite(text, text, text, text, text, timestamptz, text) is
  'Stores an invite. Hashes the URL token. Auto-grants OWNER once when no users.manage holder exists.';
