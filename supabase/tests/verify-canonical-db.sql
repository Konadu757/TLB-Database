-- Canonical tlb schema checks.
-- Run after every migration in supabase/migrations, including the historical
-- prototype files and 20260928_100001 through 20260928_100006:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/verify-canonical-db.sql
--
-- The script inserts fixture rows, expects several constraints to fail, then
-- ROLLBACK so a successful run leaves no fixture data. It does not need a
-- test framework. It was written to run as a role that bypasses RLS
-- (postgres / migration owner). It does not impersonate authenticated.

begin;

do $verify$
declare
  v_missing text;
  v_count integer;
  v_product uuid;
  v_warehouse uuid;
  v_batch uuid;
  v_uom uuid;
  v_on_hand numeric(18, 4);
  v_reserved numeric(18, 4);
  v_remaining numeric(18, 4);
  v_available numeric(18, 4);
  v_number text;
  v_options text[];
begin
  if to_regnamespace('tlb') is null then
    raise exception 'VERIFY FAIL: schema tlb does not exist';
  end if;

  select string_agg(required.relname, ', ')
    into v_missing
  from (
    values
      ('profiles'),
      ('roles'),
      ('permissions'),
      ('role_permissions'),
      ('user_roles'),
      ('warehouses'),
      ('user_warehouse_access'),
      ('units_of_measure'),
      ('product_categories'),
      ('products'),
      ('customers'),
      ('suppliers'),
      ('inventory_batches'),
      ('inventory_movements'),
      ('inventory_balances'),
      ('inventory_reservations'),
      ('document_sequences'),
      ('audit_events'),
      ('invites')
  ) as required(relname)
  where to_regclass('tlb.' || required.relname) is null;

  if v_missing is not null then
    raise exception 'VERIFY FAIL: missing tlb tables: %', v_missing;
  end if;

  if to_regclass('public.warehouses') is null
     or to_regclass('public.products') is null
     or to_regclass('public.customers') is null
     or to_regclass('public.audit_events') is null then
    raise exception 'VERIFY FAIL: prototype public tables are missing; they must not be dropped';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'tlb'
      and table_name = 'profiles'
      and column_name in ('password', 'password_hash', 'encrypted_password')
  ) then
    raise exception 'VERIFY FAIL: profiles stores a password column';
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_class frel on frel.oid = con.confrelid
    join pg_namespace fnsp on fnsp.oid = frel.relnamespace
    where nsp.nspname = 'tlb'
      and rel.relname = 'profiles'
      and con.contype = 'f'
      and fnsp.nspname = 'auth'
      and frel.relname = 'users'
  ) then
    raise exception 'VERIFY FAIL: profiles.id does not reference auth.users';
  end if;

  select count(*) into v_count from tlb.permissions;
  if v_count <> 39 then
    raise exception 'VERIFY FAIL: expected 39 permissions, found %', v_count;
  end if;

  select count(*) into v_count from tlb.roles where is_system;
  if v_count <> 9 then
    raise exception 'VERIFY FAIL: expected 9 system roles, found %', v_count;
  end if;

  select count(*) into v_count from tlb.units_of_measure;
  if v_count <> 7 then
    raise exception 'VERIFY FAIL: expected 7 units of measure, found %', v_count;
  end if;

  select count(*) into v_count
  from tlb.role_permissions rp
  join tlb.roles r on r.id = rp.role_id
  where r.code = 'OWNER';
  if v_count <> 39 then
    raise exception 'VERIFY FAIL: OWNER permissions = %', v_count;
  end if;

  select count(*) into v_count
  from tlb.role_permissions rp
  join tlb.roles r on r.id = rp.role_id
  where r.code = 'ADMIN';
  if v_count <> 39 then
    raise exception 'VERIFY FAIL: ADMIN permissions = %', v_count;
  end if;

  select count(*) into v_count
  from tlb.role_permissions rp
  join tlb.roles r on r.id = rp.role_id
  where r.code = 'MANAGER';
  if v_count <> 34 then
    raise exception 'VERIFY FAIL: MANAGER permissions = %', v_count;
  end if;

  select count(*) into v_count
  from tlb.role_permissions rp
  join tlb.roles r on r.id = rp.role_id
  where r.code = 'SALES';
  if v_count <> 19 then
    raise exception 'VERIFY FAIL: SALES permissions = %', v_count;
  end if;

  select count(*) into v_count
  from tlb.role_permissions rp
  join tlb.roles r on r.id = rp.role_id
  where r.code = 'WAREHOUSE';
  if v_count <> 16 then
    raise exception 'VERIFY FAIL: WAREHOUSE permissions = %', v_count;
  end if;

  select count(*) into v_count
  from tlb.role_permissions rp
  join tlb.roles r on r.id = rp.role_id
  where r.code = 'FINANCE';
  if v_count <> 13 then
    raise exception 'VERIFY FAIL: FINANCE permissions = %', v_count;
  end if;

  select count(*) into v_count
  from tlb.role_permissions rp
  join tlb.roles r on r.id = rp.role_id
  where r.code = 'DRIVER';
  if v_count <> 5 then
    raise exception 'VERIFY FAIL: DRIVER permissions = %', v_count;
  end if;

  select count(*) into v_count
  from tlb.role_permissions rp
  join tlb.roles r on r.id = rp.role_id
  where r.code = 'REQUESTER';
  if v_count <> 6 then
    raise exception 'VERIFY FAIL: REQUESTER permissions = %', v_count;
  end if;

  select count(*) into v_count
  from tlb.role_permissions rp
  join tlb.roles r on r.id = rp.role_id
  where r.code = 'RECEIVER';
  if v_count <> 5 then
    raise exception 'VERIFY FAIL: RECEIVER permissions = %', v_count;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'tlb'
      and table_name = 'customers'
      and column_name = 'credit_limit'
      and (data_type <> 'numeric' or numeric_precision <> 18 or numeric_scale <> 2)
  ) then
    raise exception 'VERIFY FAIL: customers.credit_limit must be numeric(18,2)';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'tlb'
      and table_name = 'customers'
      and column_name = 'payment_terms_days'
      and data_type <> 'integer'
  ) then
    raise exception 'VERIFY FAIL: customers.payment_terms_days must be integer';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'tlb'
      and table_name = 'inventory_movements'
      and column_name = 'quantity'
      and (data_type <> 'numeric' or numeric_precision <> 18 or numeric_scale <> 4)
  ) then
    raise exception 'VERIFY FAIL: inventory_movements.quantity must be numeric(18,4)';
  end if;

  select string_agg(c.relname, ', ' order by c.relname)
    into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'tlb'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if v_missing is not null then
    raise exception 'VERIFY FAIL: RLS disabled on %', v_missing;
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'tlb'
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');

  if v_count <> 0 then
    raise exception 'VERIFY FAIL: found % write policies; this foundation allows SELECT only', v_count;
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'tlb'
    and cmd = 'SELECT';

  if v_count <> 19 then
    raise exception 'VERIFY FAIL: expected 19 SELECT policies, found %', v_count;
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tlb'
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
  ) then
    raise exception 'VERIFY FAIL: a security definer function is missing search_path';
  end if;

  select c.reloptions
    into v_options
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'tlb'
    and c.relname = 'v_inventory_availability';

  if v_options is null or not ('security_invoker=true' = any (v_options)) then
    raise exception 'VERIFY FAIL: v_inventory_availability must be security_invoker';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'tlb.customers', 'select')
       or has_table_privilege('anon', 'tlb.audit_events', 'insert') then
      raise exception 'VERIFY FAIL: anon has access to tlb';
    end if;
    if has_function_privilege('anon', 'tlb.next_document_number(text, integer)', 'execute') then
      raise exception 'VERIFY FAIL: anon can execute next_document_number';
    end if;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    if has_table_privilege('authenticated', 'tlb.products', 'insert')
       or has_table_privilege('authenticated', 'tlb.inventory_movements', 'insert')
       or has_table_privilege('authenticated', 'tlb.audit_events', 'update')
       or has_table_privilege('authenticated', 'tlb.audit_events', 'delete') then
      raise exception 'VERIFY FAIL: authenticated has a table write privilege';
    end if;
    if has_function_privilege('authenticated', 'tlb.next_document_number(text, integer)', 'execute') then
      raise exception 'VERIFY FAIL: authenticated can execute next_document_number';
    end if;
    if not has_function_privilege('authenticated', 'tlb.has_permission(text)', 'execute') then
      raise exception 'VERIFY FAIL: authenticated cannot execute has_permission';
    end if;
    if not has_function_privilege(
      'authenticated',
      'tlb.record_audit_event(text, text, text, text, jsonb)',
      'execute'
    ) then
      raise exception 'VERIFY FAIL: authenticated cannot execute record_audit_event';
    end if;
  end if;

  select id into v_uom from tlb.units_of_measure where code = 'EA';
  if v_uom is null then
    raise exception 'VERIFY FAIL: EA unit was not seeded';
  end if;

  insert into tlb.warehouses (code, name, location)
  values ('WH-VERIFY', 'Verification warehouse', 'Test');
  insert into tlb.products (sku, name, uom_id)
  values ('SKU-VERIFY', 'Verification product', v_uom)
  returning id into v_product;

  select id into v_warehouse from tlb.warehouses where code = 'WH-VERIFY';

  begin
    insert into tlb.products (sku, name, uom_id)
    values ('SKU-VERIFY', 'Duplicate sku', v_uom);
    raise exception 'VERIFY FAIL: duplicate sku was accepted';
  exception
    when unique_violation then
      null;
  end;

  begin
    insert into tlb.warehouses (code, name)
    values ('WH-VERIFY', 'Duplicate warehouse');
    raise exception 'VERIFY FAIL: duplicate warehouse code was accepted';
  exception
    when unique_violation then
      null;
  end;

  begin
    insert into tlb.roles (code, name, description, is_system)
    values ('OWNER', 'Duplicate owner', 'should fail', true);
    raise exception 'VERIFY FAIL: duplicate role code was accepted';
  exception
    when unique_violation then
      null;
  end;

  begin
    insert into tlb.inventory_movements (
      movement_number, movement_type, direction, quantity,
      product_id, warehouse_id, qty_before, qty_after
    ) values (
      'TLB-MV-VERIFY-DIR', 'opening', 0, 1,
      v_product, v_warehouse, 0, 1
    );
    raise exception 'VERIFY FAIL: invalid movement direction was accepted';
  exception
    when check_violation then
      null;
  end;

  begin
    insert into tlb.inventory_movements (
      movement_number, movement_type, direction, quantity,
      product_id, warehouse_id, qty_before, qty_after
    ) values (
      'TLB-MV-VERIFY-ZERO', 'opening', 1, 0,
      v_product, v_warehouse, 0, 0
    );
    raise exception 'VERIFY FAIL: zero movement quantity was accepted';
  exception
    when check_violation then
      null;
  end;

  begin
    insert into tlb.inventory_batches (
      batch_number, product_id, warehouse_id,
      quantity_received, quantity_remaining, unit_cost, received_at
    ) values (
      'BAT-VERIFY-BAD', v_product, v_warehouse,
      1, 5, 0, now()
    );
    raise exception 'VERIFY FAIL: remaining quantity above received was accepted';
  exception
    when check_violation then
      null;
  end;

  begin
    insert into tlb.document_sequences (document_type, period_year, last_value)
    values ('CUS', 2098, 125);
    insert into tlb.document_sequences (document_type, period_year, last_value)
    values ('CUS', 2098, 125);
    raise exception 'VERIFY FAIL: duplicate document sequence was accepted';
  exception
    when unique_violation then
      null;
  end;

  v_number := tlb.next_document_number('ORD', 2099);
  if v_number <> 'TLB-ORD-2099-000125' then
    raise exception 'VERIFY FAIL: first order number was %', v_number;
  end if;

  v_number := tlb.next_document_number('order', 2099);
  if v_number <> 'TLB-ORD-2099-000126' then
    raise exception 'VERIFY FAIL: second order number was %', v_number;
  end if;

  begin
    perform tlb.next_document_number('not-a-document', 2099);
    raise exception 'VERIFY FAIL: unknown document type was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  insert into tlb.audit_events (action, entity_type, entity_id, summary)
  values ('settings.updated', 'settings', 'verify-company', 'Canonical audit insert');

  begin
    update tlb.audit_events
       set summary = 'mutated'
     where entity_id = 'verify-company';
    raise exception 'VERIFY FAIL: audit update was accepted';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;

  begin
    perform tlb.record_audit_event(
      'settings.updated', 'settings', 'verify-fn', 'no session', null
    );
    raise exception 'VERIFY FAIL: record_audit_event ran without auth.uid()';
  exception
    when insufficient_privilege then
      null;
  end;

  insert into tlb.inventory_batches (
    batch_number, product_id, warehouse_id,
    quantity_received, quantity_remaining, unit_cost, received_at, status
  ) values (
    'BAT-VERIFY-OK', v_product, v_warehouse,
    10, 0, 12.50, now(), 'Open'
  )
  returning id into v_batch;

  insert into tlb.inventory_movements (
    movement_number, movement_type, direction, quantity,
    product_id, warehouse_id, batch_id, qty_before, qty_after
  ) values (
    'TLB-MV-2099-000125', 'grn', 1, 10,
    v_product, v_warehouse, v_batch, 0, 10
  );

  insert into tlb.inventory_reservations (
    product_id, warehouse_id, batch_id, quantity, status
  ) values (
    v_product, v_warehouse, v_batch, 2, 'active'
  );

  insert into tlb.inventory_movements (
    movement_number, movement_type, direction, quantity,
    product_id, warehouse_id, batch_id, qty_before, qty_after
  ) values (
    'TLB-MV-2099-000126', 'issue', -1, 4,
    v_product, v_warehouse, v_batch, 10, 6
  );

  select b.quantity_on_hand, b.quantity_reserved
    into v_on_hand, v_reserved
  from tlb.inventory_balances b
  where b.product_id = v_product
    and b.warehouse_id = v_warehouse;

  if v_on_hand <> 6 or v_reserved <> 2 then
    raise exception 'VERIFY FAIL: balance projection on_hand % reserved %', v_on_hand, v_reserved;
  end if;

  select quantity_remaining into v_remaining
  from tlb.inventory_batches
  where id = v_batch;

  if v_remaining <> 6 then
    raise exception 'VERIFY FAIL: batch remaining is %', v_remaining;
  end if;

  select quantity_available into v_available
  from tlb.v_inventory_availability
  where product_id = v_product
    and warehouse_id = v_warehouse;

  if v_available <> 4 then
    raise exception 'VERIFY FAIL: available quantity is %', v_available;
  end if;

  begin
    update tlb.inventory_balances
       set quantity_on_hand = 0
     where product_id = v_product
       and warehouse_id = v_warehouse;
    raise exception 'VERIFY FAIL: direct balance update was accepted';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    delete from tlb.inventory_movements
    where movement_number = 'TLB-MV-2099-000126';
    raise exception 'VERIFY FAIL: movement delete was accepted';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'tlb'
      and table_name = 'invites'
      and column_name in ('password', 'password_hash', 'encrypted_password', 'token')
  ) then
    raise exception 'VERIFY FAIL: invites stores a raw token or password';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    if exists (
      select 1
      from information_schema.role_table_grants g
      where g.grantee = 'authenticated'
        and g.table_schema = 'tlb'
        and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ) then
      raise exception 'VERIFY FAIL: authenticated has table DML on tlb';
    end if;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    select string_agg(t.relname, ', ' order by t.relname)
      into v_missing
    from (
      values
        ('stock_movements'),
        ('batches'),
        ('goods_receipts'),
        ('goods_receipt_lines'),
        ('stock_issues'),
        ('stock_issue_lines'),
        ('warehouse_transfers'),
        ('warehouse_transfer_lines'),
        ('stock_adjustments'),
        ('stock_adjustment_lines')
    ) as t(relname)
    where to_regclass('public.' || t.relname) is not null
      and (
        has_table_privilege('anon', 'public.' || t.relname, 'INSERT')
        or has_table_privilege('anon', 'public.' || t.relname, 'UPDATE')
        or has_table_privilege('anon', 'public.' || t.relname, 'DELETE')
      );

    if v_missing is not null then
      raise exception 'VERIFY FAIL: anon still has write grant on %', v_missing;
    end if;
  end if;

  declare
    v_role_id uuid;
    v_accept jsonb;
  begin
    select id into v_role_id from tlb.roles where code = 'WAREHOUSE';
    if v_role_id is null then
      raise exception 'VERIFY FAIL: WAREHOUSE role missing';
    end if;

    begin
      perform tlb.create_invite(
        'not-a-role@tlb.gh',
        'Not A Role',
        'NOT_A_ROLE',
        'verify-token-value-0001',
        'TLB-VER1-FY01',
        now() + interval '2 days',
        null
      );
      raise exception 'VERIFY FAIL: unknown invite role was accepted';
    exception
      when invalid_parameter_value then
        null;
    end;

    perform tlb.create_invite(
      'verify-invite@tlb.gh',
      'Verify Invite',
      'WAREHOUSE',
      'verify-token-value-0001',
      'TLB-VER1-FY01',
      now() + interval '2 days',
      null
    );

    v_accept := tlb.accept_invite('verify-token-value-0001', null);
    if v_accept ->> 'profile_id' is null then
      raise exception 'VERIFY FAIL: accept_invite returned no profile';
    end if;
    if v_accept ->> 'role_code' <> 'WAREHOUSE' then
      raise exception 'VERIFY FAIL: accept_invite role was %', v_accept ->> 'role_code';
    end if;
    if not exists (
      select 1
      from tlb.user_roles ur
      join tlb.roles r on r.id = ur.role_id
      where ur.user_id = (v_accept ->> 'profile_id')::uuid
        and r.code = 'WAREHOUSE'
    ) then
      raise exception 'VERIFY FAIL: accept_invite did not assign user_roles';
    end if;

    begin
      perform tlb.accept_invite('verify-token-value-0001', null);
      raise exception 'VERIFY FAIL: invite accepted twice';
    exception
      when invalid_parameter_value then
        if sqlerrm not like '%invite already used%' then
          raise exception 'VERIFY FAIL: second accept error was %', sqlerrm;
        end if;
    end;

    insert into tlb.invites (
      token_hash, access_code, email, full_name, role_id, expires_at
    ) values (
      tlb.sha256_hex('expired-token-value-01'),
      'TLB-EXPR-9K2M',
      'expired.invite@tlb.gh',
      'Expired Invite',
      v_role_id,
      now() - interval '1 minute'
    );

    begin
      perform tlb.accept_invite(null, 'TLB-EXPR-9K2M');
      raise exception 'VERIFY FAIL: expired invite accepted';
    exception
      when invalid_parameter_value then
        if sqlerrm not like '%invite expired%' then
          raise exception 'VERIFY FAIL: expired invite error was %', sqlerrm;
        end if;
    end;
  end;

  select string_agg(c.relname, ', ' order by c.relname)
    into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'tlb'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if v_missing is not null then
    raise exception 'VERIFY FAIL: RLS disabled on %', v_missing;
  end if;
end
$verify$;

rollback;
