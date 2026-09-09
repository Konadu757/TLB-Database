/**
 * Stock ageing, velocity (fast/slow/dead), profitability, and party performance packs.
 */
import { daysBetween } from "./calculations";
import { isSoftDeleted } from "./trash";
import type {
  StockAgeBand,
  StockVelocityClass,
  TlbState,
} from "./types";

export function stockAgeBand(ageDays: number): StockAgeBand {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 90) return "31-90";
  if (ageDays <= 180) return "91-180";
  if (ageDays <= 365) return "181-365";
  return "365+";
}

export interface StockAgeingRow {
  batchId: string;
  batchCode: string;
  productId: string;
  productSku: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  remainingQty: number;
  unitCost: number;
  value: number;
  receivedAt: string;
  ageDays: number;
  band: StockAgeBand;
}

export function stockAgeingReport(state: TlbState, asOf = new Date().toISOString()): StockAgeingRow[] {
  return state.batches
    .filter((b) => b.remainingQty > 0 && b.status !== "Closed")
    .map((b) => {
      const product = state.products.find((p) => p.id === b.productId);
      const warehouse = state.warehouses.find((w) => w.id === b.warehouseId);
      const ageDays = daysBetween(b.receivedAt, asOf);
      return {
        batchId: b.id,
        batchCode: b.code,
        productId: b.productId,
        productSku: product?.sku ?? "",
        productName: product?.name ?? "",
        warehouseId: b.warehouseId,
        warehouseName: warehouse?.name ?? "",
        remainingQty: b.remainingQty,
        unitCost: b.unitCost,
        value: Math.round(b.remainingQty * b.unitCost * 100) / 100,
        receivedAt: b.receivedAt.slice(0, 10),
        ageDays,
        band: stockAgeBand(ageDays),
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays);
}

export interface StockVelocityRow {
  productId: string;
  productSku: string;
  productName: string;
  category: string;
  onHand: number;
  outbound30d: number;
  daysOfCover: number | null;
  velocity: StockVelocityClass;
}

/** Fast = outbound ≥ on-hand/15 in 30d; Dead = zero outbound & on-hand; Slow = else with stock. */
export function stockVelocityReport(state: TlbState, asOf = new Date().toISOString()): StockVelocityRow[] {
  const cutoff = new Date(asOf);
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const since = cutoff.toISOString();

  const outbound = new Map<string, number>();
  for (const m of state.stockMovements) {
    if (m.at < since) continue;
    if (m.signedQty >= 0) continue;
    outbound.set(m.productId, (outbound.get(m.productId) ?? 0) + Math.abs(m.signedQty));
  }

  const onHand = new Map<string, number>();
  for (const s of state.stock) {
    onHand.set(s.productId, (onHand.get(s.productId) ?? 0) + s.physicalQty);
  }

  return state.products
    .filter((p) => p.active && !isSoftDeleted(p))
    .map((p) => {
      const hand = onHand.get(p.id) ?? 0;
      const out = outbound.get(p.id) ?? 0;
      let velocity: StockVelocityClass = "Slow";
      if (hand > 0 && out === 0) velocity = "Dead";
      else if (out >= Math.max(1, hand / 15)) velocity = "Fast";
      else if (hand === 0 && out > 0) velocity = "Fast";
      const daysOfCover = out > 0 ? Math.round((hand / out) * 30) : hand > 0 ? null : 0;
      return {
        productId: p.id,
        productSku: p.sku,
        productName: p.name,
        category: p.category,
        onHand: hand,
        outbound30d: out,
        daysOfCover,
        velocity,
      };
    })
    .sort((a, b) => b.outbound30d - a.outbound30d);
}

export interface ProfitabilityRow {
  key: string;
  label: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
}

function margin(revenue: number, cogs: number): ProfitabilityRow["marginPct"] {
  if (revenue <= 0) return 0;
  return Math.round(((revenue - cogs) / revenue) * 1000) / 10;
}

export function productProfitability(
  state: TlbState,
  filter: { from?: string; to?: string } = {},
): ProfitabilityRow[] {
  const map = new Map<string, { label: string; revenue: number; cogs: number }>();
  for (const inv of state.invoices) {
    if (inv.paymentStatus === "Void") continue;
    const d = inv.invoiceDate.slice(0, 10);
    if (filter.from && d < filter.from) continue;
    if (filter.to && d > filter.to) continue;
    for (const line of state.invoiceLines.filter((l) => l.invoiceId === inv.id)) {
      const product = state.products.find((p) => p.id === line.productId);
      const cost = product?.standardCost ?? 0;
      const cur = map.get(line.productId) ?? {
        label: product ? `${product.sku} · ${product.name}` : line.productId,
        revenue: 0,
        cogs: 0,
      };
      cur.revenue += line.lineSubtotal;
      cur.cogs += cost * line.quantity;
      map.set(line.productId, cur);
    }
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      revenue: Math.round(v.revenue * 100) / 100,
      cogs: Math.round(v.cogs * 100) / 100,
      grossProfit: Math.round((v.revenue - v.cogs) * 100) / 100,
      marginPct: margin(v.revenue, v.cogs),
    }))
    .sort((a, b) => b.grossProfit - a.grossProfit);
}

export function customerProfitability(
  state: TlbState,
  filter: { from?: string; to?: string } = {},
): ProfitabilityRow[] {
  const map = new Map<string, { label: string; revenue: number; cogs: number }>();
  for (const inv of state.invoices) {
    if (inv.paymentStatus === "Void") continue;
    const d = inv.invoiceDate.slice(0, 10);
    if (filter.from && d < filter.from) continue;
    if (filter.to && d > filter.to) continue;
    const customer = state.customers.find((c) => c.id === inv.customerId);
    const cur = map.get(inv.customerId) ?? {
      label: customer?.name ?? inv.customerId,
      revenue: 0,
      cogs: 0,
    };
    for (const line of state.invoiceLines.filter((l) => l.invoiceId === inv.id)) {
      const product = state.products.find((p) => p.id === line.productId);
      cur.revenue += line.lineSubtotal;
      cur.cogs += (product?.standardCost ?? 0) * line.quantity;
    }
    map.set(inv.customerId, cur);
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      revenue: Math.round(v.revenue * 100) / 100,
      cogs: Math.round(v.cogs * 100) / 100,
      grossProfit: Math.round((v.revenue - v.cogs) * 100) / 100,
      marginPct: margin(v.revenue, v.cogs),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function categoryProfitability(
  state: TlbState,
  filter: { from?: string; to?: string } = {},
): ProfitabilityRow[] {
  const map = new Map<string, { revenue: number; cogs: number }>();
  for (const inv of state.invoices) {
    if (inv.paymentStatus === "Void") continue;
    const d = inv.invoiceDate.slice(0, 10);
    if (filter.from && d < filter.from) continue;
    if (filter.to && d > filter.to) continue;
    for (const line of state.invoiceLines.filter((l) => l.invoiceId === inv.id)) {
      const product = state.products.find((p) => p.id === line.productId);
      const cat = product?.category ?? "Other";
      const cur = map.get(cat) ?? { revenue: 0, cogs: 0 };
      cur.revenue += line.lineSubtotal;
      cur.cogs += (product?.standardCost ?? 0) * line.quantity;
      map.set(cat, cur);
    }
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      label: key,
      revenue: Math.round(v.revenue * 100) / 100,
      cogs: Math.round(v.cogs * 100) / 100,
      grossProfit: Math.round((v.revenue - v.cogs) * 100) / 100,
      marginPct: margin(v.revenue, v.cogs),
    }))
    .sort((a, b) => b.grossProfit - a.grossProfit);
}

export interface SupplierPerformanceRow {
  supplierId: string;
  supplierName: string;
  purchaseValue: number;
  poCount: number;
  onTimeReceipts: number;
  lateReceipts: number;
  rejectedQty: number;
  onTimePct: number;
}

export function supplierPerformanceReport(state: TlbState): SupplierPerformanceRow[] {
  return state.suppliers
    .filter((s) => !isSoftDeleted(s))
    .map((s) => {
      const pos = state.supplierPurchaseOrders.filter((p) => p.supplierId === s.id);
      const purchaseValue = pos.reduce((sum, p) => sum + p.total, 0);
      const grns = state.goodsReceipts.filter((g) => g.supplierId === s.id);
      let onTime = 0;
      let late = 0;
      for (const g of grns) {
        const po = g.purchaseOrderId
          ? state.supplierPurchaseOrders.find((p) => p.id === g.purchaseOrderId)
          : undefined;
        if (!po?.expectedDate) {
          onTime += 1;
          continue;
        }
        if (g.receivedAt.slice(0, 10) <= po.expectedDate.slice(0, 10)) onTime += 1;
        else late += 1;
      }
      const rejectedQty = state.goodsReceiptLines
        .filter((l) => grns.some((g) => g.id === l.grnId))
        .reduce((sum, l) => sum + l.rejectedQty + l.damagedQty, 0);
      const total = onTime + late;
      return {
        supplierId: s.id,
        supplierName: s.name,
        purchaseValue,
        poCount: pos.length,
        onTimeReceipts: onTime,
        lateReceipts: late,
        rejectedQty,
        onTimePct: total === 0 ? 100 : Math.round((onTime / total) * 1000) / 10,
      };
    })
    .sort((a, b) => b.purchaseValue - a.purchaseValue);
}

export interface CustomerPerformanceRow {
  customerId: string;
  customerName: string;
  revenue: number;
  outstandingBalance: number;
  paymentsCount: number;
  avgDaysToPay: number | null;
  creditLimit: number;
  creditUtilisationPct: number;
}

export function customerPerformanceReport(state: TlbState, asOf = new Date().toISOString()): CustomerPerformanceRow[] {
  return state.customers
    .filter((c) => !isSoftDeleted(c))
    .map((c) => {
      const invoices = state.invoices.filter((i) => i.customerId === c.id && i.paymentStatus !== "Void");
      const revenue = invoices.reduce((s, i) => s + i.total, 0);
      const outstandingBalance = invoices.reduce((s, i) => s + Math.max(0, i.total - i.amountPaid), 0);
      const payments = state.payments.filter((p) => p.customerId === c.id);
      const payLags: number[] = [];
      for (const p of payments) {
        const inv = p.invoiceId ? invoices.find((i) => i.id === p.invoiceId) : undefined;
        if (inv) payLags.push(daysBetween(inv.invoiceDate, p.paymentDate));
      }
      const avgDaysToPay =
        payLags.length === 0 ? null : Math.round((payLags.reduce((a, b) => a + b, 0) / payLags.length) * 10) / 10;
      const creditUtilisationPct =
        c.creditLimit <= 0 ? 0 : Math.round((outstandingBalance / c.creditLimit) * 1000) / 10;
      void asOf;
      return {
        customerId: c.id,
        customerName: c.name,
        revenue: Math.round(revenue * 100) / 100,
        outstandingBalance: Math.round(outstandingBalance * 100) / 100,
        paymentsCount: payments.length,
        avgDaysToPay,
        creditLimit: c.creditLimit,
        creditUtilisationPct,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}
