# Handover checklist

One pass after the SQL in [the client runbook](client-runbook.md) has been applied to the hosted Supabase project (`myjwrhimhkakiczjfzeo`, confirmed on **Project Settings → General**). Tick a box only after you have seen the result.

Project reference confirmed: ________  
Date applied: ________  
Last file that finished successfully: ________

- [ ] **Historical `public` tables.** `public.warehouses`, `public.products`, `public.customers`, and `public.audit_events` still exist (the runbook’s `to_regclass` query shows a name in every column).
- [ ] **Schema `tlb` applied.** The table list returns these 19 names: `audit_events`, `customers`, `document_sequences`, `inventory_balances`, `inventory_batches`, `inventory_movements`, `inventory_reservations`, `invites`, `permissions`, `product_categories`, `products`, `profiles`, `role_permissions`, `roles`, `suppliers`, `units_of_measure`, `user_roles`, `user_warehouse_access`, `warehouses`.
- [ ] **Verification script.** The whole of `supabase/tests/verify-canonical-db.sql` finished with no `VERIFY FAIL`, and ended in `ROLLBACK`.
- [ ] **Two document numbers differ.** That same script is the check: it requires `TLB-ORD-2099-000125` and then `TLB-ORD-2099-000126`, then rolls them back. Leave this box empty if you did not run that script. Do not call `tlb.next_document_number` on its own. The portal calls `public.issue_document_number` only when a Supabase Auth session exists (`20260928_100005`).
- [ ] **A posted stock movement updates `tlb.inventory_balances`.** That same script posts a receipt and an issue and requires quantity on hand `6` and reserved `2`, then rolls them back. `20260928_100005` is what adds `public.post_movement`. The portal uses it only after `20260928_100007` has inserted the app catalog (or `public.ensure_ledger_ref` has resolved the product and warehouse) and the browser has a Supabase Auth session. The local Owner session is not that Auth session, so the stock screen keeps the browser ledger until then.
- [ ] **Anon cannot write the tables `100006` revokes.** After `20260928_100006_access_control.sql`, this query returns no rows:

  ```sql
  select table_name, privilege_type
  from information_schema.role_table_grants
  where grantee = 'anon'
    and table_schema = 'public'
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    and table_name in (
      'stock_movements',
      'batches',
      'goods_receipts',
      'goods_receipt_lines',
      'stock_issues',
      'stock_issue_lines',
      'warehouse_transfers',
      'warehouse_transfer_lines',
      'stock_adjustments',
      'stock_adjustment_lines'
    );
  ```

  `verify-canonical-db.sql` fails if `anon` can read `tlb.customers` or insert into `tlb.audit_events`. That revoke is in `100004`. `100006` does not take write access away from the live `public` tables the portal still saves (customers, orders, invoices, and the rest of that list in the migration comment).
- [ ] **`accept_invite` and `create_invite` exist.** After `100006`, both queries return one row. `anon` is still allowed to execute them. That bootstrap is documented in the runbook. Do not revoke it until Settings sends a `users.manage` Auth session.

  ```sql
  select p.proname, r.rolname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on has_function_privilege(
    r.oid,
    p.oid,
    'execute'
  )
  where n.nspname = 'public'
    and p.proname in ('accept_invite', 'create_invite', 'post_movement')
    and r.rolname in ('anon', 'authenticated')
  order by p.proname, r.rolname;
  ```

  Expected: `accept_invite` and `create_invite` for both `anon` and `authenticated`. `post_movement` for `authenticated` only, not for `anon`.
- [ ] **App catalog rows.** After `20260928_100007_app_catalog.sql`, `tlb.warehouses.code` contains `MAIN`, `FACTORY`, and `ACCRA`, and `tlb.products.sku` contains `CHEM-A`, `CHEM-B`, `MAT-B`, `CHEM-001`, and `CHEM-014`.
- [ ] **Dashboard still loads.** [https://portal.tlbgh.com](https://portal.tlbgh.com) opens to the dashboard with no error banner after the apply.
- [ ] **Backup exists.** A Supabase dashboard backup, or a `tlb-backup-YYYYMMDD.dump` file, was taken before the apply. The service-role key was not copied into the browser or into the runbook.

If any box fails, stop. Copy the error. Do not re-run a `20260928_100001` through `100006` file that failed in the middle, and do not drop tables to retry.
