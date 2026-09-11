/**
 * Soft-delete / Trash mutations for all trashable domain entities.
 * Stock movements may be soft-hidden but never permanently purged (ledger integrity).
 * Audit events and system Owner role are never trashable.
 */
import { hasPermission } from "../domain/permissions";
import { buildCatalogDeletion, isSoftDeleted, listTrashItems as collectTrashItems } from "../domain/trash";
import type {
  AuditEvent,
  Permission,
  SoftDeleteFields,
  StoreResult,
  TlbState,
  TrashEntityType,
  TrashListItem,
} from "../domain/types";
import { findDriverBlockingAssignment } from "./ops-hub-store";

type MutResult<T> = StoreResult<{ state: TlbState; data: T }>;

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function pushAudit(
  state: TlbState,
  partial: Omit<AuditEvent, "id" | "at" | "actor"> & { actor?: string; at?: string },
): void {
  state.audit.unshift({
    id: uid("aud"),
    at: partial.at ?? new Date().toISOString(),
    actor: partial.actor ?? state.currentUser,
    action: partial.action,
    entityType: partial.entityType,
    entityId: partial.entityId,
    summary: partial.summary,
    meta: partial.meta,
  });
  if (state.audit.length > 500) state.audit.length = 500;
}

function requirePerm(state: TlbState, permission: Permission): string | null {
  if (!hasPermission(state, permission)) {
    return `Role ${state.currentRole} cannot perform ${permission}.`;
  }
  return null;
}

function refreshNotifications(state: TlbState): void {
  // Notifications module filters soft-deleted; keep array as-is for trash restore.
  void state;
}

export function applySoftDeleteMeta(target: SoftDeleteFields, actor: string, reason?: string): void {
  target.deletedAt = new Date().toISOString();
  target.deletedBy = actor;
  if (reason?.trim()) target.deletedReason = reason.trim();
  else delete target.deletedReason;
}

export function clearSoftDeleteMeta(target: SoftDeleteFields): void {
  delete target.deletedAt;
  delete target.deletedBy;
  delete target.deletedReason;
}

const ORDER_MID_FULFILMENT = new Set([
  "Confirmed",
  "Awaiting Stock",
  "Partially Supplied",
  "Ready for Supply",
  "Fully Supplied",
]);

const OPS_REQUEST_ACTIVE = new Set([
  "Preparing",
  "Ready for Collection",
  "Issued",
  "Collected",
  "In Transit",
  "Partially Delivered",
]);

/** UI + store: why Move to Trash is blocked for this record (or null if allowed). */
export function trashBlockReason(
  state: TlbState,
  entityType: TrashEntityType,
  entityId: string,
): string | null {
  if (entityType === "order") {
    const row = state.orders.find((o) => o.id === entityId);
    if (!row) return null;
    if (ORDER_MID_FULFILMENT.has(row.status)) {
      return `Cannot trash order ${row.number} while status is ${row.status}. Complete, cancel, or finish fulfilment first.`;
    }
  }
  if (entityType === "ops_request") {
    const row = (state.opsRequests ?? []).find((r) => r.id === entityId);
    if (!row) return null;
    if (OPS_REQUEST_ACTIVE.has(row.status)) {
      return `Cannot trash request ${row.number} while status is ${row.status}. Complete or cancel the job first.`;
    }
  }
  if (entityType === "ops_driver") {
    const row = (state.opsDrivers ?? []).find((d) => d.id === entityId);
    if (!row) return null;
    const blocking = findDriverBlockingAssignment(state, row.id);
    if (blocking) {
      return `Cannot remove driver ${row.code} — assigned to active request ${blocking.number} (${blocking.status}${blocking.driverStatus ? ` · ${blocking.driverStatus}` : ""}). Reassign or complete the job first.`;
    }
  }
  if (entityType === "transfer") {
    const row = (state.transfers ?? []).find((t) => t.id === entityId);
    if (!row) return null;
    if (row.status === "In Transit") {
      return `Cannot trash transfer ${row.number} while In Transit. Receive or cancel it first.`;
    }
  }
  if (entityType === "delivery") {
    const row = state.deliveries.find((d) => d.id === entityId);
    if (!row) return null;
    if (row.status === "Dispatched") {
      return `Cannot trash delivery ${row.number} while Dispatched. Confirm delivery or mark failed/returned first.`;
    }
  }
  if (entityType === "goods_receipt") {
    const row = (state.goodsReceipts ?? []).find((g) => g.id === entityId);
    if (!row) return null;
    if (row.status === "Received" || row.status === "Checked") {
      return `Cannot trash GRN ${row.number} while ${row.status}. Approve, reject, or cancel first.`;
    }
  }
  if (entityType === "supplier_po") {
    const row = (state.supplierPurchaseOrders ?? []).find((p) => p.id === entityId);
    if (!row) return null;
    if (["In transit", "Partially received"].includes(row.status)) {
      return `Cannot trash supplier PO ${row.number} while ${row.status}.`;
    }
  }
  return null;
}

export function listTrash(state: TlbState): TrashListItem[] {
  return collectTrashItems(state);
}

export function softDeleteRecord(
  state: TlbState,
  input: { entityType: TrashEntityType; entityId: string; reason?: string },
): MutResult<TrashListItem | null> {
  const blocked = requirePerm(state, "records.delete");
  if (blocked) return { ok: false, error: blocked };

  const ruleBlock = trashBlockReason(state, input.entityType, input.entityId);
  if (ruleBlock) return { ok: false, error: ruleBlock };

  const next = cloneState(state);
  const reason = input.reason?.trim();
  const actor = next.currentUser;
  let summary = "";
  const entityTypeLabel = input.entityType;

  const soft = <T extends SoftDeleteFields>(
    row: T | undefined,
    notFound: string,
    already: string,
    makeSummary: (r: T) => string,
    after?: (r: T) => void,
  ): string | null => {
    if (!row) return notFound;
    if (isSoftDeleted(row)) return already;
    applySoftDeleteMeta(row, actor, reason);
    after?.(row);
    summary = makeSummary(row);
    return null;
  };

  let err: string | null = null;

  switch (input.entityType) {
    case "customer": {
      const row = next.customers.find((c) => c.id === input.entityId);
      err = soft(row, "Customer not found.", "Customer is already in trash.", (r) => {
        r.updatedAt = r.deletedAt!;
        return `Moved customer ${r.code} · ${r.name} to trash.`;
      });
      break;
    }
    case "supplier": {
      const row = next.suppliers.find((s) => s.id === input.entityId);
      err = soft(row, "Supplier not found.", "Supplier is already in trash.", (r) => {
        r.updatedAt = r.deletedAt!;
        return `Moved supplier ${r.code} · ${r.name} to trash.`;
      });
      break;
    }
    case "product": {
      const row = next.products.find((p) => p.id === input.entityId);
      err = soft(row, "Product not found.", "Product is already in trash.", (r) => `Moved product ${r.sku} · ${r.name} to trash.`);
      break;
    }
    case "warehouse": {
      const row = next.warehouses.find((w) => w.id === input.entityId);
      err = soft(row, "Warehouse not found.", "Warehouse is already in trash.", (r) => `Moved warehouse ${r.code} · ${r.name} to trash.`);
      break;
    }
    case "order": {
      const row = next.orders.find((o) => o.id === input.entityId);
      err = soft(row, "Order not found.", "Order is already in trash.", (r) => {
        r.updatedAt = r.deletedAt!;
        return `Moved order ${r.number} to trash.`;
      });
      break;
    }
    case "catalog": {
      if (next.catalogPurgedIds.includes(input.entityId)) {
        return { ok: false, error: "Record was permanently deleted." };
      }
      if (next.catalogDeletions.some((d) => d.catalogId === input.entityId)) {
        return { ok: false, error: "Record is already in trash." };
      }
      const deletion = buildCatalogDeletion(input.entityId, actor, reason, next.quotations);
      if (!deletion) return { ok: false, error: "Catalog record not found." };
      next.catalogDeletions.unshift(deletion);
      summary = `Moved ${deletion.module} ${deletion.label} to trash.`;
      break;
    }
    case "customer_return": {
      const row = (next.customerReturns ?? []).find((r) => r.id === input.entityId);
      err = soft(row, "Customer return not found.", "Already in trash.", (r) => `Moved customer return ${r.number} to trash.`);
      break;
    }
    case "supplier_return": {
      const row = (next.supplierReturns ?? []).find((r) => r.id === input.entityId);
      err = soft(row, "Supplier return not found.", "Already in trash.", (r) => `Moved supplier return ${r.number} to trash.`);
      break;
    }
    case "non_po_purchase": {
      const row = (next.nonPoPurchases ?? []).find((r) => r.id === input.entityId);
      err = soft(row, "Non-PO not found.", "Already in trash.", (r) => `Moved Non-PO ${r.number} to trash.`);
      break;
    }
    case "import_shipment": {
      const row = (next.importShipments ?? []).find((r) => r.id === input.entityId);
      err = soft(row, "Import not found.", "Already in trash.", (r) => `Moved import ${r.number} to trash.`);
      break;
    }
    case "export_shipment": {
      const row = (next.exportShipments ?? []).find((r) => r.id === input.entityId);
      err = soft(row, "Export not found.", "Already in trash.", (r) => `Moved export ${r.number} to trash.`);
      break;
    }
    case "ops_driver": {
      const row = (next.opsDrivers ?? []).find((d) => d.id === input.entityId);
      err = soft(row, "Driver not found.", "Driver is already in trash.", (r) => {
        r.active = false;
        return `Moved driver ${r.code} · ${r.name} to trash.`;
      });
      break;
    }
    case "ops_request": {
      const row = (next.opsRequests ?? []).find((r) => r.id === input.entityId);
      err = soft(row, "Ops request not found.", "Already in trash.", (r) => `Moved ops request ${r.number} to trash.`);
      break;
    }
    case "ops_discrepancy": {
      const row = (next.opsDiscrepancies ?? []).find((d) => d.id === input.entityId);
      err = soft(row, "Discrepancy not found.", "Already in trash.", (r) => `Moved discrepancy ${r.kind} (${r.quantity}) to trash.`);
      break;
    }
    case "ops_message": {
      const row = (next.opsMessages ?? []).find((m) => m.id === input.entityId);
      err = soft(row, "Message not found.", "Already in trash.", (r) => `Moved ops message to trash.`);
      void row;
      break;
    }
    case "quotation": {
      const row = (next.quotations ?? []).find((q) => q.id === input.entityId);
      err = soft(row, "Quotation not found.", "Already in trash.", (r) => `Moved quotation ${r.number} to trash.`);
      break;
    }
    case "invoice": {
      const row = next.invoices.find((i) => i.id === input.entityId);
      err = soft(row, "Invoice not found.", "Already in trash.", (r) => `Moved invoice ${r.number} to trash.`);
      break;
    }
    case "receipt": {
      const row = next.receipts.find((r) => r.id === input.entityId);
      err = soft(row, "Receipt not found.", "Already in trash.", (r) => `Moved receipt ${r.number} to trash.`);
      break;
    }
    case "payment": {
      const row = next.payments.find((p) => p.id === input.entityId);
      err = soft(row, "Payment not found.", "Already in trash.", (r) => `Moved payment ${r.number} to trash.`);
      break;
    }
    case "delivery": {
      const row = next.deliveries.find((d) => d.id === input.entityId);
      err = soft(row, "Delivery not found.", "Already in trash.", (r) => `Moved delivery ${r.number} to trash.`);
      break;
    }
    case "goods_receipt": {
      const row = (next.goodsReceipts ?? []).find((g) => g.id === input.entityId);
      err = soft(row, "GRN not found.", "Already in trash.", (r) => `Moved GRN ${r.number} to trash.`);
      break;
    }
    case "stock_issue": {
      const row = (next.stockIssues ?? []).find((g) => g.id === input.entityId);
      err = soft(row, "Stock issue not found.", "Already in trash.", (r) => `Moved stock issue ${r.number} to trash.`);
      break;
    }
    case "transfer": {
      const row = (next.transfers ?? []).find((t) => t.id === input.entityId);
      err = soft(row, "Transfer not found.", "Already in trash.", (r) => `Moved transfer ${r.number} to trash.`);
      break;
    }
    case "adjustment": {
      const row = (next.adjustments ?? []).find((a) => a.id === input.entityId);
      err = soft(row, "Adjustment not found.", "Already in trash.", (r) => `Moved adjustment ${r.number} to trash.`);
      break;
    }
    case "batch": {
      const row = (next.batches ?? []).find((b) => b.id === input.entityId);
      err = soft(row, "Batch not found.", "Already in trash.", (r) => `Moved batch ${r.code} to trash.`);
      break;
    }
    case "stock_movement": {
      const row = (next.stockMovements ?? []).find((m) => m.id === input.entityId);
      err = soft(
        row,
        "Stock movement not found.",
        "Already hidden in trash.",
        (r) => `Hid stock movement ${r.number} from lists (ledger retained).`,
      );
      break;
    }
    case "supply": {
      const row = next.supplies.find((s) => s.id === input.entityId);
      err = soft(row, "Supply not found.", "Already in trash.", (r) => `Moved supply ${r.number} to trash.`);
      break;
    }
    case "supplier_po": {
      const row = (next.supplierPurchaseOrders ?? []).find((p) => p.id === input.entityId);
      err = soft(row, "Supplier PO not found.", "Already in trash.", (r) => {
        r.updatedAt = r.deletedAt!;
        return `Moved supplier PO ${r.number} to trash.`;
      });
      break;
    }
    case "supplier_receipt": {
      const row = (next.supplierReceipts ?? []).find((r) => r.id === input.entityId);
      err = soft(row, "Supplier receipt not found.", "Already in trash.", (r) => `Moved supplier receipt ${r.number} to trash.`);
      break;
    }
    case "supplier_payment": {
      const row = (next.supplierPayments ?? []).find((p) => p.id === input.entityId);
      err = soft(row, "Supplier payment not found.", "Already in trash.", (r) => `Moved supplier payment ${r.number} to trash.`);
      break;
    }
    case "approval": {
      const row = (next.approvals ?? []).find((a) => a.id === input.entityId);
      err = soft(row, "Approval not found.", "Already in trash.", (r) => `Moved approval ${r.title} to trash.`);
      break;
    }
    case "notification": {
      const row = next.notifications.find((n) => n.id === input.entityId);
      err = soft(row, "Notification not found.", "Already in trash.", (r) => `Moved notification “${r.title}” to trash.`);
      break;
    }
    default:
      return { ok: false, error: "Unsupported record type." };
  }

  if (err) return { ok: false, error: err };

  pushAudit(next, {
    action: "record.trashed",
    entityType: entityTypeLabel,
    entityId: input.entityId,
    summary,
    meta: {
      entityType: input.entityType,
      ...(reason ? { reason } : {}),
    },
  });
  refreshNotifications(next);
  const trashRow = collectTrashItems(next).find(
    (t) => t.entityType === input.entityType && t.entityId === input.entityId,
  );
  return { ok: true, data: { state: next, data: trashRow ?? null } };
}

export function restoreTrashItem(
  state: TlbState,
  input: { entityType: TrashEntityType; entityId: string },
): MutResult<null> {
  const blocked = requirePerm(state, "records.delete");
  if (blocked) return { ok: false, error: blocked };

  const next = cloneState(state);
  let summary = "";

  const restore = <T extends SoftDeleteFields>(
    row: T | undefined,
    notFound: string,
    makeSummary: (r: T) => string,
    after?: (r: T) => void,
  ): string | null => {
    if (!row || !isSoftDeleted(row)) return notFound;
    clearSoftDeleteMeta(row);
    after?.(row);
    summary = makeSummary(row);
    return null;
  };

  let err: string | null = null;

  switch (input.entityType) {
    case "customer": {
      const row = next.customers.find((c) => c.id === input.entityId);
      err = restore(row, "Trashed customer not found.", (r) => {
        r.updatedAt = new Date().toISOString();
        return `Restored customer ${r.code} · ${r.name} from trash.`;
      });
      break;
    }
    case "supplier": {
      const row = next.suppliers.find((s) => s.id === input.entityId);
      err = restore(row, "Trashed supplier not found.", (r) => {
        r.updatedAt = new Date().toISOString();
        return `Restored supplier ${r.code} · ${r.name} from trash.`;
      });
      break;
    }
    case "product": {
      const row = next.products.find((p) => p.id === input.entityId);
      err = restore(row, "Trashed product not found.", (r) => `Restored product ${r.sku} · ${r.name} from trash.`);
      break;
    }
    case "warehouse": {
      const row = next.warehouses.find((w) => w.id === input.entityId);
      err = restore(row, "Trashed warehouse not found.", (r) => `Restored warehouse ${r.code} · ${r.name} from trash.`);
      break;
    }
    case "order": {
      const row = next.orders.find((o) => o.id === input.entityId);
      err = restore(row, "Trashed order not found.", (r) => {
        r.updatedAt = new Date().toISOString();
        return `Restored order ${r.number} from trash.`;
      });
      break;
    }
    case "catalog": {
      const idx = next.catalogDeletions.findIndex((d) => d.catalogId === input.entityId);
      if (idx < 0) return { ok: false, error: "Trashed catalog record not found." };
      const [removed] = next.catalogDeletions.splice(idx, 1);
      summary = `Restored ${removed?.module ?? "catalog"} ${removed?.label ?? input.entityId} from trash.`;
      break;
    }
    case "customer_return": {
      err = restore(
        (next.customerReturns ?? []).find((r) => r.id === input.entityId),
        "Trashed customer return not found.",
        (r) => `Restored customer return ${r.number} from trash.`,
      );
      break;
    }
    case "supplier_return": {
      err = restore(
        (next.supplierReturns ?? []).find((r) => r.id === input.entityId),
        "Trashed supplier return not found.",
        (r) => `Restored supplier return ${r.number} from trash.`,
      );
      break;
    }
    case "non_po_purchase": {
      err = restore(
        (next.nonPoPurchases ?? []).find((r) => r.id === input.entityId),
        "Trashed Non-PO not found.",
        (r) => `Restored Non-PO ${r.number} from trash.`,
      );
      break;
    }
    case "import_shipment": {
      err = restore(
        (next.importShipments ?? []).find((r) => r.id === input.entityId),
        "Trashed import not found.",
        (r) => `Restored import ${r.number} from trash.`,
      );
      break;
    }
    case "export_shipment": {
      err = restore(
        (next.exportShipments ?? []).find((r) => r.id === input.entityId),
        "Trashed export not found.",
        (r) => `Restored export ${r.number} from trash.`,
      );
      break;
    }
    case "ops_driver": {
      err = restore(
        (next.opsDrivers ?? []).find((d) => d.id === input.entityId),
        "Trashed driver not found.",
        (r) => {
          r.active = true;
          return `Restored driver ${r.code} · ${r.name} from trash.`;
        },
      );
      break;
    }
    case "ops_request": {
      err = restore(
        (next.opsRequests ?? []).find((r) => r.id === input.entityId),
        "Trashed ops request not found.",
        (r) => `Restored ops request ${r.number} from trash.`,
      );
      break;
    }
    case "ops_discrepancy": {
      err = restore(
        (next.opsDiscrepancies ?? []).find((d) => d.id === input.entityId),
        "Trashed discrepancy not found.",
        (r) => `Restored discrepancy ${r.kind} from trash.`,
      );
      break;
    }
    case "ops_message": {
      err = restore(
        (next.opsMessages ?? []).find((m) => m.id === input.entityId),
        "Trashed message not found.",
        () => `Restored ops message from trash.`,
      );
      break;
    }
    case "quotation": {
      err = restore(
        (next.quotations ?? []).find((q) => q.id === input.entityId),
        "Trashed quotation not found.",
        (r) => `Restored quotation ${r.number} from trash.`,
      );
      break;
    }
    case "invoice": {
      err = restore(
        next.invoices.find((i) => i.id === input.entityId),
        "Trashed invoice not found.",
        (r) => `Restored invoice ${r.number} from trash.`,
      );
      break;
    }
    case "receipt": {
      err = restore(
        next.receipts.find((r) => r.id === input.entityId),
        "Trashed receipt not found.",
        (r) => `Restored receipt ${r.number} from trash.`,
      );
      break;
    }
    case "payment": {
      err = restore(
        next.payments.find((p) => p.id === input.entityId),
        "Trashed payment not found.",
        (r) => `Restored payment ${r.number} from trash.`,
      );
      break;
    }
    case "delivery": {
      err = restore(
        next.deliveries.find((d) => d.id === input.entityId),
        "Trashed delivery not found.",
        (r) => `Restored delivery ${r.number} from trash.`,
      );
      break;
    }
    case "goods_receipt": {
      err = restore(
        (next.goodsReceipts ?? []).find((g) => g.id === input.entityId),
        "Trashed GRN not found.",
        (r) => `Restored GRN ${r.number} from trash.`,
      );
      break;
    }
    case "stock_issue": {
      err = restore(
        (next.stockIssues ?? []).find((g) => g.id === input.entityId),
        "Trashed stock issue not found.",
        (r) => `Restored stock issue ${r.number} from trash.`,
      );
      break;
    }
    case "transfer": {
      err = restore(
        (next.transfers ?? []).find((t) => t.id === input.entityId),
        "Trashed transfer not found.",
        (r) => `Restored transfer ${r.number} from trash.`,
      );
      break;
    }
    case "adjustment": {
      err = restore(
        (next.adjustments ?? []).find((a) => a.id === input.entityId),
        "Trashed adjustment not found.",
        (r) => `Restored adjustment ${r.number} from trash.`,
      );
      break;
    }
    case "batch": {
      err = restore(
        (next.batches ?? []).find((b) => b.id === input.entityId),
        "Trashed batch not found.",
        (r) => `Restored batch ${r.code} from trash.`,
      );
      break;
    }
    case "stock_movement": {
      err = restore(
        (next.stockMovements ?? []).find((m) => m.id === input.entityId),
        "Hidden stock movement not found.",
        (r) => `Restored stock movement ${r.number} to lists.`,
      );
      break;
    }
    case "supply": {
      err = restore(
        next.supplies.find((s) => s.id === input.entityId),
        "Trashed supply not found.",
        (r) => `Restored supply ${r.number} from trash.`,
      );
      break;
    }
    case "supplier_po": {
      err = restore(
        (next.supplierPurchaseOrders ?? []).find((p) => p.id === input.entityId),
        "Trashed supplier PO not found.",
        (r) => {
          r.updatedAt = new Date().toISOString();
          return `Restored supplier PO ${r.number} from trash.`;
        },
      );
      break;
    }
    case "supplier_receipt": {
      err = restore(
        (next.supplierReceipts ?? []).find((r) => r.id === input.entityId),
        "Trashed supplier receipt not found.",
        (r) => `Restored supplier receipt ${r.number} from trash.`,
      );
      break;
    }
    case "supplier_payment": {
      err = restore(
        (next.supplierPayments ?? []).find((p) => p.id === input.entityId),
        "Trashed supplier payment not found.",
        (r) => `Restored supplier payment ${r.number} from trash.`,
      );
      break;
    }
    case "approval": {
      err = restore(
        (next.approvals ?? []).find((a) => a.id === input.entityId),
        "Trashed approval not found.",
        (r) => `Restored approval ${r.title} from trash.`,
      );
      break;
    }
    case "notification": {
      err = restore(
        next.notifications.find((n) => n.id === input.entityId),
        "Trashed notification not found.",
        (r) => `Restored notification “${r.title}” from trash.`,
      );
      break;
    }
    default:
      return { ok: false, error: "Unsupported record type." };
  }

  if (err) return { ok: false, error: err };

  pushAudit(next, {
    action: "record.restored",
    entityType: input.entityType,
    entityId: input.entityId,
    summary,
  });
  refreshNotifications(next);
  return { ok: true, data: { state: next, data: null } };
}

export function purgeTrashItem(
  state: TlbState,
  input: { entityType: TrashEntityType; entityId: string },
): MutResult<null> {
  const blocked = requirePerm(state, "trash.purge");
  if (blocked) return { ok: false, error: blocked };

  if (input.entityType === "stock_movement") {
    return {
      ok: false,
      error: "Stock movements cannot be permanently deleted — ledger integrity. Restore or leave hidden in Trash.",
    };
  }

  const next = cloneState(state);
  let summary = "";

  switch (input.entityType) {
    case "customer": {
      const idx = next.customers.findIndex((c) => c.id === input.entityId && isSoftDeleted(c));
      if (idx < 0) return { ok: false, error: "Trashed customer not found." };
      const [removed] = next.customers.splice(idx, 1);
      summary = `Permanently deleted customer ${removed?.code ?? input.entityId}.`;
      break;
    }
    case "supplier": {
      const idx = next.suppliers.findIndex((s) => s.id === input.entityId && isSoftDeleted(s));
      if (idx < 0) return { ok: false, error: "Trashed supplier not found." };
      const [removed] = next.suppliers.splice(idx, 1);
      summary = `Permanently deleted supplier ${removed?.code ?? input.entityId}.`;
      break;
    }
    case "product": {
      const idx = next.products.findIndex((p) => p.id === input.entityId && isSoftDeleted(p));
      if (idx < 0) return { ok: false, error: "Trashed product not found." };
      const [removed] = next.products.splice(idx, 1);
      next.stock = next.stock.filter((s) => s.productId !== input.entityId);
      summary = `Permanently deleted product ${removed?.sku ?? input.entityId}.`;
      break;
    }
    case "warehouse": {
      const idx = next.warehouses.findIndex((w) => w.id === input.entityId && isSoftDeleted(w));
      if (idx < 0) return { ok: false, error: "Trashed warehouse not found." };
      const [removed] = next.warehouses.splice(idx, 1);
      next.stock = next.stock.filter((s) => s.warehouseId !== input.entityId);
      summary = `Permanently deleted warehouse ${removed?.code ?? input.entityId}.`;
      break;
    }
    case "order": {
      const idx = next.orders.findIndex((o) => o.id === input.entityId && isSoftDeleted(o));
      if (idx < 0) return { ok: false, error: "Trashed order not found." };
      const [removed] = next.orders.splice(idx, 1);
      next.orderLines = next.orderLines.filter((l) => l.orderId !== input.entityId);
      next.reservations = next.reservations.filter((r) => {
        const line = state.orderLines.find((l) => l.id === r.orderLineId);
        return line?.orderId !== input.entityId;
      });
      summary = `Permanently deleted order ${removed?.number ?? input.entityId}.`;
      break;
    }
    case "catalog": {
      const idx = next.catalogDeletions.findIndex((d) => d.catalogId === input.entityId);
      if (idx < 0) return { ok: false, error: "Trashed catalog record not found." };
      const [removed] = next.catalogDeletions.splice(idx, 1);
      if (!next.catalogPurgedIds.includes(input.entityId)) {
        next.catalogPurgedIds.push(input.entityId);
      }
      summary = `Permanently deleted ${removed?.module ?? "catalog"} ${removed?.label ?? input.entityId}.`;
      break;
    }
    case "customer_return": {
      next.customerReturns = (next.customerReturns ?? []).filter((r) => !(r.id === input.entityId && isSoftDeleted(r)));
      summary = `Permanently deleted customer return ${input.entityId}.`;
      break;
    }
    case "supplier_return": {
      next.supplierReturns = (next.supplierReturns ?? []).filter((r) => !(r.id === input.entityId && isSoftDeleted(r)));
      summary = `Permanently deleted supplier return ${input.entityId}.`;
      break;
    }
    case "non_po_purchase": {
      next.nonPoPurchases = (next.nonPoPurchases ?? []).filter((r) => !(r.id === input.entityId && isSoftDeleted(r)));
      next.nonPoPurchaseLines = (next.nonPoPurchaseLines ?? []).filter((l) => l.nonPoId !== input.entityId);
      summary = `Permanently deleted Non-PO ${input.entityId}.`;
      break;
    }
    case "import_shipment": {
      next.importShipments = (next.importShipments ?? []).filter((r) => !(r.id === input.entityId && isSoftDeleted(r)));
      next.importShipmentLines = (next.importShipmentLines ?? []).filter((l) => l.shipmentId !== input.entityId);
      summary = `Permanently deleted import ${input.entityId}.`;
      break;
    }
    case "export_shipment": {
      next.exportShipments = (next.exportShipments ?? []).filter((r) => !(r.id === input.entityId && isSoftDeleted(r)));
      next.exportShipmentLines = (next.exportShipmentLines ?? []).filter((l) => l.shipmentId !== input.entityId);
      summary = `Permanently deleted export ${input.entityId}.`;
      break;
    }
    case "ops_driver": {
      const idx = (next.opsDrivers ?? []).findIndex((d) => d.id === input.entityId && isSoftDeleted(d));
      if (idx < 0) return { ok: false, error: "Trashed driver not found." };
      const [removed] = next.opsDrivers.splice(idx, 1);
      summary = `Permanently deleted driver ${removed?.code ?? input.entityId}.`;
      break;
    }
    case "ops_request": {
      const idx = (next.opsRequests ?? []).findIndex((r) => r.id === input.entityId && isSoftDeleted(r));
      if (idx < 0) return { ok: false, error: "Trashed ops request not found." };
      const [removed] = next.opsRequests.splice(idx, 1);
      next.opsRequestLines = (next.opsRequestLines ?? []).filter((l) => l.requestId !== input.entityId);
      next.opsMessages = (next.opsMessages ?? []).filter((m) => m.requestId !== input.entityId);
      next.opsActivity = (next.opsActivity ?? []).filter((a) => a.requestId !== input.entityId);
      next.opsCustody = (next.opsCustody ?? []).filter((c) => c.requestId !== input.entityId);
      next.opsDiscrepancies = (next.opsDiscrepancies ?? []).filter((d) => d.requestId !== input.entityId);
      summary = `Permanently deleted ops request ${removed?.number ?? input.entityId}.`;
      break;
    }
    case "ops_discrepancy": {
      next.opsDiscrepancies = (next.opsDiscrepancies ?? []).filter((d) => !(d.id === input.entityId && isSoftDeleted(d)));
      summary = `Permanently deleted discrepancy ${input.entityId}.`;
      break;
    }
    case "ops_message": {
      next.opsMessages = (next.opsMessages ?? []).filter((m) => !(m.id === input.entityId && isSoftDeleted(m)));
      summary = `Permanently deleted ops message ${input.entityId}.`;
      break;
    }
    case "quotation": {
      next.quotations = (next.quotations ?? []).filter((q) => !(q.id === input.entityId && isSoftDeleted(q)));
      summary = `Permanently deleted quotation ${input.entityId}.`;
      break;
    }
    case "invoice": {
      const idx = next.invoices.findIndex((i) => i.id === input.entityId && isSoftDeleted(i));
      if (idx < 0) return { ok: false, error: "Trashed invoice not found." };
      const [removed] = next.invoices.splice(idx, 1);
      next.invoiceLines = next.invoiceLines.filter((l) => l.invoiceId !== input.entityId);
      summary = `Permanently deleted invoice ${removed?.number ?? input.entityId}.`;
      break;
    }
    case "receipt": {
      const idx = next.receipts.findIndex((r) => r.id === input.entityId && isSoftDeleted(r));
      if (idx < 0) return { ok: false, error: "Trashed receipt not found." };
      const [removed] = next.receipts.splice(idx, 1);
      next.receiptLines = next.receiptLines.filter((l) => l.receiptId !== input.entityId);
      summary = `Permanently deleted receipt ${removed?.number ?? input.entityId}.`;
      break;
    }
    case "payment": {
      const idx = next.payments.findIndex((p) => p.id === input.entityId && isSoftDeleted(p));
      if (idx < 0) return { ok: false, error: "Trashed payment not found." };
      const [removed] = next.payments.splice(idx, 1);
      summary = `Permanently deleted payment ${removed?.number ?? input.entityId}.`;
      break;
    }
    case "delivery": {
      const idx = next.deliveries.findIndex((d) => d.id === input.entityId && isSoftDeleted(d));
      if (idx < 0) return { ok: false, error: "Trashed delivery not found." };
      const [removed] = next.deliveries.splice(idx, 1);
      next.deliveryItems = next.deliveryItems.filter((i) => i.deliveryId !== input.entityId);
      summary = `Permanently deleted delivery ${removed?.number ?? input.entityId}.`;
      break;
    }
    case "goods_receipt": {
      next.goodsReceipts = (next.goodsReceipts ?? []).filter((g) => !(g.id === input.entityId && isSoftDeleted(g)));
      next.goodsReceiptLines = (next.goodsReceiptLines ?? []).filter((l) => l.grnId !== input.entityId);
      summary = `Permanently deleted GRN ${input.entityId}.`;
      break;
    }
    case "stock_issue": {
      next.stockIssues = (next.stockIssues ?? []).filter((g) => !(g.id === input.entityId && isSoftDeleted(g)));
      next.stockIssueLines = (next.stockIssueLines ?? []).filter((l) => l.issueId !== input.entityId);
      summary = `Permanently deleted stock issue ${input.entityId}.`;
      break;
    }
    case "transfer": {
      next.transfers = (next.transfers ?? []).filter((t) => !(t.id === input.entityId && isSoftDeleted(t)));
      next.transferLines = (next.transferLines ?? []).filter((l) => l.transferId !== input.entityId);
      summary = `Permanently deleted transfer ${input.entityId}.`;
      break;
    }
    case "adjustment": {
      next.adjustments = (next.adjustments ?? []).filter((a) => !(a.id === input.entityId && isSoftDeleted(a)));
      next.adjustmentLines = (next.adjustmentLines ?? []).filter((l) => l.adjustmentId !== input.entityId);
      summary = `Permanently deleted adjustment ${input.entityId}.`;
      break;
    }
    case "batch": {
      next.batches = (next.batches ?? []).filter((b) => !(b.id === input.entityId && isSoftDeleted(b)));
      summary = `Permanently deleted batch ${input.entityId}.`;
      break;
    }
    case "supply": {
      const idx = next.supplies.findIndex((s) => s.id === input.entityId && isSoftDeleted(s));
      if (idx < 0) return { ok: false, error: "Trashed supply not found." };
      const [removed] = next.supplies.splice(idx, 1);
      next.supplyLines = next.supplyLines.filter((l) => l.supplyId !== input.entityId);
      summary = `Permanently deleted supply ${removed?.number ?? input.entityId}.`;
      break;
    }
    case "supplier_po": {
      next.supplierPurchaseOrders = (next.supplierPurchaseOrders ?? []).filter(
        (p) => !(p.id === input.entityId && isSoftDeleted(p)),
      );
      summary = `Permanently deleted supplier PO ${input.entityId}.`;
      break;
    }
    case "supplier_receipt": {
      next.supplierReceipts = (next.supplierReceipts ?? []).filter((r) => !(r.id === input.entityId && isSoftDeleted(r)));
      summary = `Permanently deleted supplier receipt ${input.entityId}.`;
      break;
    }
    case "supplier_payment": {
      next.supplierPayments = (next.supplierPayments ?? []).filter((p) => !(p.id === input.entityId && isSoftDeleted(p)));
      summary = `Permanently deleted supplier payment ${input.entityId}.`;
      break;
    }
    case "approval": {
      next.approvals = (next.approvals ?? []).filter((a) => !(a.id === input.entityId && isSoftDeleted(a)));
      summary = `Permanently deleted approval ${input.entityId}.`;
      break;
    }
    case "notification": {
      next.notifications = next.notifications.filter((n) => !(n.id === input.entityId && isSoftDeleted(n)));
      summary = `Permanently deleted notification ${input.entityId}.`;
      break;
    }
    default:
      return { ok: false, error: "Unsupported record type." };
  }

  pushAudit(next, {
    action: "record.purged",
    entityType: input.entityType,
    entityId: input.entityId,
    summary,
  });
  refreshNotifications(next);
  return { ok: true, data: { state: next, data: null } };
}
