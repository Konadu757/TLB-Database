/**
 * Sole Owner Auth must bind as TLB Owner / Owner — never Finance leftovers,
 * never a second seed Owner (user-owner / owner@tlb.gh).
 * Run: npx tsx scripts/owner-identity-verify.ts
 */
import assert from "node:assert/strict";

import {
  LEGACY_SEED_OWNER_USER_ID,
  OWNER_DISPLAY_NAME,
  OWNER_USER_ID,
  PORTAL_OWNER_AUTH_EMAIL,
  PORTAL_OWNER_AUTH_USER_ID,
  SYSTEM_ROLE_IDS,
} from "../src/lib/domain/permissions";
import {
  bindSessionToAuthIdentity,
  ensurePortalOwnerStaffDirectory,
  lockWorkspaceToOwner,
} from "../src/lib/store/migrate";
import { createSeedState } from "../src/lib/store/seed";

const FINANCE_NAME = "Finance Invitee";
const FINANCE_STAFF_ID = "staff-finance-leftover";

function ownerCount(state: ReturnType<typeof createSeedState>) {
  return state.users.filter(
    (user) => state.roles.find((role) => role.id === user.roleId)?.systemKey === "Owner",
  ).length;
}

function corruptedOwnerState() {
  const state = createSeedState();
  // Simulate the prior dual-Owner bug: legacy seed row + Auth UUID both Owner.
  state.users.push({
    id: LEGACY_SEED_OWNER_USER_ID,
    name: OWNER_DISPLAY_NAME,
    email: "owner@tlb.gh",
    roleId: SYSTEM_ROLE_IDS.Owner,
    active: true,
  });
  state.users.push({
    id: FINANCE_STAFF_ID,
    name: FINANCE_NAME,
    email: PORTAL_OWNER_AUTH_EMAIL,
    roleId: SYSTEM_ROLE_IDS.Finance,
    active: true,
  });
  const authUser = state.users.find((user) => user.id === PORTAL_OWNER_AUTH_USER_ID);
  if (authUser) {
    authUser.name = FINANCE_NAME;
    authUser.roleId = SYSTEM_ROLE_IDS.Finance;
  }
  // Keep legacy seed as an Owner so the fixture starts with a duplicate-Owner history
  // (Auth demoted + legacy Owner + same-email Finance leftover).
  state.currentUserId = FINANCE_STAFF_ID;
  state.currentUser = FINANCE_NAME;
  state.currentRoleId = SYSTEM_ROLE_IDS.Finance;
  state.currentRole = "Finance";
  return state;
}

{
  const state = corruptedOwnerState();
  // Keep Auth as Owner too so we exercise dual-Owner purge.
  const authUser = state.users.find((user) => user.id === PORTAL_OWNER_AUTH_USER_ID)!;
  authUser.name = OWNER_DISPLAY_NAME;
  authUser.roleId = SYSTEM_ROLE_IDS.Owner;
  assert.ok(ownerCount(state) >= 2, "fixture must start with duplicate Owners");
  assert.ok(
    state.users.some((user) => user.id === LEGACY_SEED_OWNER_USER_ID),
    "fixture must include legacy seed Owner",
  );
  const bound = bindSessionToAuthIdentity(state, {
    email: PORTAL_OWNER_AUTH_EMAIL,
    authUserId: PORTAL_OWNER_AUTH_USER_ID,
  });
  assert.equal(bound.currentUserId, PORTAL_OWNER_AUTH_USER_ID);
  assert.equal(bound.currentUser, OWNER_DISPLAY_NAME);
  assert.equal(bound.currentRole, "Owner");
  assert.equal(bound.currentRoleId, SYSTEM_ROLE_IDS.Owner);
  const healedAuth = bound.users.find((user) => user.id === PORTAL_OWNER_AUTH_USER_ID);
  assert.ok(healedAuth);
  assert.equal(healedAuth.name, OWNER_DISPLAY_NAME);
  assert.equal(healedAuth.roleId, SYSTEM_ROLE_IDS.Owner);
  assert.equal(bound.users.some((user) => user.id === FINANCE_STAFF_ID), false);
  assert.equal(bound.users.some((user) => user.id === LEGACY_SEED_OWNER_USER_ID), false);
  assert.equal(
    bound.users.filter((user) => user.email.toLowerCase() === PORTAL_OWNER_AUTH_EMAIL).length,
    1,
  );
  assert.equal(ownerCount(bound), 1);
  assert.equal(OWNER_USER_ID, PORTAL_OWNER_AUTH_USER_ID);
}

{
  const state = corruptedOwnerState();
  const legacy = state.users.find((user) => user.id === LEGACY_SEED_OWNER_USER_ID)!;
  legacy.email = "owner@tlb.gh";
  legacy.name = FINANCE_NAME;
  const bound = bindSessionToAuthIdentity(state, {
    email: PORTAL_OWNER_AUTH_EMAIL,
    authUserId: PORTAL_OWNER_AUTH_USER_ID,
  });
  assert.equal(bound.currentUser, OWNER_DISPLAY_NAME);
  assert.equal(bound.currentRole, "Owner");
  assert.equal(bound.users.some((user) => user.id === LEGACY_SEED_OWNER_USER_ID), false);
  assert.equal(ownerCount(bound), 1);
}

{
  const state = corruptedOwnerState();
  ensurePortalOwnerStaffDirectory(state);
  lockWorkspaceToOwner(state);
  const authUser = state.users.find((user) => user.id === PORTAL_OWNER_AUTH_USER_ID);
  assert.ok(authUser);
  assert.equal(authUser.name, OWNER_DISPLAY_NAME);
  assert.equal(authUser.roleId, SYSTEM_ROLE_IDS.Owner);
  assert.equal(state.users.some((user) => user.id === FINANCE_STAFF_ID), false);
  assert.equal(state.users.some((user) => user.id === LEGACY_SEED_OWNER_USER_ID), false);
  assert.equal(ownerCount(state), 1);
}

{
  const seed = createSeedState();
  assert.equal(ownerCount(seed), 1);
  assert.equal(seed.users.find((user) => user.id === OWNER_USER_ID)?.email, PORTAL_OWNER_AUTH_EMAIL);
  assert.equal(seed.users.some((user) => user.id === LEGACY_SEED_OWNER_USER_ID), false);
}

console.log("owner-identity-verify: sole Owner Auth binds as TLB Owner; seed Owner purged");
