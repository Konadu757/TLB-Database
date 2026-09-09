import { useCallback, useEffect, useMemo, useState } from "react";

import type { TlbState } from "@/lib/domain/types";
import {
  cancelOrderLine,
  confirmCustomerOrder,
  createCustomerOrder,
  createSupply,
  getOutstandingRows,
  loadState,
  markDelivered,
  receiveStock,
  reserveForOutstanding,
  resetToSeed,
  saveState,
  updateAgeingSettings,
  upsertCustomer,
} from "@/lib/store/tlb-store";

type MutFn = (state: TlbState) =>
  | { ok: true; data: { state: TlbState; data: unknown } }
  | { ok: false; error: string };

export function useTlbStore() {
  const [state, setState] = useState<TlbState>(() => loadState());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveState(state);
  }, [state, hydrated]);

  const apply = useCallback((fn: MutFn, successMessage?: string) => {
    setError(null);
    setNotice(null);
    let failed: string | null = null;
    setState((prev) => {
      const result = fn(prev);
      if (!result.ok) {
        failed = result.error;
        return prev;
      }
      return result.data.state;
    });
    if (failed) {
      setError(failed);
      return false;
    }
    if (successMessage) setNotice(successMessage);
    return true;
  }, []);

  const outstanding = useMemo(() => getOutstandingRows(state), [state]);

  return {
    state,
    hydrated,
    error,
    notice,
    clearMessages: () => {
      setError(null);
      setNotice(null);
    },
    outstanding,
    resetDemo: () => {
      const seed = resetToSeed();
      setState(seed);
      setNotice("Demo reset to Phase 30 Chemical A/B starting stock.");
      setError(null);
    },
    saveCustomer: (input: Parameters<typeof upsertCustomer>[1]) =>
      apply((s) => upsertCustomer(s, input), "Customer saved."),
    createOrder: (input: Parameters<typeof createCustomerOrder>[1]) =>
      apply((s) => createCustomerOrder(s, input), "Customer order created."),
    confirmOrder: (orderId: string) =>
      apply((s) => confirmCustomerOrder(s, orderId), "Order confirmed."),
    cancelLine: (lineId: string, reason: string) =>
      apply((s) => cancelOrderLine(s, lineId, reason), "Outstanding quantity cancelled with reason."),
    supply: (orderId: string, lines: Parameters<typeof createSupply>[2], notes?: string) =>
      apply((s) => createSupply(s, orderId, lines, notes), "Supply posted."),
    receive: (productId: string, warehouseId: string, qty: number) =>
      apply((s) => receiveStock(s, productId, warehouseId, qty, true), "Stock received and reserved for outstanding orders."),
    reserve: (productId: string, warehouseId: string) =>
      apply((s) => reserveForOutstanding(s, productId, warehouseId), "Stock reserved against outstanding orders."),
    deliver: (orderId: string) => apply((s) => markDelivered(s, orderId), "Order marked delivered."),
    setAgeing: (normalMaxDays: number, attentionMaxDays: number) =>
      apply((s) => updateAgeingSettings(s, normalMaxDays, attentionMaxDays), "Ageing thresholds updated."),
  };
}

export type TlbStoreApi = ReturnType<typeof useTlbStore>;
