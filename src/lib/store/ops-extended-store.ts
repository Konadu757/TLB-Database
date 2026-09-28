/**
 * Deferred ops mutations: customer/supplier returns, Non-PO procurement, import/export shipments.
 */
import { calcAvailable } from "../domain/calculations";
import { nextDocumentNumber } from "../domain/numbering";
import { hasPermission } from "../domain/permissions";
import { isSoftDeleted } from "../domain/trash";
import type {
  CustomerReturn,
  ExportShipment,
  ExportShipmentStatus,
  ImportShipment,
  ImportShipmentStatus,
  NonPoPurchase,
  Permission,
  ReturnDisposition,
  StoreResult,
  SupplierReturn,
  TlbState,
} from "../domain/types";
import { createGoodsReceipt, getOrCreateBalance, postStockMovement } from "./inventory-store";

type MutResult<T> = StoreResult<{ state: TlbState; data: T }>;

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function requirePerm(state: TlbState, permission: Permission): string | null {
  if (!hasPermission(state, permission)) {
    return `Role ${state.currentRole} cannot perform ${permission}.`;
  }
  return null;
}

function pushAudit(
  state: TlbState,
  partial: {
    action: import("../domain/types").AuditAction;
    entityType: string;
    entityId: string;
    summary: string;
    meta?: Record<string, string | number | boolean | null>;
    at?: string;
  },
): void {
  state.audit.unshift({
    id: uid("aud"),
    at: partial.at ?? new Date().toISOString(),
    actor: state.currentUser,
    action: partial.action,
    entityType: partial.entityType,
    entityId: partial.entityId,
    summary: partial.summary,
    meta: partial.meta,
  });
  if (state.audit.length > 500) state.audit.length = 500;
}

function requestApproval(
  state: TlbState,
  input: {
    kind: import("../domain/types").ApprovalKind;
    title: string;
    summary: string;
    refType: string;
    refId: string;
    amount?: number;
    autoApprove?: boolean;
  },
): void {
  const now = new Date().toISOString();
  const id = uid("appr");
  state.approvals.unshift({
    id,
    kind: input.kind,
    status: input.autoApprove ? "Approved" : "Pending",
    title: input.title,
    summary: input.summary,
    refType: input.refType,
    refId: input.refId,
    amount: input.amount,
    requestedAt: now,
    requestedBy: state.currentUser,
    decidedAt: input.autoApprove ? now : undefined,
    decidedBy: input.autoApprove ? state.currentUser : undefined,
    decisionNote: input.autoApprove ? "Auto-approved." : undefined,
  });
  pushAudit(state, {
    action: "approval.requested",
    entityType: "approval",
    entityId: id,
    summary: input.title,
    at: now,
  });
}

export function createCustomerReturn(
  state: TlbState,
  input: {
    customerId: string;
    orderId?: string;
    invoiceId?: string;
    productId: string;
    batchId?: string;
    quantity: number;
    reason: string;
    condition: CustomerReturn["condition"];
    warehouseId: string;
    disposition: ReturnDisposition;
    notes?: string;
    approve?: boolean;
  },
): MutResult<{ returnId: string; number: string }> {
  const blocked = requirePerm(state, "stock.receive");
  if (blocked) return { ok: false, error: blocked };
  if (!input.quantity || input.quantity <= 0)
    return { ok: false, error: "Return quantity must be positive." };
  if (!input.reason.trim()) return { ok: false, error: "Return reason is required." };

  const next = cloneState(state);
  next.customerReturns = next.customerReturns ?? [];
  const numbered = nextDocumentNumber("customerReturn", next.counters);
  next.counters = numbered.counters;
  const now = new Date().toISOString();
  const returnId = uid("crt");
  const approve = input.approve !== false;
  const row: CustomerReturn = {
    id: returnId,
    number: numbered.number,
    customerId: input.customerId,
    orderId: input.orderId,
    invoiceId: input.invoiceId,
    productId: input.productId,
    batchId: input.batchId,
    quantity: input.quantity,
    reason: input.reason.trim(),
    condition: input.condition,
    warehouseId: input.warehouseId,
    disposition: input.disposition,
    status: approve ? "Posted" : "Received",
    receivedBy: next.currentUser,
    receivedAt: now,
    approvedBy: approve ? next.currentUser : undefined,
    approvedAt: approve ? now : undefined,
    notes: input.notes,
    createdAt: now,
  };
  next.customerReturns.unshift(row);

  try {
    if (input.disposition === "usable") {
      postStockMovement(next, {
        type: "return_customer",
        productId: input.productId,
        warehouseId: input.warehouseId,
        quantity: input.quantity,
        batchId: input.batchId,
        reason: input.reason,
        refType: "customer_return",
        refId: returnId,
        refNumber: row.number,
        at: now,
      });
      if (input.batchId) {
        const batch = next.batches.find((b) => b.id === input.batchId);
        if (batch) {
          batch.remainingQty += input.quantity;
          if (batch.status === "Closed") batch.status = "Open";
        }
      }
    } else if (input.disposition === "quarantine") {
      postStockMovement(next, {
        type: "return_customer",
        productId: input.productId,
        warehouseId: input.warehouseId,
        quantity: input.quantity,
        batchId: input.batchId,
        reason: input.reason,
        refType: "customer_return",
        refId: returnId,
        refNumber: row.number,
        at: now,
      });
      const bal = getOrCreateBalance(next, input.productId, input.warehouseId);
      bal.quarantineQty = (bal.quarantineQty ?? 0) + input.quantity;
      if (input.batchId) {
        const batch = next.batches.find((b) => b.id === input.batchId);
        if (batch) batch.status = "Quarantine";
      }
    } else if (input.disposition === "damage") {
      postStockMovement(next, {
        type: "return_customer",
        productId: input.productId,
        warehouseId: input.warehouseId,
        quantity: input.quantity,
        batchId: input.batchId,
        reason: input.reason,
        refType: "customer_return",
        refId: returnId,
        refNumber: row.number,
        at: now,
      });
      const bal = getOrCreateBalance(next, input.productId, input.warehouseId);
      bal.damagedQty = (bal.damagedQty ?? 0) + input.quantity;
      if (input.batchId) {
        const batch = next.batches.find((b) => b.id === input.batchId);
        if (batch) batch.status = "Damaged";
      }
    } else {
      // supplier_return disposition: receive then immediately flag for supplier return path
      postStockMovement(next, {
        type: "return_customer",
        productId: input.productId,
        warehouseId: input.warehouseId,
        quantity: input.quantity,
        batchId: input.batchId,
        reason: input.reason,
        refType: "customer_return",
        refId: returnId,
        refNumber: row.number,
        notes: "Held for supplier return",
        at: now,
      });
      const bal = getOrCreateBalance(next, input.productId, input.warehouseId);
      bal.quarantineQty = (bal.quarantineQty ?? 0) + input.quantity;
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Customer return stock post failed.",
    };
  }

  pushAudit(next, {
    action: "return.customer_created",
    entityType: "customer_return",
    entityId: returnId,
    summary: `Customer return ${row.number} · ${input.disposition} · qty ${input.quantity}`,
    meta: {
      customerId: input.customerId,
      productId: input.productId,
      disposition: input.disposition,
    },
    at: now,
  });

  return { ok: true, data: { state: next, data: { returnId, number: row.number } } };
}

export function createSupplierReturn(
  state: TlbState,
  input: {
    supplierId: string;
    productId: string;
    batchId?: string;
    quantity: number;
    reason: string;
    warehouseId: string;
    grnId?: string;
    creditNoteRef?: string;
    replacementExpected?: boolean;
    notes?: string;
    approve?: boolean;
  },
): MutResult<{ returnId: string; number: string }> {
  const blocked = requirePerm(state, "stock.issue");
  if (blocked) return { ok: false, error: blocked };
  if (!input.quantity || input.quantity <= 0)
    return { ok: false, error: "Return quantity must be positive." };
  if (!input.reason.trim()) return { ok: false, error: "Return reason is required." };

  const next = cloneState(state);
  next.supplierReturns = next.supplierReturns ?? [];
  const bal = getOrCreateBalance(next, input.productId, input.warehouseId);
  if (calcAvailable(bal) < input.quantity) {
    return { ok: false, error: "Insufficient available stock for supplier return." };
  }

  const numbered = nextDocumentNumber("supplierReturn", next.counters);
  next.counters = numbered.counters;
  const now = new Date().toISOString();
  const returnId = uid("srt");
  const approve = input.approve !== false;
  const row: SupplierReturn = {
    id: returnId,
    number: numbered.number,
    supplierId: input.supplierId,
    productId: input.productId,
    batchId: input.batchId,
    quantity: input.quantity,
    reason: input.reason.trim(),
    grnId: input.grnId,
    creditNoteRef: input.creditNoteRef,
    replacementExpected: Boolean(input.replacementExpected),
    status: approve ? (input.replacementExpected ? "Replaced" : "Credited") : "Approved",
    warehouseId: input.warehouseId,
    requestedBy: next.currentUser,
    requestedAt: now,
    approvedBy: approve ? next.currentUser : undefined,
    approvedAt: approve ? now : undefined,
    notes: input.notes,
    createdAt: now,
  };
  next.supplierReturns.unshift(row);

  try {
    postStockMovement(next, {
      type: "return_supplier",
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      batchId: input.batchId,
      reason: input.reason,
      refType: "supplier_return",
      refId: returnId,
      refNumber: row.number,
      at: now,
    });
    if (input.batchId) {
      const batch = next.batches.find((b) => b.id === input.batchId);
      if (batch) {
        if (batch.remainingQty < input.quantity) {
          return {
            ok: false,
            error: `Batch ${batch.code} only has ${batch.remainingQty} remaining.`,
          };
        }
        batch.remainingQty -= input.quantity;
        if (batch.remainingQty === 0) batch.status = "Closed";
      }
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Supplier return stock post failed.",
    };
  }

  pushAudit(next, {
    action: "return.supplier_created",
    entityType: "supplier_return",
    entityId: returnId,
    summary: `Supplier return ${row.number} · qty ${input.quantity}`,
    meta: { supplierId: input.supplierId, productId: input.productId },
    at: now,
  });

  return { ok: true, data: { state: next, data: { returnId, number: row.number } } };
}

export function updateNonPoPurchase(
  state: TlbState,
  nonPoId: string,
  input: {
    reason?: string;
    invoiceRef?: string;
    receiptRef?: string;
    notes?: string;
  },
): MutResult<{ nonPoId: string }> {
  if (
    !hasPermission(state, "stock.receive") &&
    !hasPermission(state, "approvals.manage") &&
    !hasPermission(state, "records.edit")
  ) {
    return { ok: false, error: `Role ${state.currentRole} cannot edit Non-PO purchases.` };
  }
  const next = cloneState(state);
  next.nonPoPurchases = next.nonPoPurchases ?? [];
  const row = next.nonPoPurchases.find((n) => n.id === nonPoId);
  if (!row || isSoftDeleted(row)) return { ok: false, error: "Non-PO purchase not found." };
  if (row.status !== "Pending Approval") {
    return {
      ok: false,
      error: `Only Pending Approval Non-PO requests can be edited (current: ${row.status}).`,
    };
  }
  if (input.reason !== undefined) {
    const reason = input.reason.trim();
    if (!reason) return { ok: false, error: "Reason is required." };
    row.reason = reason;
  }
  if (input.invoiceRef !== undefined) row.invoiceRef = input.invoiceRef.trim() || undefined;
  if (input.receiptRef !== undefined) row.receiptRef = input.receiptRef.trim() || undefined;
  if (input.notes !== undefined) row.notes = input.notes.trim() || undefined;
  pushAudit(next, {
    action: "non_po.updated",
    entityType: "non_po_purchase",
    entityId: row.id,
    summary: `Updated Non-PO ${row.number} before approval.`,
  });
  pushAudit(next, {
    action: "record.edited",
    entityType: "non_po_purchase",
    entityId: row.id,
    summary: `Edited Non-PO ${row.number}.`,
  });
  return { ok: true, data: { state: next, data: { nonPoId: row.id } } };
}

export function createNonPoPurchase(
  state: TlbState,
  input: {
    supplierId: string;
    warehouseId: string;
    reason: string;
    invoiceRef?: string;
    receiptRef?: string;
    notes?: string;
    lines: Array<{ productId: string; quantity: number; unitPrice: number; batchCode?: string }>;
  },
): MutResult<{ nonPoId: string; number: string }> {
  const blocked = requirePerm(state, "stock.receive");
  if (blocked) return { ok: false, error: blocked };
  if (!input.reason.trim()) return { ok: false, error: "Non-PO purchases require a reason." };
  if (!input.lines.length) return { ok: false, error: "Add at least one Non-PO line." };

  const next = cloneState(state);
  next.nonPoPurchases = next.nonPoPurchases ?? [];
  next.nonPoPurchaseLines = next.nonPoPurchaseLines ?? [];
  const numbered = nextDocumentNumber("nonPoPurchase", next.counters);
  next.counters = numbered.counters;
  const now = new Date().toISOString();
  const nonPoId = uid("npo");
  const amount = input.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const row: NonPoPurchase = {
    id: nonPoId,
    number: numbered.number,
    supplierId: input.supplierId,
    warehouseId: input.warehouseId,
    reason: input.reason.trim(),
    status: "Pending Approval",
    requestedBy: next.currentUser,
    requestedAt: now,
    invoiceRef: input.invoiceRef,
    receiptRef: input.receiptRef,
    notes: input.notes,
    createdAt: now,
  };
  next.nonPoPurchases.unshift(row);
  for (const line of input.lines) {
    next.nonPoPurchaseLines.push({
      id: uid("npol"),
      nonPoId,
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      batchCode: line.batchCode,
    });
  }

  requestApproval(next, {
    kind: "non_po_purchase",
    title: `Non-PO ${row.number}`,
    summary: input.reason.trim(),
    refType: "non_po_purchase",
    refId: nonPoId,
    amount,
    autoApprove: false,
  });

  pushAudit(next, {
    action: "non_po.created",
    entityType: "non_po_purchase",
    entityId: nonPoId,
    summary: `Non-PO purchase ${row.number} submitted for approval.`,
    meta: { supplierId: input.supplierId, amount },
    at: now,
  });

  return { ok: true, data: { state: next, data: { nonPoId, number: row.number } } };
}

export function decideNonPoPurchase(
  state: TlbState,
  nonPoId: string,
  decision: "Approved" | "Rejected",
  note?: string,
): MutResult<{ nonPoId: string }> {
  const blocked = requirePerm(state, "approvals.manage");
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  next.nonPoPurchases = next.nonPoPurchases ?? [];
  const row = next.nonPoPurchases.find((n) => n.id === nonPoId);
  if (!row || isSoftDeleted(row)) return { ok: false, error: "Non-PO purchase not found." };
  if (row.status !== "Pending Approval")
    return { ok: false, error: "Non-PO is not awaiting approval." };

  const now = new Date().toISOString();
  row.status = decision === "Approved" ? "Approved" : "Rejected";
  row.approvedBy = next.currentUser;
  row.approvedAt = now;
  if (note) row.notes = [row.notes, note].filter(Boolean).join(" · ");

  const approval = next.approvals.find(
    (a) => a.refType === "non_po_purchase" && a.refId === nonPoId && a.status === "Pending",
  );
  if (approval) {
    approval.status = decision;
    approval.decidedAt = now;
    approval.decidedBy = next.currentUser;
    approval.decisionNote = note;
  }

  pushAudit(next, {
    action: "non_po.status_changed",
    entityType: "non_po_purchase",
    entityId: nonPoId,
    summary: `Non-PO ${row.number} ${decision.toLowerCase()}.`,
    at: now,
  });

  return { ok: true, data: { state: next, data: { nonPoId } } };
}

/** Post GRN from an approved Non-PO and link the documents. */
export function receiveNonPoPurchase(
  state: TlbState,
  nonPoId: string,
): MutResult<{ grnId: string; number: string }> {
  const blocked = requirePerm(state, "stock.receive");
  if (blocked) return { ok: false, error: blocked };
  const row = (state.nonPoPurchases ?? []).find((n) => n.id === nonPoId);
  if (!row || isSoftDeleted(row)) return { ok: false, error: "Non-PO purchase not found." };
  if (row.status !== "Approved")
    return { ok: false, error: "Only approved Non-PO purchases can be received." };
  if (row.grnId) return { ok: false, error: "Non-PO already linked to a GRN." };

  const lines = (state.nonPoPurchaseLines ?? []).filter((l) => l.nonPoId === nonPoId);
  if (!lines.length) return { ok: false, error: "Non-PO has no lines." };

  const grn = createGoodsReceipt(state, {
    supplierId: row.supplierId,
    nonPo: true,
    warehouseId: row.warehouseId,
    documentRefs: [row.invoiceRef, row.receiptRef].filter(Boolean).join(" / ") || undefined,
    notes: `Non-PO ${row.number}: ${row.reason}`,
    lines: lines.map((l) => ({
      productId: l.productId,
      batchCode: l.batchCode || `NPO-${Date.now().toString(36).toUpperCase()}`,
      orderedQty: l.quantity,
      acceptedQty: l.quantity,
      unitCost: l.unitPrice,
    })),
  });
  if (!grn.ok) return grn;

  const next = grn.data.state;
  const npo = next.nonPoPurchases.find((n) => n.id === nonPoId)!;
  npo.status = "Goods Received";
  npo.grnId = grn.data.data.grnId;
  pushAudit(next, {
    action: "non_po.status_changed",
    entityType: "non_po_purchase",
    entityId: nonPoId,
    summary: `Non-PO ${npo.number} goods received via ${grn.data.data.number}.`,
  });
  return { ok: true, data: { state: next, data: grn.data.data } };
}

export function upsertImportShipment(
  state: TlbState,
  input: {
    id?: string;
    supplierId: string;
    originCountry: string;
    purchaseOrderId?: string;
    containerRef?: string;
    shippingLine?: string;
    orderedAt?: string;
    etd?: string;
    eta?: string;
    clearanceNotes?: string;
    customsDocs?: string;
    warehouseId: string;
    status: ImportShipmentStatus;
    freightCost?: number;
    dutyCost?: number;
    notes?: string;
    lines: Array<{ productId: string; quantity: number; unitCost?: number }>;
  },
): MutResult<{ shipmentId: string; number: string }> {
  const blocked = requirePerm(state, "stock.receive");
  if (blocked) return { ok: false, error: blocked };
  if (!input.lines.length) return { ok: false, error: "Add at least one import line." };

  const next = cloneState(state);
  next.importShipments = next.importShipments ?? [];
  next.importShipmentLines = next.importShipmentLines ?? [];
  const now = new Date().toISOString();
  let row: ImportShipment;
  if (input.id) {
    const existing = next.importShipments.find((s) => s.id === input.id);
    if (!existing || isSoftDeleted(existing))
      return {
        ok: false,
        error: "Import shipment not found. Restore from trash first if deleted.",
      };
    if (existing.status === "Warehouse Received" || existing.status === "Cancelled") {
      return {
        ok: false,
        error: `Cannot edit an import that is ${existing.status}.`,
      };
    }
    Object.assign(existing, {
      supplierId: input.supplierId,
      originCountry: input.originCountry,
      purchaseOrderId: input.purchaseOrderId,
      containerRef: input.containerRef,
      shippingLine: input.shippingLine,
      etd: input.etd,
      eta: input.eta,
      clearanceNotes: input.clearanceNotes,
      customsDocs: input.customsDocs,
      warehouseId: input.warehouseId,
      status: input.status,
      freightCost: input.freightCost,
      dutyCost: input.dutyCost,
      notes: input.notes,
      updatedAt: now,
      clearedAt:
        input.status === "Customs Cleared" || input.status === "Warehouse Received"
          ? (existing.clearedAt ?? now)
          : existing.clearedAt,
      receivedAt:
        input.status === "Warehouse Received" ? (existing.receivedAt ?? now) : existing.receivedAt,
    });
    row = existing;
    next.importShipmentLines = next.importShipmentLines.filter((l) => l.shipmentId !== row.id);
  } else {
    const numbered = nextDocumentNumber("importShipment", next.counters);
    next.counters = numbered.counters;
    row = {
      id: uid("imp"),
      number: numbered.number,
      supplierId: input.supplierId,
      originCountry: input.originCountry,
      purchaseOrderId: input.purchaseOrderId,
      containerRef: input.containerRef,
      shippingLine: input.shippingLine,
      orderedAt: input.orderedAt ?? now,
      etd: input.etd,
      eta: input.eta,
      clearanceNotes: input.clearanceNotes,
      customsDocs: input.customsDocs,
      warehouseId: input.warehouseId,
      status: input.status,
      freightCost: input.freightCost,
      dutyCost: input.dutyCost,
      notes: input.notes,
      createdBy: next.currentUser,
      createdAt: now,
      updatedAt: now,
    };
    next.importShipments.unshift(row);
  }

  for (const line of input.lines) {
    next.importShipmentLines.push({
      id: uid("impl"),
      shipmentId: row.id,
      productId: line.productId,
      quantity: line.quantity,
      unitCost: line.unitCost,
    });
  }

  pushAudit(next, {
    action: "shipment.import_upserted",
    entityType: "import_shipment",
    entityId: row.id,
    summary: `Import ${row.number} · ${row.status}`,
    at: now,
  });

  return { ok: true, data: { state: next, data: { shipmentId: row.id, number: row.number } } };
}

export function receiveImportShipment(
  state: TlbState,
  shipmentId: string,
): MutResult<{ grnId: string; number: string }> {
  const blocked = requirePerm(state, "stock.receive");
  if (blocked) return { ok: false, error: blocked };
  const ship = (state.importShipments ?? []).find((s) => s.id === shipmentId);
  if (!ship || isSoftDeleted(ship)) return { ok: false, error: "Import shipment not found." };
  if (ship.grnId) return { ok: false, error: "Import already linked to a GRN." };
  if (
    !["Customs Cleared", "Clearance", "Arrived Port", "In Transit"].includes(ship.status) &&
    ship.status !== "Warehouse Received"
  ) {
    // allow receive from late statuses except Cancelled/Ordered only if cleared-ish
  }
  if (ship.status === "Cancelled")
    return { ok: false, error: "Cancelled shipment cannot be received." };

  const lines = (state.importShipmentLines ?? []).filter((l) => l.shipmentId === shipmentId);
  if (!lines.length) return { ok: false, error: "Import has no lines." };

  const grn = createGoodsReceipt(state, {
    supplierId: ship.supplierId,
    purchaseOrderId: ship.purchaseOrderId,
    nonPo: !ship.purchaseOrderId,
    warehouseId: ship.warehouseId,
    documentRefs: ship.customsDocs,
    notes: `Import ${ship.number} · ${ship.containerRef ?? "no container"}`,
    lines: lines.map((l) => ({
      productId: l.productId,
      batchCode: `IMP-${ship.number.slice(-4)}-${l.productId.slice(-4)}`,
      orderedQty: l.quantity,
      acceptedQty: l.quantity,
      unitCost: l.unitCost ?? 0,
    })),
  });
  if (!grn.ok) return grn;
  const next = grn.data.state;
  const s = next.importShipments.find((x) => x.id === shipmentId)!;
  s.status = "Warehouse Received";
  s.receivedAt = new Date().toISOString();
  s.grnId = grn.data.data.grnId;
  s.updatedAt = s.receivedAt;
  return { ok: true, data: { state: next, data: grn.data.data } };
}

export function upsertExportShipment(
  state: TlbState,
  input: {
    id?: string;
    customerId: string;
    destinationCountry: string;
    carrier?: string;
    docsRef?: string;
    status: ExportShipmentStatus;
    staffName?: string;
    notes?: string;
    lines: Array<{ productId: string; batchId?: string; quantity: number }>;
  },
): MutResult<{ shipmentId: string; number: string }> {
  const blocked = requirePerm(state, "stock.issue");
  if (blocked) return { ok: false, error: blocked };
  if (!input.lines.length) return { ok: false, error: "Add at least one export line." };

  const next = cloneState(state);
  next.exportShipments = next.exportShipments ?? [];
  next.exportShipmentLines = next.exportShipmentLines ?? [];
  const now = new Date().toISOString();
  let row: ExportShipment;
  if (input.id) {
    const existing = next.exportShipments.find((s) => s.id === input.id);
    if (!existing || isSoftDeleted(existing)) {
      return {
        ok: false,
        error: "Export shipment not found. Restore from trash first if deleted.",
      };
    }
    if (existing.status === "Delivered" || existing.status === "Cancelled") {
      return { ok: false, error: `Cannot edit an export that is ${existing.status}.` };
    }
    Object.assign(existing, {
      customerId: input.customerId,
      destinationCountry: input.destinationCountry,
      carrier: input.carrier,
      docsRef: input.docsRef,
      status: input.status,
      notes: input.notes,
      staffName: input.staffName ?? existing.staffName,
      updatedAt: now,
      dispatchedAt:
        input.status === "Dispatched" ||
        input.status === "In Transit" ||
        input.status === "Delivered"
          ? (existing.dispatchedAt ?? now)
          : existing.dispatchedAt,
      deliveredAt:
        input.status === "Delivered" ? (existing.deliveredAt ?? now) : existing.deliveredAt,
    });
    row = existing;
    next.exportShipmentLines = next.exportShipmentLines.filter((l) => l.shipmentId !== row.id);
  } else {
    const numbered = nextDocumentNumber("exportShipment", next.counters);
    next.counters = numbered.counters;
    row = {
      id: uid("exp"),
      number: numbered.number,
      customerId: input.customerId,
      destinationCountry: input.destinationCountry,
      carrier: input.carrier,
      docsRef: input.docsRef,
      status: input.status,
      staffName: input.staffName ?? next.currentUser,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
      dispatchedAt: ["Dispatched", "In Transit", "Delivered"].includes(input.status)
        ? now
        : undefined,
      deliveredAt: input.status === "Delivered" ? now : undefined,
    };
    next.exportShipments.unshift(row);
  }

  for (const line of input.lines) {
    next.exportShipmentLines.push({
      id: uid("expl"),
      shipmentId: row.id,
      productId: line.productId,
      batchId: line.batchId,
      quantity: line.quantity,
    });
  }

  pushAudit(next, {
    action: "shipment.export_upserted",
    entityType: "export_shipment",
    entityId: row.id,
    summary: `Export ${row.number} · ${row.status}`,
    at: now,
  });

  return { ok: true, data: { state: next, data: { shipmentId: row.id, number: row.number } } };
}

export function softDeleteOpsRecord(
  state: TlbState,
  input: {
    entityType:
      | "customer_return"
      | "supplier_return"
      | "non_po_purchase"
      | "import_shipment"
      | "export_shipment";
    entityId: string;
    reason?: string;
  },
): MutResult<{ entityId: string }> {
  const blocked = requirePerm(state, "records.delete");
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  const now = new Date().toISOString();
  const patch = { deletedAt: now, deletedBy: next.currentUser, deletedReason: input.reason };
  let label = input.entityId;
  if (input.entityType === "customer_return") {
    const row = (next.customerReturns ?? []).find((r) => r.id === input.entityId);
    if (!row) return { ok: false, error: "Customer return not found." };
    Object.assign(row, patch);
    label = row.number;
  } else if (input.entityType === "supplier_return") {
    const row = (next.supplierReturns ?? []).find((r) => r.id === input.entityId);
    if (!row) return { ok: false, error: "Supplier return not found." };
    Object.assign(row, patch);
    label = row.number;
  } else if (input.entityType === "non_po_purchase") {
    const row = (next.nonPoPurchases ?? []).find((r) => r.id === input.entityId);
    if (!row) return { ok: false, error: "Non-PO not found." };
    Object.assign(row, patch);
    label = row.number;
  } else if (input.entityType === "import_shipment") {
    const row = (next.importShipments ?? []).find((r) => r.id === input.entityId);
    if (!row) return { ok: false, error: "Import not found." };
    Object.assign(row, patch);
    label = row.number;
  } else {
    const row = (next.exportShipments ?? []).find((r) => r.id === input.entityId);
    if (!row) return { ok: false, error: "Export not found." };
    Object.assign(row, patch);
    label = row.number;
  }
  pushAudit(next, {
    action: "record.trashed",
    entityType: input.entityType,
    entityId: input.entityId,
    summary: `Moved ${label} to trash.`,
    at: now,
  });
  return { ok: true, data: { state: next, data: { entityId: input.entityId } } };
}
