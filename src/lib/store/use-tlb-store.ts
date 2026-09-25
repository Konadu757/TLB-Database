import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AppRole, AppUser, DeliveryStatus, Permission, TlbState } from "@/lib/domain/types";
import { createTlbRepository } from "@/lib/repo/tlb-repository";
import { can as canPerm } from "@/lib/store/tlb-store";
import {
  assignUserRole,
  cancelOrderLine,
  confirmCustomerOrder,
  createCustomerOrder,
  createDeliveryFromSupply,
  createInvoiceFromSupply,
  createOrdinaryReceipt,
  createReceiptFromSupply,
  createQuotation,
  createRole,
  createSupply,
  deleteRole,
  getOutstandingRows,
  loadState,
  markDelivered,
  markNotificationRead,
  markNotificationsRead,
  markAllNotificationsRead,
  deleteNotification,
  deleteNotifications,
  purgeTrashItem,
  receiveStock,
  recordPayment,
  refreshOpsNotifications,
  releaseReservation,
  reserveForOutstanding,
  resetToSeed,
  restoreTrashItem,
  softDeleteRecord,
  switchRole,
  acceptInvite,
  issueUserInvite,
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
import {
  advanceTransfer,
  createGoodsReceipt,
  createStockIssue,
  decideApproval,
  postStockAdjustment,
  requestWarehouseTransfer,
} from "@/lib/store/inventory-store";
import {
  createCustomerReturn,
  createNonPoPurchase,
  createSupplierReturn,
  decideNonPoPurchase,
  receiveImportShipment,
  receiveNonPoPurchase,
  softDeleteOpsRecord,
  upsertExportShipment,
  upsertImportShipment,
} from "@/lib/store/ops-extended-store";
import {
  acknowledgeOpsRequest,
  advanceOpsDriverStatus,
  assignOpsDriver,
  autoReviewOpsLines,
  cancelOpsRequest,
  confirmOpsDeliveryReceipt,
  confirmOpsWarehouseCollection,
  createOpsRequest,
  decideOpsRequestApproval,
  markOpsReadyForCollection,
  postOpsMessage,
  prepareOpsRequest,
  releaseOpsGoods,
  reviewOpsWarehouse,
  submitOpsRequest,
  updateOpsRequestDraft,
  upsertOpsDriver,
} from "@/lib/store/ops-hub-store";
import type { TransferStatus } from "@/lib/domain/types";

type MutFn = (state: TlbState) =>
  | { ok: true; data: { state: TlbState; data: unknown } }
  | { ok: false; error: string };

export type LastStaffInvite = {
  userId: string;
  name: string;
  email: string;
  inviteToken: string;
  inviteCode: string;
};

const SAVE_DEBOUNCE_MS = 450;

function inviteSnapshot(user: AppUser): LastStaffInvite | null {
  if (!user.inviteToken || !user.inviteCode) return null;
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    inviteToken: user.inviteToken,
    inviteCode: user.inviteCode,
  };
}

export function useTlbStore() {
  const repo = useMemo(() => createTlbRepository(), []);
  const [state, setState] = useState<TlbState>(() => loadState());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastInvite, setLastInvite] = useState<LastStaffInvite | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextPersist = useRef(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await repo.load();
        if (cancelled) return;
        skipNextPersist.current = true;
        setState(loaded);
        setHydrated(true);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setPersistError(`Failed to load from ${repo.backend}: ${message}`);
        setState(loadState());
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaving(true);
      void repo
        .save(state)
        .then(() => {
          // Remote sync failures are silent (local snapshot already kept) — never banner.
          setPersistError(null);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          const lower = message.toLowerCase();
          // Hybrid cloud/network soft-fails must never reach Flash banners.
          if (
            lower.includes("failed to fetch") ||
            lower.includes("cloud sync") ||
            lower.includes("network")
          ) {
            console.warn("[useTlbStore] save soft-failed (local kept):", message);
            setPersistError(null);
            return;
          }
          setPersistError(`Save to ${repo.backend} failed: ${message}`);
        })
        .finally(() => setSaving(false));
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, hydrated, repo]);

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

  const applyCapture = useCallback((fn: MutFn, successMessage?: string) => {
    setError(null);
    setNotice(null);
    let failed: string | null = null;
    let captured: unknown = null;
    setState((prev) => {
      const result = fn(prev);
      if (!result.ok) {
        failed = result.error;
        return prev;
      }
      captured = result.data.data;
      return result.data.state;
    });
    if (failed) {
      setError(failed);
      return { ok: false as const, data: null };
    }
    if (successMessage) setNotice(successMessage);
    return { ok: true as const, data: captured };
  }, []);

  const outstanding = useMemo(() => getOutstandingRows(state), [state]);

  return {
    state,
    hydrated,
    saving,
    backend: repo.backend,
    error: error ?? persistError,
    notice,
    lastInvite,
    persistError,
    clearLastInvite: () => setLastInvite(null),
    clearMessages: () => {
      setError(null);
      setNotice(null);
      setPersistError(null);
    },
    outstanding,
    can: (permission: Permission) => canPerm(state, permission),
    resetDemo: () => {
      const seed = resetToSeed();
      skipNextPersist.current = false;
      setState(seed);
      setNotice(
        repo.backend === "supabase"
          ? "Demo reset locally — next save will upsert seed into Supabase (does not truncate other rows first)."
          : "Demo reset to Phase 30 Chemical A/B starting stock.",
      );
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
    postGrn: (input: Parameters<typeof createGoodsReceipt>[1]) =>
      apply((s) => createGoodsReceipt(s, input), "Goods receipt posted to ledger."),
    postIssue: (input: Parameters<typeof createStockIssue>[1]) =>
      apply((s) => createStockIssue(s, input), "Stock issue posted."),
    requestTransfer: (input: Parameters<typeof requestWarehouseTransfer>[1]) =>
      apply((s) => requestWarehouseTransfer(s, input), "Transfer requested."),
    advanceTransfer: (transferId: string, toStatus: TransferStatus) =>
      apply((s) => advanceTransfer(s, transferId, toStatus), "Transfer updated."),
    postAdjustment: (input: Parameters<typeof postStockAdjustment>[1]) =>
      apply((s) => postStockAdjustment(s, input), "Adjustment saved."),
    decideApproval: (approvalId: string, decision: "Approved" | "Rejected", note?: string) =>
      apply((s) => {
        const appr = s.approvals.find((a) => a.id === approvalId);
        if (appr?.refType === "ops_request" && appr.status === "Pending") {
          return decideOpsRequestApproval(s, appr.refId, decision, { note });
        }
        return decideApproval(s, approvalId, decision, note);
      }, `Approval ${decision.toLowerCase()}.`),
    createOpsRequest: (input: Parameters<typeof createOpsRequest>[1]) =>
      apply((s) => createOpsRequest(s, input), "Ops request saved."),
    updateOpsDraft: (requestId: string, input: Parameters<typeof updateOpsRequestDraft>[2]) =>
      apply((s) => updateOpsRequestDraft(s, requestId, input), "Draft updated."),
    submitOpsRequest: (requestId: string) =>
      apply((s) => submitOpsRequest(s, requestId), "Request submitted."),
    acknowledgeOpsRequest: (requestId: string) =>
      apply((s) => acknowledgeOpsRequest(s, requestId), "Request acknowledged."),
    decideOpsApproval: (
      requestId: string,
      decision: "Approved" | "Rejected" | "Partial",
      input?: Parameters<typeof decideOpsRequestApproval>[3],
    ) => apply((s) => decideOpsRequestApproval(s, requestId, decision, input), `Ops ${decision.toLowerCase()}.`),
    autoReviewOps: (requestId: string) =>
      apply((s) => autoReviewOpsLines(s, requestId), "Warehouse availability reviewed."),
    reviewOpsWarehouse: (requestId: string, input: Parameters<typeof reviewOpsWarehouse>[2]) =>
      apply((s) => reviewOpsWarehouse(s, requestId, input), "Warehouse review saved."),
    prepareOps: (requestId: string, input: Parameters<typeof prepareOpsRequest>[2]) =>
      apply((s) => prepareOpsRequest(s, requestId, input), "Preparation saved."),
    markOpsReady: (requestId: string) =>
      apply((s) => markOpsReadyForCollection(s, requestId), "Ready for collection."),
    releaseOpsGoods: (requestId: string, input?: Parameters<typeof releaseOpsGoods>[2]) =>
      apply((s) => releaseOpsGoods(s, requestId, input), "Goods released — ledger posted."),
    assignOpsDriver: (requestId: string, driverId: string, vehicle?: string) =>
      apply((s) => assignOpsDriver(s, requestId, driverId, vehicle), "Driver assigned."),
    advanceOpsDriver: (requestId: string, toStatus: Parameters<typeof advanceOpsDriverStatus>[2], note?: string) =>
      apply((s) => advanceOpsDriverStatus(s, requestId, toStatus, note), "Driver status updated."),
    confirmOpsWarehouseCollect: (requestId: string) =>
      apply((s) => confirmOpsWarehouseCollection(s, requestId), "Warehouse collection confirmed."),
    confirmOpsDelivery: (requestId: string, input: Parameters<typeof confirmOpsDeliveryReceipt>[2]) =>
      apply((s) => confirmOpsDeliveryReceipt(s, requestId, input), "Delivery receipt recorded."),
    postOpsMessage: (requestId: string, body: string, chip?: Parameters<typeof postOpsMessage>[3]) =>
      apply((s) => postOpsMessage(s, requestId, body, chip), "Message posted."),
    cancelOpsRequest: (requestId: string, reason: string) =>
      apply((s) => cancelOpsRequest(s, requestId, reason), "Request cancelled."),
    saveOpsDriver: (input: Parameters<typeof upsertOpsDriver>[1]) =>
      apply((s) => upsertOpsDriver(s, input), "Driver saved."),
    postCustomerReturn: (input: Parameters<typeof createCustomerReturn>[1]) =>
      apply((s) => createCustomerReturn(s, input), "Customer return posted to ledger."),
    postSupplierReturn: (input: Parameters<typeof createSupplierReturn>[1]) =>
      apply((s) => createSupplierReturn(s, input), "Supplier return posted to ledger."),
    createNonPo: (input: Parameters<typeof createNonPoPurchase>[1]) =>
      apply((s) => createNonPoPurchase(s, input), "Non-PO submitted for approval."),
    decideNonPo: (nonPoId: string, decision: "Approved" | "Rejected", note?: string) =>
      apply((s) => decideNonPoPurchase(s, nonPoId, decision, note), `Non-PO ${decision.toLowerCase()}.`),
    receiveNonPo: (nonPoId: string) =>
      apply((s) => receiveNonPoPurchase(s, nonPoId), "Non-PO goods received (GRN)."),
    upsertImport: (input: Parameters<typeof upsertImportShipment>[1]) =>
      apply((s) => upsertImportShipment(s, input), "Import shipment saved."),
    receiveImport: (shipmentId: string) =>
      apply((s) => receiveImportShipment(s, shipmentId), "Import received to warehouse."),
    upsertExport: (input: Parameters<typeof upsertExportShipment>[1]) =>
      apply((s) => upsertExportShipment(s, input), "Export shipment saved."),
    moveOpsToTrash: (input: Parameters<typeof softDeleteOpsRecord>[1]) =>
      apply((s) => softDeleteOpsRecord(s, input), "Moved to trash."),
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
    deleteRole: (roleId: string) =>
      apply((s) => deleteRole(s, roleId), "Role deleted."),
    deactivateRole: (roleId: string) =>
      apply((s) => deleteRole(s, roleId), "Role deleted."),
    assignUserRole: (userId: string, roleId: string) =>
      apply((s) => assignUserRole(s, userId, roleId), "User role assigned."),
    saveUser: (input: Parameters<typeof upsertAppUser>[1]) => {
      const result = applyCapture((s) => upsertAppUser(s, input), "User saved.");
      if (result.ok && !input.id && result.data) {
        const snap = inviteSnapshot(result.data as AppUser);
        if (snap) setLastInvite(snap);
      }
      return result.ok;
    },
    issueUserInvite: (userId: string) => {
      const result = applyCapture((s) => issueUserInvite(s, userId), "Invite re-issued.");
      if (result.ok && result.data) {
        const snap = inviteSnapshot(result.data as AppUser);
        if (snap) setLastInvite(snap);
      }
      return result.ok;
    },
    acceptInvite: (input: Parameters<typeof acceptInvite>[1]) =>
      applyCapture((s) => acceptInvite(s, input), "Signed in."),
    createInvoice: (input: Parameters<typeof createInvoiceFromSupply>[1]) =>
      apply((s) => createInvoiceFromSupply(s, input), "VAT invoice created."),
    createReceipt: (input: Parameters<typeof createOrdinaryReceipt>[1]) =>
      apply((s) => createOrdinaryReceipt(s, input), "Receipt created."),
    createReceiptFromSupply: (input: Parameters<typeof createReceiptFromSupply>[1]) =>
      apply((s) => createReceiptFromSupply(s, input), "Receipt created from supply."),
    createDelivery: (input: Parameters<typeof createDeliveryFromSupply>[1]) =>
      apply((s) => createDeliveryFromSupply(s, input), "Delivery created."),
    setDeliveryStatus: (id: string, status: DeliveryStatus, confirmation?: { receiverName?: string; notes?: string }) =>
      apply((s) => updateDeliveryStatus(s, id, status, confirmation), "Delivery status updated."),
    recordPayment: (input: Parameters<typeof recordPayment>[1]) =>
      apply((s) => recordPayment(s, input), "Payment recorded."),
    readNotification: (id: string) => apply((s) => markNotificationRead(s, id)),
    /** Mark visible/open-panel notifications as viewed so the header unread badge decreases. */
    readNotifications: (ids: string[]) => apply((s) => markNotificationsRead(s, ids)),
    markAllNotificationsRead: (ids?: string[]) =>
      apply((s) => markAllNotificationsRead(s, ids), "Notifications marked as read."),
    deleteNotification: (id: string) =>
      apply((s) => deleteNotification(s, id), "Notification deleted."),
    deleteNotifications: (ids: string[]) =>
      apply((s) => deleteNotifications(s, ids), "Notifications deleted."),
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
