-- Patch: block same-email invite collisions with Owner / existing Auth users.
-- Project: mfyvhpwjrpjcxdlsqgit (TLB Database)
-- Safe to re-run.
--
-- One email = one Auth user = one staff identity.
-- create_invite / validate_invite / accept_invite refuse Owner (or any existing
-- Auth/profile) email so accept cannot overwrite the Owner password or attach
-- an invitee session to the Owner account.
--
-- Preserves optional p_phone on create_invite from the phone-onboarding patch.

-- Expire live invites that already collide with an Owner Auth email.
update tlb.invites i
   set expires_at = least(i.expires_at, now())
 where i.consumed_at is null
   and i.expires_at > now()
   and exists (
     select 1
     from auth.users u
     join tlb.user_roles ur on ur.user_id = u.id
     join tlb.roles r on r.id = ur.role_id
     where u.email is not null
       and lower(u.email) = lower(i.email)
       and r.code = 'OWNER'
       and r.is_system
       and coalesce(r.active, true)
       and r.deleted_at is null
   );

-- ---------------------------------------------------------------------------
-- create_invite — unique email + optional p_phone
-- ---------------------------------------------------------------------------

drop function if exists public.create_invite(text, text, text, text, text, timestamptz, text, text);
drop function if exists public.create_invite(text, text, text, text, text, timestamptz, text);
drop function if exists tlb.create_invite(text, text, text, text, text, timestamptz, text, text);
drop function if exists tlb.create_invite(text, text, text, text, text, timestamptz, text);

create function tlb.create_invite(
  p_email text,
  p_full_name text,
  p_role_code text,
  p_token text,
  p_access_code text,
  p_expires_at timestamptz default null,
  p_replaces_token text default null,
  p_phone text default null
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
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_replaces text := nullif(btrim(coalesce(p_replaces_token, '')), '');
  v_role_id uuid;
  v_created_by uuid;
  v_expires_at timestamptz;
  v_invite_id uuid;
  v_can_replace boolean := false;
  v_owner_role_id uuid;
  v_existing_auth uuid;
begin
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

  -- One email = one Auth user = one staff identity.
  select u.id
    into v_existing_auth
  from auth.users u
  where u.email is not null
    and lower(u.email) = v_email
  limit 1;

  if v_existing_auth is not null then
    if exists (
      select 1
      from tlb.user_roles ur
      join tlb.roles r on r.id = ur.role_id
      where ur.user_id = v_existing_auth
        and r.code = 'OWNER'
        and r.is_system
        and r.deleted_at is null
    ) then
      raise exception 'this email already belongs to the Owner account — invite staff with a different email'
        using errcode = '22023';
    end if;

    raise exception 'this email already has a sign-in account — use a different email for this staff member'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from tlb.profiles p
    where p.email is not null
      and lower(p.email) = v_email
  ) then
    raise exception 'this email is already registered to a staff account — use a unique email'
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
      created_by,
      phone
    ) values (
      tlb.sha256_hex(v_token),
      v_code,
      v_email,
      v_full_name,
      v_role_id,
      v_expires_at,
      v_created_by,
      v_phone
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

revoke all on function tlb.create_invite(text, text, text, text, text, timestamptz, text, text) from public;

create function public.create_invite(
  p_email text,
  p_full_name text,
  p_role_code text,
  p_token text,
  p_access_code text,
  p_expires_at timestamptz default null,
  p_replaces_token text default null,
  p_phone text default null
)
returns uuid
language sql
security definer
set search_path = tlb, public, pg_temp
as $$
  select tlb.create_invite(
    p_email,
    p_full_name,
    p_role_code,
    p_token,
    p_access_code,
    p_expires_at,
    p_replaces_token,
    p_phone
  );
$$;

revoke all on function public.create_invite(text, text, text, text, text, timestamptz, text, text) from public;

comment on function public.create_invite(text, text, text, text, text, timestamptz, text, text) is
  'Data API RPC create_invite. Rejects emails already used by Auth/Owner/staff. Optional p_phone for /access prefill.';

-- ---------------------------------------------------------------------------
-- validate_invite — refuse preview when invite email is already an Auth/Owner account
-- ---------------------------------------------------------------------------

create or replace function tlb.validate_invite(
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
  v_role_code text;
  v_existing_auth uuid;
begin
  if v_token is null and v_code is null then
    raise exception 'invalid invite'
      using errcode = '22023';
  end if;

  if v_token is not null then
    select *
      into v_invite
    from tlb.invites
    where token_hash = tlb.sha256_hex(v_token);
  else
    select *
      into v_invite
    from tlb.invites
    where access_code = v_code;
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

  select u.id
    into v_existing_auth
  from auth.users u
  where u.email is not null
    and lower(u.email) = lower(v_invite.email)
  limit 1;

  if v_existing_auth is not null then
    if exists (
      select 1
      from tlb.user_roles ur
      join tlb.roles r on r.id = ur.role_id
      where ur.user_id = v_existing_auth
        and r.code = 'OWNER'
        and r.is_system
        and r.deleted_at is null
    ) then
      raise exception 'invite email already belongs to the Owner account — ask an Owner to invite a different email'
        using errcode = '22023';
    end if;

    if exists (select 1 from tlb.profiles p where p.id = v_existing_auth) then
      raise exception 'invite email is already registered — ask an Owner to invite a different email'
        using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1
    from tlb.profiles p
    where p.email is not null
      and lower(p.email) = lower(v_invite.email)
      and (v_existing_auth is null or p.id is distinct from v_existing_auth)
  ) then
    raise exception 'invite email is already registered — ask an Owner to invite a different email'
      using errcode = '22023';
  end if;

  return jsonb_strip_nulls(
    jsonb_build_object(
      'email', v_invite.email,
      'full_name', v_invite.full_name,
      'role_code', v_role_code,
      'access_code', v_invite.access_code,
      'phone', nullif(btrim(coalesce(v_invite.phone, '')), '')
    )
  );
end;
$$;

revoke all on function tlb.validate_invite(text, text) from public;

create or replace function public.validate_invite(
  p_token text default null,
  p_access_code text default null
)
returns jsonb
language sql
security definer
set search_path = tlb, public, pg_temp
as $$
  select tlb.validate_invite(p_token, p_access_code);
$$;

revoke all on function public.validate_invite(text, text) from public;

-- ---------------------------------------------------------------------------
-- accept_invite — never overwrite Owner / existing Auth password via invite
-- ---------------------------------------------------------------------------

drop function if exists public.accept_invite(text, text);
drop function if exists tlb.accept_invite(text, text);
drop function if exists public.accept_invite(text, text, text);
drop function if exists tlb.accept_invite(text, text, text);

create function tlb.accept_invite(
  p_token text default null,
  p_access_code text default null,
  p_password text default null
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
  v_password text := nullif(p_password, '');
  v_invite tlb.invites%rowtype;
  v_email text;
  v_full_name text;
  v_role_code text;
  v_user_id uuid;
  v_profile_id uuid;
  v_active boolean;
  v_instance_id uuid;
  v_password_hash text;
begin
  if v_token is null and v_code is null then
    raise exception 'invalid invite'
      using errcode = '22023';
  end if;

  if v_password is null or char_length(v_password) < 8 then
    raise exception 'password must be at least 8 characters'
      using errcode = '22023';
  end if;

  if char_length(v_password) > 200 then
    raise exception 'password is too long'
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
  v_password_hash := crypt(v_password, gen_salt('bf'));

  select u.id
    into v_user_id
  from auth.users u
  where u.email is not null
    and lower(u.email) = lower(v_email)
  limit 1;

  if v_user_id is not null then
    -- Existing Auth row: never steal Owner or overwrite another staff login.
    if exists (
      select 1
      from tlb.user_roles ur
      join tlb.roles r on r.id = ur.role_id
      where ur.user_id = v_user_id
        and r.code = 'OWNER'
        and r.is_system
        and r.deleted_at is null
    ) then
      raise exception 'invite email already belongs to the Owner account — ask an Owner to invite a different email'
        using errcode = '22023';
    end if;

    if exists (select 1 from tlb.profiles p where p.id = v_user_id) then
      raise exception 'invite email is already registered — cannot accept invite for an existing account'
        using errcode = '22023';
    end if;

    -- Auth exists without a profile (incomplete prior attempt): set chosen password only.
    update auth.users
       set encrypted_password = v_password_hash,
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now(),
           raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
             || '{"provider":"email","providers":["email"]}'::jsonb,
           raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
             || jsonb_build_object('full_name', v_full_name)
     where id = v_user_id;

    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    select
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
    where not exists (
      select 1
      from auth.identities i
      where i.user_id = v_user_id
        and i.provider = 'email'
    );
  else
    v_user_id := gen_random_uuid();
    select id
      into v_instance_id
    from auth.instances
    limit 1;
    v_instance_id := coalesce(v_instance_id, '00000000-0000-0000-0000-000000000000');

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
      v_password_hash,
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

    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
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

revoke all on function tlb.accept_invite(text, text, text) from public;

comment on function tlb.accept_invite(text, text, text) is
  'Consumes invite, creates Auth+profile for a NEW email only. Refuses Owner/existing Auth emails so invite cannot overwrite another login.';

create function public.accept_invite(
  p_token text default null,
  p_access_code text default null,
  p_password text default null
)
returns jsonb
language sql
security definer
set search_path = tlb, public, pg_temp
as $$
  select tlb.accept_invite(p_token, p_access_code, p_password);
$$;

revoke all on function public.accept_invite(text, text, text) from public;

comment on function public.accept_invite(text, text, text) is
  'Data API RPC accept_invite. Requires password. Refuses emails already used by Owner or another Auth account.';

-- Grants
do $$
begin
  execute format(
    'grant execute on function tlb.create_invite(text, text, text, text, text, timestamptz, text, text) to %I',
    current_user
  );
  execute format('grant execute on function tlb.validate_invite(text, text) to %I', current_user);
  execute format('grant execute on function tlb.accept_invite(text, text, text) to %I', current_user);
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function tlb.create_invite(text, text, text, text, text, timestamptz, text, text) from anon';
    execute 'revoke all on function tlb.validate_invite(text, text) from anon';
    execute 'revoke all on function tlb.accept_invite(text, text, text) from anon';
    execute 'grant execute on function public.create_invite(text, text, text, text, text, timestamptz, text, text) to anon';
    execute 'grant execute on function public.validate_invite(text, text) to anon';
    execute 'grant execute on function public.accept_invite(text, text, text) to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function tlb.create_invite(text, text, text, text, text, timestamptz, text, text) from authenticated';
    execute 'revoke all on function tlb.validate_invite(text, text) from authenticated';
    execute 'revoke all on function tlb.accept_invite(text, text, text) from authenticated';
    execute 'grant execute on function public.create_invite(text, text, text, text, text, timestamptz, text, text) to authenticated';
    execute 'grant execute on function public.validate_invite(text, text) to authenticated';
    execute 'grant execute on function public.accept_invite(text, text, text) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function tlb.create_invite(text, text, text, text, text, timestamptz, text, text) to service_role';
    execute 'grant execute on function tlb.validate_invite(text, text) to service_role';
    execute 'grant execute on function tlb.accept_invite(text, text, text) to service_role';
    execute 'grant execute on function public.create_invite(text, text, text, text, text, timestamptz, text, text) to service_role';
    execute 'grant execute on function public.validate_invite(text, text) to service_role';
    execute 'grant execute on function public.accept_invite(text, text, text) to service_role';
  end if;
end;
$$;
