/**
 * Soft-delete / Trash coverage for newly trashable entity types.
 * Run: npx tsx scripts/trash-verify.ts
 */
import assert from "node:assert/strict";

import { listTrashItems, isSoftDeleted } from "../src/lib/domain/trash";
import { createSeedState } from "../src/lib/store/seed";
import {
  purgeTrashItem,
  restoreTrashItem,
  softDeleteRecord,
  trashBlockReason,
} from "../src/lib/store/trash-store";
import { switchSessionUser } from "../src/lib/store/tlb-store";

function ownerState() {
  let state = createSeedState();
  const owner = state.users.find((u) => {
    const role = state.roles.find((r) => r.id === u.roleId);
    return role?.systemKey === "Owner" || role?.name === "Owner";
  });
  assert.ok(owner, "seed Owner user");
  const switched = switchSessionUser(state, owner!.id);
  assert.equal(switched.ok, true);
  if (switched.ok) state = switched.data.state;
  return state;
}

function ensureSeedInvoice(state: ReturnType<typeof createSeedState>) {
  if (state.invoices[0]) return state.invoices[0];
  const customerId = state.customers[0]?.id ?? "cus-demo";
  const orderId = state.orders[0]?.id ?? "ord-phase30";
  const now = new Date().toISOString();
  const invoice = {
    id: "inv-test-trash",
    number: "TLB-INV-TEST-001",
    customerId,
    orderId,
    invoiceDate: now.slice(0, 10),
    billingAddress: "Test billing",
    vatRateId: state.vatRates[0]?.id ?? "vat-std",
    subtotal: 100,
    vatAmount: 18,
    total: 118,
    paymentStatus: "Unpaid" as const,
    amountPaid: 0,
    preparedBy: state.currentUser,
    createdAt: now,
    updatedAt: now,
  };
  state.invoices.push(invoice);
  return invoice;
}

function testInvoiceTrashRestorePurge() {
  let state = ownerState();
  const invoice = ensureSeedInvoice(state);
  assert.ok(invoice, "seed invoice");

  const trash = softDeleteRecord(state, {
    entityType: "invoice",
    entityId: invoice.id,
    reason: "test",
  });
  assert.equal(trash.ok, true, trash.ok ? "" : trash.error);
  if (!trash.ok) return;
  state = trash.data.state;
  assert.ok(isSoftDeleted(state.invoices.find((i) => i.id === invoice.id)!));
  assert.ok(
    listTrashItems(state).some((t) => t.entityType === "invoice" && t.entityId === invoice.id),
  );
  assert.ok(state.audit.some((a) => a.action === "record.trashed" && a.entityId === invoice.id));

  const restored = restoreTrashItem(state, { entityType: "invoice", entityId: invoice.id });
  assert.equal(restored.ok, true, restored.ok ? "" : restored.error);
  if (!restored.ok) return;
  state = restored.data.state;
  assert.ok(!isSoftDeleted(state.invoices.find((i) => i.id === invoice.id)!));

  const trash2 = softDeleteRecord(state, { entityType: "invoice", entityId: invoice.id });
  assert.equal(trash2.ok, true);
  if (!trash2.ok) return;
  state = trash2.data.state;
  const purged = purgeTrashItem(state, { entityType: "invoice", entityId: invoice.id });
  assert.equal(purged.ok, true, purged.ok ? "" : purged.error);
  if (!purged.ok) return;
  state = purged.data.state;
  assert.ok(!state.invoices.some((i) => i.id === invoice.id));
  assert.ok(state.audit.some((a) => a.action === "record.purged" && a.entityId === invoice.id));
}

function ensureOpsRequestFixtures(state: ReturnType<typeof createSeedState>) {
  if (!state.opsRequests) state.opsRequests = [];
  const now = new Date().toISOString();
  const userId = state.users[0]?.id ?? "usr-owner";
  const base = {
    type: "Transfer Prep" as const,
    priority: "Normal" as const,
    title: "Trash verify fixture",
    destination: "Warehouse",
    requestedBy: state.currentUser,
    requestedByUserId: userId,
    requestedAt: now,
  };
  let draft = state.opsRequests.find(
    (r) => r.status === "Draft" || r.status === "Cancelled" || r.status === "Closed",
  );
  if (!draft) {
    draft = {
      ...base,
      id: "ops-req-trash-draft",
      number: "OPS-TRASH-DRAFT",
      status: "Draft",
    };
    state.opsRequests.push(draft);
  }
  let active = state.opsRequests.find((r) =>
    ["Preparing", "Ready for Collection", "Issued", "Collected", "In Transit"].includes(r.status),
  );
  if (!active) {
    active = {
      ...base,
      id: "ops-req-trash-active",
      number: "OPS-TRASH-ACTIVE",
      status: "In Transit",
    };
    state.opsRequests.push(active);
  }
  return { draft, active };
}

function testOpsRequestTrashAndBlock() {
  let state = ownerState();
  const { draft, active } = ensureOpsRequestFixtures(state);

  const block = trashBlockReason(state, "ops_request", active.id);
  assert.ok(block, "active ops request should block trash");
  const denied = softDeleteRecord(state, { entityType: "ops_request", entityId: active.id });
  assert.equal(denied.ok, false);

  draft.status = "Draft";
  const ok = softDeleteRecord(state, { entityType: "ops_request", entityId: draft.id });
  assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
  if (!ok.ok) return;
  state = ok.data.state;
  assert.ok(
    listTrashItems(state).some((t) => t.entityType === "ops_request" && t.entityId === draft.id),
  );
}

function testStockMovementHideNoPurge() {
  let state = ownerState();
  const mov = (state.stockMovements ?? [])[0];
  assert.ok(mov, "seed stock movement");

  const trash = softDeleteRecord(state, { entityType: "stock_movement", entityId: mov.id });
  assert.equal(trash.ok, true, trash.ok ? "" : trash.error);
  if (!trash.ok) return;
  state = trash.data.state;
  assert.ok(isSoftDeleted(state.stockMovements.find((m) => m.id === mov.id)!));
  assert.ok(listTrashItems(state).some((t) => t.entityType === "stock_movement"));

  const purged = purgeTrashItem(state, { entityType: "stock_movement", entityId: mov.id });
  assert.equal(purged.ok, false);
  assert.match(purged.ok ? "" : purged.error, /ledger/i);
  // Row still present (ledger integrity)
  assert.ok(state.stockMovements.some((m) => m.id === mov.id));
}

function testGoodsReceiptAndDelivery() {
  let state = ownerState();
  const grn = (state.goodsReceipts ?? []).find(
    (g) => g.status === "Draft" || g.status === "Approved" || g.status === "Cancelled",
  );
  if (grn) {
    const ok = softDeleteRecord(state, { entityType: "goods_receipt", entityId: grn.id });
    assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
    if (ok.ok) {
      state = ok.data.state;
      assert.ok(listTrashItems(state).some((t) => t.entityType === "goods_receipt"));
    }
  }

  const delivery = state.deliveries.find((d) => d.status !== "Dispatched") ?? state.deliveries[0];
  if (delivery) {
    if (delivery.status === "Dispatched") delivery.status = "Preparing";
    const ok = softDeleteRecord(state, { entityType: "delivery", entityId: delivery.id });
    assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
  }
}

function testNotificationSoftDelete() {
  let state = ownerState();
  if (state.notifications.length === 0) {
    state.notifications.push({
      id: "ntf-test-trash",
      type: "overdue",
      title: "Test notice",
      body: "body",
      dedupeKey: "test-trash",
      createdAt: new Date().toISOString(),
    });
  }
  const n = state.notifications[0]!;
  const ok = softDeleteRecord(state, { entityType: "notification", entityId: n.id });
  assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
  if (!ok.ok) return;
  state = ok.data.state;
  assert.ok(isSoftDeleted(state.notifications.find((x) => x.id === n.id)!));
  assert.ok(listTrashItems(state).some((t) => t.entityType === "notification"));
}

testInvoiceTrashRestorePurge();
testOpsRequestTrashAndBlock();
testStockMovementHideNoPurge();
testGoodsReceiptAndDelivery();
testNotificationSoftDelete();
console.log("trash-verify: ok");
