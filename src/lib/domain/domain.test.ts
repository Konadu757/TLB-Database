/**
 * Focused domain tests: outstanding calc, partial supply rules, status transitions.
 * Run: npx --yes tsx src/lib/domain/domain.test.ts
 */
import {
  calcAvailable,
  calcOutstanding,
  deriveOrderStatus,
  validateSupplyQty,
} from "./calculations";
import { buildDashboardSnapshot, collectionsTotal } from "./dashboard-metrics";
import { DEMO_AS_OF } from "./period-range";
import { createSeedState } from "../store/seed";
import { createSupply, getOutstandingRows, receiveStock } from "../store/tlb-store";

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

test("outstanding = ordered - supplied - cancelled (never negative)", () => {
  assert(calcOutstanding({ orderedQty: 4, suppliedQty: 2, cancelledQty: 0 }) === 2, "partial");
  assert(calcOutstanding({ orderedQty: 4, suppliedQty: 4, cancelledQty: 0 }) === 0, "full");
  assert(calcOutstanding({ orderedQty: 4, suppliedQty: 1, cancelledQty: 3 }) === 0, "cancelled remainder");
  assert(calcOutstanding({ orderedQty: 4, suppliedQty: 9, cancelledQty: 0 }) === 0, "clamp");
});

test("available = physical - reserved", () => {
  assert(calcAvailable({ physicalQty: 25, reservedQty: 10 }) === 15, "basic");
  assert(calcAvailable({ physicalQty: 2, reservedQty: 5 }) === 0, "clamp");
});

test("supply validation", () => {
  assert(validateSupplyQty({ supplyNow: 3, outstanding: 2, available: 10 }) !== null, "over outstanding");
  assert(validateSupplyQty({ supplyNow: 3, outstanding: 5, available: 2 }) !== null, "over available");
  assert(validateSupplyQty({ supplyNow: 2, outstanding: 2, available: 2 }) === null, "ok");
});

test("Phase 30 Chemical A/B partial then full supply", () => {
  let state = createSeedState();
  const first = createSupply(state, "ord-phase30", [
    { orderLineId: "ol-a", quantity: 2 },
    { orderLineId: "ol-b", quantity: 10 },
  ], "First supply");
  assert(first.ok, first.ok ? "" : first.error);
  state = first.data.state;

  const lineA = state.orderLines.find((l) => l.id === "ol-a")!;
  const lineB = state.orderLines.find((l) => l.id === "ol-b")!;
  assert(calcOutstanding(lineA) === 2, "A outstanding 2");
  assert(calcOutstanding(lineB) === 0, "B outstanding 0");
  assert(state.orders.find((o) => o.id === "ord-phase30")!.status === "Partially Supplied", "partial status");
  assert(state.supplies.length === 1, "history row 1");
  assert(getOutstandingRows(state).some((r) => r.lineId === "ol-a"), "A still listed");

  const received = receiveStock(state, "prod-chem-a", "wh-main", 5, true);
  assert(received.ok, "receive ok");
  state = received.data.state;
  assert(state.orderLines.find((l) => l.id === "ol-a")!.reservedQty >= 2, "auto-reserved");

  const second = createSupply(state, "ord-phase30", [{ orderLineId: "ol-a", quantity: 2 }], "Second supply");
  assert(second.ok, second.ok ? "" : second.error);
  state = second.data.state;
  assert(calcOutstanding(state.orderLines.find((l) => l.id === "ol-a")!) === 0, "A cleared");
  assert(state.orders.find((o) => o.id === "ord-phase30")!.status === "Fully Supplied", "fully supplied");
  assert(state.supplies.length === 2, "immutable history retained");
  assert(getOutstandingRows(state).every((r) => r.orderId !== "ord-phase30"), "no outstanding left");
});

test("cannot oversupply Chemical A from seed stock", () => {
  const state = createSeedState();
  const bad = createSupply(state, "ord-phase30", [{ orderLineId: "ol-a", quantity: 4 }]);
  assert(!bad.ok, "should fail");
});

test("deriveOrderStatus partial", () => {
  const status = deriveOrderStatus({
    current: "Confirmed",
    lines: [
      {
        id: "1",
        orderId: "o",
        productId: "a",
        warehouseId: "w",
        orderedQty: 4,
        suppliedQty: 2,
        cancelledQty: 0,
        reservedQty: 0,
        unitPrice: 1,
        lineStatus: "Partially Supplied",
      },
      {
        id: "2",
        orderId: "o",
        productId: "b",
        warehouseId: "w",
        orderedQty: 10,
        suppliedQty: 10,
        cancelledQty: 0,
        reservedQty: 0,
        unitPrice: 1,
        lineStatus: "Fully Supplied",
      },
    ],
    stockByKey: new Map(),
  });
  assert(status === "Partially Supplied", status);
});

test("dashboard sales KPIs use collections by payment/receipt date", () => {
  const state = createSeedState();

  const month = buildDashboardSnapshot(state, "This Month", "All warehouses", DEMO_AS_OF);
  const today = buildDashboardSnapshot(state, "Today", "All warehouses", DEMO_AS_OF);
  const prev = buildDashboardSnapshot(state, { mode: "previousMonth" }, "All warehouses", DEMO_AS_OF);
  const custom = buildDashboardSnapshot(
    state,
    { mode: "custom", from: "2026-03-01", to: "2026-03-31" },
    "All warehouses",
    DEMO_AS_OF,
  );

  assert(month.salesTotal === 31540, `month collected expected 31540 got ${month.salesTotal}`);
  assert(today.salesTotal === 3840, `today collected expected 3840 got ${today.salesTotal}`);
  assert(prev.salesTotal === 12800, `prev month expected 12800 got ${prev.salesTotal}`);
  assert(custom.salesTotal === 37500, `custom Mar expected 37500 got ${custom.salesTotal}`);
  assert(month.salesTotal !== today.salesTotal, "period filters must diverge");
  assert(month.salesBasisLabel.toLowerCase().includes("collected"), "label collections");
  assert(
    collectionsTotal(state, month.range) === month.salesTotal,
    "collectionsTotal matches snapshot",
  );
});

console.log(`\n${passed} tests passed`);
