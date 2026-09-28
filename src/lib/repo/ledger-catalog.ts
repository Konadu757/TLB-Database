/**
 * App id → tlb uuid for the seeded catalog.
 * The same ids are inserted by supabase/migrations/20260928_100007_app_catalog.sql.
 * Any other id stays as-is until ensure_ledger_ref returns a uuid.
 */

export const CATALOG_PRODUCT_IDS: Record<string, string> = {
  "prod-chem-a": "b2000000-0000-4000-8000-000000000001",
  "prod-chem-b": "b2000000-0000-4000-8000-000000000002",
  "prod-mat-b": "b2000000-0000-4000-8000-000000000003",
  "prod-hcl": "b2000000-0000-4000-8000-000000000004",
  "prod-eth": "b2000000-0000-4000-8000-000000000005",
};

export const CATALOG_WAREHOUSE_IDS: Record<string, string> = {
  "wh-main": "a1000000-0000-4000-8000-000000000001",
  "wh-factory": "a1000000-0000-4000-8000-000000000002",
  "wh-accra": "a1000000-0000-4000-8000-000000000003",
};

export function ledgerProductId(localId: string): string {
  return CATALOG_PRODUCT_IDS[localId] ?? localId;
}

export function ledgerWarehouseId(localId: string): string {
  return CATALOG_WAREHOUSE_IDS[localId] ?? localId;
}
