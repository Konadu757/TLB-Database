# Switching from local domain store to Supabase

The UI mutates an in-memory `TlbState` via `src/lib/store/tlb-store.ts`.
Persistence goes through `createTlbRepository()` in `tlb-repository.ts`.

## Current wiring (hybrid)

When `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` are set (and
`VITE_TLB_USE_SUPABASE` is not `0`), the app uses **`SupabaseTlbRepository`**:

| On Supabase (P0/P1) | Still localStorage |
| --- | --- |
| warehouses, products, stock_balances | batches, movements, GRNs, transfers, adjustments |
| customers, customer_purchase_orders, customer_order_lines | returns, non-PO, import/export |
| supplies, supply_lines, stock_reservations | quotations, suppliers (+ supplier POs/receipts/payments) |
| invoices, invoice_lines, receipts, receipt_lines | roles / users / mock session |
| deliveries, delivery_items, payments | trash catalog deletions |
| notifications, audit_events | product extras (reorder, strategy, cost) |
| document_counters (synced subset), vat_rates | ops hub (requests, drivers, messages, …) |
| app_settings (`company_profile`, `outstanding_ageing`, `soft_delete_overlay`) | |

Outstanding quantities remain **calculated** (domain + `v_outstanding_customer_supplies`), never stored as truth.

## Migrations (apply in order)

1. `20260909_customer_orders.sql` — P0
2. `20260909_p1_documents.sql` — P1
3. `20260909_p2_text_ids_and_soft_delete.sql` — **required** so seed/app string ids (`cus-demo`, etc.) work (converts uuid → text). Soft-delete columns are optional; the app also stores soft-delete in `app_settings.soft_delete_overlay`.

Do **not** re-run archived migrations under `supabase/migrations/_archive/`.
Do **not** truncate production tables.

## Environment

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon or sb_publishable_… key>
VITE_SUPABASE_PROJECT_ID=<project-ref>
VITE_TLB_USE_SUPABASE=1
```

Mirror the same names without `VITE_` for SSR if needed (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`).
Set `VITE_TLB_USE_SUPABASE=0` to force local-only.

On Vercel: Project → Settings → Environment Variables → add the `VITE_*` vars for Production (and Preview), then redeploy.

## Verify live sync

1. Open the deployed app, wait for hydration (no “Save to supabase failed” banner).
2. Create or edit a **Customer** and save.
3. In Supabase Table Editor → `customers`, confirm the row (`code`, `name`, timestamps).
4. Reload the app (or another browser) — the customer should still be present (loaded from Supabase).
5. Optional: create an invoice after a supply — rows appear in `invoices` / `invoice_lines`.

If save fails with a uuid / type error, apply **P2** migration. If DNS/project missing, fix `VITE_SUPABASE_URL` first.

**`Failed to fetch` / network:** usually wrong or missing `VITE_SUPABASE_*` on Vercel, a paused Supabase project, CORS/DNS, or offline. Dispatch and ops mutations still complete — the hybrid repo always writes the local snapshot first, then pauses remote upserts for the rest of the session after the first unreachable failure (no banner, toast, or inline alert; `console.warn` only). Fingerprints still seed after load so Mark all read / ops clicks do not re-upsert warehouses when remote is healthy.

## Implementation notes

- Mutations stay pure in `tlb-store` / `documents.ts`; the repository only persists snapshots.
- First load against **empty** remote tables bootstraps once from the demo seed (upsert, no truncate).
- Local full snapshot remains as an offline safety net; P0/P1 source of truth is Supabase when enabled.
- Ops Hub rows stay in localStorage until a dedicated migration exists.
