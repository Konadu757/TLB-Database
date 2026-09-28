import { daysBetween } from "@/lib/domain/calculations";
import { accountsPayable, accountsReceivable, listExpiryAlerts } from "@/lib/domain/inventory";
import { listOutstandingOpsRows } from "@/lib/domain/ops-hub";
import type {
  AppNotification,
  NotificationType,
  OutstandingRow,
  TlbState,
} from "@/lib/domain/types";

function formatMoney(amount: number): string {
  return `GH₵ ${amount.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** In-app nav module label used by openLiveModule. */
export type DueAwarenessNav =
  | "Outstanding Supplies"
  | "Outstanding Requests"
  | "Accounts Receivable"
  | "Accounts Payable"
  | "Approvals"
  | "Batches"
  | "Exceptions / Discrepancies"
  | "Requests"
  | "Notifications";

export type DueAwarenessSeverity = "overdue" | "due_today" | "attention";

export interface DueAwarenessItem {
  id: string;
  severity: DueAwarenessSeverity;
  /** Short severity label shown at start of message, e.g. OVERDUE */
  label: string;
  message: string;
  nav: DueAwarenessNav;
  /** Optional record id when the destination module supports deep-open. */
  entityId?: string;
  sortKey: number;
}

/** Notification types that warrant due-awareness attention when unread. */
const SERIOUS_NOTIFICATION_TYPES = new Set<NotificationType>([
  "overdue",
  "expected_date_reached",
  "extended_unfulfilled",
  "ops_discrepancy",
  "ops_outstanding",
  "ops_approval_needed",
  "partially_supplied",
  "expected_date_approaching",
  "ops_ready_collection",
]);

function todayIso(asOf: string): string {
  return asOf.slice(0, 10);
}

function dayLabel(days: number, unit = "day"): string {
  const n = Math.max(0, Math.floor(days));
  if (n === 0) return "today";
  if (n === 1) return `1 ${unit}`;
  return `${n} ${unit}s`;
}

function severityRank(s: DueAwarenessSeverity): number {
  if (s === "overdue") return 0;
  if (s === "due_today") return 1;
  return 2;
}

function notificationSeverity(type: NotificationType): DueAwarenessSeverity {
  if (
    type === "overdue" ||
    type === "ops_discrepancy" ||
    type === "extended_unfulfilled" ||
    type === "ops_outstanding"
  ) {
    return "overdue";
  }
  if (type === "expected_date_reached" || type === "ops_approval_needed") {
    return "due_today";
  }
  return "attention";
}

function notificationLabel(type: NotificationType): string {
  switch (type) {
    case "overdue":
      return "ALERT OVERDUE";
    case "expected_date_reached":
      return "DATE REACHED";
    case "extended_unfulfilled":
      return "UNFULFILLED";
    case "ops_discrepancy":
      return "OPS EXCEPTION";
    case "ops_outstanding":
      return "OPS OUTSTANDING";
    case "ops_approval_needed":
      return "APPROVAL NEEDED";
    case "partially_supplied":
      return "PARTIAL SUPPLY";
    case "expected_date_approaching":
      return "DATE APPROACHING";
    case "ops_ready_collection":
      return "READY COLLECT";
    default:
      return "NOTIFICATION";
  }
}

function isSeriousUnreadNotification(n: AppNotification): boolean {
  if (n.readAt) return false;
  return SERIOUS_NOTIFICATION_TYPES.has(n.type);
}

/**
 * Collect due / overdue awareness items for the dashboard Needs attention card.
 * Includes overdue/due-today work, unread serious notifications, expired stock,
 * open exceptions, and stale approvals.
 */
export function buildDueAwarenessItems(
  state: TlbState,
  outstanding?: OutstandingRow[],
  asOf = new Date().toISOString(),
): DueAwarenessItem[] {
  const items: DueAwarenessItem[] = [];
  const today = todayIso(asOf);
  const supplyRows = outstanding ?? [];

  for (const row of supplyRows) {
    if (row.demandFlag !== "overdue" && row.demandFlag !== "due_today") continue;
    const overdue = row.demandFlag === "overdue";
    const agePart =
      overdue && row.ageDays > 0 ? dayLabel(row.ageDays) : overdue ? "past due" : "due today";
    items.push({
      id: `supply:${row.lineId}`,
      severity: overdue ? "overdue" : "due_today",
      label: overdue ? "OVERDUE" : "DUE TODAY",
      message: `Order ${row.orderNumber} · ${row.customerName} · ${row.productSku} · ${agePart}`,
      nav: "Outstanding Supplies",
      entityId: row.productId,
      sortKey: severityRank(overdue ? "overdue" : "due_today") * 1e9 + (overdue ? -row.ageDays : 0),
    });
  }

  for (const row of listOutstandingOpsRows(state)) {
    const req = (state.opsRequests ?? []).find((r) => r.id === row.requestId);
    const needed = req?.neededBy?.slice(0, 10);
    let severity: DueAwarenessSeverity | null = null;
    let label = "";
    let agePart = "";

    if (needed) {
      if (needed < today) {
        severity = "overdue";
        label = "OVERDUE";
        agePart = dayLabel(daysBetween(needed, asOf));
      } else if (needed === today) {
        severity = "due_today";
        label = "DUE TODAY";
        agePart = "needed today";
      }
    } else if (row.ageDays >= 8 || row.priority === "Critical") {
      severity = "overdue";
      label = row.priority === "Critical" ? "CRITICAL" : "OVERDUE";
      agePart = `${dayLabel(row.ageDays)} outstanding`;
    }

    if (!severity) continue;
    items.push({
      id: `ops-out:${row.lineId}`,
      severity,
      label,
      message: `Request ${row.requestNumber} · ${row.productName} · qty ${row.outstandingQty} · ${agePart}`,
      nav: "Outstanding Requests",
      entityId: row.requestId,
      sortKey: severityRank(severity) * 1e9 - row.ageDays,
    });
  }

  for (const row of accountsReceivable(state, asOf)) {
    const due = row.dueDate.slice(0, 10);
    if (row.ageDays <= 0 && due !== today) continue;
    const overdue = row.ageDays > 0;
    items.push({
      id: `ar:${row.docId}`,
      severity: overdue ? "overdue" : "due_today",
      label: overdue ? "OVERDUE AR" : "DUE TODAY AR",
      message: `Invoice ${row.docNumber} · ${row.partyName} · ${formatMoney(row.balance)} · ${
        overdue ? dayLabel(row.ageDays) : "due today"
      }`,
      nav: "Accounts Receivable",
      sortKey: severityRank(overdue ? "overdue" : "due_today") * 1e9 - row.ageDays,
    });
  }

  for (const row of accountsPayable(state, asOf)) {
    const due = row.dueDate.slice(0, 10);
    if (row.ageDays <= 0 && due !== today) continue;
    const overdue = row.ageDays > 0;
    items.push({
      id: `ap:${row.docId}`,
      severity: overdue ? "overdue" : "due_today",
      label: overdue ? "OVERDUE AP" : "DUE TODAY AP",
      message: `PO ${row.docNumber} · ${row.partyName} · ${formatMoney(row.balance)} · ${
        overdue ? dayLabel(row.ageDays) : "due today"
      }`,
      nav: "Accounts Payable",
      sortKey: severityRank(overdue ? "overdue" : "due_today") * 1e9 - row.ageDays,
    });
  }

  for (const appr of state.approvals ?? []) {
    if (appr.status !== "Pending") continue;
    const age = daysBetween(appr.requestedAt, asOf);
    if (age < 2) continue;
    const severity: DueAwarenessSeverity = age >= 5 ? "overdue" : "attention";
    items.push({
      id: `approval:${appr.id}`,
      severity,
      label: age >= 5 ? "STALE APPROVAL" : "PENDING APPROVAL",
      message: `${appr.title} · ${appr.summary} · ${dayLabel(age)} waiting`,
      nav: "Approvals",
      entityId: appr.id,
      sortKey: severityRank(severity) * 1e9 - age,
    });
  }

  for (const req of state.opsRequests ?? []) {
    if (req.deletedAt) continue;
    if (req.status !== "Pending Approval" && req.status !== "Partially Approved") continue;
    const age = daysBetween(req.requestedAt, asOf);
    if (age < 1 && req.priority !== "Critical") continue;
    const severity: DueAwarenessSeverity =
      req.priority === "Critical" || age >= 3 ? "overdue" : "due_today";
    items.push({
      id: `ops-appr:${req.id}`,
      severity,
      label: req.priority === "Critical" ? "CRITICAL APPROVAL" : "OPS APPROVAL",
      message: `Request ${req.number} · ${req.title} · ${dayLabel(age)} waiting`,
      nav: "Requests",
      entityId: req.id,
      sortKey: severityRank(severity) * 1e9 - age,
    });
  }

  for (const alert of listExpiryAlerts(state, asOf)) {
    if (alert.band !== "expired" && alert.band !== "30") continue;
    const expired = alert.band === "expired";
    const days = alert.daysToExpiry;
    items.push({
      id: `expiry:${alert.batch.id}`,
      severity: expired ? "overdue" : "attention",
      label: expired ? "EXPIRED STOCK" : "EXPIRING SOON",
      message: `${alert.productSku} · batch ${alert.batch.code} · ${alert.warehouseName} · qty ${
        alert.batch.remainingQty
      } · ${
        expired ? "expired" : days != null && days > 0 ? `${dayLabel(days)} left` : "within 30 days"
      }`,
      nav: "Batches",
      sortKey: severityRank(expired ? "overdue" : "attention") * 1e9 + (days ?? 0),
    });
  }

  for (const d of state.opsDiscrepancies ?? []) {
    if (d.resolvedAt) continue;
    const req = (state.opsRequests ?? []).find((r) => r.id === d.requestId);
    const product = state.products.find((p) => p.id === d.productId);
    const age = daysBetween(d.loggedAt, asOf);
    items.push({
      id: `disc:${d.id}`,
      severity: age >= 2 ? "overdue" : "attention",
      label: "EXCEPTION",
      message: `${d.kind} · ${req?.number ?? d.requestId} · ${product?.sku ?? d.productId} · qty ${
        d.quantity
      } · open ${dayLabel(age)}`,
      nav: "Exceptions / Discrepancies",
      entityId: d.requestId,
      sortKey: severityRank(age >= 2 ? "overdue" : "attention") * 1e9 - age,
    });
  }

  for (const n of state.notifications ?? []) {
    if (!isSeriousUnreadNotification(n)) continue;
    const severity = notificationSeverity(n.type);
    const age = daysBetween(n.createdAt, asOf);
    items.push({
      id: `ntf:${n.id}`,
      severity,
      label: notificationLabel(n.type),
      message: `${n.title} · ${n.body}`,
      nav: "Notifications",
      entityId: n.id,
      sortKey: severityRank(severity) * 1e9 - age,
    });
  }

  return items.sort((a, b) => a.sortKey - b.sortKey || a.message.localeCompare(b.message));
}

export function formatDueAwarenessTickerText(item: DueAwarenessItem): string {
  return `${item.label} · ${item.message}`;
}
