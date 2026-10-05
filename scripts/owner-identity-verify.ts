/**
 * Sole Owner Auth must bind as TLB Owner / Owner — never Finance leftovers,
 * never a second seed Owner (user-owner / owner@tlb.gh).
 * Finance Auth must bind as Finance person / Finance — never Owner.
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
  applyCloudStaffAccessStatuses,
  staffRoleIdFromCloudCode,
} from "../src/lib/domain/invites";
import {
  bindSessionToAuthIdentity,
  ensurePortalOwnerStaffDirectory,
  lockWorkspaceToOwner,
} from "../src/lib/store/migrate";
import { createSeedState } from "../src/lib/store/seed";

const FINANCE_NAME = "Finance Invitee";
const FINANCE_STAFF_ID = "staff-finance-leftover";
const FINANCE_AUTH_ID = "48790d50-842f-4851-a944-b1bb91a3d926";
const FINANCE_EMAIL = "konadubeatrice757@gmail.com";

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

{
  // Staff Auth (Konadu) must NEVER bind as TLB Owner — even when local row
  // still has a pre-accept invite id and session was previously Owner.
  const state = createSeedState();
  state.users.push({
    id: "invite-konadu-local",
    name: "Konadu",
    email: FINANCE_EMAIL,
    roleId: SYSTEM_ROLE_IDS.Finance,
    active: true,
    invitePending: true,
    inviteToken: "inv_test",
    inviteCode: "TLB-TEST-CODE",
  });
  state.currentUserId = PORTAL_OWNER_AUTH_USER_ID;
  state.currentUser = OWNER_DISPLAY_NAME;
  state.currentRoleId = SYSTEM_ROLE_IDS.Owner;
  state.currentRole = "Owner";

  const bound = bindSessionToAuthIdentity(state, {
    email: FINANCE_EMAIL,
    authUserId: FINANCE_AUTH_ID,
    roleCode: "FINANCE",
  });
  assert.equal(bound.currentUserId, FINANCE_AUTH_ID);
  assert.equal(bound.currentUser, "Konadu");
  assert.equal(bound.currentRole, "Finance");
  assert.equal(bound.currentRoleId, SYSTEM_ROLE_IDS.Finance);
  assert.notEqual(bound.currentUser, OWNER_DISPLAY_NAME);
  assert.notEqual(bound.currentRole, "Owner");
  const staff = bound.users.find((user) => user.id === FINANCE_AUTH_ID);
  assert.ok(staff);
  assert.equal(staff.email, FINANCE_EMAIL);
  assert.equal(staff.roleId, SYSTEM_ROLE_IDS.Finance);
  assert.equal(staff.invitePending, false);
  assert.equal(bound.users.some((user) => user.id === "invite-konadu-local"), false);
  assert.equal(ownerCount(bound), 1);
}

{
  // Regression: Finance Auth with stale local Owner roleId + cloud FINANCE
  // must never resolve to Owner roleId / TLB Owner identity.
  const state = createSeedState();
  state.users.push({
    id: FINANCE_AUTH_ID,
    name: "Konadu Beatrice",
    email: FINANCE_EMAIL,
    roleId: SYSTEM_ROLE_IDS.Owner,
    active: true,
  });
  state.currentUserId = PORTAL_OWNER_AUTH_USER_ID;
  state.currentUser = OWNER_DISPLAY_NAME;
  state.currentRoleId = SYSTEM_ROLE_IDS.Owner;
  state.currentRole = "Owner";

  assert.equal(
    staffRoleIdFromCloudCode("FINANCE", { authUserId: FINANCE_AUTH_ID, email: FINANCE_EMAIL }),
    SYSTEM_ROLE_IDS.Finance,
  );
  assert.equal(
    staffRoleIdFromCloudCode("OWNER", { authUserId: FINANCE_AUTH_ID, email: FINANCE_EMAIL }),
    undefined,
  );

  const bound = bindSessionToAuthIdentity(state, {
    email: FINANCE_EMAIL,
    authUserId: FINANCE_AUTH_ID,
    roleCode: "FINANCE",
  });
  assert.equal(bound.currentUserId, FINANCE_AUTH_ID);
  assert.equal(bound.currentUser, "Konadu Beatrice");
  assert.equal(bound.currentRole, "Finance");
  assert.equal(bound.currentRoleId, SYSTEM_ROLE_IDS.Finance);
  const staff = bound.users.find((user) => user.id === FINANCE_AUTH_ID)!;
  assert.equal(staff.roleId, SYSTEM_ROLE_IDS.Finance);
  assert.notEqual(staff.roleId, SYSTEM_ROLE_IDS.Owner);
  assert.notEqual(bound.currentRole, "Owner");
  assert.equal(ownerCount(bound), 1);
}

{
  // Cloud roster role_code must overwrite stale auth_directory Owner/Admin.
  const state = createSeedState();
  state.users.push({
    id: "invite-stale-finance",
    name: "Konadu",
    email: FINANCE_EMAIL,
    roleId: SYSTEM_ROLE_IDS.Owner,
    active: true,
    invitePending: true,
  });
  const healed = applyCloudStaffAccessStatuses(state.users, [
    {
      email: FINANCE_EMAIL,
      fullName: "Konadu Beatrice",
      profileId: FINANCE_AUTH_ID,
      roleCode: "FINANCE",
      invitePending: false,
      inviteAcceptedAt: "2026-10-01T00:00:00.000Z",
      lastSignInAt: "2026-10-05T00:00:00.000Z",
      active: true,
    },
  ]);
  const staff = healed.find((user) => user.id === FINANCE_AUTH_ID);
  assert.ok(staff);
  assert.equal(staff.name, "Konadu Beatrice");
  assert.equal(staff.roleId, SYSTEM_ROLE_IDS.Finance);
  assert.notEqual(staff.roleId, SYSTEM_ROLE_IDS.Owner);
  assert.equal(staff.invitePending, false);
}

{
  // Owner Auth still binds as TLB Owner after a staff session was active.
  const state = createSeedState();
  state.users.push({
    id: FINANCE_AUTH_ID,
    name: "Konadu",
    email: FINANCE_EMAIL,
    roleId: SYSTEM_ROLE_IDS.Finance,
    active: true,
  });
  state.currentUserId = FINANCE_AUTH_ID;
  state.currentUser = "Konadu";
  state.currentRoleId = SYSTEM_ROLE_IDS.Finance;
  state.currentRole = "Finance";
  const bound = bindSessionToAuthIdentity(state, {
    email: PORTAL_OWNER_AUTH_EMAIL,
    authUserId: PORTAL_OWNER_AUTH_USER_ID,
  });
  assert.equal(bound.currentUserId, PORTAL_OWNER_AUTH_USER_ID);
  assert.equal(bound.currentUser, OWNER_DISPLAY_NAME);
  assert.equal(bound.currentRole, "Owner");
}

console.log(
  "owner-identity-verify: sole Owner Auth binds as TLB Owner; Finance Auth binds as Finance; cloud role_code wins; seed Owner purged",
);
