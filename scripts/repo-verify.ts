/**
 * Light checks for repository wiring helpers (no network).
 * Run via: npx tsx scripts/repo-verify.ts
 */
import assert from "node:assert/strict";

import { buildSoftDeleteOverlay, customerToRow, customerFromRow } from "../src/lib/repo/mappers";
import { resetTlbRepositoryCache, shouldUseSupabaseRepository } from "../src/lib/repo/tlb-repository";

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

console.log("repo-verify: ok");
