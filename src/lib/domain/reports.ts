/**
 * Deep operational reports + CSV helpers (inventory, returns, shipments, profitability).
 */
import { calcOutstanding, daysBetween, fulfilmentPercent } from "./calculations";
import {
  categoryProfitability,
  customerPerformanceReport,
  customerProfitability,
  productProfitability,
  stockAgeingReport,
  stockVelocityReport,
  supplierPerformanceReport,
} from "./analytics-pack";
import { accountsPayable, accountsReceivable, listExpiryAlerts, listLowStock } from "./inventory";
import { getOutstandingRows } from "../store/tlb-store";
import { isSoftDeleted } from "./trash";
import type { TlbState } from "./types";

export interface DateFilter {
  from?: string;
  to?: string;
}

function inRange(iso: string, filter: DateFilter): boolean {
  const d = iso.slice(0, 10);
  if (filter.from && d < filter.from) return false;
  if (filter.to && d > filter.to) return false;
  return true;
}

export function outstandingOrdersReport(state: TlbState, filter: DateFilter = {}) {
  const rows = getOutstandingRows(state).filter((r) => inRange(r.orderDate, filter));
  return rows.map((r) => ({
    orderNumber: r.orderNumber,
    customerName: r.customerName,
    productSku: r.productSku,
    productName: r.productName,
    warehouseName: r.warehouseName,
    outstandingQty: r.outstandingQty,
    availableQty: r.availableQty,
    ageDays: r.ageDays,
    ageingBand: r.ageingBand,
    orderStatus: r.orderStatus,
    orderDate: r.orderDate.slice(0, 10),
  }));
}

export function partialSupplyReport(state: TlbState, filter: DateFilter = {}) {
  return state.orders
    .filter((o) => o.status === "Partially Supplied")
    .filter((o) => inRange(o.orderDate, filter))
    .map((o) => {
      const lines = state.orderLines.filter((l) => l.orderId === o.id);
      const customer = state.customers.find((c) => c.id === o.customerId);
      return {
        orderNumber: o.number,
        customerName: customer?.name ?? "",
        fulfilmentPercent: fulfilmentPercent(lines),
        outstandingLines: lines.filter((l) => calcOutstanding(l) > 0).length,
        supplies: state.supplies.filter((s) => s.orderId === o.id).length,
        orderDate: o.orderDate.slice(0, 10),
        requiredDate: o.requiredDate ?? "",
      };
    });
}

export function fulfilmentPerformanceReport(state: TlbState, filter: DateFilter = {}, asOf = new Date().toISOString()) {
  const orders = state.orders.filter((o) => o.status !== "Draft" && inRange(o.orderDate, filter));
  const received = orders.length;
  const fully = orders.filter((o) => o.status === "Fully Supplied" || o.status === "Delivered").length;
  const partial = orders.filter((o) => o.status === "Partially Supplied").length;
  const awaiting = orders.filter((o) => o.status === "Awaiting Stock" || o.status === "Ready for Supply").length;
  const overdue = getOutstandingRows(state, asOf).filter((r) => r.ageingBand === "Overdue" && inRange(r.orderDate, filter)).length;

  const durations: number[] = [];
  for (const o of orders) {
    if (o.status !== "Fully Supplied" && o.status !== "Delivered") continue;
    const start = o.confirmedAt ?? o.orderDate;
    const lastSupply = state.supplies
      .filter((s) => s.orderId === o.id)
      .sort((a, b) => b.suppliedAt.localeCompare(a.suppliedAt))[0];
    const end = lastSupply?.suppliedAt ?? o.updatedAt;
    durations.push(daysBetween(start, end));
  }
  const avgTimeDays =
    durations.length === 0 ? 0 : Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10;

  return {
    summary: {
      received,
      fullySupplied: fully,
      partiallySupplied: partial,
      awaitingStock: awaiting,
      avgFulfilmentDays: avgTimeDays,
      overdueLines: overdue,
    },
    rows: orders.map((o) => {
      const customer = state.customers.find((c) => c.id === o.customerId);
      return {
        orderNumber: o.number,
        customerName: customer?.name ?? "",
        status: o.status,
        fulfilmentPercent: fulfilmentPercent(state.orderLines.filter((l) => l.orderId === o.id)),
        orderDate: o.orderDate.slice(0, 10),
        ageDays: daysBetween(o.confirmedAt ?? o.orderDate, asOf),
      };
    }),
  };
}

export function customerOutstandingReport(state: TlbState, filter: DateFilter = {}) {
  const map = new Map<
    string,
    { customerCode: string; customerName: string; lines: number; qty: number; value: number }
  >();
  for (const row of getOutstandingRows(state).filter((r) => inRange(r.orderDate, filter))) {
    const cust = state.customers.find((c) => c.id === row.customerId);
    const cur = map.get(row.customerId) ?? {
      customerCode: cust?.code ?? "",
      customerName: row.customerName,
      lines: 0,
      qty: 0,
      value: 0,
    };
    cur.lines += 1;
    cur.qty += row.outstandingQty;
    cur.value += row.outstandingQty * row.unitPrice;
    map.set(row.customerId, cur);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

export function inventoryBalanceReport(state: TlbState) {
  return state.stock.map((s) => {
    const product = state.products.find((p) => p.id === s.productId);
    const warehouse = state.warehouses.find((w) => w.id === s.warehouseId);
    const cost = product?.standardCost ?? 0;
    const available = Math.max(
      0,
      s.physicalQty - s.reservedQty - (s.damagedQty ?? 0) - (s.expiredQty ?? 0) - (s.quarantineQty ?? 0),
    );
    return {
      sku: product?.sku ?? "",
      productName: product?.name ?? "",
      warehouse: warehouse?.name ?? "",
      physicalQty: s.physicalQty,
      reservedQty: s.reservedQty,
      availableQty: available,
      damagedQty: s.damagedQty ?? 0,
      quarantineQty: s.quarantineQty ?? 0,
      unitCost: cost,
      valuation: Math.round(s.physicalQty * cost * 100) / 100,
    };
  });
}

export function grnIssueReport(state: TlbState, filter: DateFilter = {}) {
  const grns = state.goodsReceipts
    .filter((g) => inRange(g.receivedAt, filter))
    .map((g) => {
      const supplier = state.suppliers.find((s) => s.id === g.supplierId);
      return {
        type: "GRN",
        number: g.number,
        party: supplier?.name ?? "",
        source: g.nonPo ? "Non-PO" : "PO",
        warehouse: state.warehouses.find((w) => w.id === g.warehouseId)?.name ?? "",
        qty: state.goodsReceiptLines.filter((l) => l.grnId === g.id).reduce((s, l) => s + l.acceptedQty, 0),
        date: g.receivedAt.slice(0, 10),
        status: g.status,
      };
    });
  const issues = state.stockIssues
    .filter((i) => inRange(i.issuedAt, filter))
    .map((i) => ({
      type: "Issue",
      number: i.number,
      party: i.reason,
      source: i.orderId ? "Order" : "Internal",
      warehouse: state.warehouses.find((w) => w.id === i.warehouseId)?.name ?? "",
      qty: state.stockIssueLines.filter((l) => l.issueId === i.id).reduce((s, l) => s + l.quantity, 0),
      date: i.issuedAt.slice(0, 10),
      status: "Posted",
    }));
  return [...grns, ...issues].sort((a, b) => b.date.localeCompare(a.date));
}

export function movementsReport(state: TlbState, filter: DateFilter = {}) {
  return state.stockMovements
    .filter((m) => inRange(m.at, filter))
    .map((m) => {
      const product = state.products.find((p) => p.id === m.productId);
      const warehouse = state.warehouses.find((w) => w.id === m.warehouseId);
      return {
        number: m.number,
        type: m.type,
        sku: product?.sku ?? "",
        warehouse: warehouse?.name ?? "",
        qtyMove: m.qtyMove,
        signedQty: m.signedQty,
        refNumber: m.refNumber ?? "",
        actor: m.actor,
        date: m.at.slice(0, 10),
      };
    });
}

export function stockAgeingCsvReport(state: TlbState) {
  return stockAgeingReport(state).map((r) => ({
    batchCode: r.batchCode,
    sku: r.productSku,
    productName: r.productName,
    warehouse: r.warehouseName,
    remainingQty: r.remainingQty,
    value: r.value,
    ageDays: r.ageDays,
    band: r.band,
    receivedAt: r.receivedAt,
  }));
}

export function lowExpiryDamagedReport(state: TlbState) {
  const low = listLowStock(state).map((r) => ({
    kind: "Low stock",
    ref: r.sku,
    detail: r.name,
    qty: r.available,
    note: `Reorder ${r.reorderPoint}`,
  }));
  const exp = listExpiryAlerts(state).map((r) => ({
    kind: r.band === "expired" ? "Expired" : "Expiring",
    ref: r.batch.code,
    detail: r.productSku,
    qty: r.batch.remainingQty,
    note: r.band,
  }));
  const damaged = state.stock
    .filter((s) => (s.damagedQty ?? 0) > 0)
    .map((s) => {
      const p = state.products.find((x) => x.id === s.productId);
      return {
        kind: "Damaged",
        ref: p?.sku ?? s.productId,
        detail: p?.name ?? "",
        qty: s.damagedQty ?? 0,
        note: state.warehouses.find((w) => w.id === s.warehouseId)?.name ?? "",
      };
    });
  return [...low, ...exp, ...damaged];
}

export function purchaseOrdersReport(state: TlbState, filter: DateFilter = {}) {
  return state.supplierPurchaseOrders
    .filter((p) => inRange(p.orderDate, filter))
    .map((p) => ({
      number: p.number,
      supplier: state.suppliers.find((s) => s.id === p.supplierId)?.name ?? "",
      status: p.status,
      total: p.total,
      orderDate: p.orderDate.slice(0, 10),
      expectedDate: p.expectedDate?.slice(0, 10) ?? "",
    }));
}

export function nonPoReport(state: TlbState, filter: DateFilter = {}) {
  return (state.nonPoPurchases ?? [])
    .filter((n) => !isSoftDeleted(n) && inRange(n.requestedAt, filter))
    .map((n) => {
      const lines = (state.nonPoPurchaseLines ?? []).filter((l) => l.nonPoId === n.id);
      return {
        number: n.number,
        supplier: state.suppliers.find((s) => s.id === n.supplierId)?.name ?? "",
        status: n.status,
        reason: n.reason,
        lineCount: lines.length,
        value: lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
        requestedAt: n.requestedAt.slice(0, 10),
        grn: n.grnId ? state.goodsReceipts.find((g) => g.id === n.grnId)?.number ?? n.grnId : "",
      };
    });
}

export function customerOrdersReport(state: TlbState, filter: DateFilter = {}) {
  return state.orders
    .filter((o) => !isSoftDeleted(o) && inRange(o.orderDate, filter))
    .map((o) => ({
      number: o.number,
      customer: state.customers.find((c) => c.id === o.customerId)?.name ?? "",
      status: o.status,
      source: o.orderSource ?? "Customer PO",
      orderDate: o.orderDate.slice(0, 10),
      requiredDate: o.requiredDate?.slice(0, 10) ?? "",
    }));
}

export function transfersReport(state: TlbState, filter: DateFilter = {}) {
  return state.transfers
    .filter((t) => inRange(t.requestedAt, filter))
    .map((t) => ({
      number: t.number,
      from: state.warehouses.find((w) => w.id === t.fromWarehouseId)?.name ?? "",
      to: state.warehouses.find((w) => w.id === t.toWarehouseId)?.name ?? "",
      status: t.status,
      requestedAt: t.requestedAt.slice(0, 10),
      requestedBy: t.requestedBy,
    }));
}

export function arApReport(state: TlbState) {
  const ar = accountsReceivable(state).map((r) => ({
    side: "AR",
    docNumber: r.docNumber,
    party: r.partyName,
    balance: r.balance,
    ageDays: r.ageDays,
    bucket: r.bucket,
  }));
  const ap = accountsPayable(state).map((r) => ({
    side: "AP",
    docNumber: r.docNumber,
    party: r.partyName,
    balance: r.balance,
    ageDays: r.ageDays,
    bucket: r.bucket,
  }));
  return [...ar, ...ap];
}

export function creditUtilisationReport(state: TlbState) {
  return customerPerformanceReport(state).map((r) => ({
    customer: r.customerName,
    creditLimit: r.creditLimit,
    outstandingBalance: r.outstandingBalance,
    utilisationPct: r.creditUtilisationPct,
    avgDaysToPay: r.avgDaysToPay ?? "",
  }));
}

export function returnsReport(state: TlbState, filter: DateFilter = {}) {
  const cust = (state.customerReturns ?? [])
    .filter((r) => !isSoftDeleted(r) && inRange(r.receivedAt, filter))
    .map((r) => ({
      type: "Customer",
      number: r.number,
      party: state.customers.find((c) => c.id === r.customerId)?.name ?? "",
      product: state.products.find((p) => p.id === r.productId)?.sku ?? "",
      qty: r.quantity,
      disposition: r.disposition,
      status: r.status,
      date: r.receivedAt.slice(0, 10),
    }));
  const sup = (state.supplierReturns ?? [])
    .filter((r) => !isSoftDeleted(r) && inRange(r.requestedAt, filter))
    .map((r) => ({
      type: "Supplier",
      number: r.number,
      party: state.suppliers.find((s) => s.id === r.supplierId)?.name ?? "",
      product: state.products.find((p) => p.id === r.productId)?.sku ?? "",
      qty: r.quantity,
      disposition: r.replacementExpected ? "replacement" : "credit",
      status: r.status,
      date: r.requestedAt.slice(0, 10),
    }));
  return [...cust, ...sup];
}

export function importsExportsReport(state: TlbState, filter: DateFilter = {}) {
  const imports = (state.importShipments ?? [])
    .filter((s) => !isSoftDeleted(s) && inRange(s.orderedAt, filter))
    .map((s) => ({
      type: "Import",
      number: s.number,
      party: state.suppliers.find((x) => x.id === s.supplierId)?.name ?? "",
      route: s.originCountry,
      status: s.status,
      container: s.containerRef ?? "",
      date: s.orderedAt.slice(0, 10),
    }));
  const exports = (state.exportShipments ?? [])
    .filter((s) => !isSoftDeleted(s) && inRange(s.createdAt, filter))
    .map((s) => ({
      type: "Export",
      number: s.number,
      party: state.customers.find((x) => x.id === s.customerId)?.name ?? "",
      route: s.destinationCountry,
      status: s.status,
      container: s.carrier ?? "",
      date: s.createdAt.slice(0, 10),
    }));
  return [...imports, ...exports];
}

export function auditActivityReport(state: TlbState, filter: DateFilter = {}) {
  return state.audit
    .filter((a) => inRange(a.at, filter))
    .slice(0, 500)
    .map((a) => ({
      at: a.at.slice(0, 19).replace("T", " "),
      actor: a.actor,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      summary: a.summary,
    }));
}

export function velocityReport(state: TlbState) {
  return stockVelocityReport(state).map((r) => ({
    sku: r.productSku,
    productName: r.productName,
    category: r.category,
    onHand: r.onHand,
    outbound30d: r.outbound30d,
    daysOfCover: r.daysOfCover ?? "",
    velocity: r.velocity,
  }));
}

export function profitabilityPack(state: TlbState, filter: DateFilter = {}) {
  return {
    byProduct: productProfitability(state, filter),
    byCustomer: customerProfitability(state, filter),
    byCategory: categoryProfitability(state, filter),
  };
}

export function supplierPerfCsv(state: TlbState) {
  return supplierPerformanceReport(state).map((r) => ({
    supplier: r.supplierName,
    purchaseValue: r.purchaseValue,
    poCount: r.poCount,
    onTimePct: r.onTimePct,
    rejectedQty: r.rejectedQty,
  }));
}

export function customerPerfCsv(state: TlbState) {
  return customerPerformanceReport(state).map((r) => ({
    customer: r.customerName,
    revenue: r.revenue,
    outstandingBalance: r.outstandingBalance,
    utilisationPct: r.creditUtilisationPct,
    avgDaysToPay: r.avgDaysToPay ?? "",
    paymentsCount: r.paymentsCount,
  }));
}

export function toCsv(rows: Array<Record<string, string | number>>): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]!);
  const escape = (v: string | number) => {
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => escape(r[k] ?? "")).join(","))].join("\n");
}

export type DeepReportTab =
  | "outstanding"
  | "partial"
  | "performance"
  | "customer"
  | "inventory"
  | "grn_issue"
  | "movements"
  | "ageing"
  | "alerts"
  | "pos"
  | "non_po"
  | "orders"
  | "transfers"
  | "arap"
  | "credit"
  | "returns"
  | "shipments"
  | "profit_product"
  | "profit_customer"
  | "velocity"
  | "supplier_perf"
  | "customer_perf"
  | "audit";

export function deepReportRows(
  state: TlbState,
  tab: DeepReportTab,
  filter: DateFilter = {},
): Array<Record<string, string | number>> {
  switch (tab) {
    case "outstanding":
      return outstandingOrdersReport(state, filter);
    case "partial":
      return partialSupplyReport(state, filter);
    case "performance":
      return fulfilmentPerformanceReport(state, filter).rows;
    case "customer":
      return customerOutstandingReport(state, filter);
    case "inventory":
      return inventoryBalanceReport(state);
    case "grn_issue":
      return grnIssueReport(state, filter);
    case "movements":
      return movementsReport(state, filter);
    case "ageing":
      return stockAgeingCsvReport(state);
    case "alerts":
      return lowExpiryDamagedReport(state);
    case "pos":
      return purchaseOrdersReport(state, filter);
    case "non_po":
      return nonPoReport(state, filter);
    case "orders":
      return customerOrdersReport(state, filter);
    case "transfers":
      return transfersReport(state, filter);
    case "arap":
      return arApReport(state);
    case "credit":
      return creditUtilisationReport(state);
    case "returns":
      return returnsReport(state, filter);
    case "shipments":
      return importsExportsReport(state, filter);
    case "profit_product":
      return productProfitability(state, filter).map((r) => ({
        label: r.label,
        revenue: r.revenue,
        cogs: r.cogs,
        grossProfit: r.grossProfit,
        marginPct: r.marginPct,
      }));
    case "profit_customer":
      return customerProfitability(state, filter).map((r) => ({
        label: r.label,
        revenue: r.revenue,
        cogs: r.cogs,
        grossProfit: r.grossProfit,
        marginPct: r.marginPct,
      }));
    case "velocity":
      return velocityReport(state);
    case "supplier_perf":
      return supplierPerfCsv(state);
    case "customer_perf":
      return customerPerfCsv(state);
    case "audit":
      return auditActivityReport(state, filter);
    default:
      return [];
  }
}
