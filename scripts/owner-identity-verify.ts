/**
 * Owner Auth must never show as Finance personnel after bind/heal.
 * Run: npx tsx scripts/owner-identity-verify.ts
 */
import assert from "node:assert/strict";

import {
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

function corruptedOwnerState() {
  const state = createSeedState();
  state.users.push({
    id: PORTAL_OWNER_AUTH_USER_ID,
    name: FINANCE_NAME,
    email: PORTAL_OWNER_AUTH_EMAIL,
    roleId: SYSTEM_ROLE_IDS.Finance,
    active: true,
  });
  state.users.push({
    id: FINANCE_STAFF_ID,
    name: FINANCE_NAME,
    email: PORTAL_OWNER_AUTH_EMAIL,
    roleId: SYSTEM_ROLE_IDS.Finance,
    active: true,
  });
  state.currentUserId = FINANCE_STAFF_ID;
  state.currentUser = FINANCE_NAME;
  state.currentRoleId = SYSTEM_ROLE_IDS.Finance;
  state.currentRole = "Finance";
  return state;
}

{
  const state = corruptedOwnerState();
  const bound = bindSessionToAuthIdentity(state, {
    email: PORTAL_OWNER_AUTH_EMAIL,
    authUserId: PORTAL_OWNER_AUTH_USER_ID,
  });
  assert.equal(bound.currentUserId, PORTAL_OWNER_AUTH_USER_ID);
  assert.equal(bound.currentUser, OWNER_DISPLAY_NAME);
  assert.equal(bound.currentRole, "Owner");
  assert.equal(bound.currentRoleId, SYSTEM_ROLE_IDS.Owner);
  const authUser = bound.users.find((user) => user.id === PORTAL_OWNER_AUTH_USER_ID);
  assert.ok(authUser);
  assert.equal(authUser.name, OWNER_DISPLAY_NAME);
  assert.equal(authUser.roleId, SYSTEM_ROLE_IDS.Owner);
  assert.equal(
    bound.users.some((user) => user.id === FINANCE_STAFF_ID),
    false,
  );
  assert.equal(
    bound.users.filter((user) => user.email.toLowerCase() === PORTAL_OWNER_AUTH_EMAIL).length,
    2,
  ); // auth uuid + seed owner
}

{
  const state = corruptedOwnerState();
  // Prior bug: seed Owner kept owner@tlb.gh while Auth used gmail → heal skipped.
  const seed = state.users.find((user) => user.id === OWNER_USER_ID)!;
  seed.email = "owner@tlb.gh";
  seed.name = FINANCE_NAME;
  const bound = bindSessionToAuthIdentity(state, {
    email: PORTAL_OWNER_AUTH_EMAIL,
    authUserId: PORTAL_OWNER_AUTH_USER_ID,
  });
  assert.equal(bound.currentUser, OWNER_DISPLAY_NAME);
  assert.equal(bound.currentRole, "Owner");
  assert.equal(bound.users.find((user) => user.id === OWNER_USER_ID)?.name, OWNER_DISPLAY_NAME);
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
}

console.log("owner-identity-verify: Owner Auth always binds as TLB Owner / Owner");
