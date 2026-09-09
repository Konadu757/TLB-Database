/**
 * Focused domain tests for outstanding calc, partial supply rules, status transitions,
 * and P1 invoice / receipt / delivery document rules.
 * Run: npm run test:domain
 */
import assert from "node:assert/strict";

import {
  ageingBand,
  calcAvailable,
  calcOutstanding,
  deriveOrderStatus,
  validateSupplyQty,
} from "../src/lib/domain/calculations";
import { canAccessNav, hasPermission } from "../src/lib/domain/permissions";
import { nextDocumentNumber } from "../src/lib/domain/numbering";
import { globalSearch } from "../src/lib/domain/search";
import { createSeedState } from "../src/lib/store/seed";
import {
  assignUserRole,
  confirmCustomerOrder,
  createDeliveryFromSupply,
  createInvoiceFromSupply,
  createOrdinaryReceipt,
  createRole,
  createSupply,
  deactivateRole,
  getOutstandingRows,
  markDelivered,
  receiveStock,
  resetToSeed,
  switchSessionUser,
  updateDeliveryStatus,
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
  const settings = { normalMaxDays: 2, attentionMaxDays: 7, extendedUnfulfilledDays: 14, expectedApproachingDays: 2 };
  assert.equal(ageingBand(1, settings), "Normal");
  assert.equal(ageingBand(5, settings), "Attention");
  assert.equal(ageingBand(8, settings), "Overdue");
}

function testNumbering() {
  let counters = { order: 0, supply: 0, customer: 0, invoice: 0, receipt: 0, delivery: 0, payment: 0 };
  const inv = nextDocumentNumber("invoice", counters, new Date("2026-09-09"));
  assert.match(inv.number, /^TLB-INV-2609-/);
  counters = inv.counters;
  const rct = nextDocumentNumber("receipt", counters, new Date("2026-09-09"));
  assert.match(rct.number, /^TLB-RCT-2609-/);
  counters = rct.counters;
  const dlv = nextDocumentNumber("delivery", counters, new Date("2026-09-09"));
  assert.match(dlv.number, /^TLB-DLV-2609-/);
}

function testPermissions() {
  assert.equal(hasPermission("Sales", "orders.create"), true);
  assert.equal(hasPermission("Warehouse", "supply.create"), true);
  assert.equal(hasPermission("Warehouse", "invoice.create"), false);
  assert.equal(hasPermission("Finance", "invoice.create"), true);
  assert.equal(hasPermission("Admin", "settings.manage"), true);
  assert.equal(hasPermission("Owner", "users.manage"), true);
  assert.equal(hasPermission("Manager", "users.manage"), false);

  const state = createSeedState();
  assert.equal(state.currentUser, "TLB Owner");
  assert.equal(state.currentRole, "Owner");
  assert.equal(hasPermission(state, "users.manage"), true);
  assert.equal(canAccessNav(state, "Settings"), true);
  assert.equal(canAccessNav(state, "Finance"), true);

  const created = createRole(state, {
    name: "Procurement Lead",
    description: "Supplier and stock intake",
    permissions: ["dashboard.view", "suppliers.manage", "stock.receive", "stock.view"],
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const roleId = created.data.data.id;
  const assigned = assignUserRole(created.data.state, "user-sales", roleId);
  assert.equal(assigned.ok, true);
  if (!assigned.ok) return;
  const switched = switchSessionUser(assigned.data.state, "user-sales");
  assert.equal(switched.ok, true);
  if (!switched.ok) return;
  assert.equal(switched.data.state.currentRole, "Procurement Lead");
  assert.equal(hasPermission(switched.data.state, "suppliers.manage"), true);
  assert.equal(hasPermission(switched.data.state, "invoice.create"), false);
  assert.equal(canAccessNav(switched.data.state, "Suppliers"), true);
  assert.equal(canAccessNav(switched.data.state, "Finance"), false);

  const blockedDelete = deactivateRole(switched.data.state, roleId);
  assert.equal(blockedDelete.ok, false);
}

function testPhase30Scenario() {
  const g = globalThis as { window?: unknown; localStorage?: Storage };
  const prevWindow = g.window;
  delete g.window;

  let state = createSeedState();
  const stockMap = new Map<string, StockBalance>();
  for (const s of state.stock) stockMap.set(`${s.productId}::${s.warehouseId}`, s);
  const lines = state.orderLines.filter((l) => l.orderId === "ord-phase30");
  const status = deriveOrderStatus({ current: "Confirmed", lines, stockByKey: stockMap });
  assert.equal(status, "Awaiting Stock");

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

  // Invoice + delivery from first supply while outstanding remains
  const vatId = state.vatRates[0]!.id;
  const supplyId = state.supplies[0]!.id;
  const invoice = createInvoiceFromSupply(state, {
    orderId: "ord-phase30",
    supplyId,
    vatRateId: vatId,
  });
  assert.equal(invoice.ok, true);
  if (!invoice.ok) return;
  state = invoice.data.state;
  assert.match(invoice.data.data.number, /^TLB-INV-/);
  assert.equal(invoice.data.data.customerTin, "C0001234567");
  assert.ok(state.audit.some((a) => a.action === "invoice.created"));

  const delivery = createDeliveryFromSupply(state, {
    orderId: "ord-phase30",
    supplyId,
    address: "12 Spintex Road, Accra",
    method: "Own fleet",
    driver: "Yaw",
  });
  assert.equal(delivery.ok, true);
  if (!delivery.ok) return;
  state = delivery.data.state;
  assert.match(delivery.data.data.number, /^TLB-DLV-/);

  // Confirming delivery must NOT mark whole order Delivered while outstanding remains
  const deliveredPartial = updateDeliveryStatus(state, delivery.data.data.id, "Delivered");
  assert.equal(deliveredPartial.ok, true);
  if (!deliveredPartial.ok) return;
  state = deliveredPartial.data.state;
  assert.equal(state.orders.find((o) => o.id === "ord-phase30")!.status, "Partially Supplied");

  const receipt = createOrdinaryReceipt(state, {
    customerId: "cus-demo",
    orderId: "ord-phase30",
    invoiceId: invoice.data.data.id,
    paymentMethod: "Bank Transfer",
    amountPaid: invoice.data.data.total,
  });
  assert.equal(receipt.ok, true);
  if (!receipt.ok) return;
  state = receipt.data.state;
  assert.match(receipt.data.data.number, /^TLB-RCT-/);
  assert.equal(state.invoices.find((i) => i.id === invoice.data.data.id)!.paymentStatus, "Paid");

  const bad = createSupply(state, "ord-phase30", [{ orderLineId: "ol-a", quantity: 3 }]);
  assert.equal(bad.ok, false);

  const recv = receiveStock(state, "prod-chem-a", "wh-main", 2, true);
  assert.equal(recv.ok, true);
  if (!recv.ok) return;
  state = recv.data.state;
  assert.equal(state.orders.find((o) => o.id === "ord-phase30")!.status, "Ready for Supply");

  const second = createSupply(state, "ord-phase30", [{ orderLineId: "ol-a", quantity: 2 }]);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  state = second.data.state;
  assert.equal(state.orders.find((o) => o.id === "ord-phase30")!.status, "Fully Supplied");
  assert.equal(state.supplies.length, 2);
  assert.equal(getOutstandingRows(state).filter((r) => r.orderId === "ord-phase30").length, 0);

  const mark = markDelivered(state, "ord-phase30");
  assert.equal(mark.ok, true);
  if (!mark.ok) return;
  state = mark.data.state;
  assert.equal(state.orders.find((o) => o.id === "ord-phase30")!.status, "Delivered");

  const hits = globalSearch(state, "TLB-INV");
  assert.ok(hits.some((h) => h.kind === "Invoice"));
  const poHits = globalSearch(state, "DCL-PO-8841");
  assert.ok(poHits.some((h) => h.kind === "Order"));

  assert.equal(state.supplies[0]?.number.startsWith("TLB-SUP-"), true);
  assert.equal(state.audit.some((a) => a.action === "supply.created"), true);
  assert.equal(state.audit.some((a) => a.action === "delivery.created"), true);
  assert.equal(state.audit.some((a) => a.action === "receipt.created"), true);

  if (prevWindow !== undefined) g.window = prevWindow;
  void resetToSeed;
  void confirmCustomerOrder;
  void calcAvailable;
}

testOutstandingNeverNegative();
testSupplyValidation();
testAgeing();
testNumbering();
testPermissions();
testPhase30Scenario();
console.log("phase30-verify: all assertions passed (P0 + P1)");
