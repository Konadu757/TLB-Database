/**
 * Inventory engine helpers: ledger integrity, FEFO/FIFO/LIFO picks,
 * expiry alerts, AR/AP ageing, product/batch traceability, Ask TLB presets.
 */
import { calcAvailable, calcUnavailable, daysBetween } from "./calculations";
import {
  customerPerformanceReport,
  productProfitability,
  stockAgeingReport,
  stockVelocityReport,
  supplierPerformanceReport,
} from "./analytics-pack";
import type {
  BatchLot,
  FinanceAgeingBucket,
  IssueStrategy,
  StockBalance,
  StockMovement,
  StockMovementType,
  TlbState,
  TraceNode,
} from "./types";

export const DEFAULT_INVENTORY_SETTINGS = {
  expiryAlertDays: [30, 60, 90],
  adjustmentApprovalThreshold: 10,
  highValueApprovalAmount: 50000,
  allowNegativeStockDefault: false,
};

export function ensureStockBuckets(bal: StockBalance): StockBalance {
  return {
    ...bal,
    damagedQty: bal.damagedQty ?? 0,
    expiredQty: bal.expiredQty ?? 0,
    quarantineQty: bal.quarantineQty ?? 0,
    inTransitQty: bal.inTransitQty ?? 0,
    allocatedQty: bal.allocatedQty ?? 0,
  };
}

export function stockPosition(bal: StockBalance) {
  const b = ensureStockBuckets(bal);
  return {
    physical: b.physicalQty,
    reserved: b.reservedQty,
    damaged: b.damagedQty ?? 0,
    expired: b.expiredQty ?? 0,
    quarantine: b.quarantineQty ?? 0,
    inTransit: b.inTransitQty ?? 0,
    allocated: b.allocatedQty ?? 0,
    unavailable: calcUnavailable(b),
    available: calcAvailable(b),
  };
}

/** Sort open batches for issue recommendation. */
export function sortBatchesForStrategy(batches: BatchLot[], strategy: IssueStrategy): BatchLot[] {
  const open = batches.filter((b) => b.remainingQty > 0 && b.status === "Open");
  const copy = [...open];
  if (strategy === "FEFO") {
    copy.sort((a, b) => {
      const ae = a.expiresAt ?? "9999-12-31";
      const be = b.expiresAt ?? "9999-12-31";
      if (ae !== be) return ae.localeCompare(be);
      return a.receivedAt.localeCompare(b.receivedAt);
    });
  } else if (strategy === "LIFO") {
    copy.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  } else {
    // FIFO
    copy.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }
  return copy;
}

export function recommendBatches(
  state: TlbState,
  productId: string,
  warehouseId: string,
  quantity: number,
  strategy?: IssueStrategy,
): { batchId: string; code: string; quantity: number }[] {
  const product = state.products.find((p) => p.id === productId);
  const strat = strategy ?? product?.issueStrategy ?? "FEFO";
  const batches = sortBatchesForStrategy(
    state.batches.filter((b) => b.productId === productId && b.warehouseId === warehouseId),
    strat,
  );
  let left = quantity;
  const picks: { batchId: string; code: string; quantity: number }[] = [];
  for (const batch of batches) {
    if (left <= 0) break;
    const take = Math.min(batch.remainingQty, left);
    if (take <= 0) continue;
    picks.push({ batchId: batch.id, code: batch.code, quantity: take });
    left -= take;
  }
  return picks;
}

export type ExpiryAlertBand = "expired" | "30" | "60" | "90" | "ok";

export function batchExpiryBand(batch: BatchLot, asOf = new Date().toISOString(), alertDays = [30, 60, 90]): ExpiryAlertBand {
  if (!batch.expiresAt) return "ok";
  if (batch.expiresAt.slice(0, 10) < asOf.slice(0, 10) || batch.status === "Expired") return "expired";
  const days = daysBetween(asOf, batch.expiresAt);
  const sorted = [...alertDays].sort((a, b) => a - b);
  for (const d of sorted) {
    if (days <= d) return String(d) as ExpiryAlertBand;
  }
  return "ok";
}

export function listExpiryAlerts(state: TlbState, asOf = new Date().toISOString()) {
  const days = state.inventorySettings?.expiryAlertDays ?? DEFAULT_INVENTORY_SETTINGS.expiryAlertDays;
  return state.batches
    .filter((b) => b.remainingQty > 0)
    .map((b) => {
      const product = state.products.find((p) => p.id === b.productId);
      const warehouse = state.warehouses.find((w) => w.id === b.warehouseId);
      const band = batchExpiryBand(b, asOf, days);
      return {
        batch: b,
        productName: product?.name ?? "",
        productSku: product?.sku ?? "",
        warehouseName: warehouse?.name ?? "",
        band,
        daysToExpiry: b.expiresAt ? daysBetween(asOf, b.expiresAt) : null,
      };
    })
    .filter((r) => r.band !== "ok");
}

export function listLowStock(state: TlbState) {
  return state.stock
    .map((bal) => {
      const product = state.products.find((p) => p.id === bal.productId);
      if (!product) return null;
      const available = calcAvailable(bal);
      const reorderPoint = product.reorderPoint ?? product.minQty ?? 0;
      if (reorderPoint <= 0 || available > reorderPoint) return null;
      const warehouse = state.warehouses.find((w) => w.id === bal.warehouseId);
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        warehouseId: bal.warehouseId,
        warehouseName: warehouse?.name ?? "",
        available,
        reorderPoint,
        reorderQty: product.reorderQty ?? 0,
        preferredSupplierId: product.preferredSupplierId,
        leadTimeDays: product.leadTimeDays ?? 0,
      };
    })
    .filter(Boolean) as Array<{
    productId: string;
    sku: string;
    name: string;
    warehouseId: string;
    warehouseName: string;
    available: number;
    reorderPoint: number;
    reorderQty: number;
    preferredSupplierId?: string;
    leadTimeDays: number;
  }>;
}

export function ageingBucket(ageDays: number): FinanceAgeingBucket {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  return "90+";
}

export interface ArApRow {
  partyId: string;
  partyName: string;
  docId: string;
  docNumber: string;
  docDate: string;
  dueDate: string;
  original: number;
  balance: number;
  ageDays: number;
  bucket: FinanceAgeingBucket;
}

/** Customer AR from unpaid / partial invoices. */
export function accountsReceivable(state: TlbState, asOf = new Date().toISOString()): ArApRow[] {
  const rows: ArApRow[] = [];
  for (const inv of state.invoices) {
    if (inv.paymentStatus === "Void" || inv.paymentStatus === "Paid") continue;
    const balance = Math.max(0, inv.total - inv.amountPaid);
    if (balance <= 0) continue;
    const customer = state.customers.find((c) => c.id === inv.customerId);
    const termsDays = parseTermsDays(customer?.paymentTerms);
    const due = addDays(inv.invoiceDate, termsDays);
    const ageDays = daysBetween(due, asOf);
    rows.push({
      partyId: inv.customerId,
      partyName: customer?.name ?? "Unknown",
      docId: inv.id,
      docNumber: inv.number,
      docDate: inv.invoiceDate,
      dueDate: due,
      original: inv.total,
      balance,
      ageDays,
      bucket: ageingBucket(ageDays),
    });
  }
  return rows.sort((a, b) => b.ageDays - a.ageDays);
}

/** Supplier AP — PO totals less supplier payments (simplified). */
export function accountsPayable(state: TlbState, asOf = new Date().toISOString()): ArApRow[] {
  const rows: ArApRow[] = [];
  for (const po of state.supplierPurchaseOrders) {
    if (po.status === "Cancelled" || po.status === "Draft") continue;
    const paid = state.supplierPayments
      .filter((p) => p.purchaseOrderId === po.id || p.supplierId === po.supplierId)
      .filter((p) => p.purchaseOrderId === po.id)
      .reduce((s, p) => s + p.amount, 0);
    const balance = Math.max(0, po.total - paid);
    if (balance <= 0) continue;
    const supplier = state.suppliers.find((s) => s.id === po.supplierId);
    const termsDays = parseTermsDays(supplier?.paymentTerms);
    const due = addDays(po.orderDate, termsDays);
    const ageDays = daysBetween(due, asOf);
    rows.push({
      partyId: po.supplierId,
      partyName: supplier?.name ?? "Unknown",
      docId: po.id,
      docNumber: po.number,
      docDate: po.orderDate,
      dueDate: due,
      original: po.total,
      balance,
      ageDays,
      bucket: ageingBucket(ageDays),
    });
  }
  return rows.sort((a, b) => b.ageDays - a.ageDays);
}

export function creditPosition(state: TlbState, customerId: string) {
  const customer = state.customers.find((c) => c.id === customerId);
  const limit = customer?.creditLimit ?? 0;
  const ar = accountsReceivable(state).filter((r) => r.partyId === customerId);
  const used = ar.reduce((s, r) => s + r.balance, 0);
  // Also count open order value not yet invoiced
  const openOrderValue = state.orders
    .filter((o) => o.customerId === customerId && !["Cancelled", "Draft", "Delivered"].includes(o.status))
    .reduce((sum, o) => {
      const lines = state.orderLines.filter((l) => l.orderId === o.id);
      return sum + lines.reduce((s, l) => s + (l.orderedQty - l.cancelledQty) * l.unitPrice, 0);
    }, 0);
  const usedTotal = used + openOrderValue;
  return {
    limit,
    used: usedTotal,
    available: Math.max(0, limit - usedTotal),
    overLimit: limit > 0 && usedTotal > limit,
  };
}

function parseTermsDays(terms?: string): number {
  if (!terms) return 30;
  if (terms === "COD") return 0;
  const m = /Net\s+(\d+)/i.exec(terms);
  return m ? Number(m[1]) : 30;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function buildProductTrace(state: TlbState, productId: string): TraceNode[] {
  const nodes: TraceNode[] = [];
  const product = state.products.find((p) => p.id === productId);
  if (!product) return nodes;

  nodes.push({
    id: `prod-${product.id}`,
    at: "",
    kind: "product",
    title: product.name,
    detail: `${product.sku} · ${product.unit}`,
    refNav: "Products",
    refId: product.id,
  });

  for (const grn of state.goodsReceipts.filter((g) =>
    state.goodsReceiptLines.some((l) => l.grnId === g.id && l.productId === productId),
  )) {
    const supplier = state.suppliers.find((s) => s.id === grn.supplierId);
    nodes.push({
      id: grn.id,
      at: grn.receivedAt,
      kind: "grn",
      title: grn.number,
      detail: `Goods in from ${supplier?.name ?? "supplier"}${grn.purchaseOrderId ? " · PO-linked" : " · Non-PO"}`,
      refNav: "Goods In",
      refId: grn.id,
    });
  }

  for (const batch of state.batches.filter((b) => b.productId === productId)) {
    nodes.push({
      id: batch.id,
      at: batch.receivedAt,
      kind: "batch",
      title: batch.code,
      detail: `Remain ${batch.remainingQty} · cost ${batch.unitCost}${batch.expiresAt ? ` · EXP ${batch.expiresAt.slice(0, 10)}` : ""}`,
      refNav: "Batches",
      refId: batch.id,
    });
  }

  for (const mv of state.stockMovements.filter((m) => m.productId === productId).slice(0, 40)) {
    nodes.push({
      id: mv.id,
      at: mv.at,
      kind: "movement",
      title: `${mv.type} · ${mv.number}`,
      detail: `${mv.signedQty >= 0 ? "+" : ""}${mv.signedQty} · ${mv.qtyBefore} → ${mv.qtyAfter}${mv.refNumber ? ` · ${mv.refNumber}` : ""}`,
      refNav: "Stock Movements",
      refId: mv.id,
    });
  }

  for (const tr of state.transfers) {
    const lines = state.transferLines.filter((l) => l.transferId === tr.id && l.productId === productId);
    if (!lines.length) continue;
    nodes.push({
      id: tr.id,
      at: tr.receivedAt ?? tr.requestedAt,
      kind: "transfer",
      title: tr.number,
      detail: `${tr.status} · qty ${lines.reduce((s, l) => s + l.quantity, 0)}`,
      refNav: "Transfers",
      refId: tr.id,
    });
  }

  for (const line of state.orderLines.filter((l) => l.productId === productId)) {
    const order = state.orders.find((o) => o.id === line.orderId);
    if (!order) continue;
    const customer = state.customers.find((c) => c.id === order.customerId);
    nodes.push({
      id: `ol-${line.id}`,
      at: order.orderDate,
      kind: "order",
      title: order.number,
      detail: `${customer?.name ?? ""} · ordered ${line.orderedQty} · supplied ${line.suppliedQty} · outstanding ${Math.max(0, line.orderedQty - line.suppliedQty - line.cancelledQty)}`,
      refNav: "Sales Orders",
      refId: order.id,
    });
  }

  for (const sl of state.supplyLines.filter((l) => l.productId === productId)) {
    const supply = state.supplies.find((s) => s.id === sl.supplyId);
    if (!supply) continue;
    nodes.push({
      id: sl.id,
      at: supply.suppliedAt,
      kind: "supply",
      title: supply.number,
      detail: `Issued ${sl.quantity}${sl.batchCode ? ` · batch ${sl.batchCode}` : ""}`,
      refNav: "Sales Orders",
      refId: supply.orderId,
    });
  }

  for (const inv of state.invoices) {
    const has = state.invoiceLines.some((l) => l.invoiceId === inv.id && l.productId === productId);
    if (!has) continue;
    nodes.push({
      id: inv.id,
      at: inv.invoiceDate,
      kind: "invoice",
      title: inv.number,
      detail: `${inv.paymentStatus} · total ${inv.total} · paid ${inv.amountPaid}`,
      refNav: "Finance",
      refId: inv.id,
    });
  }

  for (const pay of state.payments) {
    if (!pay.invoiceId && !pay.orderId) continue;
    const linkedInv = pay.invoiceId
      ? state.invoices.find((i) => i.id === pay.invoiceId)
      : state.invoices.find((i) => i.orderId === pay.orderId);
    if (!linkedInv) continue;
    const has = state.invoiceLines.some((l) => l.invoiceId === linkedInv.id && l.productId === productId);
    if (!has && pay.orderId) {
      const hasLine = state.orderLines.some((l) => l.orderId === pay.orderId && l.productId === productId);
      if (!hasLine) continue;
    } else if (!has) continue;
    nodes.push({
      id: pay.id,
      at: pay.paymentDate,
      kind: "payment",
      title: pay.number,
      detail: `${pay.method} · ${pay.amount}`,
      refNav: "Finance",
      refId: pay.id,
    });
  }

  return nodes
    .filter((n) => n.at)
    .sort((a, b) => a.at.localeCompare(b.at))
    .concat(nodes.filter((n) => !n.at));
}

export function buildBatchTrace(state: TlbState, batchId: string): TraceNode[] {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) return [];
  const nodes = buildProductTrace(state, batch.productId).filter(
    (n) =>
      n.id === batch.id ||
      n.kind === "grn" ||
      n.kind === "supplier" ||
      (n.kind === "movement" && state.stockMovements.find((m) => m.id === n.id)?.batchId === batchId) ||
      (n.kind === "supply" && state.supplyLines.find((l) => l.id === n.id)?.batchId === batchId) ||
      n.kind === "order" ||
      n.kind === "invoice" ||
      n.kind === "payment" ||
      n.kind === "transfer",
  );
  const supplier = batch.supplierId ? state.suppliers.find((s) => s.id === batch.supplierId) : undefined;
  if (supplier) {
    nodes.unshift({
      id: supplier.id,
      at: batch.receivedAt,
      kind: "supplier",
      title: supplier.name,
      detail: supplier.code,
      refNav: "Suppliers",
      refId: supplier.id,
    });
  }
  return nodes;
}

/** Ledger integrity: each movement's qtyAfter should match next movement's qtyBefore per product×warehouse chain tip. */
export function verifyLedgerTip(state: TlbState, productId: string, warehouseId: string): boolean {
  const bal = state.stock.find((s) => s.productId === productId && s.warehouseId === warehouseId);
  if (!bal) return true;
  const moves = state.stockMovements
    .filter((m) => m.productId === productId && m.warehouseId === warehouseId)
    .sort((a, b) => a.at.localeCompare(b.at));
  if (!moves.length) return true;
  const last = moves[moves.length - 1]!;
  return last.qtyAfter === bal.physicalQty;
}

export type AskTlbPresetId =
  | "goods_in_today"
  | "goods_out_today"
  | "outstanding"
  | "low_stock"
  | "expiring_stock"
  | "customers_owing"
  | "suppliers_owed"
  | "pending_approvals"
  | "incomplete_deliveries"
  | "non_po"
  | "adjustments"
  | "transfers"
  | "incoming_shipments"
  | "slow_dead_stock"
  | "returns"
  | "customer_performance"
  | "supplier_performance"
  | "stock_ageing_old"
  | "profitability"
  | "ops_pending_approvals"
  | "ops_outstanding"
  | "ops_in_transit"
  | "ops_discrepancies"
  | "ops_ready_collection";

export interface AskTlbPreset {
  id: AskTlbPresetId;
  label: string;
  description: string;
}

export const ASK_TLB_PRESETS: AskTlbPreset[] = [
  { id: "goods_in_today", label: "Today's Goods In", description: "GRNs received today" },
  { id: "goods_out_today", label: "Today's Goods Out", description: "Issues and supplies posted today" },
  { id: "outstanding", label: "Outstanding Supplies", description: "Open customer supply lines" },
  { id: "low_stock", label: "Low Stock", description: "Below reorder point" },
  { id: "expiring_stock", label: "Expiring / Expired Stock", description: "Batches in alert windows" },
  { id: "customers_owing", label: "Customers Owing", description: "Accounts receivable open balances" },
  { id: "suppliers_owed", label: "Suppliers Owed", description: "Accounts payable open balances" },
  { id: "pending_approvals", label: "Pending Approvals", description: "Approvals awaiting decision" },
  { id: "incomplete_deliveries", label: "Incomplete Deliveries", description: "Not yet delivered" },
  { id: "non_po", label: "Non-PO Purchases", description: "Non-PO requests and GRNs without PO" },
  { id: "adjustments", label: "Stock Adjustments", description: "Posted and pending adjustments" },
  { id: "transfers", label: "Warehouse Transfers", description: "Open and recent transfers" },
  { id: "incoming_shipments", label: "Incoming Shipments", description: "Import shipments and open supplier POs" },
  { id: "slow_dead_stock", label: "Slow / Dead Stock", description: "Low or zero 30-day outbound velocity" },
  { id: "returns", label: "Returns", description: "Customer and supplier returns" },
  { id: "customer_performance", label: "Customer Performance", description: "Revenue, outstanding, credit utilisation" },
  { id: "supplier_performance", label: "Supplier Performance", description: "Purchase value, on-time, rejections" },
  { id: "stock_ageing_old", label: "Aged Stock 91+", description: "Batches older than 90 days" },
  { id: "profitability", label: "Product Profitability", description: "Gross profit where cost + sales exist" },
  { id: "ops_pending_approvals", label: "Ops Pending Approvals", description: "Operations Hub requests awaiting approval" },
  { id: "ops_outstanding", label: "Ops Outstanding Shortage", description: "Warehouse shortage outstanding (not delivery missing)" },
  { id: "ops_in_transit", label: "Ops In Transit", description: "Requests collected / in transit" },
  { id: "ops_discrepancies", label: "Ops Discrepancies", description: "Delivery missing / damaged / wrong / rejected" },
  { id: "ops_ready_collection", label: "Ops Ready for Collection", description: "Prepared and ready for driver pickup" },
];

export interface AskTlbHit {
  id: string;
  label: string;
  subtitle: string;
  nav: string;
  entityId?: string;
}

export function runAskTlbPreset(state: TlbState, presetId: AskTlbPresetId, asOf = new Date().toISOString()): AskTlbHit[] {
  const today = asOf.slice(0, 10);
  switch (presetId) {
    case "goods_in_today":
      return state.goodsReceipts
        .filter((g) => g.receivedAt.slice(0, 10) === today)
        .map((g) => ({
          id: g.id,
          label: g.number,
          subtitle: g.status,
          nav: "Goods In",
          entityId: g.id,
        }));
    case "goods_out_today": {
      const issues = state.stockIssues
        .filter((i) => i.issuedAt.slice(0, 10) === today)
        .map((i) => ({ id: i.id, label: i.number, subtitle: i.reason, nav: "Goods Out", entityId: i.id }));
      const supplies = state.supplies
        .filter((s) => s.suppliedAt.slice(0, 10) === today)
        .map((s) => ({ id: s.id, label: s.number, subtitle: "Customer supply", nav: "Sales Orders", entityId: s.orderId }));
      return [...issues, ...supplies];
    }
    case "outstanding":
      return state.orderLines
        .filter((l) => l.orderedQty - l.suppliedQty - l.cancelledQty > 0)
        .map((l) => {
          const order = state.orders.find((o) => o.id === l.orderId);
          const product = state.products.find((p) => p.id === l.productId);
          return {
            id: l.id,
            label: order?.number ?? l.orderId,
            subtitle: `${product?.sku ?? ""} · outstanding ${l.orderedQty - l.suppliedQty - l.cancelledQty}`,
            nav: "Outstanding Supplies",
            entityId: l.orderId,
          };
        });
    case "low_stock":
      return listLowStock(state).map((r) => ({
        id: `${r.productId}-${r.warehouseId}`,
        label: `${r.sku} · ${r.name}`,
        subtitle: `Available ${r.available} · reorder at ${r.reorderPoint}`,
        nav: "Stock",
        entityId: r.productId,
      }));
    case "expiring_stock":
      return listExpiryAlerts(state, asOf).map((r) => ({
        id: r.batch.id,
        label: r.batch.code,
        subtitle: `${r.productSku} · ${r.band === "expired" ? "EXPIRED" : `${r.band}d window`} · remain ${r.batch.remainingQty}`,
        nav: "Batches",
        entityId: r.batch.id,
      }));
    case "customers_owing":
      return accountsReceivable(state, asOf).map((r) => ({
        id: r.docId,
        label: r.docNumber,
        subtitle: `${r.partyName} · balance ${r.balance} · ${r.bucket}`,
        nav: "Accounts Receivable",
        entityId: r.docId,
      }));
    case "suppliers_owed":
      return accountsPayable(state, asOf).map((r) => ({
        id: r.docId,
        label: r.docNumber,
        subtitle: `${r.partyName} · balance ${r.balance} · ${r.bucket}`,
        nav: "Accounts Payable",
        entityId: r.docId,
      }));
    case "pending_approvals":
      return state.approvals
        .filter((a) => a.status === "Pending")
        .map((a) => ({
          id: a.id,
          label: a.title,
          subtitle: a.summary,
          nav: "Approvals",
          entityId: a.id,
        }));
    case "incomplete_deliveries":
      return state.deliveries
        .filter((d) => d.status !== "Delivered" && d.status !== "Returned")
        .map((d) => ({
          id: d.id,
          label: d.number,
          subtitle: d.status,
          nav: "Deliveries",
          entityId: d.id,
        }));
    case "non_po": {
      const purchases = (state.nonPoPurchases ?? [])
        .filter((n) => !n.deletedAt)
        .map((n) => ({
          id: n.id,
          label: n.number,
          subtitle: `${n.status} · ${n.reason}`,
          nav: "Non-PO Purchases",
          entityId: n.id,
        }));
      const grns = state.goodsReceipts
        .filter((g) => g.nonPo)
        .map((g) => ({
          id: g.id,
          label: g.number,
          subtitle: `GRN · ${g.status}`,
          nav: "Goods In",
          entityId: g.id,
        }));
      return [...purchases, ...grns];
    }
    case "adjustments":
      return state.adjustments.map((a) => ({
        id: a.id,
        label: a.number,
        subtitle: `${a.kind} · ${a.status}`,
        nav: "Adjustments",
        entityId: a.id,
      }));
    case "transfers":
      return state.transfers.map((t) => ({
        id: t.id,
        label: t.number,
        subtitle: t.status,
        nav: "Transfers",
        entityId: t.id,
      }));
    case "incoming_shipments": {
      const imports = (state.importShipments ?? [])
        .filter((s) => !s.deletedAt && s.status !== "Warehouse Received" && s.status !== "Cancelled")
        .map((s) => ({
          id: s.id,
          label: s.number,
          subtitle: `${s.status} · ${s.originCountry}`,
          nav: "Import & Export",
          entityId: s.id,
        }));
      const pos = state.supplierPurchaseOrders
        .filter((p) => ["Ordered", "In transit", "Open", "Partially received"].includes(p.status))
        .map((p) => ({
          id: p.id,
          label: p.number,
          subtitle: p.status,
          nav: "Procurement",
          entityId: p.id,
        }));
      return [...imports, ...pos];
    }
    case "slow_dead_stock":
      return stockVelocityReport(state, asOf)
        .filter((r) => r.velocity === "Slow" || r.velocity === "Dead")
        .map((r) => ({
          id: r.productId,
          label: `${r.productSku} · ${r.productName}`,
          subtitle: `${r.velocity} · on hand ${r.onHand} · out 30d ${r.outbound30d}`,
          nav: "Stock",
          entityId: r.productId,
        }));
    case "returns": {
      const cust = (state.customerReturns ?? [])
        .filter((r) => !r.deletedAt)
        .map((r) => ({
          id: r.id,
          label: r.number,
          subtitle: `Customer · ${r.disposition} · ${r.status}`,
          nav: "Returns",
          entityId: r.id,
        }));
      const sup = (state.supplierReturns ?? [])
        .filter((r) => !r.deletedAt)
        .map((r) => ({
          id: r.id,
          label: r.number,
          subtitle: `Supplier · ${r.status}`,
          nav: "Returns",
          entityId: r.id,
        }));
      return [...cust, ...sup];
    }
    case "customer_performance":
      return customerPerformanceReport(state, asOf).map((r) => ({
        id: r.customerId,
        label: r.customerName,
        subtitle: `Revenue ${r.revenue} · outstanding ${r.outstandingBalance} · util ${r.creditUtilisationPct}%`,
        nav: "Customers",
        entityId: r.customerId,
      }));
    case "supplier_performance":
      return supplierPerformanceReport(state).map((r) => ({
        id: r.supplierId,
        label: r.supplierName,
        subtitle: `Purchases ${r.purchaseValue} · on-time ${r.onTimePct}% · rejected ${r.rejectedQty}`,
        nav: "Suppliers",
        entityId: r.supplierId,
      }));
    case "stock_ageing_old":
      return stockAgeingReport(state, asOf)
        .filter((r) => r.ageDays > 90)
        .map((r) => ({
          id: r.batchId,
          label: r.batchCode,
          subtitle: `${r.productSku} · ${r.band} · ${r.ageDays}d · qty ${r.remainingQty}`,
          nav: "Batches",
          entityId: r.batchId,
        }));
    case "profitability":
      return productProfitability(state).map((r) => ({
        id: r.key,
        label: r.label,
        subtitle: `GP ${r.grossProfit} · margin ${r.marginPct}% · rev ${r.revenue}`,
        nav: "Reports",
        entityId: r.key,
      }));
    case "ops_pending_approvals":
      return (state.opsRequests ?? [])
        .filter((r) => !r.deletedAt && (r.status === "Pending Approval" || r.status === "Partially Approved"))
        .map((r) => ({
          id: r.id,
          label: r.number,
          subtitle: `${r.title} · ${r.priority}`,
          nav: "Requests",
          entityId: r.id,
        }));
    case "ops_outstanding":
      return (state.opsRequestLines ?? [])
        .filter((l) => {
          const shortage = Math.max(0, l.requestedQty - l.approvedQty - l.cancelledQty);
          return shortage > 0;
        })
        .map((l) => {
          const req = (state.opsRequests ?? []).find((r) => r.id === l.requestId);
          const product = state.products.find((p) => p.id === l.productId);
          const shortage = Math.max(0, l.requestedQty - l.approvedQty - l.cancelledQty);
          return {
            id: l.id,
            label: req?.number ?? l.requestId,
            subtitle: `${product?.name ?? l.productId} shortage ${shortage} (missing disc. ${l.missingQty})`,
            nav: "Outstanding Requests",
            entityId: l.requestId,
          };
        });
    case "ops_in_transit":
      return (state.opsRequests ?? [])
        .filter((r) => !r.deletedAt && ["Collected", "In Transit", "Issued"].includes(r.status))
        .map((r) => ({
          id: r.id,
          label: r.number,
          subtitle: `${r.driverName ?? "unassigned"} · ${r.destination}`,
          nav: "Requests",
          entityId: r.id,
        }));
    case "ops_discrepancies":
      return (state.opsDiscrepancies ?? [])
        .filter((d) => !d.resolvedAt)
        .map((d) => {
          const req = (state.opsRequests ?? []).find((r) => r.id === d.requestId);
          const product = state.products.find((p) => p.id === d.productId);
          return {
            id: d.id,
            label: req?.number ?? d.requestId,
            subtitle: `${d.kind} × ${d.quantity} · ${product?.name ?? d.productId}`,
            nav: "Exceptions / Discrepancies",
            entityId: d.requestId,
          };
        });
    case "ops_ready_collection":
      return (state.opsRequests ?? [])
        .filter((r) => !r.deletedAt && r.status === "Ready for Collection")
        .map((r) => ({
          id: r.id,
          label: r.number,
          subtitle: r.title,
          nav: "Warehouse Actions",
          entityId: r.id,
        }));
    default:
      return [];
  }
}

export function movementSignedQty(type: StockMovementType, qty: number): number {
  const inbound: StockMovementType[] = [
    "opening",
    "grn",
    "transfer_in",
    "adjustment_plus",
    "return_customer",
    "release",
    "production",
  ];
  if (type === "reservation") return 0;
  if (inbound.includes(type)) return Math.abs(qty);
  return -Math.abs(qty);
}

export function summarizeMovements(movements: StockMovement[]) {
  return {
    count: movements.length,
    inbound: movements.filter((m) => m.signedQty > 0).reduce((s, m) => s + m.signedQty, 0),
    outbound: movements.filter((m) => m.signedQty < 0).reduce((s, m) => s + Math.abs(m.signedQty), 0),
  };
}
