/**
 * Soft-delete / Trash coverage for newly trashable entity types.
 * Run: npx tsx scripts/trash-verify.ts
 */
import assert from "node:assert/strict";

import { createSystemRoles, SYSTEM_ROLE_IDS } from "../src/lib/domain/permissions";
import {
  listTrashItems,
  isSoftDeleted,
  PURGE_CONFIRM_PHRASE,
  RESTORE_CONFIRM_PHRASE,
  TRASH_CONFIRM_PHRASE,
} from "../src/lib/domain/trash";
import { lockWorkspaceToOwner } from "../src/lib/store/migrate";
import { createSeedState } from "../src/lib/store/seed";
import {
  purgeTrashItem,
  restoreTrashItem,
  softDeleteRecord,
  trashBlockReason,
} from "../src/lib/store/trash-store";
import { deleteRole, switchSessionUser } from "../src/lib/store/tlb-store";

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

function sessionAsSales(state: ReturnType<typeof createSeedState>) {
  const next = structuredClone(state);
  const sales = createSystemRoles().find((role) => role.systemKey === "Sales");
  assert.ok(sales);
  if (!next.roles.some((role) => role.id === sales.id)) {
    next.roles.push({ ...sales, permissions: [...sales.permissions] });
  }
  const user = next.users.find((item) => item.id === "user-sales") ?? next.users[0];
  assert.ok(user);
  user.roleId = sales.id;
  next.currentUserId = user.id;
  next.currentRoleId = sales.id;
  next.currentRole = "Sales";
  return next;
}

function testConfirmPhrasesAreDistinct() {
  const phrases = [TRASH_CONFIRM_PHRASE, PURGE_CONFIRM_PHRASE, RESTORE_CONFIRM_PHRASE];
  assert.deepEqual(phrases, ["DELETE", "PERMANENT", "RESTORE"]);
  assert.equal(new Set(phrases.map((phrase) => phrase.toLowerCase())).size, 3);
}

function testNonOwnerCannotMutateTrash() {
  const state = sessionAsSales(ownerState());
  const customer = state.customers[0];
  assert.ok(customer);
  const trashed = softDeleteRecord(state, { entityType: "customer", entityId: customer.id });
  assert.equal(trashed.ok, false);

  const owner = ownerState();
  const invoice = ensureSeedInvoice(owner);
  const moved = softDeleteRecord(owner, { entityType: "invoice", entityId: invoice.id });
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  const asSales = sessionAsSales(moved.data.state);
  const restored = restoreTrashItem(asSales, { entityType: "invoice", entityId: invoice.id });
  assert.equal(restored.ok, false);
  const purged = purgeTrashItem(asSales, { entityType: "invoice", entityId: invoice.id });
  assert.equal(purged.ok, false);
}

function testRoleDeleteWithUsersAndTasks() {
  let state = ownerState();
  const warehouse = createSystemRoles().find((role) => role.systemKey === "Warehouse");
  assert.ok(warehouse);
  if (!state.roles.some((role) => role.id === warehouse.id)) {
    state.roles.push({ ...warehouse, permissions: [...warehouse.permissions] });
  }
  const sales = state.users.find((user) => user.id === "user-sales");
  assert.ok(sales);
  sales.roleId = SYSTEM_ROLE_IDS.Warehouse;
  state.notifications.push({
    id: "ntf-warehouse-task",
    type: "ops_approval_needed",
    title: "Warehouse task",
    body: "Still assigned after the role is trashed",
    targetRole: "Warehouse",
    dedupeKey: "warehouse-task",
    createdAt: new Date().toISOString(),
  });

  const blocked = deleteRole(sessionAsSales(state), SYSTEM_ROLE_IDS.Warehouse);
  assert.equal(blocked.ok, false);

  const deleted = deleteRole(state, SYSTEM_ROLE_IDS.Warehouse, "role no longer used");
  assert.equal(deleted.ok, true, deleted.ok ? "" : deleted.error);
  if (!deleted.ok) return;
  state = deleted.data.state;
  const trashedRole = state.roles.find((role) => role.id === SYSTEM_ROLE_IDS.Warehouse);
  assert.equal(trashedRole?.active, false);
  assert.ok(trashedRole && isSoftDeleted(trashedRole));
  assert.equal(state.users.find((user) => user.id === "user-sales")?.roleId, SYSTEM_ROLE_IDS.Admin);
  assert.ok(listTrashItems(state).some((item) => item.entityType === "role" && item.label === "Warehouse"));
  assert.ok(state.notifications.some((note) => note.id === "ntf-warehouse-task" && !note.deletedAt));
  assert.ok(state.audit.some((event) => event.action === "role.deleted"));

  const ownerBlocked = deleteRole(state, SYSTEM_ROLE_IDS.Owner);
  assert.equal(ownerBlocked.ok, false);

  const restored = restoreTrashItem(state, {
    entityType: "role",
    entityId: SYSTEM_ROLE_IDS.Warehouse,
  });
  assert.equal(restored.ok, true, restored.ok ? "" : restored.error);
  if (!restored.ok) return;
  state = restored.data.state;
  const back = state.roles.find((role) => role.id === SYSTEM_ROLE_IDS.Warehouse);
  assert.equal(back?.active, true);
  assert.ok(back && !isSoftDeleted(back));
  assert.equal(state.users.find((user) => user.id === "user-sales")?.roleId, SYSTEM_ROLE_IDS.Admin);
  assert.ok(!listTrashItems(state).some((item) => item.entityType === "role"));

  const deletedAgain = deleteRole(state, SYSTEM_ROLE_IDS.Warehouse);
  assert.equal(deletedAgain.ok, true);
  if (!deletedAgain.ok) return;
  state = deletedAgain.data.state;
  const purged = purgeTrashItem(state, {
    entityType: "role",
    entityId: SYSTEM_ROLE_IDS.Warehouse,
  });
  assert.equal(purged.ok, true, purged.ok ? "" : purged.error);
  if (!purged.ok) return;
  state = purged.data.state;
  assert.ok(!state.roles.some((role) => role.id === SYSTEM_ROLE_IDS.Warehouse));
  assert.equal(state.users.find((user) => user.id === "user-sales")?.roleId, SYSTEM_ROLE_IDS.Admin);
  lockWorkspaceToOwner(state);
  assert.ok(!state.roles.some((role) => role.id === SYSTEM_ROLE_IDS.Warehouse));

  const kept = ownerState();
  const trashedWarehouse = {
    ...warehouse,
    permissions: [...warehouse.permissions],
    active: false,
    deletedAt: new Date().toISOString(),
    deletedBy: "TLB Owner",
  };
  const existingWarehouse = kept.roles.findIndex((role) => role.id === warehouse.id);
  if (existingWarehouse >= 0) kept.roles[existingWarehouse] = trashedWarehouse;
  else kept.roles.push(trashedWarehouse);
  lockWorkspaceToOwner(kept);
  assert.ok(kept.roles.some((role) => role.id === SYSTEM_ROLE_IDS.Warehouse && role.deletedAt));
  assert.equal(kept.currentRole, "Owner");
}

function testOwnerDeletesAssignmentWithoutSwitchingSession() {
  const state = ownerState();
  const beforeUser = state.currentUserId;
  const beforeRole = state.currentRole;
  const blockedSelf = softDeleteRecord(state, {
    entityType: "user",
    entityId: state.currentUserId,
  });
  assert.equal(blockedSelf.ok, false);

  const blockedRole = softDeleteRecord(sessionAsSales(state), {
    entityType: "user",
    entityId: "user-finance",
  });
  assert.equal(blockedRole.ok, false);

  const deleted = softDeleteRecord(state, {
    entityType: "user",
    entityId: "user-sales",
    reason: "left the team",
  });
  assert.equal(deleted.ok, true, deleted.ok ? "" : deleted.error);
  if (!deleted.ok) return;
  assert.equal(deleted.data.state.currentUserId, beforeUser);
  assert.equal(deleted.data.state.currentRole, beforeRole);
  assert.equal(deleted.data.state.currentUser, state.currentUser);
  const trashed = deleted.data.state.users.find((user) => user.id === "user-sales");
  assert.ok(trashed && isSoftDeleted(trashed));
  assert.equal(trashed.active, false);
  assert.ok(
    listTrashItems(deleted.data.state).some(
      (item) => item.entityType === "user" && item.entityId === "user-sales",
    ),
  );
  lockWorkspaceToOwner(deleted.data.state);
  assert.equal(deleted.data.state.currentRole, "Owner");
  assert.equal(deleted.data.state.currentUserId, beforeUser);
  assert.ok(isSoftDeleted(deleted.data.state.users.find((user) => user.id === "user-sales")!));
  assert.equal(trashBlockReason(state, "user", state.currentUserId)?.length ? true : false, true);
}

testOwnerDeletesAssignmentWithoutSwitchingSession();
testInvoiceTrashRestorePurge();
testOpsRequestTrashAndBlock();
testStockMovementHideNoPurge();
testGoodsReceiptAndDelivery();
testNotificationSoftDelete();
testConfirmPhrasesAreDistinct();
testNonOwnerCannotMutateTrash();
testRoleDeleteWithUsersAndTasks();
console.log("trash-verify: ok");
