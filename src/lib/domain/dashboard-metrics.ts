import { calcAvailable, statusTone } from "./calculations";
import {
  DEMO_AS_OF,
  type DashboardPeriod,
  type DashboardRangeSelection,
  type DateRange,
  getPeriodRange,
  isoInRange,
  parseDateKey,
  previousComparableRange,
  rangeDayCount,
  resolveSelectionRange,
  selectionLabel,
  toDateKey,
  toRangeSelection,
} from "./period-range";
import type { TlbState } from "./types";
import { getOutstandingRows, orderValue, formatMoney } from "../store/tlb-store";

export type MetricTrend = "up" | "down" | "neutral";

export interface DashboardMetric {
  label: string;
  value: string;
  note: string;
  trend: MetricTrend;
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface DashboardOrderRow {
  id: string;
  number: string;
  customer: string;
  value: string;
  status: string;
  tone: string;
  orderDate: string;
}

export interface StockSlice {
  label: string;
  value: string;
  width: string;
  tone: string;
}

export interface OpsRow {
  title: string;
  detail: string;
  progress: number;
  caption: string;
  date: string;
  kind: "import" | "production";
}

export interface ReceivableBucket {
  label: string;
  amount: number;
  className: "current" | "due" | "overdue" | "critical";
}

export interface CollectionEvent {
  id: string;
  date: string;
  amount: number;
  source: "payment" | "receipt";
  orderId?: string;
  label: string;
}

export interface DashboardSnapshot {
  range: DateRange;
  selection: DashboardRangeSelection;
  period: DashboardPeriod | "Previous Month" | "Custom";
  metrics: DashboardMetric[];
  /** Collected sales for the selected period (receipts/payments dated in range). */
  salesTotal: number;
  salesTotalLabel: string;
  salesDeltaLabel: string;
  salesDeltaTone: "success" | "warning" | "info";
  salesBasisLabel: string;
  collectionCount: number;
  chart: ChartPoint[];
  chartAxisMax: number;
  recentOrders: DashboardOrderRow[];
  inventoryValue: number;
  inventoryValueLabel: string;
  stockItemCount: number;
  stockSlices: StockSlice[];
  lowStock: number;
  outOfStock: number;
  outstandingRows: ReturnType<typeof getOutstandingRows>;
  outstandingOverdue: number;
  alerts: { title: string; detail: string; type: string; date: string }[];
  opsRows: OpsRow[];
  receivablesTotal: number;
  receivablesLabel: string;
  receivableBuckets: ReceivableBucket[];
  periodLabel: string;
}

/** Fallback unit costs when no order line price exists for a product. */
const FALLBACK_UNIT_COST: Record<string, number> = {
  "prod-chem-a": 1850,
  "prod-chem-b": 920,
  "prod-hcl": 640,
  "prod-eth": 1250,
};

/** Sandbox ops events with dates so period filtering is visible. */
const OPS_EVENTS: OpsRow[] = [
  {
    title: "IMP-26017 · Ningbo → Tema",
    detail: "Sodium Hydroxide · 1 container",
    progress: 68,
    caption: "At port · clearing",
    date: "2026-09-08",
    kind: "import",
  },
  {
    title: "IMP-26012 · Shanghai → Tema",
    detail: "Ethanol feedstock · 2 containers",
    progress: 42,
    caption: "On water",
    date: "2026-08-14",
    kind: "import",
  },
  {
    title: "IMP-26004 · Rotterdam → Tema",
    detail: "Acid drums · 1 container",
    progress: 100,
    caption: "Cleared Q1",
    date: "2026-03-18",
    kind: "import",
  },
  {
    title: "PO-26042 · Hydrogen Peroxide",
    detail: "Batch HP-26009 · 1,200 L target",
    progress: 46,
    caption: "Mixing · 46%",
    date: "2026-09-09",
    kind: "production",
  },
  {
    title: "PO-26039 · HCl dilution",
    detail: "Batch HCL-26022 · queued",
    progress: 12,
    caption: "Queued",
    date: "2026-09-02",
    kind: "production",
  },
  {
    title: "PO-26021 · Ethanol blend",
    detail: "Batch ETH-26011 · complete",
    progress: 100,
    caption: "Released",
    date: "2026-07-22",
    kind: "production",
  },
  {
    title: "PO-26008 · Solvent pack",
    detail: "Batch SOL-26003 · archived",
    progress: 100,
    caption: "Closed",
    date: "2026-02-11",
    kind: "production",
  },
];

const ALERT_EVENTS = [
  {
    title: "Sodium Hydroxide below reorder level",
    detail: "Main Warehouse · 180 kg remaining",
    type: "danger",
    date: "2026-09-09",
  },
  {
    title: "Batch ETH-26018 expires in 42 days",
    detail: "Ethanol 96% · 24 drums",
    type: "warning",
    date: "2026-09-02",
  },
  {
    title: "QC release required",
    detail: "Production batch HP-26009",
    type: "info",
    date: "2026-09-09",
  },
  {
    title: "Import clearance overdue",
    detail: "IMP-26012 · Shanghai · Ethanol",
    type: "warning",
    date: "2026-08-20",
  },
  {
    title: "Q1 customs bond review",
    detail: "IMP-26004 bond file archived",
    type: "info",
    date: "2026-03-22",
  },
];

function formatCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `GH₵ ${(amount / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `GH₵ ${(amount / 1_000).toFixed(1)}K`;
  return formatMoney(amount);
}

function productUnitCost(state: TlbState, productId: string): number {
  const fromLine = state.orderLines.find((l) => l.productId === productId);
  if (fromLine) return fromLine.unitPrice;
  return FALLBACK_UNIT_COST[productId] ?? 0;
}

function warehouseIdForName(state: TlbState, warehouse: string): string | null {
  if (!warehouse || warehouse === "All warehouses") return null;
  return state.warehouses.find((w) => w.name === warehouse)?.id ?? null;
}

function orderMatchesWarehouse(
  state: TlbState,
  orderId: string | undefined,
  warehouseId: string | null,
): boolean {
  if (!warehouseId) return true;
  if (!orderId) return true;
  return state.orderLines.some((l) => l.orderId === orderId && l.warehouseId === warehouseId);
}

function filterOrders(state: TlbState, range: DateRange, warehouseId: string | null) {
  return state.orders.filter((o) => {
    if (!isoInRange(o.orderDate, range)) return false;
    if (!warehouseId) return true;
    return state.orderLines.some((l) => l.orderId === o.id && l.warehouseId === warehouseId);
  });
}

/**
 * Collected sales events for a period.
 * - Payments by `paymentDate` (cash actually received)
 * - Receipts by `receiptDate` using `amountPaid`, excluding receipts already covered by a linked payment
 */
export function listCollections(
  state: TlbState,
  range: DateRange,
  warehouseId: string | null = null,
): CollectionEvent[] {
  const coveredReceiptIds = new Set(
    state.payments.map((p) => p.receiptId).filter((id): id is string => Boolean(id)),
  );
  const events: CollectionEvent[] = [];

  for (const p of state.payments) {
    if (!isoInRange(p.paymentDate, range)) continue;
    if (!orderMatchesWarehouse(state, p.orderId, warehouseId)) continue;
    events.push({
      id: p.id,
      date: p.paymentDate.slice(0, 10),
      amount: p.amount,
      source: "payment",
      orderId: p.orderId,
      label: p.number,
    });
  }

  for (const r of state.receipts) {
    if (r.amountPaid <= 0) continue;
    if (coveredReceiptIds.has(r.id)) continue;
    if (!isoInRange(r.receiptDate, range)) continue;
    if (!orderMatchesWarehouse(state, r.orderId, warehouseId)) continue;
    events.push({
      id: r.id,
      date: r.receiptDate.slice(0, 10),
      amount: r.amountPaid,
      source: "receipt",
      orderId: r.orderId,
      label: r.number,
    });
  }

  return events;
}

export function collectionsTotal(
  state: TlbState,
  range: DateRange,
  warehouseId: string | null = null,
): number {
  return listCollections(state, range, warehouseId).reduce((sum, e) => sum + e.amount, 0);
}

function previousRangeForSelection(
  selection: DashboardRangeSelection,
  range: DateRange,
  asOf: string,
): DateRange {
  if (selection.mode === "preset") {
    const d = new Date(asOf);
    switch (selection.period) {
      case "Today": {
        d.setDate(d.getDate() - 1);
        const key = toDateKey(d);
        return { from: key, to: key };
      }
      case "This Week": {
        d.setDate(d.getDate() - 7);
        return getPeriodRange("This Week", d);
      }
      case "This Month": {
        d.setMonth(d.getMonth() - 1);
        return getPeriodRange("This Month", d);
      }
      case "This Quarter": {
        d.setMonth(d.getMonth() - 3);
        return getPeriodRange("This Quarter", d);
      }
      case "This Year": {
        d.setFullYear(d.getFullYear() - 1);
        return getPeriodRange("This Year", d);
      }
    }
  }
  if (selection.mode === "previousMonth") {
    const d = new Date(asOf);
    d.setMonth(d.getMonth() - 2);
    return getPeriodRange("This Month", d);
  }
  return previousComparableRange(range);
}

type ChartGranularity = "day" | "weekdays" | "monthWeeks" | "months";

function chartGranularity(selection: DashboardRangeSelection, range: DateRange): ChartGranularity {
  if (selection.mode === "preset") {
    switch (selection.period) {
      case "Today":
        return "day";
      case "This Week":
        return "weekdays";
      case "This Month":
        return "monthWeeks";
      case "This Quarter":
      case "This Year":
        return "months";
    }
  }
  const days = rangeDayCount(range);
  if (days <= 1) return "day";
  if (days <= 7) return "weekdays";
  if (days <= 40) return "monthWeeks";
  return "months";
}

function buildCollectionsChart(
  events: CollectionEvent[],
  selection: DashboardRangeSelection,
  range: DateRange,
  asOf: string,
): ChartPoint[] {
  const valueByKey = new Map<string, number>();
  const bump = (key: string, amount: number) => {
    valueByKey.set(key, (valueByKey.get(key) ?? 0) + amount);
  };
  const granularity = chartGranularity(selection, range);
  const monthLabels = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  for (const e of events) {
    const d = parseDateKey(e.date);
    if (granularity === "day") bump("Collected", e.amount);
    else if (granularity === "weekdays") {
      const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      bump(labels[(d.getDay() + 6) % 7]!, e.amount);
    } else if (granularity === "monthWeeks") {
      const weekNum = Math.min(4, Math.floor((d.getDate() - 1) / 7));
      bump(`W${weekNum + 1}`, e.amount);
    } else {
      bump(monthLabels[d.getMonth()]!, e.amount);
    }
  }

  if (granularity === "day")
    return [{ label: "Collected", value: valueByKey.get("Collected") ?? 0 }];
  if (granularity === "weekdays") {
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => ({
      label,
      value: valueByKey.get(label) ?? 0,
    }));
  }
  if (granularity === "monthWeeks") {
    return ["W1", "W2", "W3", "W4", "W5"].map((label) => ({
      label,
      value: valueByKey.get(label) ?? 0,
    }));
  }

  if (selection.mode === "preset" && selection.period === "This Quarter") {
    const start = parseDateKey(range.from);
    const months = [start.getMonth(), start.getMonth() + 1, start.getMonth() + 2].map(
      (m) => monthLabels[m]!,
    );
    return months.map((label) => ({ label, value: valueByKey.get(label) ?? 0 }));
  }

  if (selection.mode === "preset" && selection.period === "This Year") {
    const asOfMonth = new Date(asOf).getMonth();
    return monthLabels
      .slice(0, asOfMonth + 1)
      .map((label) => ({ label, value: valueByKey.get(label) ?? 0 }));
  }

  const startM = parseDateKey(range.from).getMonth();
  const endM = parseDateKey(range.to).getMonth();
  const startY = parseDateKey(range.from).getFullYear();
  const endY = parseDateKey(range.to).getFullYear();
  if (startY === endY) {
    return monthLabels
      .slice(startM, endM + 1)
      .map((label) => ({ label, value: valueByKey.get(label) ?? 0 }));
  }
  return monthLabels.map((label) => ({ label, value: valueByKey.get(label) ?? 0 }));
}

function salesLabelForSelection(selection: DashboardRangeSelection): string {
  if (selection.mode === "previousMonth") return "Prev. month collected";
  if (selection.mode === "custom") return "Collected sales";
  switch (selection.period) {
    case "Today":
      return "Today's collections";
    case "This Week":
      return "Weekly collections";
    case "This Month":
      return "Monthly collections";
    case "This Quarter":
      return "Quarterly collections";
    case "This Year":
      return "Yearly collections";
  }
}

function periodField(selection: DashboardRangeSelection): DashboardSnapshot["period"] {
  if (selection.mode === "previousMonth") return "Previous Month";
  if (selection.mode === "custom") return "Custom";
  return selection.period;
}

export function buildDashboardSnapshot(
  state: TlbState,
  periodOrSelection: DashboardPeriod | DashboardRangeSelection,
  warehouse = "All warehouses",
  asOf: string = DEMO_AS_OF,
): DashboardSnapshot {
  const selection = toRangeSelection(periodOrSelection);
  const range = resolveSelectionRange(selection, asOf);
  const warehouseId = warehouseIdForName(state, warehouse);
  const collectionEvents = listCollections(state, range, warehouseId);
  const salesTotal = collectionEvents.reduce((s, e) => s + e.amount, 0);
  const prevSales = collectionsTotal(
    state,
    previousRangeForSelection(selection, range, asOf),
    warehouseId,
  );
  const deltaPct =
    prevSales > 0 ? ((salesTotal - prevSales) / prevSales) * 100 : salesTotal > 0 ? 100 : 0;
  const deltaLabel =
    prevSales === 0 && salesTotal === 0
      ? "No prior-period collections"
      : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}% vs prior`;

  const ordersInRange = filterOrders(state, range, warehouseId);
  const activeOrders = ordersInRange.filter(
    (o) => o.status !== "Delivered" && o.status !== "Cancelled",
  );
  const awaiting = activeOrders.filter(
    (o) =>
      o.status === "Awaiting Stock" ||
      o.status === "Ready for Supply" ||
      o.status === "Partially Supplied",
  ).length;

  const stockRows = state.stock.filter((s) => !warehouseId || s.warehouseId === warehouseId);
  let physical = 0;
  let reserved = 0;
  let inventoryValue = 0;
  let lowStock = 0;
  let outOfStock = 0;
  for (const bal of stockRows) {
    physical += bal.physicalQty;
    reserved += bal.reservedQty;
    inventoryValue += bal.physicalQty * productUnitCost(state, bal.productId);
    const available = calcAvailable(bal);
    if (available <= 0) outOfStock += 1;
    else if (available < 10) lowStock += 1;
  }
  const available = Math.max(0, physical - reserved);
  const denom = physical > 0 ? physical : 1;
  const stockSlices: StockSlice[] = [
    {
      label: "Available",
      value: `${Math.round((available / denom) * 100)}%`,
      width: `${Math.round((available / denom) * 100)}%`,
      tone: "bg-primary",
    },
    {
      label: "Reserved",
      value: `${Math.round((reserved / denom) * 100)}%`,
      width: `${Math.round((reserved / denom) * 100)}%`,
      tone: "bg-info",
    },
  ];

  const outstandingAll = getOutstandingRows(state, asOf).filter((r) => {
    if (!isoInRange(r.orderDate, range)) return false;
    if (!warehouseId) return true;
    return r.warehouseId === warehouseId;
  });
  const receivablesTotal = outstandingAll.reduce((s, r) => s + r.outstandingQty * r.unitPrice, 0);
  const overdueValue = outstandingAll
    .filter((r) => r.ageingBand === "Overdue")
    .reduce((s, r) => s + r.outstandingQty * r.unitPrice, 0);

  const openInvoices = state.invoices.filter(
    (inv) => isoInRange(inv.invoiceDate, range) && inv.paymentStatus !== "Paid",
  );
  const invoiceOpen = openInvoices.reduce(
    (s, inv) => s + Math.max(0, inv.total - inv.amountPaid),
    0,
  );
  const receivablesCombined = receivablesTotal + invoiceOpen;

  const current = outstandingAll
    .filter((r) => r.ageDays <= 2)
    .reduce((s, r) => s + r.outstandingQty * r.unitPrice, 0);
  const due = outstandingAll
    .filter((r) => r.ageDays > 2 && r.ageDays <= 7)
    .reduce((s, r) => s + r.outstandingQty * r.unitPrice, 0);
  const overdueBand = outstandingAll
    .filter((r) => r.ageDays > 7 && r.ageDays <= 30)
    .reduce((s, r) => s + r.outstandingQty * r.unitPrice, 0);
  const critical = outstandingAll
    .filter((r) => r.ageDays > 30)
    .reduce((s, r) => s + r.outstandingQty * r.unitPrice, 0);

  const opsInRange = OPS_EVENTS.filter((e) => isoInRange(e.date, range));
  const imports = opsInRange.filter((e) => e.kind === "import");
  const production = opsInRange.filter((e) => e.kind === "production" && e.progress < 100);

  const chart = buildCollectionsChart(collectionEvents, selection, range, asOf);
  const chartMax = Math.max(...chart.map((c) => c.value), 1);

  const recentOrders: DashboardOrderRow[] = [...ordersInRange]
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate))
    .slice(0, 6)
    .map((o) => {
      const customer = state.customers.find((c) => c.id === o.customerId);
      return {
        id: o.id,
        number: o.number,
        customer: customer?.name ?? "—",
        value: formatMoney(orderValue(state, o.id)),
        status: o.status,
        tone: statusTone(o.status),
        orderDate: o.orderDate.slice(0, 10),
      };
    });

  const metrics: DashboardMetric[] = [
    {
      label: salesLabelForSelection(selection),
      value: formatCompact(salesTotal),
      note: deltaLabel,
      trend: deltaPct > 0 ? "up" : deltaPct < 0 ? "down" : "neutral",
    },
    {
      label: "Inventory",
      value: formatCompact(inventoryValue),
      note: warehouseId ? warehouse : `Across ${state.warehouses.length} warehouses`,
      trend: "neutral",
    },
    {
      label: "Receivables",
      value: formatCompact(receivablesCombined),
      note: overdueValue > 0 ? `${formatCompact(overdueValue)} overdue` : "No overdue lines",
      trend: overdueValue > 0 ? "down" : "neutral",
    },
    {
      label: "Active orders",
      value: String(activeOrders.length),
      note: `${awaiting} awaiting supply`,
      trend: activeOrders.length > 0 ? "up" : "neutral",
    },
    {
      label: "Active imports",
      value: String(imports.length),
      note: imports.length
        ? `${imports.filter((i) => i.progress < 100).length} in transit`
        : "None in period",
      trend: "neutral",
    },
    {
      label: "Production",
      value: String(production.length),
      note: production.length
        ? `${production.filter((p) => p.progress >= 40).length} on schedule`
        : "None in period",
      trend: "neutral",
    },
  ];

  return {
    range,
    selection,
    period: periodField(selection),
    metrics,
    salesTotal,
    salesTotalLabel: formatMoney(salesTotal),
    salesDeltaLabel: deltaLabel,
    salesDeltaTone: deltaPct >= 0 ? "success" : "warning",
    salesBasisLabel: "Collected sales (payments + receipts in period)",
    collectionCount: collectionEvents.length,
    chart,
    chartAxisMax: chartMax,
    recentOrders,
    inventoryValue,
    inventoryValueLabel: formatMoney(inventoryValue),
    stockItemCount: stockRows.reduce((s, b) => s + b.physicalQty, 0),
    stockSlices,
    lowStock,
    outOfStock,
    outstandingRows: outstandingAll,
    outstandingOverdue: outstandingAll.filter((r) => r.ageingBand === "Overdue").length,
    alerts: ALERT_EVENTS.filter((a) => isoInRange(a.date, range)),
    opsRows: opsInRange.slice(0, 2),
    receivablesTotal: receivablesCombined,
    receivablesLabel: formatMoney(receivablesCombined),
    receivableBuckets: [
      { label: "Current", amount: current, className: "current" },
      { label: "Attention", amount: due, className: "due" },
      { label: "Overdue", amount: overdueBand, className: "overdue" },
      { label: "Critical", amount: critical, className: "critical" },
    ],
    periodLabel: `${selectionLabel(selection)} · ${range.from} → ${range.to}`,
  };
}

/** Quick equality check helper for tests / verification. */
export function snapshotFingerprint(snap: DashboardSnapshot): string {
  return [
    snap.salesTotal,
    snap.collectionCount,
    snap.metrics.find((m) => m.label.toLowerCase().includes("collect"))?.value,
    snap.recentOrders.map((o) => o.number).join(","),
    snap.outstandingRows.length,
    snap.opsRows.map((o) => o.title).join("|"),
    snap.alerts.length,
  ].join("::");
}
