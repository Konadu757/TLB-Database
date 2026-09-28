/**
 * Repository boundary for live Supabase wiring.
 *
 * Runtime:
 * - LocalTlbRepository when Supabase is disabled / credentials missing
 * - SupabaseTlbRepository (hybrid) when VITE_SUPABASE_URL + key + VITE_TLB_USE_SUPABASE=1
 *
 * Do not destroy production data when applying migrations — use additive SQL only.
 */

import { supabase } from "@/integrations/supabase/client";
import type { TlbState } from "../domain/types";
import { loadState, saveState } from "../store/tlb-store";
import { SupabaseTlbRepository } from "./supabase-tlb-repository";

export interface TlbRepository {
  load(): Promise<TlbState>;
  save(state: TlbState): Promise<void>;
  backend: "local" | "supabase";
  /**
   * Deprecated soft-error hook — always null in production UI.
   * Cloud/network sync failures are console-only; local save is the source of truth offline.
   */
  getLastError?(): string | null;
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

function envFlag(name: string): string | undefined {
  try {
    const vite = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    return vite?.[name] ?? (typeof process !== "undefined" ? process.env?.[name] : undefined);
  } catch {
    return typeof process !== "undefined" ? process.env?.[name] : undefined;
  }
}

/** True when URL + publishable key exist and the feature flag is enabled. */
export function shouldUseSupabaseRepository(): boolean {
  const url = envFlag("VITE_SUPABASE_URL") || envFlag("SUPABASE_URL");
  const key = envFlag("VITE_SUPABASE_PUBLISHABLE_KEY") || envFlag("SUPABASE_PUBLISHABLE_KEY");
  const flag = (
    envFlag("VITE_TLB_USE_SUPABASE") ||
    envFlag("TLB_USE_SUPABASE") ||
    "1"
  ).toLowerCase();
  if (!url || !key) return false;
  // Default ON when credentials exist; set VITE_TLB_USE_SUPABASE=0 to force local.
  return flag !== "0" && flag !== "false" && flag !== "off";
}

let cached: TlbRepository | null = null;

/**
 * Returns the active repository. Prefers live Supabase when configured.
 */
export function createTlbRepository(): TlbRepository {
  if (cached) return cached;
  if (shouldUseSupabaseRepository()) {
    try {
      cached = new SupabaseTlbRepository(supabase);
      return cached;
    } catch (err) {
      console.error("[createTlbRepository] Supabase client failed, using local store:", err);
    }
  }
  cached = new LocalTlbRepository();
  return cached;
}

/** Test helper — clear singleton between tests. */
export function resetTlbRepositoryCache(): void {
  cached = null;
}
