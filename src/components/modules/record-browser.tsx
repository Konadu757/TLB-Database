import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Search } from "lucide-react";

import type { DateRange } from "@/lib/domain/period-range";
import { isoInRange } from "@/lib/domain/period-range";

export type RecordTone = "success" | "warning" | "info" | "danger" | "neutral";

export type DetailSectionTone =
  | "summary"
  | "profile"
  | "activity"
  | "orders"
  | "lines"
  | "history"
  | "stock"
  | "outstanding"
  | "invoices"
  | "receipts"
  | "payments"
  | "deliveries"
  | "supplies";

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
  tone?: DetailSectionTone;
}

export interface DetailSummaryItem {
  label: string;
  value: ReactNode;
  note?: string;
  tileClass?: string;
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

/** Shared list←detail back control — high-contrast purple chip, keyboard accessible. */
export function RecordBackLink({
  label,
  onBack,
}: {
  label: string;
  onBack: () => void;
}) {
  return (
    <button type="button" className="tlb-record-back" onClick={onBack} aria-label={`Back to ${label}`}>
      <span aria-hidden="true">←</span>
      <span>{label}</span>
    </button>
  );
}

export function RecordDetailHeader({
  backLabel,
  onBack,
  code,
  title,
  subtitle,
  badges,
  actions,
}: {
  backLabel: string;
  onBack: () => void;
  code?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="tlb-record-back-bar">
        <RecordBackLink label={backLabel} onBack={onBack} />
      </div>
      <header className="tlb-record-detail-header tlb-customer-detail-header">
        <div className="tlb-record-detail-header-row tlb-customer-detail-header-row">
          <div className="tlb-record-detail-identity tlb-customer-detail-identity">
            {code ? <span className="tlb-record-detail-code tlb-customer-detail-code">{code}</span> : null}
            <strong>{title}</strong>
            {subtitle ? <p className="tlb-muted-line">{subtitle}</p> : null}
          </div>
          <div className="tlb-record-detail-actions tlb-customer-detail-actions">
            {badges ? <div className="tlb-record-detail-badges tlb-customer-detail-badges">{badges}</div> : null}
            {actions}
          </div>
        </div>
      </header>
    </>
  );
}

export function RecordDetailSection({
  tone = "profile",
  kicker,
  title,
  actions,
  span2,
  children,
}: {
  tone?: DetailSectionTone;
  kicker: string;
  title: string;
  actions?: ReactNode;
  span2?: boolean;
  children: ReactNode;
}) {
  return (
    <article
      className={`tlb-panel tlb-record-detail-section tlb-customer-detail-section tlb-record-detail-section--${tone} tlb-customer-detail-section--${tone}${span2 ? " tlb-span-2" : ""}`}
    >
      <div className="tlb-panel-heading">
        <div>
          <span>{kicker}</span>
          <strong>{title}</strong>
        </div>
        {actions}
      </div>
      {children}
    </article>
  );
}

export function RecordDetailPage({
  backLabel,
  onBack,
  code,
  title,
  subtitle,
  badges,
  actions,
  children,
  flash,
}: {
  backLabel: string;
  onBack: () => void;
  code?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flash?: ReactNode;
}) {
  return (
    <div className="tlb-module tlb-record-detail-page tlb-customer-detail-page">
      {flash}
      <RecordDetailHeader
        backLabel={backLabel}
        onBack={onBack}
        {...(code !== undefined ? { code } : {})}
        title={title}
        {...(subtitle !== undefined ? { subtitle } : {})}
        {...(badges !== undefined ? { badges } : {})}
        {...(actions !== undefined ? { actions } : {})}
      />
      <section className="tlb-detail-sections tlb-record-detail tlb-customer-detail">{children}</section>
    </div>
  );
}

/**
 * Full-width list → dedicated full-page detail (replaces side-pane RecordBrowser).
 */
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
  onBack,
  backLabel,
  statusOf,
  detailTitle,
  detailSubtitle,
  detailCode,
  detailFields,
  detailSummary,
  historyGroups,
  periodLabel,
  toolbarExtra,
  listExtra,
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
  onBack: () => void;
  backLabel?: string;
  statusOf?: (row: T) => { label: string; tone: string };
  detailTitle: (row: T) => string;
  detailSubtitle?: (row: T) => string;
  detailCode?: (row: T) => ReactNode;
  detailFields: (row: T) => BrowserField[];
  detailSummary?: (row: T) => DetailSummaryItem[];
  historyGroups?: (row: T) => BrowserHistoryGroup[];
  periodLabel?: string;
  toolbarExtra?: ReactNode;
  listExtra?: ReactNode;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return rows.filter((row) => matchesSearch(getSearchValues(row), search));
  }, [rows, search, getSearchValues]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const hasSearch = search.trim().length > 0;

  if (selectedId) {
    if (!selected) {
      return (
        <div className="tlb-module">
          <EmptyState title="Record not found" detail="The selected record is no longer available." />
          <div style={{ marginTop: 12 }}>
            <RecordBackLink label={backLabel ?? title} onBack={onBack} />
          </div>
        </div>
      );
    }

    const status = statusOf?.(selected);
    const groups = historyGroups?.(selected) ?? [];
    const summary = detailSummary?.(selected) ?? [];

    return (
      <RecordDetailPage
        backLabel={backLabel ?? title}
        onBack={onBack}
        code={detailCode?.(selected) ?? selected.id.slice(0, 12)}
        title={detailTitle(selected)}
        subtitle={detailSubtitle?.(selected) ?? kicker}
        badges={status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
      >
        {summary.length > 0 ? (
          <RecordDetailSection tone="summary" kicker="Overview" title="Summary" span2>
            <div className="tlb-customer-summary" aria-label="Record summary">
              {summary.map((item) => (
                <div key={item.label} className={item.tileClass}>
                  <span>{item.label}</span>
                  <strong>
                    {item.value}
                    {item.note ? <small>{item.note}</small> : null}
                  </strong>
                </div>
              ))}
            </div>
          </RecordDetailSection>
        ) : null}

        <RecordDetailSection tone="profile" kicker={kicker} title="Details" span2>
          <dl className="tlb-kv">
            {detailFields(selected).map((field) => (
              <div key={field.label} className={field.span === 2 ? "tlb-span-2" : undefined}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </RecordDetailSection>

        {groups.map((group) => (
          <RecordDetailSection
            key={group.title}
            tone={group.tone ?? (group.title.toLowerCase().includes("line") ? "lines" : "history")}
            kicker="Related"
            title={group.title}
            span2
          >
            {group.rows.length === 0 ? (
              <EmptyState title={group.empty} detail="Nothing linked for this record yet." />
            ) : (
              <div className="tlb-table-scroll tlb-orders-panel">
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
          </RecordDetailSection>
        ))}
      </RecordDetailPage>
    );
  }

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

      {listExtra}

      <article className="tlb-panel tlb-orders-panel tlb-customers-list-panel">
        <div className="tlb-table-scroll">
          {rows.length === 0 ? (
            <EmptyState title={emptyTitle} detail={emptyDetail} />
          ) : filtered.length === 0 ? (
            <EmptyState title="No records match your search." detail={noMatchDetail} />
          ) : (
            <table className="tlb-customers-table">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col.key} className={col.className}>
                      {col.header}
                    </th>
                  ))}
                  {statusOf ? <th className="tlb-col-priority">Status</th> : null}
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const status = statusOf?.(row);
                  return (
                    <tr
                      key={row.id}
                      className="tlb-row-clickable"
                      tabIndex={0}
                      onClick={() => onSelect(row.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(row.id);
                        }
                      }}
                    >
                      {columns.map((col) => (
                        <td key={col.key} className={col.className}>
                          {col.render(row)}
                        </td>
                      ))}
                      {status ? (
                        <td className="tlb-col-priority">
                          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                        </td>
                      ) : null}
                      <td>
                        <button
                          type="button"
                          aria-label={`View ${detailTitle(row)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(row.id);
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
          <div className="tlb-list-meta">
            {rows.length} record{rows.length === 1 ? "" : "s"} in period
          </div>
        ) : null}
      </article>
    </div>
  );
}

export { StatusBadge, EmptyState };
