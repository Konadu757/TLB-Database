/**
 * Operations Hub domain helpers — line calcs, availability, approval rules,
 * outstanding shortage vs delivery discrepancy (never merged).
 */
import { calcAvailable } from "./calculations";
import type {
  OpsActionItem,
  OpsApprovalRule,
  OpsDriverJobStatus,
  OpsRequest,
  OpsRequestLine,
  OpsRequestPriority,
  OpsRequestStatus,
  OpsRequestType,
  OpsWarehouseAvailability,
  TlbState,
} from "./types";

export function opsOutstandingShortage(line: OpsRequestLine): number {
  return Math.max(0, line.requestedQty - line.approvedQty - line.cancelledQty);
}

/** Delivery-side missing — separate from warehouse shortage outstanding. */
export function opsDiscrepancyMissing(line: OpsRequestLine): number {
  return Math.max(0, line.missingQty);
}

export function opsLineOpenRemainder(line: OpsRequestLine): number {
  return opsOutstandingShortage(line);
}

export function recomputeOpsLineDerived(line: OpsRequestLine): OpsRequestLine {
  return {
    ...line,
    missingQty: Math.max(0, line.missingQty),
    damagedQty: Math.max(0, line.damagedQty),
    wrongQty: Math.max(0, line.wrongQty),
    rejectedQty: Math.max(0, line.rejectedQty),
  };
}

export function deriveOpsRequestStatus(req: OpsRequest, lines: OpsRequestLine[]): OpsRequestStatus {
  if (
    req.status === "Cancelled" ||
    req.status === "Rejected" ||
    req.status === "Closed" ||
    req.status === "Draft"
  ) {
    return req.status;
  }
  const active = lines.filter((l) => l.cancelledQty < l.requestedQty);
  if (!active.length) return "Cancelled";

  if (req.status === "Delivered" || req.status === "Partially Delivered") {
    const anyPartial = active.some((l) => l.receivedQty > 0 && l.receivedQty < l.issuedQty);
    const allReceived = active.every((l) => l.issuedQty === 0 || l.receivedQty >= l.issuedQty);
    if (allReceived && !anyPartial) return "Delivered";
    if (active.some((l) => l.receivedQty > 0)) return "Partially Delivered";
  }

  if (
    ["In Transit", "Collected", "Issued", "Ready for Collection", "Preparing"].includes(req.status)
  ) {
    return req.status;
  }

  const allApproved = active.every((l) => l.approvedQty >= l.requestedQty - l.cancelledQty);
  const anyApproved = active.some((l) => l.approvedQty > 0);
  const noneApproved = active.every((l) => l.approvedQty === 0);

  if (
    req.status === "Pending Approval" ||
    req.status === "Partially Approved" ||
    req.status === "Approved"
  ) {
    if (allApproved) return "Approved";
    if (anyApproved) return "Partially Approved";
    if (noneApproved && req.status === "Pending Approval") return "Pending Approval";
  }

  return req.status;
}

export function defaultOpsApprovalRules(): OpsApprovalRule[] {
  return [
    {
      id: "rule-critical",
      name: "Critical priority",
      active: true,
      priorities: ["Critical"],
      requireApproval: true,
      note: "Critical requests always require manager approval and a priority reason.",
    },
    {
      id: "rule-emergency",
      name: "Emergency top-up",
      active: true,
      types: ["Emergency Top-up"],
      requireApproval: true,
    },
    {
      id: "rule-high-value",
      name: "High estimated value",
      active: true,
      minValue: 5000,
      requireApproval: true,
      note: "Estimated value = Σ(qty × standardCost).",
    },
    {
      id: "rule-high-priority",
      name: "High priority",
      active: true,
      priorities: ["High"],
      requireApproval: true,
    },
  ];
}

export function estimateOpsRequestValue(
  state: TlbState,
  lines: Array<{ productId: string; quantity: number }>,
): number {
  return lines.reduce((sum, line) => {
    const cost = state.products.find((p) => p.id === line.productId)?.standardCost ?? 0;
    return sum + cost * line.quantity;
  }, 0);
}

export function opsRequestNeedsApproval(
  state: TlbState,
  input: {
    type: OpsRequestType;
    priority: OpsRequestPriority;
    lines: Array<{ productId: string; quantity: number }>;
  },
): { needs: boolean; matchedRuleIds: string[] } {
  const value = estimateOpsRequestValue(state, input.lines);
  const rules = (state.opsApprovalRules ?? defaultOpsApprovalRules()).filter((r) => r.active);
  const matched: string[] = [];
  for (const rule of rules) {
    if (!rule.requireApproval) continue;
    if (rule.types?.length && !rule.types.includes(input.type)) continue;
    if (rule.priorities?.length && !rule.priorities.includes(input.priority)) continue;
    if (rule.minValue != null && value < rule.minValue) continue;
    matched.push(rule.id);
  }
  if (input.priority === "Critical") {
    if (!matched.includes("rule-critical")) matched.push("rule-critical");
  }
  return { needs: matched.length > 0, matchedRuleIds: matched };
}

export function warehouseAvailabilityForProduct(
  state: TlbState,
  productId: string,
  needed: number,
): Array<{
  warehouseId: string;
  warehouseName: string;
  available: number;
  status: OpsWarehouseAvailability;
}> {
  const rows: Array<{
    warehouseId: string;
    warehouseName: string;
    available: number;
    status: OpsWarehouseAvailability;
  }> = [];
  for (const wh of state.warehouses.filter((w) => w.active && !w.deletedAt)) {
    const bal = state.stock.find((s) => s.productId === productId && s.warehouseId === wh.id);
    const available = bal ? calcAvailable(bal) : 0;
    let status: OpsWarehouseAvailability = "Out of Stock";
    if (available >= needed && needed > 0) status = "Available";
    else if (available > 0 && available < needed) status = "Partial";
    else if (needed <= 0) status = "Available";
    rows.push({ warehouseId: wh.id, warehouseName: wh.name, available, status });
  }
  return rows.sort((a, b) => b.available - a.available);
}

export function bestFulfilWarehouse(
  state: TlbState,
  productId: string,
  needed: number,
  preferredWarehouseId?: string,
): {
  warehouseId: string;
  warehouseName: string;
  available: number;
  status: OpsWarehouseAvailability;
} | null {
  const rows = warehouseAvailabilityForProduct(state, productId, needed);
  if (!rows.length) return null;
  if (preferredWarehouseId) {
    const pref = rows.find((r) => r.warehouseId === preferredWarehouseId);
    if (pref && pref.available > 0) return pref;
  }
  return (
    rows.find((r) => r.status === "Available") ??
    rows.find((r) => r.status === "Partial") ??
    rows[0] ??
    null
  );
}

export function opsStatusTone(status: OpsRequestStatus | OpsDriverJobStatus | string): string {
  switch (status) {
    case "Draft":
      return "draft";
    case "Submitted":
    case "Acknowledged":
    case "Pending Approval":
    case "Assigned":
      return "pending";
    case "Partially Approved":
    case "Partial":
    case "Partially Delivered":
      return "partial";
    case "Approved":
    case "Warehouse Review":
      return "confirmed";
    case "Preparing":
    case "En Route Warehouse":
    case "Arrived Warehouse":
      return "awaiting";
    case "Ready for Collection":
    case "Ready":
      return "ready";
    case "Issued":
    case "Collected":
      return "supplied";
    case "In Transit":
    case "Departed":
    case "Arrived Destination":
      return "warning";
    case "Delivered":
    case "Closed":
      return "delivered";
    case "Rejected":
    case "Cancelled":
    case "Problem":
      return "cancelled";
    case "Critical":
      return "danger";
    case "High":
      return "warning";
    default:
      return "neutral";
  }
}

export function listOutstandingOpsRows(state: TlbState) {
  const rows: Array<{
    requestId: string;
    requestNumber: string;
    lineId: string;
    productId: string;
    productName: string;
    warehouseId: string;
    requestedQty: number;
    approvedQty: number;
    outstandingQty: number;
    missingDiscrepancyQty: number;
    status: OpsRequestStatus;
    priority: OpsRequestPriority;
    ageDays: number;
    title: string;
  }> = [];
  const now = Date.now();
  for (const req of state.opsRequests ?? []) {
    if (req.deletedAt) continue;
    if (req.status === "Cancelled" || req.status === "Rejected" || req.status === "Draft") continue;
    for (const line of (state.opsRequestLines ?? []).filter((l) => l.requestId === req.id)) {
      const shortage = opsOutstandingShortage(line);
      if (shortage <= 0) continue;
      const product = state.products.find((p) => p.id === line.productId);
      const ageDays = Math.max(
        0,
        Math.floor((now - new Date(req.requestedAt).getTime()) / 86_400_000),
      );
      rows.push({
        requestId: req.id,
        requestNumber: req.number,
        lineId: line.id,
        productId: line.productId,
        productName: product?.name ?? line.productId,
        warehouseId: line.fulfilWarehouseId ?? line.warehouseId,
        requestedQty: line.requestedQty,
        approvedQty: line.approvedQty,
        outstandingQty: shortage,
        missingDiscrepancyQty: opsDiscrepancyMissing(line),
        status: req.status,
        priority: req.priority,
        ageDays,
        title: req.title,
      });
    }
  }
  return rows.sort(
    (a, b) => b.ageDays - a.ageDays || a.requestNumber.localeCompare(b.requestNumber),
  );
}

export function buildMyOpsActions(state: TlbState): OpsActionItem[] {
  const items: OpsActionItem[] = [];
  const role = state.currentRole;
  const canApprove =
    role === "Owner" || role === "Admin" || role === "Manager" || role === "Finance";
  const canWarehouse =
    role === "Owner" || role === "Admin" || role === "Manager" || role === "Warehouse";
  const canDrive =
    role === "Owner" || role === "Admin" || role === "Driver" || role === "Warehouse";
  const canReceive =
    role === "Owner" ||
    role === "Admin" ||
    role === "Manager" ||
    role === "Receiver" ||
    role === "Requester";

  for (const req of state.opsRequests ?? []) {
    if (req.deletedAt) continue;
    const base = {
      requestId: req.id,
      requestNumber: req.number,
      priority: req.priority,
      status: req.status,
      nav: "Requests",
    };
    if (
      (req.status === "Submitted" || req.status === "Pending Approval") &&
      !req.acknowledgedAt &&
      canApprove
    ) {
      items.push({
        id: `ack-${req.id}`,
        kind: "acknowledge",
        title: `Acknowledge ${req.number}`,
        subtitle: req.title,
        ...base,
      });
    }
    if ((req.status === "Pending Approval" || req.status === "Partially Approved") && canApprove) {
      items.push({
        id: `apr-${req.id}`,
        kind: "approve",
        title: `Approve ${req.number}`,
        subtitle: `${req.priority} · ${req.type}`,
        ...base,
        nav: "Approvals",
      });
    }
    if (
      (req.status === "Approved" ||
        req.status === "Partially Approved" ||
        req.status === "Warehouse Review") &&
      canWarehouse
    ) {
      items.push({
        id: `wh-${req.id}`,
        kind: "warehouse_review",
        title: `Warehouse review ${req.number}`,
        subtitle: req.title,
        ...base,
        nav: "Warehouse Actions",
      });
    }
    if ((req.status === "Preparing" || req.status === "Warehouse Review") && canWarehouse) {
      items.push({
        id: `prep-${req.id}`,
        kind: "prepare",
        title: `Prepare ${req.number}`,
        subtitle: "Pick / pack to approved qty",
        ...base,
        nav: "Warehouse Actions",
      });
    }
    if (req.status === "Ready for Collection" && canWarehouse) {
      items.push({
        id: `rel-${req.id}`,
        kind: "release",
        title: `Release goods ${req.number}`,
        subtitle: "Post stock movement + dual collect",
        ...base,
        nav: "Warehouse Actions",
      });
    }
    if (
      req.driverId &&
      req.driverStatus &&
      !["Delivered", "Problem"].includes(req.driverStatus) &&
      canDrive &&
      ["Issued", "Collected", "In Transit", "Ready for Collection"].includes(req.status)
    ) {
      items.push({
        id: `drv-${req.id}`,
        kind: "drive",
        title: `Driver job ${req.number}`,
        subtitle: req.driverStatus,
        ...base,
        nav: "Drivers",
      });
    }
    if (
      (req.status === "In Transit" ||
        req.status === "Collected" ||
        req.driverStatus === "Arrived Destination") &&
      canReceive
    ) {
      items.push({
        id: `rcv-${req.id}`,
        kind: "receive",
        title: `Confirm delivery ${req.number}`,
        subtitle: req.destination,
        ...base,
        nav: "Deliveries",
      });
    }
    for (const d of (state.opsDiscrepancies ?? []).filter(
      (x) => x.requestId === req.id && !x.resolvedAt,
    )) {
      items.push({
        id: `disc-${d.id}`,
        kind: "resolve_discrepancy",
        title: `Discrepancy on ${req.number}`,
        subtitle: `${d.kind} × ${d.quantity}`,
        ...base,
        nav: "Exceptions / Discrepancies",
      });
    }
  }
  return items;
}

export function opsKanbanColumns(
  state: TlbState,
): Array<{ id: string; title: string; statuses: OpsRequestStatus[]; requests: OpsRequest[] }> {
  const cols: Array<{ id: string; title: string; statuses: OpsRequestStatus[] }> = [
    {
      id: "submitted",
      title: "Submitted",
      statuses: ["Submitted", "Acknowledged", "Pending Approval"],
    },
    {
      id: "approved",
      title: "Approved",
      statuses: ["Approved", "Partially Approved", "Warehouse Review"],
    },
    { id: "prep", title: "Preparing", statuses: ["Preparing", "Ready for Collection"] },
    { id: "transit", title: "In Transit", statuses: ["Issued", "Collected", "In Transit"] },
    { id: "done", title: "Delivered", statuses: ["Delivered", "Partially Delivered", "Closed"] },
  ];
  const live = (state.opsRequests ?? []).filter(
    (r) =>
      !r.deletedAt && r.status !== "Cancelled" && r.status !== "Rejected" && r.status !== "Draft",
  );
  return cols.map((c) => ({
    ...c,
    requests: live.filter((r) => c.statuses.includes(r.status)),
  }));
}
