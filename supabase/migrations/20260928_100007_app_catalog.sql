-- App catalog for ledger posts.
-- Forward-only. Does not change 20260928_100001 through 20260928_100006.
--
-- The portal's seeded products and warehouses use ids such as prod-hcl and
-- wh-main. public.post_movement requires tlb uuids. This file inserts those
-- rows with fixed ids (the same map as src/lib/repo/ledger-catalog.ts) and
-- adds public.ensure_ledger_ref so a signed-in stock user can resolve any
-- later product or warehouse before posting.
--
-- This file does not revoke anon execute on public.create_invite.
-- The portal Owner is a browser session. accept_invite does not mint a
-- GoTrue session, so Settings still calls create_invite with the anon key.
-- Revoking that grant would stop the first owner from issuing any invite.

-- ---------------------------------------------------------------------------
-- Seeded warehouses and products. Skipped when the code or sku is already there.
-- ---------------------------------------------------------------------------

insert into tlb.warehouses (id, code, name, location, active)
select v.id, v.code, v.name, v.location, true
from (
  values
    (
      'a1000000-0000-4000-8000-000000000001'::uuid,
      'MAIN',
      'Main Warehouse',
      'Tema · bonded chemicals'
    ),
    (
      'a1000000-0000-4000-8000-000000000002'::uuid,
      'FACTORY',
      'Factory Store',
      'Production floor · WIP'
    ),
    (
      'a1000000-0000-4000-8000-000000000003'::uuid,
      'ACCRA',
      'Accra Hub',
      'Accra · regional fulfilment'
    )
) as v(id, code, name, location)
where not exists (
  select 1
  from tlb.warehouses w
  where w.id = v.id
     or w.code = v.code
);

insert into tlb.products (id, sku, name, uom_id, issue_strategy, active)
select v.id, v.sku, v.name, u.id, v.issue_strategy, true
from (
  values
    ('b2000000-0000-4000-8000-000000000001'::uuid, 'CHEM-A', 'Chemical A', 'DRUM', 'FEFO'),
    ('b2000000-0000-4000-8000-000000000002'::uuid, 'CHEM-B', 'Chemical B', 'DRUM', 'FIFO'),
    ('b2000000-0000-4000-8000-000000000003'::uuid, 'MAT-B', 'Material B', 'BAG', 'FEFO'),
    ('b2000000-0000-4000-8000-000000000004'::uuid, 'CHEM-001', 'Hydrochloric Acid 32%', 'DRUM', 'FEFO'),
    ('b2000000-0000-4000-8000-000000000005'::uuid, 'CHEM-014', 'Ethanol 96%', 'DRUM', 'FEFO')
) as v(id, sku, name, uom_code, issue_strategy)
join tlb.units_of_measure u on u.code = v.uom_code
where not exists (
  select 1
  from tlb.products p
  where p.id = v.id
     or p.sku = v.sku
);

-- ---------------------------------------------------------------------------
-- Resolve or insert one product and one warehouse for the signed-in profile.
-- Also records warehouse access for that profile so post_movement can see it
-- when the role does not hold users.manage.
-- ---------------------------------------------------------------------------

create or replace function tlb.ensure_ledger_ref(
  p_product_key text,
  p_sku text,
  p_product_name text,
  p_unit text,
  p_issue_strategy text,
  p_warehouse_key text,
  p_warehouse_code text,
  p_warehouse_name text,
  p_warehouse_location text
)
returns jsonb
language plpgsql
security definer
set search_path = tlb, pg_temp
as $$
declare
  v_product_key text := btrim(coalesce(p_product_key, ''));
  v_sku text := btrim(coalesce(p_sku, ''));
  v_product_name text := btrim(coalesce(p_product_name, ''));
  v_warehouse_key text := btrim(coalesce(p_warehouse_key, ''));
  v_code text := btrim(coalesce(p_warehouse_code, ''));
  v_warehouse_name text := btrim(coalesce(p_warehouse_name, ''));
  v_location text := coalesce(p_warehouse_location, '');
  v_strategy text := upper(btrim(coalesce(p_issue_strategy, '')));
  v_uom_code text;
  v_uom uuid;
  v_product uuid;
  v_warehouse uuid;
  v_preferred_product uuid;
  v_preferred_warehouse uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if not tlb.is_active_profile() then
    raise exception 'active profile required'
      using errcode = '42501';
  end if;

  if not (
    tlb.has_permission('stock.receive')
    or tlb.has_permission('stock.issue')
    or tlb.has_permission('stock.transfer')
    or tlb.has_permission('stock.adjust')
    or tlb.has_permission('users.manage')
  ) then
    raise exception 'stock permission required'
      using errcode = '42501';
  end if;

  if v_sku = '' or v_product_name = '' or v_code = '' or v_warehouse_name = '' then
    raise exception 'product and warehouse names are required'
      using errcode = '22023';
  end if;

  if v_strategy not in ('FIFO', 'LIFO', 'FEFO') then
    v_strategy := 'FEFO';
  end if;

  v_uom_code := case lower(btrim(coalesce(p_unit, '')))
    when 'drum' then 'DRUM'
    when 'drums' then 'DRUM'
    when 'bag' then 'BAG'
    when 'bags' then 'BAG'
    when 'kg' then 'KG'
    when 'kilogram' then 'KG'
    when 'g' then 'G'
    when 'gram' then 'G'
    when 'l' then 'L'
    when 'litre' then 'L'
    when 'liter' then 'L'
    when 'ml' then 'ML'
    when 'ea' then 'EA'
    when 'each' then 'EA'
    else 'EA'
  end;

  select u.id
    into v_uom
  from tlb.units_of_measure u
  where u.code = v_uom_code;

  if v_uom is null then
    select u.id
      into v_uom
    from tlb.units_of_measure u
    where u.code = 'EA';
  end if;

  if v_uom is null then
    raise exception 'unit of measure is missing'
      using errcode = '55000';
  end if;

  v_preferred_product := case v_product_key
    when 'prod-chem-a' then 'b2000000-0000-4000-8000-000000000001'::uuid
    when 'prod-chem-b' then 'b2000000-0000-4000-8000-000000000002'::uuid
    when 'prod-mat-b' then 'b2000000-0000-4000-8000-000000000003'::uuid
    when 'prod-hcl' then 'b2000000-0000-4000-8000-000000000004'::uuid
    when 'prod-eth' then 'b2000000-0000-4000-8000-000000000005'::uuid
    else null
  end;

  if v_preferred_product is null and v_product_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_preferred_product := v_product_key::uuid;
  end if;

  v_preferred_warehouse := case v_warehouse_key
    when 'wh-main' then 'a1000000-0000-4000-8000-000000000001'::uuid
    when 'wh-factory' then 'a1000000-0000-4000-8000-000000000002'::uuid
    when 'wh-accra' then 'a1000000-0000-4000-8000-000000000003'::uuid
    else null
  end;

  if v_preferred_warehouse is null and v_warehouse_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_preferred_warehouse := v_warehouse_key::uuid;
  end if;

  select p.id
    into v_product
  from tlb.products p
  where p.deleted_at is null
    and (p.id = v_preferred_product or p.sku = v_sku)
  order by case when p.sku = v_sku then 0 else 1 end
  limit 1;

  if v_product is null then
    begin
      insert into tlb.products (id, sku, name, uom_id, issue_strategy, active)
      values (coalesce(v_preferred_product, gen_random_uuid()), v_sku, v_product_name, v_uom, v_strategy, true)
      returning id into v_product;
    exception
      when unique_violation then
        select p.id
          into v_product
        from tlb.products p
        where p.sku = v_sku
        limit 1;
    end;
  end if;

  if v_product is null then
    raise exception 'product could not be stored'
      using errcode = '55000';
  end if;

  select w.id
    into v_warehouse
  from tlb.warehouses w
  where w.deleted_at is null
    and (w.id = v_preferred_warehouse or w.code = v_code)
  order by case when w.code = v_code then 0 else 1 end
  limit 1;

  if v_warehouse is null then
    begin
      insert into tlb.warehouses (id, code, name, location, active)
      values (
        coalesce(v_preferred_warehouse, gen_random_uuid()),
        v_code,
        v_warehouse_name,
        v_location,
        true
      )
      returning id into v_warehouse;
    exception
      when unique_violation then
        select w.id
          into v_warehouse
        from tlb.warehouses w
        where w.code = v_code
        limit 1;
    end;
  end if;

  if v_warehouse is null then
    raise exception 'warehouse could not be stored'
      using errcode = '55000';
  end if;

  insert into tlb.user_warehouse_access (user_id, warehouse_id, created_by)
  values (auth.uid(), v_warehouse, auth.uid())
  on conflict (user_id, warehouse_id) do nothing;

  return jsonb_build_object(
    'product_id', v_product,
    'warehouse_id', v_warehouse
  );
end;
$$;

revoke all on function tlb.ensure_ledger_ref(text, text, text, text, text, text, text, text, text) from public;

comment on function tlb.ensure_ledger_ref(text, text, text, text, text, text, text, text, text) is
  'Resolves or inserts one tlb product and warehouse for the current profile. Not granted to authenticated; call public.ensure_ledger_ref.';

create or replace function public.ensure_ledger_ref(
  p_product_key text,
  p_sku text,
  p_product_name text,
  p_unit text,
  p_issue_strategy text,
  p_warehouse_key text,
  p_warehouse_code text,
  p_warehouse_name text,
  p_warehouse_location text
)
returns jsonb
language sql
security definer
set search_path = tlb, pg_temp
as $$
  select tlb.ensure_ledger_ref(
    p_product_key,
    p_sku,
    p_product_name,
    p_unit,
    p_issue_strategy,
    p_warehouse_key,
    p_warehouse_code,
    p_warehouse_name,
    p_warehouse_location
  );
$$;

revoke all on function public.ensure_ledger_ref(text, text, text, text, text, text, text, text, text) from public;

comment on function public.ensure_ledger_ref(text, text, text, text, text, text, text, text, text) is
  'Data API RPC ensure_ledger_ref. Thin SECURITY DEFINER wrapper. Granted to authenticated only.';

do $$
begin
  execute format(
    'grant execute on function tlb.ensure_ledger_ref(text, text, text, text, text, text, text, text, text) to %I',
    current_user
  );
  execute format(
    'grant execute on function public.ensure_ledger_ref(text, text, text, text, text, text, text, text, text) to %I',
    current_user
  );
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function tlb.ensure_ledger_ref(text, text, text, text, text, text, text, text, text) from anon';
    execute 'revoke all on function public.ensure_ledger_ref(text, text, text, text, text, text, text, text, text) from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function tlb.ensure_ledger_ref(text, text, text, text, text, text, text, text, text) from authenticated';
    execute 'grant execute on function public.ensure_ledger_ref(text, text, text, text, text, text, text, text, text) to authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function tlb.ensure_ledger_ref(text, text, text, text, text, text, text, text, text) to service_role';
    execute 'grant execute on function public.ensure_ledger_ref(text, text, text, text, text, text, text, text, text) to service_role';
  end if;
end;
$$;

notify pgrst, 'reload schema';
