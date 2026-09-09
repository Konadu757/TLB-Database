/**
 * Repository boundary for live Supabase wiring.
 *
 * Current runtime: LocalTlbRepository (localStorage via tlb-store).
 * To switch: implement SupabaseTlbRepository against migrations in
 * supabase/migrations/, then swap createTlbRepository() below.
 *
 * Do not destroy production data when applying migrations — use additive SQL only.
 */

import type { TlbState } from "../domain/types";
import { loadState, saveState } from "../store/tlb-store";

export interface TlbRepository {
  load(): Promise<TlbState>;
  save(state: TlbState): Promise<void>;
  backend: "local" | "supabase";
}

export class LocalTlbRepository implements TlbRepository {
  backend = "local" as const;
  async load(): Promise<TlbState> {
    return loadState();
  }
  async save(state: TlbState): Promise<void> {
    saveState(state);
  }
}

/**
 * Placeholder for live wiring. Tables: invoices, invoice_lines, receipts,
 * receipt_lines, deliveries, delivery_items, notifications, payments,
 * stock_reservations, vat_rates, company_profile (+ existing P0 tables).
 *
 * Enable when SUPABASE_URL is set AND migrations have been applied:
 *   return new SupabaseTlbRepository(createClient(...))
 */
export function createTlbRepository(): TlbRepository {
  // Credentials exist in .env but live table sync is not enabled until
  // migrations are applied in the Supabase project. Keep local store.
  return new LocalTlbRepository();
}
