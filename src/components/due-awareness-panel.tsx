import { useMemo } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";

import {
  buildDueAwarenessItems,
  type DueAwarenessItem,
  type DueAwarenessNav,
  type DueAwarenessSeverity,
} from "@/lib/domain/due-awareness";
import type { OutstandingRow, TlbState } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export type DueAwarenessNavigate = (
  nav: DueAwarenessNav,
  orderId?: string | null,
  productId?: string | null,
  customerId?: string | null,
  supplierId?: string | null,
  opsRequestId?: string | null,
) => void;

type Props = {
  state: TlbState;
  outstanding: OutstandingRow[];
  onNavigate: DueAwarenessNavigate;
  /** Cap rows shown; full count still appears in the heading. */
  limit?: number;
};

function severityTone(severity: DueAwarenessSeverity): string {
  if (severity === "overdue") return "danger";
  if (severity === "due_today") return "warning";
  return "info";
}

function handleNavigate(item: DueAwarenessItem, onNavigate: DueAwarenessNavigate) {
  if (item.nav === "Outstanding Supplies") {
    onNavigate(item.nav, null, item.entityId ?? null);
    return;
  }
  if (
    item.nav === "Outstanding Requests" ||
    item.nav === "Exceptions / Discrepancies" ||
    item.nav === "Requests"
  ) {
    onNavigate(item.nav, null, null, null, null, item.entityId ?? null);
    return;
  }
  if (item.nav === "Approvals" || item.nav === "Batches" || item.nav === "Notifications") {
    onNavigate(item.nav, null, null, null, null, item.entityId ?? null);
    return;
  }
  onNavigate(item.nav);
}

export function DueAwarenessPanel({
  state,
  outstanding,
  onNavigate,
  limit = 8,
}: Props) {
  const items = useMemo(
    () => buildDueAwarenessItems(state, outstanding),
    [state, outstanding],
  );

  const overdueCount = items.filter((i) => i.severity === "overdue").length;
  const shown = items.slice(0, limit);
  const hidden = Math.max(0, items.length - shown.length);

  return (
    <article
      className="tlb-panel tlb-due-panel"
      aria-label={`Due and overdue, ${items.length} item${items.length === 1 ? "" : "s"}`}
    >
      <div className="tlb-panel-heading">
        <div>
          <span>Due &amp; overdue</span>
          <strong>
            {items.length === 0
              ? "Nothing needs attention right now"
              : `${items.length} item${items.length === 1 ? "" : "s"} needing attention`}
          </strong>
        </div>
        {overdueCount > 0 ? (
          <span className="tlb-due-panel-count" title={`${overdueCount} overdue`}>
            <AlertTriangle aria-hidden="true" />
            {overdueCount} overdue
          </span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="tlb-muted-line" style={{ padding: "1rem 1.05rem" }}>
          No overdue supplies, receivables, approvals, or serious alerts.
        </p>
      ) : (
        <ul className="tlb-due-list">
          {shown.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={cn(
                  "tlb-due-row",
                  item.severity === "overdue" && "tlb-due-row--overdue",
                  item.severity === "due_today" && "tlb-due-row--today",
                )}
                onClick={() => handleNavigate(item, onNavigate)}
              >
                <span
                  className={cn(
                    "tlb-due-row-icon",
                    `tlb-due-row-icon--${severityTone(item.severity)}`,
                  )}
                >
                  <AlertTriangle />
                </span>
                <span className="tlb-due-row-copy">
                  <strong>
                    <span className={`status-badge status-${severityTone(item.severity)}`}>
                      {item.label}
                    </span>
                    <span className="tlb-due-row-msg">{item.message}</span>
                  </strong>
                  <small>{item.nav}</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="tlb-muted-line tlb-due-panel-more">
          +{hidden} more — open the linked module from a row above for the full queue.
        </p>
      ) : null}
    </article>
  );
}
