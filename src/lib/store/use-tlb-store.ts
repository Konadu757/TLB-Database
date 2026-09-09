import { useCallback, useEffect, useMemo, useState } from "react";

import type { AppRole, DeliveryStatus, Permission, TlbState } from "@/lib/domain/types";
import { can as canPerm } from "@/lib/store/tlb-store";
import {
  assignUserRole,
  cancelOrderLine,
  confirmCustomerOrder,
  createCustomerOrder,
  createDeliveryFromSupply,
  createInvoiceFromSupply,
  createOrdinaryReceipt,
  createQuotation,
  createRole,
  createSupply,
  deactivateRole,
  getOutstandingRows,
  loadState,
  markDelivered,
  markNotificationRead,
  markNotificationsRead,
  purgeTrashItem,
  receiveStock,
  recordPayment,
  refreshOpsNotifications,
  releaseReservation,
  reserveForOutstanding,
  resetToSeed,
  restoreTrashItem,
  saveState,
  softDeleteRecord,
  switchRole,
  switchSessionUser,
  updateAgeingSettings,
  updateCompanyProfile,
  updateDeliveryStatus,
  updateRole,
  upsertAppUser,
  upsertCustomer,
  upsertSupplier,
  upsertVatRate,
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
    can: (permission: Permission) => canPerm(state, permission),
    resetDemo: () => {
      const seed = resetToSeed();
      setState(seed);
      setNotice("Demo reset to Phase 30 Chemical A/B starting stock.");
      setError(null);
    },
    saveCustomer: (input: Parameters<typeof upsertCustomer>[1]) =>
      apply((s) => upsertCustomer(s, input), "Customer saved."),
    saveSupplier: (input: Parameters<typeof upsertSupplier>[1]) =>
      apply((s) => upsertSupplier(s, input), "Supplier saved."),
    createOrder: (input: Parameters<typeof createCustomerOrder>[1]) =>
      apply((s) => createCustomerOrder(s, input), "Customer order created."),
    createQuotation: (input: Parameters<typeof createQuotation>[1]) =>
      apply((s) => createQuotation(s, input), "Quotation created."),
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
    releaseReservation: (id: string, reason?: string) =>
      apply((s) => releaseReservation(s, id, reason), "Reservation released."),
    deliver: (orderId: string) => apply((s) => markDelivered(s, orderId), "Order marked delivered."),
    setAgeing: (
      normalMaxDays: number,
      attentionMaxDays: number,
      extendedUnfulfilledDays?: number,
      expectedApproachingDays?: number,
    ) =>
      apply(
        (s) => updateAgeingSettings(s, normalMaxDays, attentionMaxDays, extendedUnfulfilledDays, expectedApproachingDays),
        "Ageing thresholds updated.",
      ),
    saveCompany: (company: Parameters<typeof updateCompanyProfile>[1]) =>
      apply((s) => updateCompanyProfile(s, company), "Company profile saved."),
    saveVatRate: (input: Parameters<typeof upsertVatRate>[1]) =>
      apply((s) => upsertVatRate(s, input), "VAT rate saved."),
    setRole: (role: AppRole) => apply((s) => switchRole(s, role), `Role set to ${role}.`),
    switchUser: (userId: string) => apply((s) => switchSessionUser(s, userId), "Signed in as selected user."),
    createRole: (input: Parameters<typeof createRole>[1]) =>
      apply((s) => createRole(s, input), "Role created."),
    updateRole: (roleId: string, input: Parameters<typeof updateRole>[2]) =>
      apply((s) => updateRole(s, roleId, input), "Role updated."),
    deactivateRole: (roleId: string) =>
      apply((s) => deactivateRole(s, roleId), "Role deactivated."),
    assignUserRole: (userId: string, roleId: string) =>
      apply((s) => assignUserRole(s, userId, roleId), "User role assigned."),
    saveUser: (input: Parameters<typeof upsertAppUser>[1]) =>
      apply((s) => upsertAppUser(s, input), "User saved."),
    createInvoice: (input: Parameters<typeof createInvoiceFromSupply>[1]) =>
      apply((s) => createInvoiceFromSupply(s, input), "VAT invoice created."),
    createReceipt: (input: Parameters<typeof createOrdinaryReceipt>[1]) =>
      apply((s) => createOrdinaryReceipt(s, input), "Receipt created."),
    createDelivery: (input: Parameters<typeof createDeliveryFromSupply>[1]) =>
      apply((s) => createDeliveryFromSupply(s, input), "Delivery created."),
    setDeliveryStatus: (id: string, status: DeliveryStatus, confirmation?: { receiverName?: string; notes?: string }) =>
      apply((s) => updateDeliveryStatus(s, id, status, confirmation), "Delivery status updated."),
    recordPayment: (input: Parameters<typeof recordPayment>[1]) =>
      apply((s) => recordPayment(s, input), "Payment recorded."),
    readNotification: (id: string) => apply((s) => markNotificationRead(s, id)),
    /** Mark visible/open-panel notifications as viewed so the header unread badge decreases. */
    readNotifications: (ids: string[]) => apply((s) => markNotificationsRead(s, ids)),
    refreshNotifications: () => apply((s) => refreshOpsNotifications(s)),
    moveToTrash: (input: Parameters<typeof softDeleteRecord>[1]) =>
      apply((s) => softDeleteRecord(s, input), "Moved to trash."),
    restoreFromTrash: (input: Parameters<typeof restoreTrashItem>[1]) =>
      apply((s) => restoreTrashItem(s, input), "Restored from trash."),
    purgeFromTrash: (input: Parameters<typeof purgeTrashItem>[1]) =>
      apply((s) => purgeTrashItem(s, input), "Permanently deleted."),
  };
}

export type TlbStoreApi = ReturnType<typeof useTlbStore>;
