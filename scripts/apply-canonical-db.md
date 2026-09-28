# Apply the canonical database

Use this with [the client runbook](../docs/operations/client-runbook.md). This page is the ordered list. It does not repeat the SQL inside the migration files.

The Supabase project the portal has used is `myjwrhimhkakiczjfzeo`. In the dashboard, open **Project Settings → General** and confirm the reference matches before you run anything. SQL Editor runs as the database owner. You do not paste an API key into it.

As of this page, `supabase/migrations` contains the historical files and `20260928_100001` through `20260928_100007`. Apply those seven canonical files in filename order after the historical check below. Skip `supabase/migrations/_archive/`. That folder is not part of this apply.

## 1. See what is already on the database

In the SQL Editor, run:

```sql
select
  to_regclass('public.customers') is not null as customers,
  to_regclass('public.invoices') is not null as invoices,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customers'
      and column_name = 'deleted_at'
  ) as soft_delete,
  (
    select column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'document_counters'
      and column_name = 'order_seq'
  ) as order_seq_default,
  to_regclass('tlb.profiles') is not null as canonical_started;
```

| Result | What to paste |
| --- | --- |
| `customers` is false | Start at the historical list below, from the first file. |
| `customers` is true and `invoices` is false | Start at `20260909_p1_documents.sql`, then the files under it. |
| `invoices` is true and `soft_delete` is false | Start at `20260909_p2_text_ids_and_soft_delete.sql`, then `20260911`. |
| `soft_delete` is true and `order_seq_default` does not contain `124` | Run only `20260911_mature_document_sequences.sql`. |
| `customers`, `invoices`, and `soft_delete` are true, and `order_seq_default` contains `124` | Skip the historical files. Start at `20260928_100001_core_identity.sql`. |
| `canonical_started` is true | Stop. `100001` has already been applied at least in part. Copy what you see and get a developer. Do not run `100001` again. |

## 2. Historical files, only if the check says so

Paste one whole file, wait until the editor reports success, then paste the next.

1. `supabase/migrations/20260909_customer_orders.sql`
2. `supabase/migrations/20260909_p1_documents.sql`
3. `supabase/migrations/20260909_p2_text_ids_and_soft_delete.sql`
4. `supabase/migrations/20260911_mature_document_sequences.sql`

With `psql`, from the repository root, run only the files the check still needs:

```text
psql "postgresql://postgres:[DATABASE_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20260909_customer_orders.sql
psql "postgresql://postgres:[DATABASE_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20260909_p1_documents.sql
psql "postgresql://postgres:[DATABASE_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20260909_p2_text_ids_and_soft_delete.sql
psql "postgresql://postgres:[DATABASE_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20260911_mature_document_sequences.sql
```

`[DATABASE_PASSWORD]` is the database password from **Project Settings → Database**. It is not the anon key and it is not the service-role key.

## 3. Canonical foundation

Paste these in order, one file at a time, after the historical step is either done or skipped:

1. `supabase/migrations/20260928_100001_core_identity.sql`
2. `supabase/migrations/20260928_100002_master_data.sql`
3. `supabase/migrations/20260928_100003_inventory_ledger.sql`
4. `supabase/migrations/20260928_100004_documents_audit_rls.sql`
5. `supabase/migrations/20260928_100005_ledger_post_and_document_numbers.sql` — `public.post_movement`, `public.issue_document_number` (authenticated only)
6. `supabase/migrations/20260928_100006_access_control.sql` — `public.accept_invite`, `public.create_invite` (anon execute kept; see the runbook bootstrap), and revoke of anon/authenticated writes on `stock_movements`, `batches`, `goods_receipts`, `goods_receipt_lines`, `stock_issues`, `stock_issue_lines`, `warehouse_transfers`, `warehouse_transfer_lines`, `stock_adjustments`, `stock_adjustment_lines`
7. `supabase/migrations/20260928_100007_app_catalog.sql` — seeded warehouse and product uuids, `public.ensure_ledger_ref`

`psql` from the repository root (this script uses `\i` and does not copy the SQL):

```text
psql "postgresql://postgres:[DATABASE_PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" -v ON_ERROR_STOP=1 -f scripts/apply-canonical-db.sql
```

`100001` through `100006` create objects without “if not exists”. A second run stops with “already exists”. That is a reason to stop, not a reason to drop the schema. `100007` skips a catalog row when that id, code, or sku is already present.

## 4. Confirm

Follow the success checks in the runbook, then the boxes in [the handover checklist](../docs/operations/handover-checklist.md).
