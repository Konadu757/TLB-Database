# Switching from local domain store to Supabase

The UI and domain mutations currently run through `src/lib/store/tlb-store.ts`
(localStorage). Entity shapes match the SQL migrations.

## Steps

1. Apply migrations in order under `supabase/migrations/` (P0 customer orders, then P1 documents).
2. Confirm tables exist: `invoices`, `invoice_lines`, `receipts`, `receipt_lines`, `deliveries`, `delivery_items`, `payments`, `notifications`, `stock_reservations`, `vat_rates`, and company settings in `app_settings`.
3. Implement `SupabaseTlbRepository` in `tlb-repository.ts` mapping row ↔ domain types.
4. Change `createTlbRepository()` to return the Supabase implementation when `VITE_SUPABASE_URL` is present and a feature flag (e.g. `VITE_TLB_USE_SUPABASE=1`) is set.
5. Keep mutations pure in `tlb-store` / `documents.ts`; the repository only persists snapshots or translates actions to SQL/RPC.

Do **not** truncate production tables. Prefer additive migrations and upserts.
