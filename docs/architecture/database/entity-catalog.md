# Entity catalog

Schema: `tlb`. Prototype copies in `public` are listed only where the name collides. New work should not add columns to those prototype tables.

UUID primary keys default to `gen_random_uuid()`. `profiles.id` is the exception. Business numbers are text and are never the primary key.

## Identity

### `profiles`

| Column | Notes |
| --- | --- |
| `id` | PK, FK to `auth.users.id`, `ON DELETE RESTRICT` |
| `full_name` | Required. No password, hash, or invite token |
| `email` | Copy of the auth email. Auth remains the source of truth |
| `active` | Deactivate here. Profiles are not soft-deleted |

Created by `tlb.handle_new_auth_user()` on `auth.users` insert. Frontend `AppUser.inviteToken` and ids such as `user-owner` are not stored.

### `roles`

System codes, all `is_system = true`: `OWNER`, `ADMIN`, `MANAGER`, `SALES`, `WAREHOUSE`, `FINANCE`, `DRIVER`, `REQUESTER`, `RECEIVER`.

`name` is the frontend `SystemRoleKey` (`Owner`, `Admin`, …). `code` is the stable uppercase key. Custom roles may omit `code` or use another uppercase code that is not in the system list. A custom role cannot be promoted to `is_system`.

System `code`, `name`, and `is_system` cannot change. System roles cannot be deleted or soft-deleted. `active` may change. Descriptions match `createSystemRoles()` in `src/lib/domain/permissions.ts`.

Frontend ids `role-owner` and the rest of `SYSTEM_ROLE_IDS` are not used.

### `permissions`

39 codes. The full `ALL_PERMISSIONS` list and the `PERMISSION_LABELS` module/label text. The catalog trigger rejects updates and deletes unless a migration sets `tlb.allow_system_role_write`.

### `role_permissions`

Primary key `(role_id, permission_code)`.

Seeded from `SYSTEM_ROLE_PERMISSIONS` only. Owner and Admin receive every catalog code. The other system roles receive the lists in `permissions.ts` and nothing else. After the seed, system-role rows cannot be inserted, updated, or deleted unless that same migration flag is set. Custom roles can receive existing permission codes.

Expected seed sizes: Owner 39, Admin 39, Manager 34, Sales 19, Warehouse 16, Finance 13, Driver 5, Requester 6, Receiver 5.

### `user_roles`

Primary key `(user_id, role_id)`. This is many-to-many. The frontend session still has one `roleId`.

### `warehouses`

`code` unique, `name`, `location`, `active`, soft-delete columns. `public.warehouses` is untouched and, after the prototype’s P2 migration, uses text ids. `tlb.warehouses.id` is a UUID.

### `user_warehouse_access`

Primary key `(user_id, warehouse_id)`. A row means the user may see that warehouse. It is not implied by `stock.view`.

## Master data

### `units_of_measure`

Seeded data, not only TypeScript: `EA`, `KG`, `G`, `L`, `ML`, `DRUM`, `BAG`. `active` retires a unit. Products reference `uom_id`. The frontend `Product.unit` string is not a foreign key yet.

### `product_categories`

`code`, `name`, `active`, soft-delete. Not seeded. The frontend stores `Product.category` as free text. `products.category_id` is nullable until categories are created.

### `suppliers`

`supplier_number` is the business key (frontend `code`). `category` is constrained to Chemical, Packaging, Equipment, Logistics, Other. `payment_terms_days` is an integer. Map from the frontend union: COD 0, Net 7, Net 15, Net 30, Net 45, Net 60. `preferred` matches `Supplier.preferred`. There is no `public.suppliers` table.

### `products`

`sku` unique. `uom_id` required. `issue_strategy` is `FIFO`, `LIFO`, or `FEFO`, default `FEFO` (the frontend fallback in `recommendBatches`). Quantity columns are `numeric(18,4)`. `standard_cost` is `numeric(18,2)`. `preferred_supplier_id` references `tlb.suppliers` and is created only after that table exists. `allow_negative_stock` is stored for parity and is **not** honored by `inventory_balances`, which stays `>= 0`.

`public.products` is untouched.

### `customers`

`customer_number` unique (frontend `code`). `category` is Hospital, Laboratory, Distributor, Industrial, Educational, Other. `credit_limit numeric(18,2)` defaults to 0. In the frontend, 0 means “no limit configured”, not “credit banned”. `payment_terms_days` uses the same integer map as suppliers, default 30.

`public.customers` is untouched. Its `credit_limit` is `numeric(14,2)` and its `payment_terms` is text. Those columns are not the canonical ones.

## Inventory

See `inventory-ledger.md`.

| Table | Primary key | Stored vs derived |
| --- | --- | --- |
| `inventory_batches` | `id` | `quantity_received` is the ceiling. `quantity_remaining` is a projection |
| `inventory_movements` | `id` | Source of truth for physical quantity. Signed qty is `direction * quantity` and is not a column |
| `inventory_balances` | `(product_id, warehouse_id)` | Projection. No surrogate id |
| `inventory_reservations` | `id` | Holds. Active quantity is summed onto `quantity_reserved` |
| `v_inventory_availability` | — | `quantity_available` is derived and never stored |

## Documents and audit

### `document_sequences`

Primary key `(document_type, period_year)`. `last_value` is the last issued integer, from 125 through 999999. Issued by `tlb.next_document_number()` only in normal operation. Prototype `public.document_counters` is a different table and is not altered.

Accepted type codes: `ORD`, `QTE`, `SUP`, `INV`, `RCT`, `DLV`, `PAY`, `VEN`, `PO`, `GRN`, `SPAY`, `MV`, `ISS`, `TR`, `ADJ`, `BAT`, `CRT`, `SRT`, `NPO`, `IMP`, `EXP`, `REQ`, `CUS`. The function also accepts the frontend `DocumentKind` names (`order`, `stockMovement`, `supplierPo`, and the rest) and maps them onto those codes.

### `audit_events`

Append-only. `created_at` corresponds to frontend `AuditEvent.at`. `actor_id` references `profiles` and may be null for a service-role insert. `record_audit_event()` refuses a null `auth.uid()`. `action` is text so a new audit action does not need a catalog migration before the app is wired; the known set is `AuditAction` in `src/lib/domain/types.ts`. `meta` must be a JSON object or null. `entity_id` is text because future documents are not in this schema yet.

`public.audit_events` is untouched.

## Row Level Security helpers

All of these are `SECURITY DEFINER` with `search_path = tlb, pg_temp`:

- `is_active_profile()`
- `is_self(uuid)`
- `has_role(uuid)`
- `has_permission(text)`
- `can_access_warehouse(uuid)`
- `can_read_products()`
- `can_read_customers()`
- `can_read_suppliers()`
- `can_read_stock()`

`has_permission` only inspects `auth.uid()`. It does not take a user id, so it cannot be used to probe another person’s grants.

## Indexes

Unique: role `code`, live role `lower(name)`, permission `code`, warehouse `code`, unit `code`, category `code`, live category `lower(name)`, supplier number, product `sku`, customer number, batch number, movement number, document sequence key.

Supporting: `profiles.email`, `role_permissions.permission_code`, `user_roles.role_id`, `user_warehouse_access.warehouse_id`, live names on warehouses, suppliers, products, and customers, product foreign keys, batch issue order `(product_id, warehouse_id, expires_at, received_at)` where the batch is open and still has quantity, batch receipt order, movements by product/warehouse/time and by batch, active reservations, audit by time, entity, and actor.

## Prototype fields left behind on purpose

- localStorage and seed string ids
- user invite tokens
- `paymentTerms` text (replaced by `payment_terms_days`)
- `Product.unit` and `Product.category` strings (replaced by foreign keys, category optional)
- `StockBalance.id`
- `StockMovement.signedQty`, `qtyMove` as a separate stored sign, and soft-delete flags on movements
- `StockReservation.orderLineId` (no sales-order table yet; use `reference_type` / `reference_id` later)
- integer quantities and `numeric(14,2)` money on the prototype tables
