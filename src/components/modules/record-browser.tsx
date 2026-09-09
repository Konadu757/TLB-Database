import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Search } from "lucide-react";

import type { DateRange } from "@/lib/domain/period-range";
import { isoInRange } from "@/lib/domain/period-range";

export type RecordTone = "success" | "warning" | "info" | "danger" | "neutral";

export interface BrowserColumn<T> {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => ReactNode;
}

export interface BrowserField {
  label: string;
  value: ReactNode;
  span?: 2;
}

export interface BrowserHistoryGroup {
  title: string;
  empty: string;
  rows: Array<{ id: string; cells: ReactNode[] }>;
  headers?: string[];
}

function StatusBadge({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="tlb-empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function matchesSearch(haystack: Array<string | number | null | undefined>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack
    .filter((v) => v != null && String(v).length > 0)
    .join(" ")
    .toLowerCase()
    .includes(q);
}

export function filterByPeriodDate(
  dateIso: string | undefined | null,
  range: DateRange | null | undefined,
  opts?: { whenMissing?: "include" | "exclude" },
): boolean {
  if (!range) return true;
  if (!dateIso) return (opts?.whenMissing ?? "include") === "include";
  return isoInRange(dateIso, range);
}

/** Shared list + detail pane used by Quotations and other list modules. */
export function RecordBrowser<T extends { id: string }>({
  kicker,
  title,
  searchPlaceholder,
  searchAriaLabel,
  emptyTitle,
  emptyDetail,
  noMatchDetail,
  rows,
  columns,
  getSearchValues,
  selectedId,
  onSelect,
  statusOf,
  detailTitle,
  detailSubtitle,
  detailFields,
  detailSummary,
  historyGroups,
  periodLabel,
  toolbarExtra,
}: {
  kicker: string;
  title: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
  emptyTitle: string;
  emptyDetail: string;
  noMatchDetail: string;
  rows: T[];
  columns: BrowserColumn<T>[];
  getSearchValues: (row: T) => Array<string | number | null | undefined>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusOf?: (row: T) => { label: string; tone: string };
  detailTitle: (row: T) => string;
  detailSubtitle?: (row: T) => string;
  detailFields: (row: T) => BrowserField[];
  detailSummary?: (row: T) => Array<{ label: string; value: ReactNode; note?: string }>;
  historyGroups?: (row: T) => BrowserHistoryGroup[];
  periodLabel?: string;
  toolbarExtra?: ReactNode;
}) {
  const detailRef = useRef<HTMLElement | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return rows.filter((row) => matchesSearch(getSearchValues(row), search));
  }, [rows, search, getSearchValues]);

  useEffect(() => {
    if (selectedId && !filtered.some((r) => r.id === selectedId) && filtered[0]) {
      onSelect(filtered[0].id);
    }
  }, [filtered, selectedId, onSelect]);

  const selected = filtered.find((r) => r.id === selectedId) ?? rows.find((r) => r.id === selectedId) ?? null;
  const hasSearch = search.trim().length > 0;

  const selectRow = (id: string) => {
    onSelect(id);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">{kicker}</span>
          <strong>{title}</strong>
          {periodLabel ? <p className="tlb-muted-line">Scoped to {periodLabel}</p> : null}
        </div>
        <div className="tlb-toolbar-actions">
          <label className="tlb-module-search">
            <Search aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchAriaLabel}
            />
          </label>
          {toolbarExtra}
        </div>
      </div>

      <div className="tlb-split">
        <article className="tlb-panel tlb-orders-panel">
          <div className="tlb-table-scroll">
            {rows.length === 0 ? (
              <EmptyState title={emptyTitle} detail={emptyDetail} />
            ) : filtered.length === 0 ? (
              <EmptyState title="No records match your search." detail={noMatchDetail} />
            ) : (
              <table>
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th key={col.key} className={col.className}>
                        {col.header}
                      </th>
                    ))}
                    {statusOf ? <th>Status</th> : null}
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const isSelected = selected?.id === row.id;
                    const status = statusOf?.(row);
                    return (
                      <tr
                        key={row.id}
                        className={`tlb-row-clickable${isSelected ? " tlb-row-active" : ""}`}
                        tabIndex={0}
                        aria-selected={isSelected}
                        onClick={() => selectRow(row.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectRow(row.id);
                          }
                        }}
                      >
                        {columns.map((col) => (
                          <td key={col.key} className={col.className}>
                            {col.render(row)}
                          </td>
                        ))}
                        {status ? (
                          <td>
                            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                          </td>
                        ) : null}
                        <td>
                          <button
                            type="button"
                            aria-label={`View ${detailTitle(row)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectRow(row.id);
                            }}
                          >
                            <ChevronRight />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {hasSearch && filtered.length > 0 ? (
            <div className="tlb-list-meta">
              Showing {filtered.length} of {rows.length} records
            </div>
          ) : periodLabel && rows.length > 0 ? (
            <div className="tlb-list-meta">{rows.length} record{rows.length === 1 ? "" : "s"} in period</div>
          ) : null}
        </article>

        <article className="tlb-panel tlb-detail-panel" ref={detailRef} key={selected?.id ?? "none"}>
          {selected ? (
            <>
              <div className="tlb-panel-heading">
                <div>
                  <span>{kicker}</span>
                  <strong>{detailTitle(selected)}</strong>
                  {detailSubtitle ? <p className="tlb-muted-line">{detailSubtitle(selected)}</p> : null}
                </div>
                {statusOf ? (
                  <StatusBadge tone={statusOf(selected).tone}>{statusOf(selected).label}</StatusBadge>
                ) : null}
              </div>

              {detailSummary ? (
                <div className="tlb-customer-summary">
                  {detailSummary(selected).map((item) => (
                    <div key={item.label}>
                      <span>{item.label}</span>
                      <strong>
                        {item.value}
                        {item.note ? <small>{item.note}</small> : null}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : null}

              <dl className="tlb-kv">
                {detailFields(selected).map((field) => (
                  <div key={field.label} className={field.span === 2 ? "tlb-span-2" : undefined}>
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>

              {(historyGroups?.(selected) ?? []).map((group) => (
                <div key={group.title}>
                  <div className="tlb-subheading">{group.title}</div>
                  {group.rows.length === 0 ? (
                    <EmptyState title={group.empty} detail="Nothing linked for this record yet." />
                  ) : (
                    <div className="tlb-table-scroll">
                      <table>
                        {group.headers ? (
                          <thead>
                            <tr>
                              {group.headers.map((h) => (
                                <th key={h}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                        ) : null}
                        <tbody>
                          {group.rows.map((r) => (
                            <tr key={r.id}>
                              {r.cells.map((cell, i) => (
                                <td key={`${r.id}-${i}`}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : (
            <EmptyState title="Select a record" detail="Choose a row to open full details and related history." />
          )}
        </article>
      </div>
    </div>
  );
}
