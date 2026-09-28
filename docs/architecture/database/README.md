# Canonical database

This is the first production schema for the TLB Management System. It does not replace the React app, `TlbState`, localStorage, or `src/lib/repo/supabase-tlb-repository.ts`. Those still talk to the prototype tables and the in-browser store.

## Where it lives

Historical migrations under `supabase/migrations/20260909_*` and `20260911_*` created prototype tables in `public` (`warehouses`, `products`, `customers`, `audit_events`, and the sales-document tables). Several of those names are the names this foundation needs.

The canonical tables are in schema **`tlb`**. The new migrations do not `ALTER` or `DROP` the prototype tables. `public` remains the prototype. `tlb` is the schema new server work should use.

`tlb` is not added to the Supabase Data API exposed-schema list. The browser client cannot see it until that is a deliberate later change.

## Principles

- Identity is a UUID from `gen_random_uuid()`, except `profiles.id`, which is `auth.users.id`.
- Frontend seed ids (`user-owner`, `role-owner`, `cus-demo`, `wh-main`) are not database identities.
- Business numbers are separate text columns: `customer_number`, `supplier_number`, `sku`, warehouse `code`, `batch_number`, `movement_number`, and document numbers from `tlb.next_document_number()`.
- Money is `numeric(18,2)`. Quantities are `numeric(18,4)`.
- Timestamps are `timestamptz`. Mutable rows have `created_at` and `updated_at`. `tlb.set_updated_at()` maintains `updated_at`.
- The ledger and the audit log are append-only. Triggers reject `UPDATE`, `DELETE`, and `TRUNCATE`.
- Master data that the product can retire uses soft-delete columns (`deleted_at`, `deleted_by`, `deleted_reason`) instead of a hard delete.
- Passwords are not stored. GoTrue owns credentials. `tlb.profiles` holds the application profile.
- Row Level Security is enabled on every `tlb` table. Policies are `SELECT` only, and they call permission helpers. There is no policy that lets every authenticated user read or write everything.
- `SECURITY DEFINER` functions set `search_path = tlb, pg_temp`, do not use dynamic SQL, and do not read service-role secrets.

RLS is not `FORCE`d. The helper functions are `SECURITY DEFINER` and must run as the owning role, which bypasses RLS. Forcing RLS onto that owner would make the policies call helpers that are themselves subject to the same policies.

## Auth ownership

`tlb.handle_new_auth_user()` runs after insert on `auth.users` and inserts `tlb.profiles`. It copies `id`, a display name, and email. It does not copy a password hash.

Role assignment is `tlb.user_roles` (many-to-many). The current frontend user has a single `roleId`. That stays a client concern until a later checkpoint.

There is no open “first user becomes owner” function. The first `OWNER` row in `tlb.user_roles` is a service-role SQL step. Leaving that path callable by `authenticated` would let the first signed-in browser session claim the tenant.

## Row Level Security

`authenticated` has `SELECT` on `tlb` tables and `EXECUTE` on the read helpers plus `tlb.record_audit_event()`. It does not have insert, update, delete, or truncate on the tables. `anon` has no grants on schema `tlb`.

| Read | Rule |
| --- | --- |
| Own profile, or any profile with `users.manage` | `profiles` |
| Own roles, or all roles with `users.manage` | `roles`, `role_permissions` |
| Own role assignments, or all with `users.manage` | `user_roles` |
| Any active profile | `permissions` catalog |
| `user_warehouse_access` row, or `users.manage` | `warehouses` and warehouse-scoped stock |
| `stock.view`, `stock.receive`, `orders.create`, `quotations.view`, or `supply.create` | products, units, categories |
| `customers.manage` | customers |
| `suppliers.manage` or `stock.receive` | suppliers |
| `stock.view` and warehouse access | batches, balances, movements, reservations |
| `audit.view` | `audit_events` |
| `settings.manage` | `document_sequences` |

`stock.view` does not reveal every warehouse. A warehouse user still needs `tlb.user_warehouse_access`. `users.manage` can read warehouses so an administrator can see what they are granting. Granting that access is still a deferred write.

`tlb.record_audit_event()` is the one `authenticated` write path. It inserts a single audit row for `auth.uid()` and requires an active profile. It cannot update or delete.

`tlb.next_document_number()` is executable by `service_role` only (and the function owner). A signed-in browser session cannot burn sequence numbers.

### Deferred writes

No `INSERT`, `UPDATE`, `DELETE`, or `ALL` policies exist. Later checkpoints should add one `SECURITY DEFINER` function per command, with a permission check, rather than a broad write policy. The intended split is commented at the bottom of `supabase/migrations/20260928_100004_documents_audit_rls.sql`:

- Profile self-service and admin deactivate
- Custom roles and their `role_permissions` (system role rows stay trigger-locked)
- `user_roles` assignment
- Warehouse and warehouse-access maintenance
- Units, categories, products, customers, suppliers
- Batch shell plus `post_movement()` for the ledger
- Reservation create and release
- Document numbers stay inside `next_document_number()`
- Audit stays inside `record_audit_event()`

Direct writes to `inventory_balances.quantity_*` and `inventory_batches.quantity_remaining` are rejected unless the projection trigger set `tlb.inventory_projection` for that statement.

## Document numbers

`tlb.next_document_number(type, year)` is concurrent-safe: `INSERT ... ON CONFLICT DO UPDATE` locks the `(document_type, period_year)` row. The first number in a year is **125**. The format is four-digit UTC year and a six-digit sequence:

`TLB-ORD-2026-000125`

The frontend helper in `src/lib/domain/numbering.ts` still formats `TLB-ORD-YYMM-00125`. This schema does not change that helper. Customer and supplier codes in the frontend are `TLB-CUS-0001` / `TLB-VEN-0001` with no year. The canonical issuer uses the same year-and-six-digit pattern for `CUS` and `VEN` as well (`TLB-CUS-2026-000125`). Wire the app to it in a later checkpoint; do not renumber prototype localStorage documents.

`last_value` cannot move backwards and cannot skip ahead unless a migration sets `tlb.allow_sequence_jump`. Rows cannot be deleted.

## Soft delete

Soft-delete columns are on warehouses, roles, product categories, products, customers, and suppliers. System roles cannot be soft-deleted or renamed. Unique business keys (`sku`, warehouse `code`, `customer_number`, `supplier_number`) stay unique after soft delete so a retired key is not reused by accident. Role display names are unique only among rows that are not soft-deleted.

These tables are not soft-deleted:

- `profiles` (deactivate with `active`)
- `permissions`, `role_permissions`, `user_roles`, `user_warehouse_access`
- `units_of_measure` (deactivate with `active`)
- `inventory_batches` (close or change `status`)
- `inventory_movements`, `audit_events`, `document_sequences` (append-only)
- `inventory_balances` (projection)
- `inventory_reservations` (change `status`; delete is rejected)

## What this foundation does not store

Sales orders, quotations, invoices, receipts, payments, deliveries, procurement, goods receipts, factory, quality, and the Communication Hub stay in the client store and, where they already exist, in the prototype `public` tables. Outstanding quantity, line status, invoice totals, and available-to-promise beyond the stock view are derived in TypeScript today and are not copied in as stored sources of truth.

## Apply and check

Apply the existing migration directory in filename order. Then, against that database:

```text
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/verify-canonical-db.sql
```

The script rolls back its fixtures. It expects a role that bypasses RLS. It checks tables, the permission seed, duplicate sku / warehouse / role, invalid movement direction, zero quantity, remaining quantity above received, document-number uniqueness and increment, audit insert and immutability, and RLS. Details are in `entity-catalog.md` and `inventory-ledger.md`.
