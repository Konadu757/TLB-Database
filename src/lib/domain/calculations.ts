import type {
  AgeingBand,
  AgeingSettings,
  CustomerOrderLine,
  CustomerOrderStatus,
  CustomerPurchaseOrder,
  LineStatus,
  StockBalance,
} from "./types";

/** outstanding = ordered - supplied - cancelled (never negative) */
export function calcOutstanding(line: Pick<CustomerOrderLine, "orderedQty" | "suppliedQty" | "cancelledQty">): number {
  return Math.max(0, line.orderedQty - line.suppliedQty - line.cancelledQty);
}

/** available = physical - reserved - unavailable buckets (never negative unless configured elsewhere) */
export function calcUnavailable(stock: Pick<StockBalance, "damagedQty" | "expiredQty" | "quarantineQty">): number {
  return (stock.damagedQty ?? 0) + (stock.expiredQty ?? 0) + (stock.quarantineQty ?? 0);
}

/** available = physical - reserved - unavailable (never negative) */
export function calcAvailable(stock: Pick<StockBalance, "physicalQty" | "reservedQty" | "damagedQty" | "expiredQty" | "quarantineQty">): number {
  return Math.max(0, stock.physicalQty - stock.reservedQty - calcUnavailable(stock));
}

export function validateSupplyQty(params: {
  supplyNow: number;
  outstanding: number;
  available: number;
}): string | null {
  const { supplyNow, outstanding, available } = params;
  if (!Number.isFinite(supplyNow) || supplyNow <= 0) return "Supply quantity must be greater than zero.";
  if (!Number.isInteger(supplyNow)) return "Supply quantity must be a whole number.";
  if (supplyNow > outstanding) return `Cannot supply ${supplyNow}; only ${outstanding} outstanding.`;
  if (supplyNow > available) return `Cannot supply ${supplyNow}; only ${available} available in warehouse.`;
  return null;
}

export function deriveLineStatus(line: CustomerOrderLine, availableForOutstanding: number): LineStatus {
  const outstanding = calcOutstanding(line);
  if (line.cancelledQty > 0 && outstanding === 0 && line.suppliedQty === 0) return "Cancelled";
  if (outstanding === 0 && line.suppliedQty > 0) return "Fully Supplied";
  if (line.suppliedQty > 0 && outstanding > 0) return "Partially Supplied";
  if (outstanding > 0 && availableForOutstanding < outstanding) return "Awaiting Stock";
  if (outstanding > 0 && availableForOutstanding >= outstanding) return "Ready";
  return "Open";
}

export function deriveOrderStatus(params: {
  current: CustomerOrderStatus;
  lines: CustomerOrderLine[];
  stockByKey: Map<string, StockBalance>;
}): CustomerOrderStatus {
  const { current, lines, stockByKey } = params;
  if (current === "Draft" || current === "Pending" || current === "Delivered") return current;
  if (current === "Cancelled") return "Cancelled";
  if (lines.length === 0) return current;

  const allCancelled = lines.every((l) => calcOutstanding(l) === 0 && l.suppliedQty === 0 && l.cancelledQty > 0);
  if (allCancelled) return "Cancelled";

  const anyOpen = lines.some((l) => calcOutstanding(l) > 0);
  const anySupplied = lines.some((l) => l.suppliedQty > 0);
  const allClosed = lines.every((l) => calcOutstanding(l) === 0);

  if (allClosed && anySupplied) return "Fully Supplied";
  if (!anyOpen) return current === "Confirmed" ? "Confirmed" : current;

  const openLines = lines.filter((l) => calcOutstanding(l) > 0);
  const allReady = openLines.every((l) => {
    const key = `${l.productId}::${l.warehouseId}`;
    const bal = stockByKey.get(key);
    const available = bal ? calcAvailable(bal) : 0;
    // reserved on this line counts toward covering this line's outstanding
    const covering = available + l.reservedQty;
    return covering >= calcOutstanding(l);
  });

  if (allReady) return "Ready for Supply";
  if (anySupplied) return "Partially Supplied";
  return "Awaiting Stock";
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export function ageingBand(ageDays: number, settings: AgeingSettings): AgeingBand {
  if (ageDays <= settings.normalMaxDays) return "Normal";
  if (ageDays <= settings.attentionMaxDays) return "Attention";
  return "Overdue";
}

export function fulfilmentPercent(lines: CustomerOrderLine[]): number {
  const ordered = lines.reduce((s, l) => s + l.orderedQty, 0);
  if (ordered <= 0) return 0;
  const supplied = lines.reduce((s, l) => s + l.suppliedQty, 0);
  return Math.min(100, Math.round((supplied / ordered) * 100));
}

export function statusTone(status: CustomerOrderStatus | LineStatus | AgeingBand | string): string {
  switch (status) {
    case "Draft":
      return "draft";
    case "Pending":
      return "pending";
    case "Confirmed":
    case "Ordered":
      return "confirmed";
    case "Awaiting Stock":
      return "awaiting";
    case "Partially Supplied":
    case "Partially received":
    case "Partial":
      return "partial";
    case "Ready for Supply":
    case "Ready":
      return "ready";
    case "Fully Supplied":
    case "Received":
      return "supplied";
    case "Delivered":
      return "delivered";
    case "Cancelled":
    case "Void":
      return "cancelled";
    case "Normal":
    case "Active":
    case "Paid":
    case "Preferred":
      return "success";
    case "Attention":
    case "Preparing":
    case "Dispatched":
    case "In transit":
      return "warning";
    case "Overdue":
    case "Failed":
    case "Returned":
    case "Unpaid":
      return "danger";
    case "Open":
    default:
      return "info";
  }
}

export function refreshLineStatuses(
  lines: CustomerOrderLine[],
  stockByKey: Map<string, StockBalance>,
): CustomerOrderLine[] {
  return lines.map((line) => {
    if (calcOutstanding(line) === 0 && line.suppliedQty === 0 && line.cancelledQty > 0) {
      return { ...line, lineStatus: "Cancelled" as const };
    }
    const key = `${line.productId}::${line.warehouseId}`;
    const bal = stockByKey.get(key);
    const available = bal ? calcAvailable(bal) : 0;
    const covering = available + line.reservedQty;
    return { ...line, lineStatus: deriveLineStatus(line, covering) };
  });
}

export function stockKey(productId: string, warehouseId: string): string {
  return `${productId}::${warehouseId}`;
}

export function buildStockMap(stock: StockBalance[]): Map<string, StockBalance> {
  return new Map(stock.map((s) => [stockKey(s.productId, s.warehouseId), s]));
}

export function orderNeedsAttention(order: CustomerPurchaseOrder): boolean {
  return (
    order.status === "Awaiting Stock" ||
    order.status === "Partially Supplied" ||
    order.status === "Ready for Supply"
  );
}
