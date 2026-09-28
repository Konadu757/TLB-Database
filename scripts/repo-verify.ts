/**
 * Light checks for repository wiring helpers (no network).
 * Run via: npx tsx scripts/repo-verify.ts
 */
import assert from "node:assert/strict";

import { buildSoftDeleteOverlay, customerToRow, customerFromRow } from "../src/lib/repo/mappers";
import { ledgerProductId, ledgerWarehouseId } from "../src/lib/repo/ledger-catalog";
import {
  mergeCanonicalBalances,
  mergeCanonicalMovements,
  tryIssueDocumentNumber,
  tryPostMovement,
} from "../src/lib/repo/ledger-rpc";
import {
  resetTlbRepositoryCache,
  shouldUseSupabaseRepository,
} from "../src/lib/repo/tlb-repository";

const row = customerToRow({
  id: "cus-test",
  code: "C-TEST",
  name: "Test Hospital",
  category: "Hospital",
  contactName: "Ada",
  phone: "+233",
  email: "a@test.gh",
  address: "Tema",
  creditLimit: 1000,
  paymentTerms: "Net 30",
  active: true,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  deletedAt: "2026-09-09T12:00:00.000Z",
  deletedBy: "Owner",
});

assert.equal(row.id, "cus-test");
assert.equal(row.code, "C-TEST");
assert.ok(!("deleted_at" in row), "soft-delete stays out of core row payload");

const overlay = buildSoftDeleteOverlay({
  warehouses: [],
  products: [],
  customers: [
    {
      id: "cus-test",
      code: "C-TEST",
      name: "Test Hospital",
      category: "Hospital",
      contactName: "Ada",
      phone: "+233",
      email: "a@test.gh",
      address: "Tema",
      creditLimit: 1000,
      paymentTerms: "Net 30",
      active: true,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
      deletedAt: "2026-09-09T12:00:00.000Z",
      deletedBy: "Owner",
    },
  ],
  orders: [],
});
assert.equal(overlay.customer?.["cus-test"]?.deletedAt, "2026-09-09T12:00:00.000Z");

const roundTrip = customerFromRow(
  {
    id: row.id!,
    code: row.code,
    name: row.name,
    category: row.category,
    contact_name: row.contact_name ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    tin: null,
    credit_limit: Number(row.credit_limit),
    payment_terms: row.payment_terms!,
    notes: null,
    active: true,
    created_at: row.created_at!,
    updated_at: row.updated_at!,
  },
  overlay,
);
assert.equal(roundTrip.deletedAt, "2026-09-09T12:00:00.000Z");

resetTlbRepositoryCache();
// Without forcing env in node, helper should be a boolean (credentials may or may not be present).
assert.equal(typeof shouldUseSupabaseRepository(), "boolean");

assert.match(ledgerProductId("prod-hcl"), /^[0-9a-f-]{36}$/i);
assert.match(ledgerWarehouseId("wh-main"), /^[0-9a-f-]{36}$/i);
assert.equal(ledgerProductId("prd-custom"), "prd-custom");
assert.equal(ledgerWarehouseId("wh-custom"), "wh-custom");

assert.equal(tryIssueDocumentNumber("order"), null);
assert.equal(
  tryPostMovement({
    type: "grn",
    productId: "prod-hcl",
    warehouseId: "wh-main",
    quantity: 1,
    batchId: "batch-local",
  }),
  null,
);
assert.equal(
  tryPostMovement({
    type: "grn",
    productId: "11111111-1111-4111-8111-111111111111",
    warehouseId: "22222222-2222-4222-8222-222222222222",
    quantity: 2,
  }),
  null,
);

const mergedMoves = mergeCanonicalMovements(
  [
    {
      id: "mv-local",
      number: "TLB-MV-LOCAL",
      type: "grn",
      productId: "p1",
      warehouseId: "w1",
      qtyBefore: 0,
      qtyMove: 1,
      qtyAfter: 1,
      signedQty: 1,
      actor: "Owner",
      at: "2026-09-01T00:00:00.000Z",
    },
  ],
  [
    {
      id: "mv-server",
      movement_number: "TLB-MV-2026-000125",
      movement_type: "grn",
      direction: 1,
      quantity: 4,
      product_id: "p1",
      warehouse_id: "w1",
      qty_before: 0,
      qty_after: 4,
      created_at: "2026-09-28T00:00:00.000Z",
      actor_id: "11111111-1111-4111-8111-111111111111",
    },
  ],
);
assert.equal(mergedMoves[0]?.number, "TLB-MV-2026-000125");
assert.equal(mergedMoves[1]?.number, "TLB-MV-LOCAL");
assert.equal(mergedMoves[0]?.signedQty, 4);

const mergedBalances = mergeCanonicalBalances(
  [
    {
      id: "stk-local",
      productId: "p1",
      warehouseId: "w1",
      physicalQty: 1,
      reservedQty: 0,
    },
  ],
  [
    {
      product_id: "p1",
      warehouse_id: "w1",
      quantity_on_hand: 6,
      quantity_reserved: 1,
    },
  ],
);
assert.equal(mergedBalances[0]?.id, "stk-local");
assert.equal(mergedBalances[0]?.physicalQty, 6);
assert.equal(mergedBalances[0]?.reservedQty, 1);

console.log("repo-verify: ok");
