-- CP01 — Database foundation (schema tlb only).
-- Does not require public prototype tables. Does not test invites (CP02+).
--
--   npx supabase db query --linked -f supabase/tests/verify-cp01-foundation.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/verify-cp01-foundation.sql

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
    raise exception 'CP01 VERIFY FAIL: schema tlb does not exist';
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
      ('user_warehouse_access'),
      ('warehouses'),
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
      ('audit_events')
  ) as required(relname)
  where to_regclass('tlb.' || required.relname) is null;

  if v_missing is not null then
    raise exception 'CP01 VERIFY FAIL: missing tlb tables: %', v_missing;
  end if;

  select count(*) into v_count from tlb.permissions;
  if v_count <> 39 then
    raise exception 'CP01 VERIFY FAIL: expected 39 permissions, found %', v_count;
  end if;

  select count(*) into v_count from tlb.roles where is_system;
  if v_count <> 9 then
    raise exception 'CP01 VERIFY FAIL: expected 9 system roles, found %', v_count;
  end if;

  select count(*) into v_count from tlb.units_of_measure;
  if v_count <> 7 then
    raise exception 'CP01 VERIFY FAIL: expected 7 units of measure, found %', v_count;
  end if;

  select string_agg(c.relname, ', ' order by c.relname)
    into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'tlb'
    and c.relkind = 'r'
    and c.relname in (
      'profiles', 'roles', 'permissions', 'role_permissions', 'user_roles',
      'user_warehouse_access', 'warehouses', 'units_of_measure',
      'product_categories', 'products', 'customers', 'suppliers',
      'inventory_batches', 'inventory_movements', 'inventory_balances',
      'inventory_reservations', 'document_sequences', 'audit_events'
    )
    and not c.relrowsecurity;

  if v_missing is not null then
    raise exception 'CP01 VERIFY FAIL: RLS disabled on %', v_missing;
  end if;

  select count(*) into v_count
  from pg_policies pol
  where pol.schemaname = 'tlb'
    and pol.tablename in (
      'profiles', 'roles', 'permissions', 'role_permissions', 'user_roles',
      'user_warehouse_access', 'warehouses', 'units_of_measure',
      'product_categories', 'products', 'customers', 'suppliers',
      'inventory_batches', 'inventory_balances', 'inventory_movements',
      'inventory_reservations', 'document_sequences', 'audit_events'
    )
    and pol.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');

  if v_count <> 0 then
    raise exception 'CP01 VERIFY FAIL: write policies on foundation tables';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_table_privilege('anon', 'tlb.customers', 'select')
       or has_table_privilege('anon', 'tlb.audit_events', 'insert') then
      raise exception 'CP01 VERIFY FAIL: anon has access to tlb';
    end if;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    if has_table_privilege('authenticated', 'tlb.products', 'insert')
       or has_table_privilege('authenticated', 'tlb.inventory_movements', 'insert') then
      raise exception 'CP01 VERIFY FAIL: authenticated has table write on foundation';
    end if;
    if has_function_privilege('authenticated', 'tlb.next_document_number(text, integer)', 'execute') then
      raise exception 'CP01 VERIFY FAIL: authenticated can execute next_document_number';
    end if;
  end if;

  select id into v_uom from tlb.units_of_measure where code = 'EA';

  insert into tlb.warehouses (code, name, location)
  values ('WH-CP01', 'CP01 verify warehouse', 'Test');
  insert into tlb.products (sku, name, uom_id)
  values ('SKU-CP01', 'CP01 verify product', v_uom)
  returning id into v_product;

  select id into v_warehouse from tlb.warehouses where code = 'WH-CP01';

  insert into tlb.inventory_batches (
    batch_number, product_id, warehouse_id,
    quantity_received, quantity_remaining, unit_cost, received_at, status
  ) values (
    'BAT-CP01', v_product, v_warehouse,
    10, 0, 1, now(), 'Open'
  )
  returning id into v_batch;

  insert into tlb.inventory_movements (
    movement_number, movement_type, direction, quantity,
    product_id, warehouse_id, batch_id, qty_before, qty_after
  ) values (
    'TLB-MV-CP01-000001', 'grn', 1, 10,
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
    'TLB-MV-CP01-000002', 'issue', -1, 4,
    v_product, v_warehouse, v_batch, 10, 6
  );

  select b.quantity_on_hand, b.quantity_reserved
    into v_on_hand, v_reserved
  from tlb.inventory_balances b
  where b.product_id = v_product
    and b.warehouse_id = v_warehouse;

  if v_on_hand <> 6 or v_reserved <> 2 then
    raise exception 'CP01 VERIFY FAIL: balance on_hand % reserved %', v_on_hand, v_reserved;
  end if;

  select quantity_available into v_available
  from tlb.v_inventory_availability
  where product_id = v_product
    and warehouse_id = v_warehouse;

  if v_available <> 4 then
    raise exception 'CP01 VERIFY FAIL: available %', v_available;
  end if;

  v_number := tlb.next_document_number('ORD', 2097);
  if v_number <> 'TLB-ORD-2097-000125' then
    raise exception 'CP01 VERIFY FAIL: document number %', v_number;
  end if;

  insert into tlb.audit_events (action, entity_type, entity_id, summary)
  values ('cp01.verify', 'migration', 'cp01', 'CP01 foundation verify');

  begin
    update tlb.audit_events set summary = 'x' where entity_id = 'cp01';
    raise exception 'CP01 VERIFY FAIL: audit update allowed';
  exception
    when object_not_in_prerequisite_state then
      null;
  end;

  select c.reloptions into v_options
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'tlb' and c.relname = 'v_inventory_availability';

  if v_options is null or not ('security_invoker=true' = any (v_options)) then
    raise exception 'CP01 VERIFY FAIL: v_inventory_availability security_invoker';
  end if;

  raise notice 'CP01 VERIFY OK';
end
$verify$;

rollback;
