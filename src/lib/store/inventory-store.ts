/**
 * Inventory mutations: immutable ledger, GRN, issue, transfer, adjustment, FEFO supply picks.
 */
import {
  calcAvailable,
  buildStockMap,
  refreshLineStatuses,
  stockKey,
} from "../domain/calculations";
import {
  DEFAULT_INVENTORY_SETTINGS,
  ensureStockBuckets,
  movementSignedQty,
  recommendBatches,
} from "../domain/inventory";
import { nextDocumentNumber } from "../domain/numbering";
import { tryPostMovement } from "../repo/ledger-rpc";
import { hasPermission } from "../domain/permissions";
import type {
  ApprovalKind,
  ApprovalRequest,
  BatchLot,
  GoodsReceiptLine,
  GoodsReceiptNote,
  Permission,
  StockAdjustment,
  StockBalance,
  StockIssueReason,
  StockMovement,
  StockMovementType,
  StoreResult,
  TlbState,
  TransferStatus,
  WarehouseTransfer,
} from "../domain/types";

type MutResult<T> = StoreResult<{ state: TlbState; data: T }>;

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/** Later posts in one action must sort after earlier posts when timestamps would otherwise tie. */
function movementClock(start: string): () => string {
  let ms = new Date(start).getTime();
  return () => {
    const iso = new Date(ms).toISOString();
    ms += 1;
    return iso;
  };
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
    actor?: string;
    at?: string;
  },
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

export function getOrCreateBalance(
  state: TlbState,
  productId: string,
  warehouseId: string,
): StockBalance {
  let bal = state.stock.find((s) => s.productId === productId && s.warehouseId === warehouseId);
  if (!bal) {
    bal = ensureStockBuckets({
      id: uid("stk"),
      productId,
      warehouseId,
      physicalQty: 0,
      reservedQty: 0,
    });
    state.stock.push(bal);
  } else {
    Object.assign(bal, ensureStockBuckets(bal));
  }
  return bal;
}

/** Append immutable movement and update physical qty. */
export function postStockMovement(
  state: TlbState,
  input: {
    type: StockMovementType;
    productId: string;
    warehouseId: string;
    quantity: number;
    batchId?: string;
    reason?: string;
    refType?: string;
    refId?: string;
    refNumber?: string;
    notes?: string;
    /** When false, only record ledger without changing physical (e.g. reservation). */
    applyPhysical?: boolean;
    at?: string;
  },
): StockMovement {
  const product = state.products.find((p) => p.id === input.productId);
  const warehouse = state.warehouses.find((w) => w.id === input.warehouseId);
  const remote =
    input.applyPhysical === false || input.type === "reservation" || input.type === "release"
      ? null
      : tryPostMovement({
          type: input.type,
          productId: input.productId,
          warehouseId: input.warehouseId,
          quantity: input.quantity,
          batchId: input.batchId,
          reason: input.reason,
          refType: input.refType,
          refId: input.refId,
          refNumber: input.refNumber,
          notes: input.notes,
          applyPhysical: input.applyPhysical,
          productSku: product?.sku,
          productName: product?.name,
          productUnit: product?.unit,
          issueStrategy: product?.issueStrategy,
          warehouseCode: warehouse?.code,
          warehouseName: warehouse?.name,
          warehouseLocation: warehouse?.location,
        });
  const bal = getOrCreateBalance(state, input.productId, input.warehouseId);
  const qtyBefore = bal.physicalQty;
  const signed = movementSignedQty(input.type, input.quantity);
  const apply =
    input.applyPhysical !== false && input.type !== "reservation" && input.type !== "release";
  if (remote) {
    bal.physicalQty = remote.qtyAfter;
  } else if (apply) {
    bal.physicalQty = qtyBefore + signed;
    const product = state.products.find((p) => p.id === input.productId);
    const allowNeg =
      product?.allowNegativeStock ?? state.inventorySettings?.allowNegativeStockDefault ?? false;
    if (!allowNeg && bal.physicalQty < 0) {
      bal.physicalQty = qtyBefore;
      throw new Error("Insufficient physical stock for this movement.");
    }
  }
  let number: string;
  if (remote) {
    state.counters = {
      ...state.counters,
      stockMovement: (state.counters.stockMovement ?? 0) + 1,
    };
    number = remote.movementNumber;
  } else {
    const numbered = nextDocumentNumber("stockMovement", state.counters);
    state.counters = numbered.counters;
    number = numbered.number;
  }
  const move: StockMovement = {
    id: remote?.id ?? uid("mv"),
    number,
    type: input.type,
    productId: input.productId,
    warehouseId: input.warehouseId,
    batchId: input.batchId,
    qtyBefore: remote?.qtyBefore ?? qtyBefore,
    qtyMove: remote?.quantity ?? Math.abs(input.quantity),
    qtyAfter: remote?.qtyAfter ?? bal.physicalQty,
    signedQty: remote ? remote.signedQty : apply ? signed : 0,
    reason: input.reason,
    refType: input.refType,
    refId: input.refId,
    refNumber: input.refNumber,
    notes: input.notes,
    actor: state.currentUser,
    at: remote?.createdAt ?? input.at ?? new Date().toISOString(),
  };
  state.stockMovements.unshift(move);
  pushAudit(state, {
    action: "stock.movement",
    entityType: "stock_movement",
    entityId: move.id,
    summary: `${move.type} ${move.signedQty >= 0 ? "+" : ""}${move.signedQty} ${move.number}`,
    meta: {
      type: move.type,
      productId: move.productId,
      warehouseId: move.warehouseId,
      qty: move.qtyMove,
    },
    at: move.at,
  });
  return move;
}

export function consumeBatch(state: TlbState, batchId: string, qty: number): void {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) throw new Error("Batch not found.");
  if (batch.remainingQty < qty)
    throw new Error(`Batch ${batch.code} only has ${batch.remainingQty} remaining.`);
  batch.remainingQty -= qty;
  if (batch.remainingQty === 0) batch.status = "Closed";
}

export function createGoodsReceipt(
  state: TlbState,
  input: {
    supplierId: string;
    purchaseOrderId?: string;
    nonPo?: boolean;
    warehouseId: string;
    receivedAt?: string;
    documentRefs?: string;
    notes?: string;
    lines: Array<{
      productId: string;
      batchCode: string;
      orderedQty: number;
      acceptedQty: number;
      rejectedQty?: number;
      damagedQty?: number;
      unitCost: number;
      manufacturedAt?: string;
      expiresAt?: string;
    }>;
  },
): MutResult<{ grnId: string; number: string }> {
  const blocked = requirePerm(state, "stock.receive");
  if (blocked) return { ok: false, error: blocked };
  if (!input.lines.length) return { ok: false, error: "Add at least one GRN line." };
  if (input.nonPo && !input.notes) {
    return { ok: false, error: "Non-PO purchases require a notes / accountability reason." };
  }

  const next = cloneState(state);
  const numbered = nextDocumentNumber("supplierReceipt", next.counters);
  next.counters = numbered.counters;
  const now = input.receivedAt ?? new Date().toISOString();
  const grnId = uid("grn");
  const grn: GoodsReceiptNote = {
    id: grnId,
    number: numbered.number,
    supplierId: input.supplierId,
    purchaseOrderId: input.purchaseOrderId,
    nonPo: Boolean(input.nonPo) || !input.purchaseOrderId,
    status: "Approved",
    receivedAt: now,
    receivedBy: next.currentUser,
    checkedBy: next.currentUser,
    checkedAt: now,
    approvedBy: next.currentUser,
    approvedAt: now,
    warehouseId: input.warehouseId,
    documentRefs: input.documentRefs,
    notes: input.notes,
    createdAt: now,
  };
  next.goodsReceipts.unshift(grn);

  // Mirror legacy supplierReceipts for existing Suppliers module
  next.supplierReceipts.unshift({
    id: grnId,
    number: numbered.number,
    supplierId: input.supplierId,
    purchaseOrderId: input.purchaseOrderId,
    receivedAt: now,
    productId: input.lines[0]?.productId,
    quantity: input.lines.reduce((s, l) => s + l.acceptedQty, 0),
    warehouseId: input.warehouseId,
    notes: input.notes,
  });

  if (input.purchaseOrderId) {
    const po = next.supplierPurchaseOrders.find((p) => p.id === input.purchaseOrderId);
    if (po && po.status !== "Received") {
      po.status = "Partially received";
      po.updatedAt = now;
    }
  }

  if (grn.nonPo) {
    requestApproval(next, {
      kind: "non_po_purchase",
      title: `Non-PO GRN ${grn.number}`,
      summary: `Non-PO goods in from supplier — accountability recorded.`,
      refType: "grn",
      refId: grnId,
      autoApprove: true,
    });
  }

  for (const line of input.lines) {
    if (!Number.isInteger(line.acceptedQty) || line.acceptedQty < 0) {
      return { ok: false, error: "Accepted quantities must be whole numbers." };
    }
    const grnLine: GoodsReceiptLine = {
      id: uid("grnl"),
      grnId,
      productId: line.productId,
      warehouseId: input.warehouseId,
      batchCode: line.batchCode,
      orderedQty: line.orderedQty,
      acceptedQty: line.acceptedQty,
      rejectedQty: line.rejectedQty ?? 0,
      damagedQty: line.damagedQty ?? 0,
      unitCost: line.unitCost,
      manufacturedAt: line.manufacturedAt,
      expiresAt: line.expiresAt,
    };

    if (line.acceptedQty > 0) {
      const batchId = uid("bat");
      const batch: BatchLot = {
        id: batchId,
        code: line.batchCode,
        productId: line.productId,
        warehouseId: input.warehouseId,
        supplierId: input.supplierId,
        receivedQty: line.acceptedQty,
        remainingQty: line.acceptedQty,
        unitCost: line.unitCost,
        manufacturedAt: line.manufacturedAt,
        expiresAt: line.expiresAt,
        receivedAt: now,
        grnId,
        supplierPoId: input.purchaseOrderId,
        status: "Open",
      };
      next.batches.unshift(batch);
      grnLine.batchId = batchId;
      try {
        postStockMovement(next, {
          type: "grn",
          productId: line.productId,
          warehouseId: input.warehouseId,
          quantity: line.acceptedQty,
          batchId,
          refType: "grn",
          refId: grnId,
          refNumber: grn.number,
          at: now,
        });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "GRN stock post failed." };
      }
      pushAudit(next, {
        action: "batch.created",
        entityType: "batch",
        entityId: batchId,
        summary: `Batch ${batch.code} received via ${grn.number}.`,
        at: now,
      });
    }

    if ((line.damagedQty ?? 0) > 0) {
      const bal = getOrCreateBalance(next, line.productId, input.warehouseId);
      bal.damagedQty = (bal.damagedQty ?? 0) + (line.damagedQty ?? 0);
    }

    next.goodsReceiptLines.push(grnLine);
  }

  pushAudit(next, {
    action: "grn.created",
    entityType: "grn",
    entityId: grnId,
    summary: `Goods receipt ${grn.number} posted.`,
    meta: { supplierId: input.supplierId, nonPo: grn.nonPo },
    at: now,
  });

  return { ok: true, data: { state: next, data: { grnId, number: grn.number } } };
}

export function createStockIssue(
  state: TlbState,
  input: {
    warehouseId: string;
    reason: StockIssueReason;
    notes?: string;
    orderId?: string;
    supplyId?: string;
    deliveryId?: string;
    lines: Array<{ productId: string; quantity: number; batchId?: string }>;
  },
): MutResult<{ issueId: string; number: string }> {
  const blocked = requirePerm(state, "stock.issue");
  if (blocked) return { ok: false, error: blocked };
  if (!input.lines.length) return { ok: false, error: "Add at least one issue line." };

  const next = cloneState(state);
  const numbered = nextDocumentNumber("stockIssue", next.counters);
  next.counters = numbered.counters;
  const now = new Date().toISOString();
  const at = movementClock(now);
  const issueId = uid("iss");
  next.stockIssues.unshift({
    id: issueId,
    number: numbered.number,
    reason: input.reason,
    warehouseId: input.warehouseId,
    issuedAt: now,
    issuedBy: next.currentUser,
    orderId: input.orderId,
    supplyId: input.supplyId,
    deliveryId: input.deliveryId,
    notes: input.notes,
  });

  const moveType: StockMovementType =
    input.reason === "Damage"
      ? "damage"
      : input.reason === "Expiry"
        ? "expiry"
        : input.reason === "Sample"
          ? "sample"
          : input.reason === "Production"
            ? "production"
            : "issue";

  for (const line of input.lines) {
    const bal = getOrCreateBalance(next, line.productId, input.warehouseId);
    if (
      calcAvailable(bal) < line.quantity &&
      !next.products.find((p) => p.id === line.productId)?.allowNegativeStock
    ) {
      return { ok: false, error: `Insufficient available stock for issue of ${line.quantity}.` };
    }
    const picks = line.batchId
      ? [
          {
            batchId: line.batchId,
            code: next.batches.find((b) => b.id === line.batchId)?.code ?? "",
            quantity: line.quantity,
          },
        ]
      : recommendBatches(next, line.productId, input.warehouseId, line.quantity);
    try {
      let posted = 0;
      for (const pick of picks) {
        const take = Math.min(pick.quantity, line.quantity - posted);
        if (take <= 0) continue;
        consumeBatch(next, pick.batchId, take);
        postStockMovement(next, {
          type: moveType,
          productId: line.productId,
          warehouseId: input.warehouseId,
          quantity: take,
          batchId: pick.batchId,
          reason: input.reason,
          refType: "stock_issue",
          refId: issueId,
          refNumber: numbered.number,
          at: at(),
        });
        next.stockIssueLines.push({
          id: uid("issl"),
          issueId,
          productId: line.productId,
          warehouseId: input.warehouseId,
          batchId: pick.batchId,
          quantity: take,
        });
        posted += take;
      }
      if (posted < line.quantity) {
        if (line.batchId) {
          return { ok: false, error: "Not enough batch quantity for the selected batch." };
        }
        const rest = line.quantity - posted;
        postStockMovement(next, {
          type: moveType,
          productId: line.productId,
          warehouseId: input.warehouseId,
          quantity: rest,
          reason: input.reason,
          refType: "stock_issue",
          refId: issueId,
          refNumber: numbered.number,
          at: at(),
        });
        next.stockIssueLines.push({
          id: uid("issl"),
          issueId,
          productId: line.productId,
          warehouseId: input.warehouseId,
          quantity: rest,
        });
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Issue failed." };
    }
    if (input.reason === "Damage") {
      bal.damagedQty = (bal.damagedQty ?? 0) + line.quantity;
    }
    if (input.reason === "Expiry") {
      bal.expiredQty = (bal.expiredQty ?? 0) + line.quantity;
    }
  }

  pushAudit(next, {
    action: "stock.issued",
    entityType: "stock_issue",
    entityId: issueId,
    summary: `Stock issue ${numbered.number} (${input.reason}).`,
    at: now,
  });

  return { ok: true, data: { state: next, data: { issueId, number: numbered.number } } };
}

export function requestWarehouseTransfer(
  state: TlbState,
  input: {
    fromWarehouseId: string;
    toWarehouseId: string;
    notes?: string;
    lines: Array<{ productId: string; quantity: number; batchId?: string }>;
  },
): MutResult<{ transferId: string; number: string }> {
  const blocked = requirePerm(state, "stock.transfer");
  if (blocked) return { ok: false, error: blocked };
  if (input.fromWarehouseId === input.toWarehouseId) {
    return { ok: false, error: "Source and destination warehouses must differ." };
  }
  if (!input.lines.length) return { ok: false, error: "Add transfer lines." };

  const next = cloneState(state);
  const numbered = nextDocumentNumber("transfer", next.counters);
  next.counters = numbered.counters;
  const now = new Date().toISOString();
  const transferId = uid("tr");
  next.transfers.unshift({
    id: transferId,
    number: numbered.number,
    fromWarehouseId: input.fromWarehouseId,
    toWarehouseId: input.toWarehouseId,
    status: "Requested",
    requestedAt: now,
    requestedBy: next.currentUser,
    notes: input.notes,
  });
  for (const line of input.lines) {
    next.transferLines.push({
      id: uid("trl"),
      transferId,
      productId: line.productId,
      batchId: line.batchId,
      quantity: line.quantity,
    });
  }
  requestApproval(next, {
    kind: "transfer",
    title: `Transfer ${numbered.number}`,
    summary: `Warehouse transfer requested`,
    refType: "transfer",
    refId: transferId,
  });
  pushAudit(next, {
    action: "stock.transferred",
    entityType: "transfer",
    entityId: transferId,
    summary: `Transfer ${numbered.number} requested.`,
    at: now,
  });
  return { ok: true, data: { state: next, data: { transferId, number: numbered.number } } };
}

export function advanceTransfer(
  state: TlbState,
  transferId: string,
  toStatus: TransferStatus,
): MutResult<WarehouseTransfer> {
  const next = cloneState(state);
  const tr = next.transfers.find((t) => t.id === transferId);
  if (!tr) return { ok: false, error: "Transfer not found." };
  const now = new Date().toISOString();
  const lines = next.transferLines.filter((l) => l.transferId === transferId);

  if (toStatus === "Approved") {
    const blocked = requirePerm(state, "stock.approve") ?? requirePerm(state, "approvals.manage");
    // allow either
    if (
      !hasPermission(state, "stock.approve") &&
      !hasPermission(state, "approvals.manage") &&
      !hasPermission(state, "stock.transfer")
    ) {
      return { ok: false, error: blocked ?? "Cannot approve transfer." };
    }
    tr.status = "Approved";
    tr.approvedAt = now;
    tr.approvedBy = next.currentUser;
    const appr = next.approvals.find((a) => a.refId === transferId && a.status === "Pending");
    if (appr) {
      appr.status = "Approved";
      appr.decidedAt = now;
      appr.decidedBy = next.currentUser;
    }
  } else if (toStatus === "Released" || toStatus === "In Transit") {
    const blocked = requirePerm(state, "stock.transfer");
    if (blocked) return { ok: false, error: blocked };
    if (tr.status !== "Approved" && tr.status !== "Released") {
      return { ok: false, error: "Transfer must be approved before release." };
    }
    // Deduct source on release; destination only on receive
    if (tr.status === "Approved") {
      for (const line of lines) {
        try {
          if (line.batchId) consumeBatch(next, line.batchId, line.quantity);
          postStockMovement(next, {
            type: "transfer_out",
            productId: line.productId,
            warehouseId: tr.fromWarehouseId,
            quantity: line.quantity,
            batchId: line.batchId,
            refType: "transfer",
            refId: tr.id,
            refNumber: tr.number,
            at: now,
          });
          const fromBal = getOrCreateBalance(next, line.productId, tr.fromWarehouseId);
          fromBal.inTransitQty = (fromBal.inTransitQty ?? 0) + line.quantity;
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "Release failed." };
        }
      }
      tr.releasedAt = now;
      tr.releasedBy = next.currentUser;
    }
    tr.status = "In Transit";
    tr.inTransitAt = now;
  } else if (toStatus === "Received") {
    const blocked = requirePerm(state, "stock.transfer");
    if (blocked) return { ok: false, error: blocked };
    if (tr.status !== "In Transit" && tr.status !== "Released") {
      return { ok: false, error: "Transfer must be in transit to receive." };
    }
    for (const line of lines) {
      try {
        const fromBal = getOrCreateBalance(next, line.productId, tr.fromWarehouseId);
        fromBal.inTransitQty = Math.max(0, (fromBal.inTransitQty ?? 0) - line.quantity);
        postStockMovement(next, {
          type: "transfer_in",
          productId: line.productId,
          warehouseId: tr.toWarehouseId,
          quantity: line.quantity,
          batchId: line.batchId,
          refType: "transfer",
          refId: tr.id,
          refNumber: tr.number,
          at: now,
        });
        if (line.batchId) {
          const batch = next.batches.find((b) => b.id === line.batchId);
          if (batch) {
            // Split remaining at destination as new warehouse location on same batch record
            batch.warehouseId = tr.toWarehouseId;
            batch.remainingQty += 0; // already consumed from source remaining on release; re-open at dest
            // On release we consumed remaining; recreate remaining at destination
            batch.remainingQty = line.quantity;
            batch.status = "Open";
          }
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Receive failed." };
      }
    }
    tr.status = "Received";
    tr.receivedAt = now;
    tr.receivedBy = next.currentUser;
  } else if (toStatus === "Cancelled") {
    tr.status = "Cancelled";
  } else {
    tr.status = toStatus;
  }

  return { ok: true, data: { state: next, data: tr } };
}

export function postStockAdjustment(
  state: TlbState,
  input: {
    kind?: "adjustment" | "count";
    notes?: string;
    lines: Array<{
      productId: string;
      warehouseId: string;
      qtyAfter: number;
      reason: string;
      batchId?: string;
    }>;
  },
): MutResult<{ adjustmentId: string; number: string }> {
  const blocked = requirePerm(state, "stock.adjust");
  if (blocked) return { ok: false, error: blocked };
  if (!input.lines.length) return { ok: false, error: "Add adjustment lines." };

  const next = cloneState(state);
  const threshold =
    next.inventorySettings?.adjustmentApprovalThreshold ??
    DEFAULT_INVENTORY_SETTINGS.adjustmentApprovalThreshold;
  let maxAbs = 0;
  for (const line of input.lines) {
    const bal = getOrCreateBalance(next, line.productId, line.warehouseId);
    maxAbs = Math.max(maxAbs, Math.abs(line.qtyAfter - bal.physicalQty));
  }
  const needsApproval = maxAbs >= threshold;
  if (
    needsApproval &&
    !hasPermission(next, "stock.approve") &&
    !hasPermission(next, "approvals.manage")
  ) {
    // create pending adjustment
  }

  const numbered = nextDocumentNumber("adjustment", next.counters);
  next.counters = numbered.counters;
  const now = new Date().toISOString();
  const adjustmentId = uid("adj");
  const adj: StockAdjustment = {
    id: adjustmentId,
    number: numbered.number,
    status: needsApproval && !hasPermission(next, "stock.approve") ? "Pending Approval" : "Posted",
    kind: input.kind ?? "adjustment",
    createdAt: now,
    createdBy: next.currentUser,
    notes: input.notes,
    requiresApproval: needsApproval,
  };
  if (adj.status === "Posted") {
    adj.postedAt = now;
    adj.postedBy = next.currentUser;
    if (needsApproval) {
      adj.approvedAt = now;
      adj.approvedBy = next.currentUser;
    }
  }
  next.adjustments.unshift(adj);

  for (const line of input.lines) {
    const bal = getOrCreateBalance(next, line.productId, line.warehouseId);
    const qtyBefore = bal.physicalQty;
    const variance = line.qtyAfter - qtyBefore;
    next.adjustmentLines.push({
      id: uid("adjl"),
      adjustmentId,
      productId: line.productId,
      warehouseId: line.warehouseId,
      batchId: line.batchId,
      qtyBefore,
      qtyAfter: line.qtyAfter,
      variance,
      reason: line.reason,
    });
    if (adj.status === "Posted" && variance !== 0) {
      try {
        postStockMovement(next, {
          type: variance > 0 ? "adjustment_plus" : "adjustment_minus",
          productId: line.productId,
          warehouseId: line.warehouseId,
          quantity: Math.abs(variance),
          batchId: line.batchId,
          reason: line.reason,
          refType: "adjustment",
          refId: adjustmentId,
          refNumber: numbered.number,
          at: now,
        });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Adjustment failed." };
      }
    }
  }

  if (adj.status === "Pending Approval") {
    requestApproval(next, {
      kind: "stock_adjustment",
      title: `Adjustment ${numbered.number}`,
      summary: `Variance requires approval (threshold ${threshold}).`,
      refType: "adjustment",
      refId: adjustmentId,
    });
  }

  pushAudit(next, {
    action: "stock.adjusted",
    entityType: "adjustment",
    entityId: adjustmentId,
    summary: `Stock adjustment ${numbered.number} · ${adj.status}.`,
    at: now,
  });

  return { ok: true, data: { state: next, data: { adjustmentId, number: numbered.number } } };
}

export function decideApproval(
  state: TlbState,
  approvalId: string,
  decision: "Approved" | "Rejected",
  note?: string,
): MutResult<ApprovalRequest> {
  const blocked = requirePerm(state, "approvals.manage");
  const blocked2 = requirePerm(state, "stock.approve");
  if (blocked && blocked2) return { ok: false, error: blocked };
  const next = cloneState(state);
  const appr = next.approvals.find((a) => a.id === approvalId);
  if (!appr) return { ok: false, error: "Approval not found." };
  if (appr.status !== "Pending") return { ok: false, error: "Approval already decided." };
  const now = new Date().toISOString();
  appr.status = decision;
  appr.decidedAt = now;
  appr.decidedBy = next.currentUser;
  appr.decisionNote = note;

  if (decision === "Approved" && appr.refType === "adjustment") {
    const adj = next.adjustments.find((a) => a.id === appr.refId);
    if (adj && adj.status === "Pending Approval") {
      adj.status = "Posted";
      adj.postedAt = now;
      adj.postedBy = next.currentUser;
      adj.approvedAt = now;
      adj.approvedBy = next.currentUser;
      for (const line of next.adjustmentLines.filter((l) => l.adjustmentId === adj.id)) {
        if (line.variance === 0) continue;
        try {
          postStockMovement(next, {
            type: line.variance > 0 ? "adjustment_plus" : "adjustment_minus",
            productId: line.productId,
            warehouseId: line.warehouseId,
            quantity: Math.abs(line.variance),
            batchId: line.batchId,
            reason: line.reason,
            refType: "adjustment",
            refId: adj.id,
            refNumber: adj.number,
            at: now,
          });
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "Post failed." };
        }
      }
    }
  }
  if (decision === "Approved" && appr.refType === "transfer") {
    const advanced = advanceTransfer(next, appr.refId, "Approved");
    if (advanced.ok) return { ok: true, data: { state: advanced.data.state, data: appr } };
  }

  if (appr.refType === "non_po_purchase") {
    const npo = (next.nonPoPurchases ?? []).find((n) => n.id === appr.refId);
    if (npo && npo.status === "Pending Approval") {
      npo.status = decision === "Approved" ? "Approved" : "Rejected";
      npo.approvedBy = next.currentUser;
      npo.approvedAt = now;
      if (note) npo.notes = [npo.notes, note].filter(Boolean).join(" · ");
    }
  }

  pushAudit(next, {
    action: "approval.decided",
    entityType: "approval",
    entityId: appr.id,
    summary: `Approval ${decision}: ${appr.title}`,
    at: now,
  });
  return { ok: true, data: { state: next, data: appr } };
}

function requestApproval(
  state: TlbState,
  input: {
    kind: ApprovalKind;
    title: string;
    summary: string;
    refType: string;
    refId: string;
    amount?: number;
    autoApprove?: boolean;
  },
): ApprovalRequest {
  const now = new Date().toISOString();
  const appr: ApprovalRequest = {
    id: uid("appr"),
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
    decisionNote: input.autoApprove ? "Auto-recorded for accountability" : undefined,
  };
  state.approvals.unshift(appr);
  pushAudit(state, {
    action: "approval.requested",
    entityType: "approval",
    entityId: appr.id,
    summary: appr.title,
    at: now,
  });
  return appr;
}

/** Apply FEFO/FIFO batch consumption when creating a supply (called from createSupply). */
export function applySupplyBatchPicks(
  state: TlbState,
  supplyId: string,
  supplyNumber: string,
  productId: string,
  warehouseId: string,
  quantity: number,
  forcedBatchId?: string,
  at?: string,
): { batchId?: string; batchCode?: string } {
  const clock = movementClock(at ?? new Date().toISOString());
  const picks = forcedBatchId
    ? [
        {
          batchId: forcedBatchId,
          code: state.batches.find((b) => b.id === forcedBatchId)?.code ?? "",
          quantity,
        },
      ]
    : recommendBatches(state, productId, warehouseId, quantity);

  let primary: { batchId?: string; batchCode?: string } = {};
  let posted = 0;
  for (const pick of picks) {
    const take = Math.min(pick.quantity, quantity - posted);
    if (take <= 0) continue;
    consumeBatch(state, pick.batchId, take);
    postStockMovement(state, {
      type: "supply",
      productId,
      warehouseId,
      quantity: take,
      batchId: pick.batchId,
      refType: "supply",
      refId: supplyId,
      refNumber: supplyNumber,
      at: clock(),
    });
    if (!primary.batchId) primary = { batchId: pick.batchId, batchCode: pick.code };
    posted += take;
  }
  // Physical stock can exceed open batch remaining (quick receive, adjustment).
  // The unbatched remainder must still hit the ledger for the full supply qty.
  if (posted < quantity) {
    postStockMovement(state, {
      type: "supply",
      productId,
      warehouseId,
      quantity: quantity - posted,
      refType: "supply",
      refId: supplyId,
      refNumber: supplyNumber,
      at: clock(),
    });
  }
  return primary;
}

export function recomputeOpenOrderStatuses(state: TlbState): void {
  const stockMap = buildStockMap(state.stock);
  for (const order of state.orders) {
    if (["Draft", "Pending", "Delivered", "Cancelled"].includes(order.status)) continue;
    const lines = state.orderLines.filter((l) => l.orderId === order.id);
    const refreshed = refreshLineStatuses(lines, stockMap);
    for (const line of refreshed) {
      const idx = state.orderLines.findIndex((l) => l.id === line.id);
      if (idx >= 0) state.orderLines[idx] = line;
    }
  }
}

export { stockKey };
