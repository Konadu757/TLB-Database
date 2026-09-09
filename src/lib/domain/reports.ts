import { calcOutstanding, daysBetween, fulfilmentPercent } from "./calculations";
import { getOutstandingRows } from "../store/tlb-store";
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
