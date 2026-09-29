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
  resolveAskTlbHitOpen,
  runAskTlbPreset,
  verifyLedgerTip,
} from "../src/lib/domain/inventory";
import { stockAgeBand, stockAgeingReport } from "../src/lib/domain/analytics-pack";
import { deepReportRows, toCsv } from "../src/lib/domain/reports";
import { mergeStaffUsers, staffUsersForRemoteDirectory } from "../src/lib/domain/invites";
import { canAccessNav, dbRoleCodeForRoleId, hasPermission } from "../src/lib/domain/permissions";
import { nextDocumentNumber } from "../src/lib/domain/numbering";
import { getPeriodRange, isoInRange, livePeriodAsOf } from "../src/lib/domain/period-range";
import { globalSearch } from "../src/lib/domain/search";
import { createSeedState } from "../src/lib/store/seed";
import {
  advanceTransfer,
  createGoodsReceipt,
  createStockIssue,
  getOrCreateBalance,
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
  acknowledgeOpsRequest,
  advanceOpsDriverStatus,
  assignOpsDriver,
  autoReviewOpsLines,
  confirmOpsDeliveryReceipt,
  confirmOpsWarehouseCollection,
  createOpsRequest,
  decideOpsRequestApproval,
  markOpsReadyForCollection,
  prepareOpsRequest,
  releaseOpsGoods,
  submitOpsRequest,
} from "../src/lib/store/ops-hub-store";
import {
  opsDiscrepancyMissing,
  opsOutstandingShortage,
  listOutstandingOpsRows,
} from "../src/lib/domain/ops-hub";
import {
  acceptInvite,
  applyHostedInviteAcceptance,
  assignUserRole,
  confirmCustomerOrder,
  createCustomerOrder,
  createDeliveryFromSupply,
  createInvoiceFromSupply,
  createOrdinaryReceipt,
  createReceiptFromSupply,
  createSupply,
  deleteRole,
  getOutstandingRows,
  issueUserInvite,
  markDelivered,
  receiveStock,
  resetToSeed,
  switchRole,
  switchSessionUser,
  updateDeliveryStatus,
  upsertAppUser,
} from "../src/lib/store/tlb-store";
import { createSystemRoles, OWNER_USER_ID, SYSTEM_ROLE_IDS } from "../src/lib/domain/permissions";
import type {
  CustomerOrderLine,
  StockBalance,
  SystemRoleKey,
  TlbState,
} from "../src/lib/domain/types";

function withSystemRole(state: TlbState, key: SystemRoleKey): TlbState {
  const role = createSystemRoles().find((item) => item.systemKey === key);
  if (!role) throw new Error(`Missing system role ${key}`);
  if (!state.roles.some((item) => item.id === role.id)) {
    state.roles.push({ ...role, permissions: [...role.permissions] });
  }
  return state;
}

/** In-memory session for permission checks. The app itself cannot switch roles. */
function sessionAs(state: TlbState, userId: string, key: SystemRoleKey): TlbState {
  const next = structuredClone(state);
  withSystemRole(next, key);
  const roleId = SYSTEM_ROLE_IDS[key];
  const user = next.users.find((item) => item.id === userId);
  if (!user) throw new Error(`Missing user ${userId}`);
  user.roleId = roleId;
  next.currentUserId = userId;
  next.currentRoleId = roleId;
  next.currentRole = key;
  return next;
}

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
  assert.equal(
    validateSupplyQty({ supplyNow: 3, outstanding: 2, available: 10 }),
    "Cannot supply 3; only 2 outstanding.",
  );
  assert.equal(
    validateSupplyQty({ supplyNow: 2, outstanding: 2, available: 1 }),
    "Cannot supply 2; only 1 available in warehouse.",
  );
  assert.equal(validateSupplyQty({ supplyNow: 2, outstanding: 2, available: 2 }), null);
}

function testAgeing() {
  const settings = {
    normalMaxDays: 2,
    attentionMaxDays: 7,
    extendedUnfulfilledDays: 14,
    expectedApproachingDays: 2,
  };
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
  assert.deepEqual(
    state.roles.map((role) => role.systemKey),
    [
      "Owner",
      "Admin",
      "Manager",
      "Sales",
      "Warehouse",
      "Finance",
      "Driver",
      "Requester",
      "Receiver",
    ],
  );
  assert.ok(state.users.every((user) => user.roleId === SYSTEM_ROLE_IDS.Owner));
  const switched = switchRole(state, "Sales");
  assert.equal(switched.ok, false);
  assert.equal(state.currentRole, "Owner");

  // Non-Owner session cannot delete roles.
  const asSales = sessionAs(state, "user-sales", "Sales");
  withSystemRole(asSales, "Warehouse");
  const blockedDelete = deleteRole(asSales, SYSTEM_ROLE_IDS.Warehouse);
  assert.equal(blockedDelete.ok, false);

  // Owner assigns a predefined role without changing the signed-in session.
  const roleState = withSystemRole(structuredClone(state), "Warehouse");
  const assigned = assignUserRole(roleState, "user-sales", SYSTEM_ROLE_IDS.Warehouse);
  assert.equal(assigned.ok, true);
  if (!assigned.ok) return;
  assert.equal(assigned.data.data.roleId, SYSTEM_ROLE_IDS.Warehouse);
  assert.equal(assigned.data.state.currentRole, "Owner");
  assert.equal(assigned.data.state.currentUserId, state.currentUserId);

  // Owner can still move a system role to trash; assigned users return to Owner.
  const deleted = deleteRole(assigned.data.state, SYSTEM_ROLE_IDS.Warehouse);
  assert.equal(deleted.ok, true);
  if (!deleted.ok) return;
  const warehouseGone = deleted.data.state.roles.find((r) => r.id === SYSTEM_ROLE_IDS.Warehouse);
  assert.equal(warehouseGone?.active, false);
  const salesUser = deleted.data.state.users.find((u) => u.id === "user-sales");
  assert.equal(salesUser?.roleId, SYSTEM_ROLE_IDS.Owner);
  assert.ok(deleted.data.state.audit.some((a) => a.action === "role.deleted"));

  // Owner role itself cannot be deleted.
  const blockOwner = deleteRole(deleted.data.state, SYSTEM_ROLE_IDS.Owner);
  assert.equal(blockOwner.ok, false);

  // Last active Owner cannot be demoted or deactivated.
  const demoteLast = assignUserRole(state, OWNER_USER_ID, SYSTEM_ROLE_IDS.Admin);
  assert.equal(demoteLast.ok, false);
  const soleOwner = structuredClone(state);
  for (const user of soleOwner.users) {
    if (user.id !== OWNER_USER_ID) user.active = false;
  }
  const deactivateLast = upsertAppUser(soleOwner, {
    id: OWNER_USER_ID,
    name: "TLB Owner",
    email: "owner@tlb.gh",
    roleId: SYSTEM_ROLE_IDS.Owner,
    active: false,
  });
  assert.equal(deactivateLast.ok, false);

  // Editing other staff profile fields succeeds and is audited.
  const edited = upsertAppUser(structuredClone(state), {
    id: "user-sales",
    name: "Ama Mensah Updated",
    email: "ama.updated@tlb.gh",
    roleId: SYSTEM_ROLE_IDS.Owner,
    active: true,
  });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  assert.equal(edited.data.data.name, "Ama Mensah Updated");
  assert.equal(edited.data.data.email, "ama.updated@tlb.gh");
  assert.ok(
    edited.data.state.audit.some((a) => a.action === "user.updated" && a.entityId === "user-sales"),
  );
}

function testInvites() {
  const state = withSystemRole(withSystemRole(createSeedState(), "Warehouse"), "Sales");
  const created = upsertAppUser(state, {
    name: "Invite Test User",
    email: "invite.test@tlb.gh",
    roleId: SYSTEM_ROLE_IDS.Owner,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const user = created.data.data;
  assert.ok(user.inviteToken);
  assert.ok(user.inviteCode);
  assert.equal(user.invitePending, true);

  const accepted = acceptInvite(created.data.state, { code: user.inviteCode! });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.data.state.currentUserId, user.id);
  assert.equal(accepted.data.data.invitePending, false);

  const backAsOwner = switchSessionUser(accepted.data.state, OWNER_USER_ID);
  assert.equal(backAsOwner.ok, true);
  if (!backAsOwner.ok) return;
  const reissued = issueUserInvite(backAsOwner.data.state, user.id);
  assert.equal(reissued.ok, true);
  if (!reissued.ok) return;
  assert.notEqual(reissued.data.data.inviteCode, user.inviteCode);
  assert.equal(reissued.data.data.invitePending, true);

  assert.equal(dbRoleCodeForRoleId(SYSTEM_ROLE_IDS.Warehouse), "WAREHOUSE");
  assert.equal(dbRoleCodeForRoleId("role-custom"), null);

  const mirrored = applyHostedInviteAcceptance(created.data.state, {
    profileId: "11111111-1111-1111-1111-111111111111",
    email: user.email,
    fullName: "Invite Test User",
    roleCode: "WAREHOUSE",
  });
  assert.equal(mirrored.ok, true);
  if (!mirrored.ok) return;
  assert.equal(mirrored.data.state.currentUserId, user.id);
  assert.equal(mirrored.data.data.invitePending, false);
  assert.equal(mirrored.data.state.currentRole, "Owner");

  const createdRemote = applyHostedInviteAcceptance(state, {
    profileId: "22222222-2222-2222-2222-222222222222",
    email: "new.person@tlb.gh",
    fullName: "New Person",
    roleCode: "SALES",
  });
  assert.equal(createdRemote.ok, true);
  if (!createdRemote.ok) return;
  assert.equal(createdRemote.data.state.currentUserId, "22222222-2222-2222-2222-222222222222");
  assert.equal(createdRemote.data.state.currentRole, "Owner");

  const badRole = applyHostedInviteAcceptance(state, {
    profileId: "33333333-3333-3333-3333-333333333333",
    email: "x@tlb.gh",
    fullName: "X",
    roleCode: "CUSTOM",
  });
  assert.equal(badRole.ok, false);

  const stripped = staffUsersForRemoteDirectory([user]);
  assert.equal(stripped[0]?.inviteToken, undefined);
  assert.equal(stripped[0]?.inviteCode, undefined);
  assert.equal(stripped[0]?.email, user.email);
  const merged = mergeStaffUsers(stripped, [user]);
  assert.equal(merged[0]?.inviteToken, user.inviteToken);
  assert.equal(merged[0]?.inviteCode, user.inviteCode);
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

  const supplyReceipt = createReceiptFromSupply(state, {
    orderId: "ord-phase30",
    supplyId: second.data.data.supplyId,
    paymentMethod: "Cash",
  });
  assert.equal(supplyReceipt.ok, true, supplyReceipt.ok ? "" : supplyReceipt.error);
  if (!supplyReceipt.ok) return;
  state = supplyReceipt.data.state;
  assert.match(supplyReceipt.data.data.number, /^TLB-RCT-/);
  assert.ok(state.receiptLines.some((l) => l.receiptId === supplyReceipt.data.data.id));
  assert.ok(supplyReceipt.data.data.amountPaid > 0);
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
  assert.equal(
    state.audit.some((a) => a.action === "supply.created"),
    true,
  );
  assert.equal(
    state.audit.some((a) => a.action === "delivery.created"),
    true,
  );
  assert.equal(
    state.audit.some((a) => a.action === "receipt.created"),
    true,
  );

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
  assert.ok(
    next.stockMovements.some((m) => m.type === "grn" && m.refNumber === grn.data.data.number),
  );

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
  assert.equal(state.version, 14);
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
  assert.ok(
    next.stockMovements.some(
      (m) => m.type === "return_customer" && m.refId === crt.data.data.returnId,
    ),
  );

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
  assert.equal(
    next.nonPoPurchases.find((n) => n.id === npo.data.data.nonPoId)?.status,
    "Goods Received",
  );

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

/**
 * §49 Operations Hub workflow:
 * Factory requests Chemical A 50 + Material B 20; stock A=50 B=15 → A full / B partial;
 * approve A50 B15; outstanding B=5; prepare FEFO; release; driver collect → In Transit;
 * receive A50 B14 → discrepancy B missing 1; outstanding shortage remains 5.
 * Do not merge shortage 5 and missing 1.
 */
function testSection49OpsHubWorkflow() {
  let state = createSeedState();
  assert.ok(state.opsDrivers.length >= 1, "seed drivers");
  assert.ok(
    state.products.some((p) => p.id === "prod-mat-b"),
    "Material B product",
  );
  assert.match(nextDocumentNumber("opsRequest", { ...state.counters }).number, /^TLB-REQ-/);

  // Set stock: Chemical A = 50, Material B = 15 at main (and FEFO batches).
  const balA = getOrCreateBalance(state, "prod-chem-a", "wh-main");
  balA.physicalQty = 50;
  balA.reservedQty = 0;
  const balB = getOrCreateBalance(state, "prod-mat-b", "wh-main");
  balB.physicalQty = 15;
  balB.reservedQty = 0;
  // Ensure FEFO batches cover release qty.
  const batA = state.batches.find(
    (b) => b.productId === "prod-chem-a" && b.warehouseId === "wh-main",
  );
  if (batA) {
    batA.remainingQty = 50;
    batA.receivedQty = 50;
    batA.status = "Open";
  } else {
    state.batches.push({
      id: "bat-chema-49",
      code: "CHEMA-49",
      productId: "prod-chem-a",
      warehouseId: "wh-main",
      receivedQty: 50,
      remainingQty: 50,
      unitCost: 850,
      receivedAt: new Date().toISOString(),
      status: "Open",
    });
  }
  const batB = state.batches.find(
    (b) => b.productId === "prod-mat-b" && b.warehouseId === "wh-main",
  );
  if (batB) {
    batB.remainingQty = 15;
    batB.receivedQty = 15;
    batB.status = "Open";
  }

  const created = createOpsRequest(state, {
    type: "Factory Draw",
    priority: "High",
    title: "§49 Factory draw A+B",
    destination: "Factory line 2",
    warehouseId: "wh-main",
    lines: [
      { productId: "prod-chem-a", quantity: 50 },
      { productId: "prod-mat-b", quantity: 20 },
    ],
    submit: true,
  });
  assert.equal(created.ok, true, created.ok ? "" : created.error);
  if (!created.ok) return;
  state = created.data.state;
  const requestId = created.data.data.requestId;
  assert.match(created.data.data.number, /^TLB-REQ-/);
  assert.equal(state.opsRequests.find((r) => r.id === requestId)?.status, "Pending Approval");

  const ack = acknowledgeOpsRequest(state, requestId);
  assert.equal(ack.ok, true);
  if (!ack.ok) return;
  state = ack.data.state;

  const lines = state.opsRequestLines.filter((l) => l.requestId === requestId);
  const lineA = lines.find((l) => l.productId === "prod-chem-a")!;
  const lineB = lines.find((l) => l.productId === "prod-mat-b")!;
  assert.ok(lineA && lineB);

  // Availability intelligence: A full (50), B partial (15 of 20).
  assert.equal(calcAvailable(getOrCreateBalance(state, "prod-chem-a", "wh-main")), 50);
  assert.equal(calcAvailable(getOrCreateBalance(state, "prod-mat-b", "wh-main")), 15);

  const approved = decideOpsRequestApproval(state, requestId, "Partial", {
    note: "Approve available stock only",
    lineApprovals: [
      { lineId: lineA.id, approvedQty: 50 },
      { lineId: lineB.id, approvedQty: 15 },
    ],
  });
  assert.equal(approved.ok, true, approved.ok ? "" : approved.error);
  if (!approved.ok) return;
  state = approved.data.state;
  const afterApprA = state.opsRequestLines.find((l) => l.id === lineA.id)!;
  const afterApprB = state.opsRequestLines.find((l) => l.id === lineB.id)!;
  assert.equal(afterApprA.approvedQty, 50);
  assert.equal(afterApprB.approvedQty, 15);
  assert.equal(opsOutstandingShortage(afterApprB), 5, "Material B outstanding shortage = 5");
  assert.equal(opsOutstandingShortage(afterApprA), 0);
  assert.equal(opsDiscrepancyMissing(afterApprB), 0, "no delivery discrepancy yet");

  const reviewed = autoReviewOpsLines(state, requestId);
  assert.equal(reviewed.ok, true);
  if (!reviewed.ok) return;
  state = reviewed.data.state;

  const prepared = prepareOpsRequest(state, requestId, {
    lines: [
      { lineId: lineA.id, preparedQty: 50 },
      { lineId: lineB.id, preparedQty: 15 },
    ],
  });
  assert.equal(prepared.ok, true, prepared.ok ? "" : prepared.error);
  if (!prepared.ok) return;
  state = prepared.data.state;

  const ready = markOpsReadyForCollection(state, requestId);
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  state = ready.data.state;

  const driverId = state.opsDrivers[0]!.id;
  const released = releaseOpsGoods(state, requestId, { driverId });
  assert.equal(released.ok, true, released.ok ? "" : released.error);
  if (!released.ok) return;
  state = released.data.state;
  assert.ok(state.stockMovements.some((m) => m.refType === "ops_request" && m.refId === requestId));
  assert.ok(state.stockMovements.some((m) => m.refId === requestId && m.qtyBefore !== m.qtyAfter));
  assert.equal(state.opsRequests.find((r) => r.id === requestId)?.status, "Issued");

  const whCollect = confirmOpsWarehouseCollection(state, requestId);
  assert.equal(whCollect.ok, true);
  if (!whCollect.ok) return;
  state = whCollect.data.state;

  let drv = advanceOpsDriverStatus(state, requestId, "En Route Warehouse");
  assert.equal(drv.ok, true);
  if (!drv.ok) return;
  state = drv.data.state;
  drv = advanceOpsDriverStatus(state, requestId, "Arrived Warehouse");
  assert.equal(drv.ok, true);
  if (!drv.ok) return;
  state = drv.data.state;
  drv = advanceOpsDriverStatus(state, requestId, "Collected");
  assert.equal(drv.ok, true);
  if (!drv.ok) return;
  state = drv.data.state;
  drv = advanceOpsDriverStatus(state, requestId, "Departed");
  assert.equal(drv.ok, true);
  if (!drv.ok) return;
  state = drv.data.state;
  assert.equal(state.opsRequests.find((r) => r.id === requestId)?.status, "In Transit");

  drv = advanceOpsDriverStatus(state, requestId, "Arrived Destination");
  assert.equal(drv.ok, true);
  if (!drv.ok) return;
  state = drv.data.state;

  const receipt = confirmOpsDeliveryReceipt(state, requestId, {
    outcome: "Partial",
    receivedBy: "Factory receiver",
    notes: "Material B short one bag on arrival",
    lines: [
      { lineId: lineA.id, receivedQty: 50, missingQty: 0 },
      { lineId: lineB.id, receivedQty: 14, missingQty: 1 },
    ],
  });
  assert.equal(receipt.ok, true, receipt.ok ? "" : receipt.error);
  if (!receipt.ok) return;
  state = receipt.data.state;

  const finalA = state.opsRequestLines.find((l) => l.id === lineA.id)!;
  const finalB = state.opsRequestLines.find((l) => l.id === lineB.id)!;
  assert.equal(finalA.receivedQty, 50);
  assert.equal(finalB.receivedQty, 14);
  assert.equal(opsDiscrepancyMissing(finalB), 1, "delivery missing discrepancy = 1");
  assert.equal(opsOutstandingShortage(finalB), 5, "warehouse outstanding shortage remains 5");
  assert.notEqual(
    opsOutstandingShortage(finalB),
    opsDiscrepancyMissing(finalB),
    "must not merge 5 and 1",
  );

  const outstandingRows = listOutstandingOpsRows(state).filter((r) => r.requestId === requestId);
  assert.ok(outstandingRows.some((r) => r.productId === "prod-mat-b" && r.outstandingQty === 5));
  assert.ok(
    outstandingRows.some((r) => r.productId === "prod-mat-b" && r.missingDiscrepancyQty === 1),
  );

  const disc = state.opsDiscrepancies.filter(
    (d) => d.requestId === requestId && d.kind === "missing",
  );
  assert.ok(disc.some((d) => d.productId === "prod-mat-b" && d.quantity === 1));

  const searchHits = globalSearch(state, created.data.data.number);
  assert.ok(searchHits.some((h) => h.kind === "Ops Request"));

  const askOut = runAskTlbPreset(state, "ops_outstanding");
  assert.ok(askOut.some((h) => h.entityId === requestId && h.nav === "Requests"));
  const askDisc = runAskTlbPreset(state, "ops_discrepancies");
  assert.ok(askDisc.some((h) => h.entityId === requestId && h.nav === "Requests"));
}

function testAskTlbOpenRouting() {
  const state = createSeedState();

  const outstanding = runAskTlbPreset(state, "outstanding");
  assert.ok(outstanding.length > 0);
  assert.ok(outstanding.every((h) => h.nav === "Sales Orders" && Boolean(h.entityId)));
  const openOrder = resolveAskTlbHitOpen(outstanding[0]!);
  assert.equal(openOrder.nav, "Sales Orders");
  assert.equal(openOrder.orderId, outstanding[0]!.entityId);
  assert.equal(openOrder.focusEntityId, undefined);

  const customers = runAskTlbPreset(state, "customer_performance");
  assert.ok(customers.length > 0);
  const openCustomer = resolveAskTlbHitOpen(customers[0]!);
  assert.equal(openCustomer.customerId, customers[0]!.entityId);
  assert.equal(openCustomer.orderId, undefined);

  const owing = runAskTlbPreset(state, "customers_owing");
  if (owing.length > 0) {
    assert.ok(owing.every((h) => h.nav === "Finance"));
    const openInv = resolveAskTlbHitOpen(owing[0]!);
    assert.equal(openInv.focusEntityId, owing[0]!.entityId);
  }

  const low = runAskTlbPreset(state, "low_stock");
  if (low.length > 0) {
    assert.ok(low.every((h) => h.nav === "Products"));
    const openProduct = resolveAskTlbHitOpen(low[0]!);
    assert.equal(openProduct.focusEntityId, low[0]!.entityId);
  }

  const suppliersOwed = runAskTlbPreset(state, "suppliers_owed");
  if (suppliersOwed.length > 0) {
    assert.ok(suppliersOwed.every((h) => h.nav === "Suppliers"));
    const openSup = resolveAskTlbHitOpen(suppliersOwed[0]!);
    assert.equal(openSup.supplierId, suppliersOwed[0]!.entityId);
  }

  const batches = runAskTlbPreset(state, "expiring_stock");
  if (batches.length > 0) {
    const openBatch = resolveAskTlbHitOpen(batches[0]!);
    assert.equal(openBatch.focusEntityId, batches[0]!.entityId);
    assert.equal(openBatch.nav, "Batches");
  }

  console.log("ask-tlb-open-routing: assertions passed");
}

testOutstandingNeverNegative();
testSupplyValidation();
testAgeing();
testNumbering();
testPermissions();
testInvites();
testPhase30Scenario();
testInventoryEngine();
testDeferredOpsPack();
testSection49OpsHubWorkflow();
testAskTlbOpenRouting();
testHandoverWorkflowGaps();
console.log(
  "phase30-verify: all assertions passed (P0 inventory + P1 + Ask TLB + deferred ops + §49 Ops Hub)",
);

function testHandoverWorkflowGaps() {
  const asOf = livePeriodAsOf(new Date("2026-09-28T12:00:00.000Z"));
  assert.match(asOf, /^2026-09-2[89]/);
  const month = getPeriodRange("This Month", asOf);
  assert.equal(isoInRange("2026-09-28T12:00:00.000Z", month), true);
  const demoToday = getPeriodRange("Today", "2026-09-09T12:00:00.000Z");
  assert.equal(isoInRange("2026-09-28T12:00:00.000Z", demoToday), false);

  let state = createSeedState();
  const over = createCustomerOrder(state, {
    customerId: "cus-demo",
    lines: [{ productId: "prod-hcl", warehouseId: "wh-main", orderedQty: 400, unitPrice: 1000 }],
  });
  assert.equal(over.ok, true);
  if (!over.ok) return;
  state = over.data.state;
  const blocked = confirmCustomerOrder(state, over.data.data.id);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.match(blocked.error, /override reason/);

  const asSales = sessionAs(state, "user-sales", "Sales");
  const salesOverride = confirmCustomerOrder(asSales, over.data.data.id, "Sales tried");
  assert.equal(salesOverride.ok, false);
  if (salesOverride.ok) return;
  assert.match(salesOverride.error, /manager approval/);

  const asManager = sessionAs(state, "user-manager", "Manager");
  const managerOverride = confirmCustomerOrder(
    asManager,
    over.data.data.id,
    "Approved for campaign",
  );
  assert.equal(managerOverride.ok, true, managerOverride.ok ? "" : managerOverride.error);

  const hclOrder = createCustomerOrder(createSeedState(), {
    customerId: "cus-demo",
    lines: [{ productId: "prod-hcl", warehouseId: "wh-main", orderedQty: 186, unitPrice: 100 }],
  });
  assert.equal(hclOrder.ok, true);
  if (!hclOrder.ok) return;
  let stockState = hclOrder.data.state;
  const confirmed = confirmCustomerOrder(stockState, hclOrder.data.data.id);
  assert.equal(confirmed.ok, true, confirmed.ok ? "" : confirmed.error);
  if (!confirmed.ok) return;
  stockState = confirmed.data.state;
  const line = stockState.orderLines.find((l) => l.orderId === hclOrder.data.data.id);
  assert.ok(line);
  if (!line) return;
  const supplied = createSupply(stockState, hclOrder.data.data.id, [
    { orderLineId: line.id, quantity: 186 },
  ]);
  assert.equal(supplied.ok, true, supplied.ok ? "" : supplied.error);
  if (!supplied.ok) return;
  stockState = supplied.data.state;
  const moved = stockState.stockMovements
    .filter((m) => m.refId === supplied.data.data.supplyId)
    .reduce((sum, m) => sum + m.qtyMove, 0);
  assert.equal(moved, 186);
  assert.equal(calcOutstanding(stockState.orderLines.find((l) => l.id === line.id)!), 0);
  assert.equal(verifyLedgerTip(stockState, "prod-hcl", "wh-main"), true);

  const issue = createStockIssue(createSeedState(), {
    warehouseId: "wh-main",
    reason: "Internal use",
    lines: [{ productId: "prod-hcl", quantity: 186 }],
  });
  assert.equal(issue.ok, true, issue.ok ? "" : issue.error);
  if (!issue.ok) return;
  const issued = issue.data.state.stockMovements
    .filter((m) => m.refId === issue.data.data.issueId)
    .reduce((sum, m) => sum + m.qtyMove, 0);
  assert.equal(issued, 186);
  assert.equal(verifyLedgerTip(issue.data.state, "prod-hcl", "wh-main"), true);

  console.log("handover-workflow-gaps: assertions passed");
}
