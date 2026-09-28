import { useMemo } from "react";

import { buildDueAwarenessItems, type DueAwarenessItem } from "@/lib/domain/due-awareness";
import type { OutstandingRow, TlbState } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

type Props = {
  state: TlbState;
  outstanding: OutstandingRow[];
  /** Opens the Notifications page (full notification list). */
  onOpenNotifications: () => void;
};

type SummaryPart = { key: string; label: string; count: number; tone?: "danger" | "warning" };

function buildSummaryParts(items: DueAwarenessItem[]): SummaryPart[] {
  const overdue = items.filter((i) => i.severity === "overdue").length;
  const dueToday = items.filter((i) => i.severity === "due_today").length;
  const approvals = items.filter((i) => i.nav === "Approvals" || i.nav === "Requests").length;
  const stock = items.filter((i) => i.nav === "Batches").length;
  const supplies = items.filter(
    (i) => i.nav === "Outstanding Supplies" || i.nav === "Outstanding Requests",
  ).length;
  const finance = items.filter(
    (i) => i.nav === "Accounts Receivable" || i.nav === "Accounts Payable",
  ).length;
  const exceptions = items.filter((i) => i.nav === "Exceptions / Discrepancies").length;
  const notifications = items.filter((i) => i.nav === "Notifications").length;

  const parts: SummaryPart[] = [];
  if (overdue > 0) parts.push({ key: "overdue", label: "overdue", count: overdue, tone: "danger" });
  if (dueToday > 0)
    parts.push({ key: "today", label: "due today", count: dueToday, tone: "warning" });
  if (approvals > 0) parts.push({ key: "approvals", label: "approvals", count: approvals });
  if (supplies > 0) parts.push({ key: "supplies", label: "supplies", count: supplies });
  if (finance > 0) parts.push({ key: "finance", label: "AR / AP", count: finance });
  if (stock > 0) parts.push({ key: "stock", label: "stock alerts", count: stock });
  if (exceptions > 0) parts.push({ key: "exceptions", label: "exceptions", count: exceptions });
  if (notifications > 0) parts.push({ key: "ntf", label: "alerts", count: notifications });

  // Avoid double-counting noise: prefer severity + category mix, max ~4 chips
  return parts.slice(0, 4);
}

export function DueAwarenessPanel({ state, outstanding, onOpenNotifications }: Props) {
  const items = useMemo(() => buildDueAwarenessItems(state, outstanding), [state, outstanding]);

  const parts = useMemo(() => buildSummaryParts(items), [items]);
  const total = items.length;
  const overdueCount = items.filter((i) => i.severity === "overdue").length;
  const hasAttention = total > 0;

  const summaryLine =
    parts.length > 0
      ? parts.map((p) => `${p.count} ${p.label}`).join(" · ")
      : "No items need attention right now";

  return (
    <button
      type="button"
      className={cn(
        "tlb-panel tlb-due-panel tlb-due-panel--summary",
        overdueCount > 0 && "tlb-due-panel--has-overdue",
      )}
      onClick={onOpenNotifications}
      aria-label={
        hasAttention
          ? `Needs attention: ${total} items. ${summaryLine}. Open notifications.`
          : "Needs attention: all clear. Open notifications."
      }
    >
      <span className="tlb-due-panel-title">Needs attention</span>
      <span className="tlb-due-panel-body">
        <strong className="tlb-due-panel-total">
          {hasAttention ? `${total} item${total === 1 ? "" : "s"}` : "All clear"}
        </strong>
        <span className="tlb-due-panel-summary">{summaryLine}</span>
      </span>
    </button>
  );
}
