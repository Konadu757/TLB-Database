import { useEffect, useMemo, useState } from "react";

import {
  buildDueAwarenessItems,
  formatDueAwarenessTickerText,
  type DueAwarenessItem,
  type DueAwarenessNav,
} from "@/lib/domain/due-awareness";
import type { OutstandingRow, TlbState } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export type DueTickerNavigate = (
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
  onNavigate: DueTickerNavigate;
  onVisibilityChange?: (visible: boolean) => void;
};

export function DueNewsCrawler({ state, outstanding, onNavigate, onVisibilityChange }: Props) {
  const items = useMemo(
    () => buildDueAwarenessItems(state, outstanding),
    [state, outstanding],
  );
  const visible = items.length > 0;
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    onVisibilityChange?.(visible);
  }, [visible, onVisibilityChange]);

  if (!visible) return null;

  const handleNavigate = (item: DueAwarenessItem) => {
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
    onNavigate(item.nav);
  };

  const strip = [...items, ...items];
  const durationSec = Math.max(28, Math.min(90, items.length * 7));

  return (
    <div
      className="tlb-due-ticker"
      role="region"
      aria-label={`Due and overdue awareness, ${items.length} item${items.length === 1 ? "" : "s"}`}
    >
      <div className="tlb-due-ticker-badge" aria-hidden="true">
        <span className="tlb-due-ticker-pulse" />
        <strong>DUE</strong>
        <em>{items.length}</em>
      </div>

      <div className={cn("tlb-due-ticker-track", reducedMotion && "tlb-due-ticker-track--static")}>
        {reducedMotion ? (
          <ul className="tlb-due-ticker-static-list">
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" className="tlb-due-ticker-item" onClick={() => handleNavigate(item)}>
                  {formatDueAwarenessTickerText(item)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div
            className="tlb-due-ticker-marquee"
            style={{ animationDuration: `${durationSec}s` }}
          >
            {strip.map((item, index) => (
              <button
                key={`${item.id}-${index}`}
                type="button"
                className="tlb-due-ticker-item"
                onClick={() => handleNavigate(item)}
                tabIndex={index < items.length ? 0 : -1}
                aria-hidden={index >= items.length ? true : undefined}
              >
                {formatDueAwarenessTickerText(item)}
                <span className="tlb-due-ticker-sep" aria-hidden="true">
                  •
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
