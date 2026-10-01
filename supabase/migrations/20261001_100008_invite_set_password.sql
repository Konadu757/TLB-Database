-- Patch: invitees set their own password when accepting.
-- Project: mfyvhpwjrpjcxdlsqgit (TLB Database)
-- Safe to re-run.
--
-- Adds:
--   public.validate_invite(token, access_code) → email/name/role without consuming
--   public.accept_invite(token, access_code, password) → consumes invite and sets GoTrue password
--
-- Does not mint a session. Client signs in with email + the new password after this returns.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- validate_invite (read-only check)
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

  return jsonb_build_object(
    'email', v_invite.email,
    'full_name', v_invite.full_name,
    'role_code', v_role_code,
    'access_code', v_invite.access_code
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
-- accept_invite with required password
-- Drop 2-arg wrappers, replace with 3-arg that sets encrypted_password.
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
    and lower(u.email) = v_email
  limit 1;

  if v_user_id is null then
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
  else
    -- Existing Auth row (e.g. prior accept with random hash): set the password they chose.
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
  'Consumes one live invite, ensures a profile, assigns tlb.user_roles, and sets the Auth password the invitee chose. Does not mint a GoTrue session.';

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
  'Data API RPC accept_invite. Requires a password of at least 8 characters. Does not mint a session.';

-- Grants
do $$
begin
  execute format('grant execute on function tlb.validate_invite(text, text) to %I', current_user);
  execute format('grant execute on function tlb.accept_invite(text, text, text) to %I', current_user);
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function tlb.validate_invite(text, text) from anon';
    execute 'revoke all on function tlb.accept_invite(text, text, text) from anon';
    execute 'grant execute on function public.validate_invite(text, text) to anon';
    execute 'grant execute on function public.accept_invite(text, text, text) to anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function tlb.validate_invite(text, text) from authenticated';
    execute 'revoke all on function tlb.accept_invite(text, text, text) from authenticated';
    execute 'grant execute on function public.validate_invite(text, text) to authenticated';
    execute 'grant execute on function public.accept_invite(text, text, text) to authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function tlb.validate_invite(text, text) to service_role';
    execute 'grant execute on function tlb.accept_invite(text, text, text) to service_role';
    execute 'grant execute on function public.validate_invite(text, text) to service_role';
    execute 'grant execute on function public.accept_invite(text, text, text) to service_role';
  end if;
end;
$$;
