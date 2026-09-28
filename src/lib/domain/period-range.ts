/** Dashboard period presets and local-timezone date-range helpers. */

export const DASHBOARD_PERIODS = [
  "Today",
  "This Week",
  "This Month",
  "This Quarter",
  "This Year",
] as const;

export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export interface DateRange {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
}

/** Unified selection for live presets + historical / custom lookup. */
export type DashboardRangeSelection =
  | { mode: "preset"; period: DashboardPeriod }
  | { mode: "previousMonth" }
  | { mode: "custom"; from: string; to: string };

/** Demo clock aligned with seed data (2026-09-09). */
export const DEMO_AS_OF = "2026-09-09T12:00:00.000";

/**
 * Live period anchor. Seed metrics stay on the demo clock until wall time passes it,
 * then Today / This Week include records just created.
 */
export function livePeriodAsOf(now: Date = new Date()): string {
  const nowIso = now.toISOString();
  return nowIso > DEMO_AS_OF ? nowIso : DEMO_AS_OF;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar date as YYYY-MM-DD. */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, day] = key.slice(0, 10).split("-").map(Number);
  return new Date(y!, m! - 1, day!, 12, 0, 0, 0);
}

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** Monday-start week (ISO-style local). */
export function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  const start = startOfLocalDay(d);
  start.setDate(start.getDate() + diff);
  return start;
}

export function endOfWeek(d: Date): Date {
  const start = startOfWeek(d);
  const end = endOfLocalDay(start);
  end.setDate(end.getDate() + 6);
  return end;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1, 0, 0, 0, 0);
}

export function endOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q + 3, 0, 23, 59, 59, 999);
}

export function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
}

export function endOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
}

export function getPeriodRange(
  period: DashboardPeriod,
  asOf: Date | string = DEMO_AS_OF,
): DateRange {
  const d = typeof asOf === "string" ? new Date(asOf) : asOf;
  switch (period) {
    case "Today":
      return { from: toDateKey(d), to: toDateKey(d) };
    case "This Week":
      return { from: toDateKey(startOfWeek(d)), to: toDateKey(endOfWeek(d)) };
    case "This Month":
      return { from: toDateKey(startOfMonth(d)), to: toDateKey(endOfMonth(d)) };
    case "This Quarter":
      return { from: toDateKey(startOfQuarter(d)), to: toDateKey(endOfQuarter(d)) };
    case "This Year":
      return { from: toDateKey(startOfYear(d)), to: toDateKey(endOfYear(d)) };
  }
}

export function getPreviousMonthRange(asOf: Date | string = DEMO_AS_OF): DateRange {
  const d = typeof asOf === "string" ? new Date(asOf) : new Date(asOf);
  d.setMonth(d.getMonth() - 1);
  return { from: toDateKey(startOfMonth(d)), to: toDateKey(endOfMonth(d)) };
}

export function normalizeRange(from: string, to: string): DateRange {
  const a = from.slice(0, 10);
  const b = to.slice(0, 10);
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function resolveSelectionRange(
  selection: DashboardRangeSelection,
  asOf: Date | string = DEMO_AS_OF,
): DateRange {
  switch (selection.mode) {
    case "preset":
      return getPeriodRange(selection.period, asOf);
    case "previousMonth":
      return getPreviousMonthRange(asOf);
    case "custom":
      return normalizeRange(selection.from, selection.to);
  }
}

export function selectionLabel(selection: DashboardRangeSelection): string {
  switch (selection.mode) {
    case "preset":
      return selection.period;
    case "previousMonth":
      return "Previous Month";
    case "custom":
      return "Custom range";
  }
}

/** Inclusive day count for a YYYY-MM-DD range. */
export function rangeDayCount(range: DateRange): number {
  const from = parseDateKey(range.from);
  const to = parseDateKey(range.to);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/** Equal-length window immediately before `range`. */
export function previousComparableRange(range: DateRange): DateRange {
  const from = parseDateKey(range.from);
  const days = rangeDayCount(range);
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return { from: toDateKey(prevFrom), to: toDateKey(prevTo) };
}

/** Inclusive YYYY-MM-DD comparison against an ISO timestamp or date key. */
export function isoInRange(iso: string, range: DateRange): boolean {
  const key = iso.slice(0, 10);
  return key >= range.from && key <= range.to;
}

export function isDashboardPeriod(value: string): value is DashboardPeriod {
  return (DASHBOARD_PERIODS as readonly string[]).includes(value);
}

export function toRangeSelection(
  periodOrSelection: DashboardPeriod | DashboardRangeSelection,
): DashboardRangeSelection {
  if (typeof periodOrSelection === "string") {
    return { mode: "preset", period: periodOrSelection };
  }
  return periodOrSelection;
}
