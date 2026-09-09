/**
 * Focused domain tests for outstanding calc, partial supply rules, and status transitions.
 * Run: npx --yes tsx scripts/phase30-verify.ts
 */
import assert from "node:assert/strict";

import {
  ageingBand,
  calcAvailable,
  calcOutstanding,
  deriveOrderStatus,
  validateSupplyQty,
} from "../src/lib/domain/calculations";
import { createSeedState } from "../src/lib/store/seed";
import {
  confirmCustomerOrder,
  createSupply,
  getOutstandingRows,
  receiveStock,
  resetToSeed,
} from "../src/lib/store/tlb-store";
import type { CustomerOrderLine, StockBalance } from "../src/lib/domain/types";

function testOutstandingNeverNegative() {
  const line: CustomerOrderLine = {
    id: "x",
    orderId: "o",
    productId: "p",
    warehouseId: "w",
    orderedQty: 4,
    suppliedQty: 2,
    cancelledQty: 3,
    reservedQty: 0,
    unitPrice: 1,
    lineStatus: "Partially Supplied",
  };
  assert.equal(calcOutstanding(line), 0);
}

function testSupplyValidation() {
  assert.equal(validateSupplyQty({ supplyNow: 3, outstanding: 2, available: 10 }), "Cannot supply 3; only 2 outstanding.");
  assert.equal(validateSupplyQty({ supplyNow: 2, outstanding: 2, available: 1 }), "Cannot supply 2; only 1 available in warehouse.");
  assert.equal(validateSupplyQty({ supplyNow: 2, outstanding: 2, available: 2 }), null);
}

function testAgeing() {
  const settings = { normalMaxDays: 2, attentionMaxDays: 7 };
  assert.equal(ageingBand(1, settings), "Normal");
  assert.equal(ageingBand(5, settings), "Attention");
  assert.equal(ageingBand(8, settings), "Overdue");
}

function testPhase30Scenario() {
  // Isolate from browser storage
  const g = globalThis as { window?: unknown; localStorage?: Storage };
  const prevWindow = g.window;
  delete g.window;

  let state = createSeedState();
  // Seed order is Confirmed — recompute via confirm path already done; force supply readiness
  const stockMap = new Map<string, StockBalance>();
  for (const s of state.stock) stockMap.set(`${s.productId}::${s.warehouseId}`, s);
  const lines = state.orderLines.filter((l) => l.orderId === "ord-phase30");
  const status = deriveOrderStatus({ current: "Confirmed", lines, stockByKey: stockMap });
  assert.equal(status, "Awaiting Stock");

  // First supply: A=2, B=10
  const first = createSupply(state, "ord-phase30", [
    { orderLineId: "ol-a", quantity: 2 },
    { orderLineId: "ol-b", quantity: 10 },
  ]);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  state = first.data.state;
  const order1 = state.orders.find((o) => o.id === "ord-phase30")!;
  assert.equal(order1.status, "Partially Supplied");
  const lineA = state.orderLines.find((l) => l.id === "ol-a")!;
  const lineB = state.orderLines.find((l) => l.id === "ol-b")!;
  assert.equal(calcOutstanding(lineA), 2);
  assert.equal(calcOutstanding(lineB), 0);
  assert.equal(state.supplies.length, 1);

  // Over-supply blocked
  const bad = createSupply(state, "ord-phase30", [{ orderLineId: "ol-a", quantity: 3 }]);
  assert.equal(bad.ok, false);

  // Receive stock for A and auto-reserve
  const recv = receiveStock(state, "prod-chem-a", "wh-main", 2, true);
  assert.equal(recv.ok, true);
  if (!recv.ok) return;
  state = recv.data.state;
  const balA = state.stock.find((s) => s.productId === "prod-chem-a" && s.warehouseId === "wh-main")!;
  assert.ok(calcAvailable(balA) + balA.reservedQty >= 2);
  const order2 = state.orders.find((o) => o.id === "ord-phase30")!;
  assert.equal(order2.status, "Ready for Supply");

  // Second supply remaining A=2
  const second = createSupply(state, "ord-phase30", [{ orderLineId: "ol-a", quantity: 2 }]);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  state = second.data.state;
  const order3 = state.orders.find((o) => o.id === "ord-phase30")!;
  assert.equal(order3.status, "Fully Supplied");
  assert.equal(state.supplies.length, 2);
  assert.equal(getOutstandingRows(state).filter((r) => r.orderId === "ord-phase30").length, 0);

  // History preserved
  assert.equal(state.supplies[0]?.number.startsWith("TLB-SUP-"), true);
  assert.equal(state.audit.some((a) => a.action === "supply.created"), true);

  if (prevWindow !== undefined) g.window = prevWindow;
  // Keep reset helper import used in runtime demos
  void resetToSeed;
  void confirmCustomerOrder;
}

testOutstandingNeverNegative();
testSupplyValidation();
testAgeing();
testPhase30Scenario();
console.log("phase30-verify: all assertions passed");
