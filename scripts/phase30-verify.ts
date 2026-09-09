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
import {
  accountsPayable,
  accountsReceivable,
  ageingBucket,
  buildProductTrace,
  recommendBatches,
  runAskTlbPreset,
  verifyLedgerTip,
} from "../src/lib/domain/inventory";
import { stockAgeBand, stockAgeingReport } from "../src/lib/domain/analytics-pack";
import { deepReportRows, toCsv } from "../src/lib/domain/reports";
import { canAccessNav, hasPermission } from "../src/lib/domain/permissions";
import { nextDocumentNumber } from "../src/lib/domain/numbering";
import { globalSearch } from "../src/lib/domain/search";
import { createSeedState } from "../src/lib/store/seed";
import {
  advanceTransfer,
  createGoodsReceipt,
  createStockIssue,
  postStockAdjustment,
  requestWarehouseTransfer,
} from "../src/lib/store/inventory-store";
import {
  createCustomerReturn,
  createNonPoPurchase,
  decideNonPoPurchase,
  receiveImportShipment,
  receiveNonPoPurchase,
  upsertImportShipment,
} from "../src/lib/store/ops-extended-store";
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
  let counters = {
    order: 0,
    supply: 0,
    customer: 0,
    supplier: 0,
    supplierPo: 0,
    supplierReceipt: 0,
    supplierPayment: 0,
    invoice: 0,
    receipt: 0,
    delivery: 0,
    payment: 0,
    quotation: 0,
    stockMovement: 0,
    stockIssue: 0,
    transfer: 0,
    adjustment: 0,
    batch: 0,
  };
  const inv = nextDocumentNumber("invoice", counters, new Date("2026-09-09"));
  assert.match(inv.number, /^TLB-INV-2609-/);
  counters = inv.counters;
  const rct = nextDocumentNumber("receipt", counters, new Date("2026-09-09"));
  assert.match(rct.number, /^TLB-RCT-2609-/);
  counters = rct.counters;
  const dlv = nextDocumentNumber("delivery", counters, new Date("2026-09-09"));
  assert.match(dlv.number, /^TLB-DLV-2609-/);
  counters = dlv.counters;
  const mv = nextDocumentNumber("stockMovement", counters, new Date("2026-09-09"));
  assert.match(mv.number, /^TLB-MV-2609-/);
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

function testInventoryEngine() {
  const state = createSeedState();
  assert.ok(state.batches.length >= 2, "seed batches");
  assert.ok(state.stockMovements.length >= 1, "seed movements");
  assert.equal(verifyLedgerTip(state, "prod-hcl", "wh-main"), true);

  const picks = recommendBatches(state, "prod-hcl", "wh-main", 5);
  assert.equal(picks[0]?.code, "HCL-26001");

  const avail = calcAvailable(state.stock.find((s) => s.id === "stk-hcl-main")!);
  assert.equal(avail, 200 - 12 - 2);

  assert.equal(ageingBucket(10), "0-30");
  assert.equal(ageingBucket(45), "31-60");
  assert.equal(ageingBucket(100), "90+");

  const ar = accountsReceivable(state);
  assert.ok(Array.isArray(ar));
  const ap = accountsPayable(state);
  assert.ok(ap.length > 0);

  const trace = buildProductTrace(state, "prod-hcl");
  assert.ok(trace.some((n) => n.kind === "grn"));
  assert.ok(trace.some((n) => n.kind === "batch"));
  assert.ok(trace.some((n) => n.kind === "transfer"));

  const ask = runAskTlbPreset(state, "expiring_stock");
  assert.ok(ask.length >= 1);
  const empty = runAskTlbPreset(state, "incomplete_deliveries");
  assert.equal(empty.length, 0);

  let next = state;
  const grn = createGoodsReceipt(next, {
    supplierId: "sup-ningbo",
    purchaseOrderId: "spo-hcl-trace",
    warehouseId: "wh-main",
    notes: "Test GRN",
    lines: [
      {
        productId: "prod-chem-a",
        batchCode: "CHEM-A-TEST",
        orderedQty: 5,
        acceptedQty: 5,
        unitCost: 800,
        expiresAt: "2026-09-20",
      },
    ],
  });
  assert.equal(grn.ok, true);
  if (!grn.ok) return;
  next = grn.data.state;
  assert.ok(next.stockMovements.some((m) => m.type === "grn" && m.refNumber === grn.data.data.number));

  const issue = createStockIssue(next, {
    warehouseId: "wh-main",
    reason: "Sample",
    lines: [{ productId: "prod-chem-b", quantity: 1 }],
  });
  assert.equal(issue.ok, true);
  if (!issue.ok) return;
  next = issue.data.state;

  const tr = requestWarehouseTransfer(next, {
    fromWarehouseId: "wh-main",
    toWarehouseId: "wh-factory",
    lines: [{ productId: "prod-chem-b", quantity: 1 }],
  });
  assert.equal(tr.ok, true);
  if (!tr.ok) return;
  next = tr.data.state;
  const approved = advanceTransfer(next, tr.data.data.transferId, "Approved");
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  next = approved.data.state;
  const released = advanceTransfer(next, tr.data.data.transferId, "In Transit");
  assert.equal(released.ok, true);
  if (!released.ok) return;
  next = released.data.state;
  const received = advanceTransfer(next, tr.data.data.transferId, "Received");
  assert.equal(received.ok, true);
  if (!received.ok) return;
  next = received.data.state;
  assert.equal(next.transfers.find((t) => t.id === tr.data.data.transferId)?.status, "Received");

  const adj = postStockAdjustment(next, {
    kind: "count",
    lines: [
      {
        productId: "prod-eth",
        warehouseId: "wh-main",
        qtyAfter: 48,
        reason: "No variance",
      },
    ],
  });
  assert.equal(adj.ok, true);

  const outstanding = getOutstandingRows(state);
  assert.ok(outstanding.every((r) => r.demandFlag));
}

function testDeferredOpsPack() {
  const state = createSeedState();
  assert.equal(state.version, 10);
  assert.ok((state.customerReturns ?? []).length >= 1, "seed customer returns");
  assert.ok((state.nonPoPurchases ?? []).length >= 1, "seed non-po");
  assert.ok((state.importShipments ?? []).length >= 1, "seed imports");

  assert.equal(stockAgeBand(10), "0-30");
  assert.equal(stockAgeBand(45), "31-90");
  assert.equal(stockAgeBand(100), "91-180");
  assert.equal(stockAgeBand(200), "181-365");
  assert.equal(stockAgeBand(400), "365+");

  const ageing = stockAgeingReport(state);
  assert.ok(ageing.length >= 1);

  let next = state;
  const crt = createCustomerReturn(next, {
    customerId: "cus-demo",
    productId: "prod-hcl",
    batchId: "bat-hcl-26001",
    quantity: 1,
    reason: "Test return",
    condition: "Sellable",
    warehouseId: "wh-main",
    disposition: "usable",
  });
  assert.equal(crt.ok, true);
  if (!crt.ok) return;
  next = crt.data.state;
  assert.ok(next.stockMovements.some((m) => m.type === "return_customer" && m.refId === crt.data.data.returnId));

  const npo = createNonPoPurchase(next, {
    supplierId: "sup-ningbo",
    warehouseId: "wh-main",
    reason: "Emergency top-up for test",
    lines: [{ productId: "prod-eth", quantity: 1, unitPrice: 400 }],
  });
  assert.equal(npo.ok, true);
  if (!npo.ok) return;
  next = npo.data.state;
  const decided = decideNonPoPurchase(next, npo.data.data.nonPoId, "Approved");
  assert.equal(decided.ok, true);
  if (!decided.ok) return;
  next = decided.data.state;
  const received = receiveNonPoPurchase(next, npo.data.data.nonPoId);
  assert.equal(received.ok, true);
  if (!received.ok) return;
  next = received.data.state;
  assert.equal(next.nonPoPurchases.find((n) => n.id === npo.data.data.nonPoId)?.status, "Goods Received");

  const imp = upsertImportShipment(next, {
    supplierId: "sup-ningbo",
    originCountry: "China",
    warehouseId: "wh-main",
    status: "Customs Cleared",
    lines: [{ productId: "prod-chem-a", quantity: 2, unitCost: 800 }],
  });
  assert.equal(imp.ok, true);
  if (!imp.ok) return;
  next = imp.data.state;
  const receivedImp = receiveImportShipment(next, imp.data.data.shipmentId);
  assert.equal(receivedImp.ok, true);

  const returnsAsk = runAskTlbPreset(createSeedState(), "returns");
  assert.ok(returnsAsk.length >= 1);
  const slowAsk = runAskTlbPreset(createSeedState(), "slow_dead_stock");
  assert.ok(Array.isArray(slowAsk));

  const csvRows = deepReportRows(createSeedState(), "ageing");
  assert.ok(csvRows.length >= 1);
  assert.ok(toCsv(csvRows).includes("batchCode") || toCsv(csvRows).includes("band"));
}

testOutstandingNeverNegative();
testSupplyValidation();
testAgeing();
testNumbering();
testPermissions();
testPhase30Scenario();
testInventoryEngine();
testDeferredOpsPack();
console.log("phase30-verify: all assertions passed (P0 inventory + P1 + Ask TLB + deferred ops)");
