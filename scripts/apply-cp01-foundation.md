# CP01 — Database foundation (schema `tlb`)

Live Supabase project: **mfyvhpwjrpjcxdlsqgit** (TLB Database). Portal: [https://portal.tlbgh.com](https://portal.tlbgh.com). Confirm **Project Settings → General** before applying SQL.

CP01 is the canonical model in schema `tlb` only. It does **not** wire the frontend. Later checkpoints add invites, public ledger RPCs, and app catalog (`20260928_100005` onward).

## Do not re-apply onto live

As of the Oct 2026 diagnosis on **mfyv**:

| Check | Result |
| --- | --- |
| All 18 CP01 `tlb` tables | Present |
| Seeds (39 permissions, 9 system roles) | Present |
| `tlb.next_document_number` | Present |
| `supabase_migrations.schema_migrations` | **Missing** (SQL was pasted; CLI never recorded history) |
| `npx supabase migration list --linked` | Every local file shows **empty Remote** |

Re-running CP01 files on this database fails with Postgres **`42P07: relation "…" already exists`** (representative: `relation "profiles" already exists`). That is a **re-apply conflict**, not a broken foundation.

**Do not** run `npx supabase db push` (or `--dry-run` expecting a clean apply) against live until migration history is repaired. The CLI sees all 18 files as pending and will try to recreate objects that already exist. Direct `db push` may also hang on `Initialising login role…` on some networks; prefer `db query --linked` / SQL Editor for one-off checks.

Historical `public.*` prototype migrations (`20260909_*`, `20260911_*`) are a **separate** chain. Live may have had `tlb` without those `public` tables. Do not assume `db push` of the full folder is the CP01 path.

## Apply order (greenfield / clean DB only)

Paste each file in the SQL Editor (or use `npx supabase db query --linked -f …`) **once**, in this order:

1. `supabase/migrations/20260928_100001_core_identity.sql`
2. `supabase/migrations/20260928_100002_master_data.sql`
3. `supabase/migrations/20260928_100003_inventory_ledger.sql`
4. `supabase/migrations/20260928_100004_documents_audit_rls.sql`

Do **not** re-run a file that already succeeded. “Already exists” means stop and verify instead of dropping `tlb`.

### Full chain vs CP01-only

| Goal | Order |
| --- | --- |
| **CP01-only** (canonical `tlb`) | The four files above |
| **Full portal stack** (prototype `public` + CP01 + invites/ledger wrappers) | See `scripts/apply-canonical-db.md` — historical `20260909_*` / `20260911_*`, then `100001`–`100007`, then later `100008+` only if needed |

Skip `supabase/migrations/_archive/`.

## Live history repair (non-destructive)

Goal: teach the CLI what was already applied **without** resetting production.

1. Confirm objects with the gap check / verify script below — do **not** drop `tlb`.
2. Prefer **manual SQL Editor** for any *missing* forward file only (e.g. a post-CP01 migration that is absent). Do not re-paste `100001`–`100004` on mfyv.
3. CLI `migration repair` / recording into `supabase_migrations` is blocked until filenames yield **unique** version ids. Current names like `20260928_100001_…` and three `20260909_*` files list in the CLI as duplicate date-only versions (`20260928`, `20260909`). Renaming historical migrations is an architect decision — do not rename casually on a live project.
4. Until then: treat live apply as **SQL Editor / `db query --linked -f` of individual missing files**, not `db push` of the whole directory.

## Verify CP01

```bash
npx supabase db query --linked -f supabase/tests/verify-cp01-foundation.sql
```

Success ends with `CP01 VERIFY OK` in the notice (transaction rolls back; no fixture data kept).

Quick presence check:

```bash
npx supabase db query --linked -f supabase/.temp/cp01-gap-check.sql
```

For the full stack including invites and public prototype checks, use `supabase/tests/verify-canonical-db.sql` after `100006+` on a database that still has the prototype `public` tables.

## What CP01 includes

Identity: `profiles`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_warehouse_access`, `warehouses`.

Master data: `units_of_measure`, `product_categories`, `products`, `customers`, `suppliers`.

Inventory: `inventory_batches`, `inventory_movements`, `inventory_balances`, `inventory_reservations`, view `v_inventory_availability`.

Documents & audit: `document_sequences`, `audit_events`, function `tlb.next_document_number()`.

RLS: enabled on all CP01 tables; **SELECT-only** policies for `authenticated`; no table DML grants; `service_role` bypass for migrations and future SECURITY DEFINER writers.
