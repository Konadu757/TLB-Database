-- Posts two movements and two document numbers through the public RPC wrappers.
-- Run after supabase/migrations, including 20260928_100005:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/verify-ledger-post.sql
--
-- Expects a role that bypasses RLS (postgres / migration owner). It stubs
-- auth.uid() for the duration of the transaction and then ROLLBACK, which
-- restores the previous auth.uid() function as well as the fixture rows.

begin;

do $verify$
declare
  v_user uuid := '11111111-1111-4111-8111-111111111111';
  v_blocked uuid := '22222222-2222-4222-8222-222222222222';
  v_year integer;
  v_product uuid;
  v_warehouse uuid;
  v_batch uuid;
  v_uom uuid;
  v_role uuid;
  v_args text;
  v_on_hand numeric(18, 4);
  v_remaining numeric(18, 4);
  v_move_1 jsonb;
  v_move_2 jsonb;
  v_number_1 text;
  v_number_2 text;
  v_extra text;
  v_count integer;
  v_options text[];
begin
  if to_regprocedure('public.post_movement(text, uuid, uuid, numeric, uuid, text, text, text, text, text)') is null then
    raise exception 'VERIFY FAIL: public.post_movement is missing';
  end if;

  if to_regprocedure('public.issue_document_number(text)') is null then
    raise exception 'VERIFY FAIL: public.issue_document_number is missing';
  end if;

  select pg_get_function_identity_arguments(p.oid)
    into v_args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'issue_document_number';

  if v_args is distinct from 'p_document_type text' then
    raise exception 'VERIFY FAIL: issue_document_number args are %', v_args;
  end if;

  select pg_get_function_identity_arguments(p.oid)
    into v_args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'post_movement';

  if v_args like '%qty_before%'
     or v_args like '%movement_number%'
     or v_args like '%integer%'
     or v_args like '%bigint%' then
    raise exception 'VERIFY FAIL: post_movement lets the client pass ledger state: %', v_args;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    if not has_function_privilege(
      'authenticated',
      'public.post_movement(text, uuid, uuid, numeric, uuid, text, text, text, text, text)',
      'execute'
    ) then
      raise exception 'VERIFY FAIL: authenticated cannot execute public.post_movement';
    end if;

    if not has_function_privilege('authenticated', 'public.issue_document_number(text)', 'execute') then
      raise exception 'VERIFY FAIL: authenticated cannot execute public.issue_document_number';
    end if;

    if has_function_privilege(
      'authenticated',
      'tlb.post_movement(text, uuid, uuid, numeric, uuid, text, text, text, text, text)',
      'execute'
    ) then
      raise exception 'VERIFY FAIL: authenticated can execute tlb.post_movement directly';
    end if;

    if has_function_privilege('authenticated', 'tlb.issue_document_number(text)', 'execute') then
      raise exception 'VERIFY FAIL: authenticated can execute tlb.issue_document_number directly';
    end if;

    if has_function_privilege('authenticated', 'tlb.next_document_number(text, integer)', 'execute') then
      raise exception 'VERIFY FAIL: authenticated can execute next_document_number';
    end if;

    if has_table_privilege('authenticated', 'tlb.inventory_movements', 'insert')
       or has_table_privilege('authenticated', 'tlb.inventory_balances', 'insert')
       or has_table_privilege('authenticated', 'tlb.inventory_balances', 'update') then
      raise exception 'VERIFY FAIL: authenticated can write the ledger tables';
    end if;

    if not has_table_privilege('authenticated', 'public.tlb_inventory_movements', 'select')
       or not has_table_privilege('authenticated', 'public.tlb_inventory_balances', 'select') then
      raise exception 'VERIFY FAIL: authenticated cannot read the public ledger views';
    end if;

    if has_table_privilege('authenticated', 'public.tlb_inventory_movements', 'insert')
       or has_table_privilege('authenticated', 'public.tlb_inventory_balances', 'update') then
      raise exception 'VERIFY FAIL: authenticated can write the public ledger views';
    end if;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_function_privilege(
      'anon',
      'public.post_movement(text, uuid, uuid, numeric, uuid, text, text, text, text, text)',
      'execute'
    ) or has_function_privilege('anon', 'public.issue_document_number(text)', 'execute') then
      raise exception 'VERIFY FAIL: anon can execute ledger RPCs';
    end if;
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'tlb'
    and tablename = 'inventory_movements'
    and cmd <> 'SELECT';

  if v_count <> 0 then
    raise exception 'VERIFY FAIL: inventory_movements has a write policy';
  end if;

  select c.reloptions
    into v_options
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'tlb_inventory_balances';

  if v_options is null or not ('security_invoker=true' = any (v_options)) then
    raise exception 'VERIFY FAIL: tlb_inventory_balances must be security_invoker';
  end if;

  select id into v_uom from tlb.units_of_measure where code = 'EA';
  select id into v_role from tlb.roles where code = 'WAREHOUSE';
  if v_uom is null or v_role is null then
    raise exception 'VERIFY FAIL: EA unit or WAREHOUSE role is missing';
  end if;

  insert into auth.users (id, email) values
    (v_user, 'warehouse-post@verify.tlb'),
    (v_blocked, 'blocked-post@verify.tlb');

  -- handle_new_auth_user() already inserted the profile rows.
  update tlb.profiles
     set full_name = 'Warehouse Poster',
         active = true
   where id = v_user;

  update tlb.profiles
     set full_name = 'Blocked Poster',
         active = true
   where id = v_blocked;

  insert into tlb.user_roles (user_id, role_id) values (v_user, v_role);

  insert into tlb.warehouses (code, name, location)
  values ('WH-POST', 'Post verification warehouse', 'Test')
  returning id into v_warehouse;

  insert into tlb.user_warehouse_access (user_id, warehouse_id)
  values (v_user, v_warehouse);

  insert into tlb.products (sku, name, uom_id)
  values ('SKU-POST', 'Post verification product', v_uom)
  returning id into v_product;

  insert into tlb.inventory_batches (
    batch_number, product_id, warehouse_id,
    quantity_received, quantity_remaining, unit_cost, received_at, status
  ) values (
    'BAT-POST-1', v_product, v_warehouse,
    10, 0, 4.25, now(), 'Open'
  )
  returning id into v_batch;

  execute
    'create or replace function auth.uid() returns uuid language sql stable as $uid$ select '
    || quote_literal(v_user::text)
    || '::uuid $uid$';

  v_move_1 := public.post_movement(
    'grn', v_product, v_warehouse, 10, v_batch,
    'verify receipt', 'grn', 'grn-post-1', 'GRN-POST', 'first'
  );
  v_move_2 := public.post_movement(
    'issue', v_product, v_warehouse, 4, v_batch,
    'verify issue', 'issue', 'iss-post-1', 'ISS-POST', 'second'
  );

  v_year := extract(year from timezone('utc', now()))::integer;

  if (v_move_1->>'movement_number') is distinct from ('TLB-MV-' || v_year::text || '-000125') then
    raise exception 'VERIFY FAIL: first movement number %', v_move_1->>'movement_number';
  end if;

  if (v_move_2->>'movement_number') is distinct from ('TLB-MV-' || v_year::text || '-000126') then
    raise exception 'VERIFY FAIL: second movement number %', v_move_2->>'movement_number';
  end if;

  if v_move_1->>'movement_number' = v_move_2->>'movement_number'
     or v_move_1->>'id' = v_move_2->>'id' then
    raise exception 'VERIFY FAIL: movement numbers or ids are not unique';
  end if;

  if (v_move_1->>'qty_before')::numeric <> 0
     or (v_move_1->>'qty_after')::numeric <> 10
     or (v_move_2->>'qty_before')::numeric <> 10
     or (v_move_2->>'qty_after')::numeric <> 6 then
    raise exception 'VERIFY FAIL: movement chain % / %', v_move_1, v_move_2;
  end if;

  select b.quantity_on_hand
    into v_on_hand
  from tlb.inventory_balances b
  where b.product_id = v_product
    and b.warehouse_id = v_warehouse;

  if v_on_hand <> 6 then
    raise exception 'VERIFY FAIL: on-hand after two posts is %', v_on_hand;
  end if;

  select quantity_remaining
    into v_remaining
  from tlb.inventory_batches
  where id = v_batch;

  if v_remaining <> 6 then
    raise exception 'VERIFY FAIL: batch remaining after two posts is %', v_remaining;
  end if;

  v_number_1 := public.issue_document_number('order');
  v_number_2 := public.issue_document_number('ORD');

  if v_number_1 is distinct from ('TLB-ORD-' || v_year::text || '-000125') then
    raise exception 'VERIFY FAIL: first document number %', v_number_1;
  end if;

  if v_number_2 is distinct from ('TLB-ORD-' || v_year::text || '-000126') then
    raise exception 'VERIFY FAIL: second document number %', v_number_2;
  end if;

  if v_number_1 = v_number_2 then
    raise exception 'VERIFY FAIL: document numbers are not unique';
  end if;

  select count(*) into v_count
  from tlb.document_sequences
  where document_type = 'ORD'
    and period_year = v_year
    and last_value = 126;

  if v_count <> 1 then
    raise exception 'VERIFY FAIL: ORD sequence did not land on 126';
  end if;

  begin
    perform public.post_movement('sideways', v_product, v_warehouse, 1, null, null, null, null, null, null);
    raise exception 'VERIFY FAIL: bad direction was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.post_movement('grn', v_product, v_warehouse, 0, null, null, null, null, null, null);
    raise exception 'VERIFY FAIL: zero quantity was accepted';
  exception
    when check_violation then
      null;
  end;

  begin
    perform public.post_movement('issue', v_product, v_warehouse, 100, v_batch, null, null, null, null, null);
    raise exception 'VERIFY FAIL: negative on-hand was accepted';
  exception
    when check_violation then
      null;
  end;

  execute
    'create or replace function auth.uid() returns uuid language sql stable as $uid$ select '
    || quote_literal(v_blocked::text)
    || '::uuid $uid$';

  begin
    perform public.post_movement('grn', v_product, v_warehouse, 1, null, null, null, null, null, null);
    raise exception 'VERIFY FAIL: post without stock permission was accepted';
  exception
    when insufficient_privilege then
      null;
  end;

  v_extra := public.issue_document_number('invoice');
  if v_extra is null or v_extra !~ '^TLB-INV-[0-9]{4}-[0-9]{6}$' then
    raise exception 'VERIFY FAIL: active profile without stock permission could not issue a number (% )', v_extra;
  end if;

  execute
    'create or replace function auth.uid() returns uuid language sql stable as $uid$ select null::uuid $uid$';

  begin
    perform public.issue_document_number('order');
    raise exception 'VERIFY FAIL: document number issued without a session';
  exception
    when insufficient_privilege then
      null;
  end;

  select b.quantity_on_hand
    into v_on_hand
  from tlb.inventory_balances b
  where b.product_id = v_product
    and b.warehouse_id = v_warehouse;

  if v_on_hand <> 6 then
    raise exception 'VERIFY FAIL: rejected posts changed on-hand to %', v_on_hand;
  end if;
end
$verify$;

rollback;
