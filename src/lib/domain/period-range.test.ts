/**
 * Period filter verification: Today ≠ Year when seed spans dates.
 * Run: npx --yes tsx src/lib/domain/period-range.test.ts
 */
import { buildDashboardSnapshot, snapshotFingerprint } from "./dashboard-metrics";
import { DASHBOARD_PERIODS, getPeriodRange, isoInRange } from "./period-range";
import { createSeedState } from "../store/seed";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test("period ranges nest correctly on demo as-of", () => {
  const today = getPeriodRange("Today");
  const week = getPeriodRange("This Week");
  const month = getPeriodRange("This Month");
  const quarter = getPeriodRange("This Quarter");
  const year = getPeriodRange("This Year");
  assert(today.from === "2026-09-09" && today.to === "2026-09-09", "today");
  assert(week.from <= today.from && week.to >= today.to, "week contains today");
  assert(month.from === "2026-09-01", "month start");
  assert(quarter.from === "2026-07-01", "quarter start");
  assert(year.from === "2026-01-01" && year.to === "2026-12-31", "year");
  assert(isoInRange("2026-03-18", year) && !isoInRange("2026-03-18", today), "year-only date");
});

test("Today sales ≠ This Year sales on seed data", () => {
  const state = createSeedState();
  const today = buildDashboardSnapshot(state, "Today");
  const year = buildDashboardSnapshot(state, "This Year");
  assert(today.salesTotal !== year.salesTotal, `sales today ${today.salesTotal} vs year ${year.salesTotal}`);
  assert(today.recentOrders.length < year.recentOrders.length, "fewer orders today than year");
  assert(snapshotFingerprint(today) !== snapshotFingerprint(year), "fingerprints differ");
});

test("each preset produces a distinct fingerprint", () => {
  const state = createSeedState();
  const prints = DASHBOARD_PERIODS.map((p) => snapshotFingerprint(buildDashboardSnapshot(state, p)));
  const unique = new Set(prints);
  assert(unique.size === DASHBOARD_PERIODS.length, `expected ${DASHBOARD_PERIODS.length} unique, got ${unique.size}: ${prints.join(" | ")}`);
});

test("Today active orders only include same-day seed order", () => {
  const state = createSeedState();
  const today = buildDashboardSnapshot(state, "Today");
  assert(today.recentOrders.every((o) => o.orderDate === "2026-09-09"), "only today dates");
  assert(today.recentOrders.some((o) => o.number === "TLB-ORD-2609-00002"), "includes today order");
  assert(!today.recentOrders.some((o) => o.number === "TLB-ORD-2603-00005"), "excludes March order");
});

console.log(`\n${passed} period tests passed`);
