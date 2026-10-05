import {
  ALL_PERMISSIONS,
  createSystemRoles,
  isPortalOwnerAuth,
  isSoleOwnerUserId,
  LEGACY_SEED_OWNER_USER_ID,
  OWNER_DISPLAY_NAME,
  OWNER_USER_ID,
  PORTAL_OWNER_AUTH_EMAIL,
  PORTAL_OWNER_AUTH_USER_ID,
  SYSTEM_ROLE_IDS,
  SYSTEM_ROLE_PERMISSIONS,
} from "../domain/permissions";
import type {
  AgeingSettings,
  AppUser,
  CompanyProfile,
  DocumentCounters,
  InventorySettings,
  Permission,
  RoleDefinition,
  SystemRoleKey,
  TlbState,
  VatRate,
} from "../domain/types";
import { DEFAULT_INVENTORY_SETTINGS } from "../domain/inventory";
import { MATURE_SEQUENCE_FLOOR, floorMatureCommercialCounters } from "../domain/numbering";
import { defaultTaxCatalog, ensureTaxCatalog } from "../domain/tax";
import { createSeedState } from "./seed";
import {
  ensureQuotationLines,
  rollupQuotationLines,
} from "../domain/quotation-calc";
import { omitPurgedEntities } from "../domain/trash";

const DEFAULT_COMPANY: CompanyProfile = {
  legalName: "TLB Enterprise Limited",
  tradingName: "TLB Enterprise",
  address: "Industrial Area, Tema, Ghana",
  phone: "+233 30 200 0000",
  email: "accounts@tlb.gh",
  logoNote: "Use company logo from brand assets",
};

/** @deprecated Prefer defaultTaxCatalog() — kept for seed import compatibility. */
const DEFAULT_VAT: VatRate[] = defaultTaxCatalog();

const DEFAULT_AGEING: AgeingSettings = {
  normalMaxDays: 2,
  attentionMaxDays: 7,
  extendedUnfulfilledDays: 14,
  expectedApproachingDays: 2,
};

const DEFAULT_COUNTERS: DocumentCounters = {
  order: MATURE_SEQUENCE_FLOOR,
  supply: MATURE_SEQUENCE_FLOOR,
  customer: 0,
  supplier: 0,
  supplierPo: 0,
  supplierReceipt: 0,
  supplierPayment: 0,
  invoice: MATURE_SEQUENCE_FLOOR,
  receipt: MATURE_SEQUENCE_FLOOR,
  delivery: MATURE_SEQUENCE_FLOOR,
  payment: MATURE_SEQUENCE_FLOOR,
  quotation: MATURE_SEQUENCE_FLOOR,
  stockMovement: 0,
  stockIssue: 0,
  transfer: 0,
  adjustment: 0,
  batch: 0,
  customerReturn: 0,
  supplierReturn: 0,
  nonPoPurchase: 0,
  importShipment: 0,
  exportShipment: 0,
  opsRequest: MATURE_SEQUENCE_FLOOR,
};

/** Map legacy demo emails onto non-Owner system roles so seed never mints a second Owner. */
function demoRoleIdForEmail(email: string, roles: RoleDefinition[]): string {
  const byKey = (key: (typeof SYSTEM_ROLE_IDS)[keyof typeof SYSTEM_ROLE_IDS]) =>
    roles.find((r) => r.id === key)?.id ?? key;
  switch (email.trim().toLowerCase()) {
    case "sales@tlb.gh":
      return byKey(SYSTEM_ROLE_IDS.Sales);
    case "warehouse@tlb.gh":
      return byKey(SYSTEM_ROLE_IDS.Warehouse);
    case "finance@tlb.gh":
      return byKey(SYSTEM_ROLE_IDS.Finance);
    case "manager@tlb.gh":
      return byKey(SYSTEM_ROLE_IDS.Manager);
    case "driver@tlb.gh":
      return byKey(SYSTEM_ROLE_IDS.Driver);
    case "factory@tlb.gh":
      return byKey(SYSTEM_ROLE_IDS.Requester);
    default:
      return byKey(SYSTEM_ROLE_IDS.Admin);
  }
}

function defaultUsers(roles: RoleDefinition[]): AppUser[] {
  const ownerId = roles.find((r) => r.systemKey === "Owner")?.id ?? SYSTEM_ROLE_IDS.Owner;
  return [
    {
      id: OWNER_USER_ID,
      name: OWNER_DISPLAY_NAME,
      email: PORTAL_OWNER_AUTH_EMAIL,
      roleId: ownerId,
      active: true,
    },
    {
      id: "user-sales",
      name: "Ama Mensah",
      email: "sales@tlb.gh",
      roleId: demoRoleIdForEmail("sales@tlb.gh", roles),
      active: true,
    },
    {
      id: "user-warehouse",
      name: "Kofi Boateng",
      email: "warehouse@tlb.gh",
      roleId: demoRoleIdForEmail("warehouse@tlb.gh", roles),
      active: true,
    },
    {
      id: "user-finance",
      name: "Efua Addo",
      email: "finance@tlb.gh",
      roleId: demoRoleIdForEmail("finance@tlb.gh", roles),
      active: true,
    },
    {
      id: "user-manager",
      name: "Yaw Mensah",
      email: "manager@tlb.gh",
      roleId: demoRoleIdForEmail("manager@tlb.gh", roles),
      active: true,
    },
    {
      id: "user-driver",
      name: "Kwesi Owusu",
      email: "driver@tlb.gh",
      roleId: demoRoleIdForEmail("driver@tlb.gh", roles),
      active: true,
    },
    {
      id: "user-requester",
      name: "Abena Factory",
      email: "factory@tlb.gh",
      roleId: demoRoleIdForEmail("factory@tlb.gh", roles),
      active: true,
    },
  ];
}

/**
 * Keep predefined roles in the catalog so role assignment can offer them.
 * Roles already stored (including soft-deleted) are left alone. Roles
 * recorded in catalogPurgedIds stay gone after permanent delete.
 * The signed-in session stays Owner.
 */
export function ensureDeletableSystemRoles(state: TlbState): void {
  const purged = new Set(state.catalogPurgedIds ?? []);
  const presentIds = new Set(state.roles.map((role) => role.id));
  const presentKeys = new Set(
    state.roles.map((role) => role.systemKey).filter((key): key is SystemRoleKey => Boolean(key)),
  );
  for (const role of createSystemRoles()) {
    if (role.systemKey === "Owner") continue;
    if (presentIds.has(role.id) || (role.systemKey && presentKeys.has(role.systemKey))) continue;
    if (purged.has(role.id)) continue;
    state.roles.push({ ...role, permissions: [...role.permissions] });
    presentIds.add(role.id);
    if (role.systemKey) presentKeys.add(role.systemKey);
  }
}

/**
 * Ensure the Owner catalog role exists and orphaned users get a live role.
 * Does NOT force the browser session onto the Owner staff user — invited
 * Finance/Sales/etc. sessions must survive load and refresh.
 */
export function lockWorkspaceToOwner(state: TlbState): void {
  const catalogOwner = createSystemRoles().find((r) => r.systemKey === "Owner");
  const existing = state.roles.find(
    (r) => r.systemKey === "Owner" || r.id === SYSTEM_ROLE_IDS.Owner,
  );
  const owner: RoleDefinition = {
    ...(catalogOwner ?? existing)!,
    id: SYSTEM_ROLE_IDS.Owner,
    name: "Owner",
    systemKey: "Owner",
    active: true,
    permissions: [...SYSTEM_ROLE_PERMISSIONS.Owner],
  };
  delete owner.deletedAt;
  delete owner.deletedBy;
  delete owner.deletedReason;
  const others = state.roles.filter(
    (role) => role.systemKey !== "Owner" && role.id !== SYSTEM_ROLE_IDS.Owner,
  );
  state.roles = [owner, ...others];
  const liveRoleIds = new Set(
    state.roles.filter((role) => role.active && !role.deletedAt).map((role) => role.id),
  );
  for (const user of state.users) {
    if (!liveRoleIds.has(user.roleId)) {
      user.roleId = isSoleOwnerUserId(user.id) ? owner.id : SYSTEM_ROLE_IDS.Admin;
    }
  }
  ensureDeletableSystemRoles(state);
  ensurePortalOwnerStaffDirectory(state);
  const ownerUser = state.users.find((u) => u.id === OWNER_USER_ID);
  if (ownerUser) {
    ownerUser.active = true;
    ownerUser.roleId = owner.id;
  }
  // Never steal a staff Auth session into Owner just because the row is
  // briefly missing — bindSessionToAuthIdentity remaps/creates that row.
  const sessionUser = state.users.find((u) => u.id === state.currentUserId && u.active);
  if (
    !sessionUser &&
    (!state.currentUserId ||
      state.currentUserId === LEGACY_SEED_OWNER_USER_ID ||
      isPortalOwnerAuth({ authUserId: state.currentUserId }))
  ) {
    state.currentUserId = PORTAL_OWNER_AUTH_USER_ID;
  }
  state.version = Math.max(state.version, 15);
  syncSessionIdentity(state);
}

/** Keep denormalized session fields aligned with the signed-in user's assigned role. */
export function syncSessionIdentity(state: TlbState): void {
  const matched =
    state.users.find((u) => u.id === state.currentUserId && u.active) ??
    state.users.find((u) => u.id === state.currentUserId);
  // Only fall back to Owner when the session id is unset/Owner/legacy —
  // never when a staff Auth UUID is set but not yet remapped into users.
  const user =
    matched ??
    (!state.currentUserId ||
    state.currentUserId === LEGACY_SEED_OWNER_USER_ID ||
    isPortalOwnerAuth({ authUserId: state.currentUserId })
      ? (state.users.find((u) => u.id === OWNER_USER_ID) ?? state.users[0])
      : undefined);
  if (!user) return;
  const role =
    state.roles.find((r) => r.id === user.roleId && r.active && !r.deletedAt) ??
    state.roles.find((r) => r.id === user.roleId) ??
    (isSoleOwnerUserId(user.id)
      ? state.roles.find((r) => r.systemKey === "Owner" && r.active)
      : undefined);
  state.currentUserId = user.id;
  state.currentUser = user.name;
  if (role) {
    state.currentRoleId = role.id;
    state.currentRole = (role.systemKey ?? role.name) as TlbState["currentRole"];
  }
}

/**
 * Owner heal is ONLY for the portal Owner Auth account
 * (mccaesartechsolutions@gmail.com / aa9ba161-…). Staff Auth logins must
 * never enter this path — broad heuristics previously forced every staff
 * session into TLB Owner.
 */
function shouldHealAuthOwner(
  _state: TlbState,
  authUserId: string,
  authEmail: string,
): boolean {
  if (!authUserId && !authEmail) return false;
  return isPortalOwnerAuth({ authUserId, email: authEmail });
}

/**
 * Keep exactly one Owner staff row — the portal Auth UUID — as TLB Owner / OWNER.
 * Drops legacy `user-owner`, same-email leftovers, and demotes any other Owner
 * role assignments so Settings / role switcher cannot show two Owners.
 */
export function ensurePortalOwnerStaffDirectory(state: TlbState): void {
  const ownerRole =
    state.roles.find((role) => role.systemKey === "Owner" && role.active && !role.deletedAt) ??
    state.roles.find((role) => role.id === SYSTEM_ROLE_IDS.Owner);
  if (!ownerRole) return;

  let authUser = state.users.find((user) => user.id === PORTAL_OWNER_AUTH_USER_ID);
  if (!authUser) {
    authUser = {
      id: PORTAL_OWNER_AUTH_USER_ID,
      name: OWNER_DISPLAY_NAME,
      email: PORTAL_OWNER_AUTH_EMAIL,
      roleId: ownerRole.id,
      active: true,
    };
    state.users.push(authUser);
  } else {
    authUser.active = true;
    authUser.roleId = ownerRole.id;
    authUser.name = OWNER_DISPLAY_NAME;
    authUser.email = PORTAL_OWNER_AUTH_EMAIL;
  }

  state.users = state.users.filter((user) => {
    if (isSoleOwnerUserId(user.id)) return true;
    // Legacy local seed Owner must never coexist with Auth Owner.
    if (user.id === LEGACY_SEED_OWNER_USER_ID) return false;
    const userEmail = user.email.trim().toLowerCase();
    if (userEmail === PORTAL_OWNER_AUTH_EMAIL) return false;
    if (userEmail === "owner@tlb.gh") return false;
    return true;
  });

  for (const user of state.users) {
    if (isSoleOwnerUserId(user.id)) continue;
    const role = state.roles.find((r) => r.id === user.roleId);
    if (role?.systemKey === "Owner") {
      user.roleId = demoRoleIdForEmail(user.email, state.roles);
    }
  }

  // Only remap legacy seed session → Owner. Do not steal staff Auth UUIDs.
  if (state.currentUserId === LEGACY_SEED_OWNER_USER_ID) {
    state.currentUserId = PORTAL_OWNER_AUTH_USER_ID;
  }
}

/**
 * Force Auth Owner staff row onto OWNER role + TLB Owner name, drop legacy
 * seed Owner, and drop leftover Finance (etc.) staff that share the Owner
 * email so hydrate cannot resurrect a second Owner or wrong "Signed in as".
 */
function healAuthOwnerIdentity(
  state: TlbState,
  authUserId: string,
  authEmail: string,
): boolean {
  if (!authUserId) return false;
  if (!shouldHealAuthOwner(state, authUserId, authEmail)) return false;

  const before = JSON.stringify({
    users: state.users.map((u) => [u.id, u.name, u.email, u.roleId, u.active]),
    currentUserId: state.currentUserId,
  });

  ensurePortalOwnerStaffDirectory(state);

  // Prefer the live Auth UUID as the signed-in staff row.
  if (state.users.some((user) => user.id === authUserId)) {
    state.currentUserId = authUserId;
  } else {
    state.currentUserId = PORTAL_OWNER_AUTH_USER_ID;
  }

  const email = (authEmail || PORTAL_OWNER_AUTH_EMAIL).trim().toLowerCase();
  const bound = state.users.find((user) => user.id === state.currentUserId);
  if (bound && email && bound.email.trim().toLowerCase() !== email) {
    bound.email = email;
  }

  const after = JSON.stringify({
    users: state.users.map((u) => [u.id, u.name, u.email, u.roleId, u.active]),
    currentUserId: state.currentUserId,
  });
  return before !== after;
}

function authOwnerNeedsHeal(
  state: TlbState,
  authUserId: string,
  authEmail: string,
): boolean {
  if (!shouldHealAuthOwner(state, authUserId, authEmail)) return false;
  const ownerRole =
    state.roles.find((role) => role.systemKey === "Owner" && role.active && !role.deletedAt) ??
    state.roles.find((role) => role.id === SYSTEM_ROLE_IDS.Owner);
  if (!ownerRole) return false;

  const authUser = state.users.find((user) => user.id === authUserId);
  if (!authUser) return true;
  if (!authUser.active) return true;
  if (authUser.roleId !== ownerRole.id) return true;
  if (authUser.name !== OWNER_DISPLAY_NAME) return true;
  const email = (authEmail || authUser.email || "").trim().toLowerCase();
  if (email && authUser.email.trim().toLowerCase() !== email) return true;
  if (state.currentUserId !== authUserId) return true;

  if (state.users.some((user) => user.id === LEGACY_SEED_OWNER_USER_ID)) return true;

  const extraOwners = state.users.some((user) => {
    if (isSoleOwnerUserId(user.id)) return false;
    return state.roles.find((role) => role.id === user.roleId)?.systemKey === "Owner";
  });
  if (extraOwners) return true;

  const colliding = state.users.some((user) => {
    if (isSoleOwnerUserId(user.id) || user.id === authUserId) return false;
    const userEmail = user.email.trim().toLowerCase();
    return Boolean(email && userEmail === email);
  });
  return colliding;
}

/**
 * Remap a pending invite / stale local staff row onto the live Auth UUID so
 * session bind can find them. Never promotes non-Owner Auth into Owner.
 */
function ensureStaffAuthUserRow(
  state: TlbState,
  input: { authUserId: string; email: string },
): AppUser | undefined {
  const authUserId = input.authUserId.trim();
  const email = input.email.trim().toLowerCase();
  if (!authUserId || isPortalOwnerAuth({ authUserId, email })) return undefined;

  const byId =
    state.users.find((u) => u.active && u.id === authUserId) ??
    state.users.find((u) => u.id === authUserId);
  if (byId) {
    if (email && byId.email.trim().toLowerCase() !== email) byId.email = email;
    byId.active = true;
    byId.invitePending = false;
    delete byId.inviteToken;
    delete byId.inviteCode;
    if (!byId.inviteAcceptedAt) byId.inviteAcceptedAt = new Date().toISOString();
    // Staff Auth must never keep an Owner role assignment.
    const role = state.roles.find((r) => r.id === byId.roleId);
    if (role?.systemKey === "Owner") {
      byId.roleId = demoRoleIdForEmail(byId.email, state.roles);
    }
    return byId;
  }

  const byEmail = email
    ? state.users.find(
        (u) =>
          !isSoleOwnerUserId(u.id) &&
          u.email.trim().toLowerCase() === email,
      )
    : undefined;
  if (byEmail) {
    byEmail.id = authUserId;
    byEmail.active = true;
    byEmail.invitePending = false;
    delete byEmail.inviteToken;
    delete byEmail.inviteCode;
    if (!byEmail.inviteAcceptedAt) byEmail.inviteAcceptedAt = new Date().toISOString();
    const role = state.roles.find((r) => r.id === byEmail.roleId);
    if (role?.systemKey === "Owner") {
      byEmail.roleId = demoRoleIdForEmail(byEmail.email, state.roles);
    }
    return byEmail;
  }

  if (!email) return undefined;
  const created: AppUser = {
    id: authUserId,
    name: email.split("@")[0] || "Staff",
    email,
    roleId: demoRoleIdForEmail(email, state.roles),
    active: true,
    invitePending: false,
    inviteAcceptedAt: new Date().toISOString(),
  };
  state.users.push(created);
  return created;
}

/**
 * Bind the local workspace session to the Auth user (profile id / email).
 * Prefer Auth UUID over email so same-email collisions cannot steal Owner.
 * Owner Auth always binds to Owner staff + OWNER role + TLB Owner name.
 * Any other Auth login binds to that staff profile + invited role — never Owner.
 * Returns the same state reference when already aligned.
 */
export function bindSessionToAuthIdentity(
  state: TlbState,
  input: { email?: string; authUserId?: string },
): TlbState {
  const email = input.email?.trim().toLowerCase() ?? "";
  const authUserId = input.authUserId?.trim() ?? "";
  if (!email && !authUserId) return state;

  const portalOwner = isPortalOwnerAuth({ authUserId, email });

  // ── Owner Auth only ──────────────────────────────────────────────
  if (portalOwner) {
    const needsHeal = authUserId ? authOwnerNeedsHeal(state, authUserId, email) : true;
    const byId = authUserId
      ? state.users.find((u) => u.active && u.id === authUserId) ??
        state.users.find((u) => u.id === authUserId)
      : undefined;
    let user = byId;
    if (!user && authUserId) user = byId;
    if (!user && !authUserId) return state;

    const sessionUserId = authUserId || user?.id || PORTAL_OWNER_AUTH_USER_ID;
    const role = user ? state.roles.find((r) => r.id === user.roleId) : undefined;
    const roleLabel = (role?.systemKey ?? role?.name ?? state.currentRole) as TlbState["currentRole"];
    if (
      !needsHeal &&
      user &&
      state.currentUserId === user.id &&
      state.currentUser === user.name &&
      state.currentRoleId === user.roleId &&
      state.currentRole === roleLabel &&
      user.name === OWNER_DISPLAY_NAME &&
      role?.systemKey === "Owner" &&
      state.currentRole === "Owner"
    ) {
      return state;
    }

    const next = JSON.parse(JSON.stringify(state)) as TlbState;
    if (authUserId) healAuthOwnerIdentity(next, authUserId, email);
    else ensurePortalOwnerStaffDirectory(next);
    next.currentUserId =
      (authUserId && next.users.some((u) => u.id === authUserId) ? authUserId : undefined) ??
      sessionUserId;
    syncSessionIdentity(next);
    return next;
  }

  // ── Staff Auth — never Owner ─────────────────────────────────────
  if (!authUserId) return state;

  const next = JSON.parse(JSON.stringify(state)) as TlbState;
  // Keep sole Owner directory tidy without changing this staff session.
  ensurePortalOwnerStaffDirectory(next);
  const staff = ensureStaffAuthUserRow(next, { authUserId, email });
  if (!staff) return state;

  const role = next.roles.find((r) => r.id === staff.roleId);
  const roleLabel = (role?.systemKey ?? role?.name ?? next.currentRole) as TlbState["currentRole"];
  if (
    next.currentUserId === staff.id &&
    next.currentUser === staff.name &&
    next.currentRoleId === staff.roleId &&
    next.currentRole === roleLabel
  ) {
    // Still return next when we remapped/created the row so callers persist heal.
    const unchanged =
      state.users.some((u) => u.id === staff.id) &&
      state.currentUserId === staff.id &&
      state.currentUser === staff.name;
    return unchanged ? state : next;
  }

  next.currentUserId = staff.id;
  syncSessionIdentity(next);
  return next;
}

function mergeById<T extends { id: string }>(existing: T[], extras: T[]): T[] {
  const ids = new Set(existing.map((e) => e.id));
  return [...existing, ...extras.filter((e) => !ids.has(e.id))];
}

/** Upgrade legacy localStorage payloads without wiping demo data. */
export function migrateState(raw: unknown): TlbState {
  if (!raw || typeof raw !== "object") return createSeedState();
  const parsed = raw as Partial<TlbState> & { version?: number };
  const seed = createSeedState();
  const priorVersion = parsed.version ?? 0;

  const counters: DocumentCounters = {
    ...DEFAULT_COUNTERS,
    ...(parsed.counters ?? {}),
    supplier: parsed.counters?.supplier ?? 0,
    supplierPo: parsed.counters?.supplierPo ?? 0,
    supplierReceipt: parsed.counters?.supplierReceipt ?? 0,
    supplierPayment: parsed.counters?.supplierPayment ?? 0,
    invoice: parsed.counters?.invoice ?? 0,
    receipt: parsed.counters?.receipt ?? 0,
    delivery: parsed.counters?.delivery ?? 0,
    payment: parsed.counters?.payment ?? 0,
    quotation: parsed.counters?.quotation ?? 0,
    stockMovement: parsed.counters?.stockMovement ?? 0,
    stockIssue: parsed.counters?.stockIssue ?? 0,
    transfer: parsed.counters?.transfer ?? 0,
    adjustment: parsed.counters?.adjustment ?? 0,
    batch: parsed.counters?.batch ?? 0,
    customerReturn: parsed.counters?.customerReturn ?? 0,
    supplierReturn: parsed.counters?.supplierReturn ?? 0,
    nonPoPurchase: parsed.counters?.nonPoPurchase ?? 0,
    importShipment: parsed.counters?.importShipment ?? 0,
    exportShipment: parsed.counters?.exportShipment ?? 0,
    opsRequest: parsed.counters?.opsRequest ?? 0,
  };

  const ageing: AgeingSettings = {
    ...DEFAULT_AGEING,
    ...(parsed.ageing ?? {}),
    extendedUnfulfilledDays:
      parsed.ageing?.extendedUnfulfilledDays ?? DEFAULT_AGEING.extendedUnfulfilledDays,
    expectedApproachingDays:
      parsed.ageing?.expectedApproachingDays ?? DEFAULT_AGEING.expectedApproachingDays,
  };

  // v3: seed dated collections when upgrading from empty finance ledgers.
  const needsCollectionSeed =
    priorVersion < 3 && !parsed.payments?.length && !parsed.receipts?.length;

  // v4: seed supplier master + period-dated procurement activity.
  const needsSupplierSeed = priorVersion < 4 || !parsed.suppliers?.length;

  // v6: merge period-spanning commercial demo rows so Today ≠ Month ≠ Year is visible
  // without wiping user-created documents (merge-by-id only).
  const needsPeriodSpanSeed = priorVersion < 6;

  // v5/v14: keep saved users, then lock the workspace to the Owner role only.
  const ownerCatalog = createSystemRoles().filter((r) => r.systemKey === "Owner");
  const roles: RoleDefinition[] = parsed.roles?.length ? parsed.roles : ownerCatalog;
  const users: AppUser[] = parsed.users?.length
    ? mergeById(parsed.users, defaultUsers(roles))
    : defaultUsers(roles);

  const baseOrders = parsed.orders?.length
    ? parsed.orders.map((o) => ({ ...o }))
    : seed.orders.map((o) => ({ ...o }));
  const baseOrderLines = parsed.orderLines?.length ? parsed.orderLines : seed.orderLines;
  const baseReceipts = needsCollectionSeed ? seed.receipts : (parsed.receipts ?? []);
  const baseReceiptLines = needsCollectionSeed ? seed.receiptLines : (parsed.receiptLines ?? []);
  const basePayments = needsCollectionSeed ? seed.payments : (parsed.payments ?? []);

  // v9: inventory engine collections (ledger, batches, GRN, transfers, approvals).
  const needsInventorySeed = priorVersion < 9;
  // v10: returns, Non-PO workflow, import/export shipments, ageing/profit packs.
  const needsOpsPackSeed = priorVersion < 10;
  // v11: Operations Hub (requests, drivers, discrepancies, approval rules).
  const needsOpsHubSeed = priorVersion < 11;

  const inventorySettings: InventorySettings = {
    ...DEFAULT_INVENTORY_SETTINGS,
    ...(parsed.inventorySettings ?? {}),
    expiryAlertDays: parsed.inventorySettings?.expiryAlertDays?.length
      ? parsed.inventorySettings.expiryAlertDays
      : DEFAULT_INVENTORY_SETTINGS.expiryAlertDays,
  };

  const next: TlbState = {
    version: 14,
    warehouses: needsOpsHubSeed
      ? mergeById(parsed.warehouses?.length ? parsed.warehouses : seed.warehouses, seed.warehouses)
      : parsed.warehouses?.length
        ? parsed.warehouses
        : seed.warehouses,
    products:
      needsInventorySeed || needsOpsHubSeed
        ? mergeById(parsed.products?.length ? parsed.products : seed.products, seed.products)
        : parsed.products?.length
          ? parsed.products
          : seed.products,
    stock: needsOpsHubSeed
      ? mergeById(
          parsed.stock?.length ? parsed.stock.map((s) => ({ ...s })) : seed.stock,
          seed.stock,
        )
      : parsed.stock?.length
        ? parsed.stock.map((s) => ({ ...s }))
        : seed.stock,
    batches:
      needsInventorySeed || needsOpsHubSeed
        ? mergeById(parsed.batches ?? [], seed.batches)
        : (parsed.batches ?? []),
    stockMovements: needsInventorySeed
      ? mergeById(parsed.stockMovements ?? [], seed.stockMovements)
      : (parsed.stockMovements ?? []),
    goodsReceipts: needsInventorySeed
      ? mergeById(parsed.goodsReceipts ?? [], seed.goodsReceipts)
      : (parsed.goodsReceipts ?? []),
    goodsReceiptLines: needsInventorySeed
      ? mergeById(parsed.goodsReceiptLines ?? [], seed.goodsReceiptLines)
      : (parsed.goodsReceiptLines ?? []),
    stockIssues: parsed.stockIssues ?? [],
    stockIssueLines: parsed.stockIssueLines ?? [],
    transfers: needsInventorySeed
      ? mergeById(parsed.transfers ?? [], seed.transfers)
      : (parsed.transfers ?? []),
    transferLines: needsInventorySeed
      ? mergeById(parsed.transferLines ?? [], seed.transferLines)
      : (parsed.transferLines ?? []),
    adjustments: parsed.adjustments ?? [],
    adjustmentLines: parsed.adjustmentLines ?? [],
    approvals: needsInventorySeed
      ? mergeById(parsed.approvals ?? [], seed.approvals)
      : (parsed.approvals ?? []),
    inventorySettings,
    customers: parsed.customers?.length ? parsed.customers : seed.customers,
    suppliers: needsSupplierSeed ? seed.suppliers : (parsed.suppliers ?? []),
    supplierPurchaseOrders: needsSupplierSeed
      ? seed.supplierPurchaseOrders
      : (parsed.supplierPurchaseOrders ?? []),
    supplierReceipts: needsSupplierSeed ? seed.supplierReceipts : (parsed.supplierReceipts ?? []),
    supplierPayments: needsSupplierSeed ? seed.supplierPayments : (parsed.supplierPayments ?? []),
    orders: needsPeriodSpanSeed ? mergeById(baseOrders, seed.orders) : baseOrders,
    orderLines: needsPeriodSpanSeed ? mergeById(baseOrderLines, seed.orderLines) : baseOrderLines,
    supplies: parsed.supplies ?? [],
    supplyLines: parsed.supplyLines ?? [],
    invoices: parsed.invoices ?? [],
    invoiceLines: parsed.invoiceLines ?? [],
    receipts: needsPeriodSpanSeed ? mergeById(baseReceipts, seed.receipts) : baseReceipts,
    receiptLines: needsPeriodSpanSeed
      ? mergeById(baseReceiptLines, seed.receiptLines)
      : baseReceiptLines,
    deliveries: parsed.deliveries ?? [],
    deliveryItems: parsed.deliveryItems ?? [],
    payments: needsPeriodSpanSeed ? mergeById(basePayments, seed.payments) : basePayments,
    quotations: parsed.quotations ?? [],
    customerReturns: needsOpsPackSeed
      ? mergeById(parsed.customerReturns ?? [], seed.customerReturns)
      : (parsed.customerReturns ?? []),
    supplierReturns: needsOpsPackSeed
      ? mergeById(parsed.supplierReturns ?? [], seed.supplierReturns)
      : (parsed.supplierReturns ?? []),
    nonPoPurchases: needsOpsPackSeed
      ? mergeById(parsed.nonPoPurchases ?? [], seed.nonPoPurchases)
      : (parsed.nonPoPurchases ?? []),
    nonPoPurchaseLines: needsOpsPackSeed
      ? mergeById(parsed.nonPoPurchaseLines ?? [], seed.nonPoPurchaseLines)
      : (parsed.nonPoPurchaseLines ?? []),
    importShipments: needsOpsPackSeed
      ? mergeById(parsed.importShipments ?? [], seed.importShipments)
      : (parsed.importShipments ?? []),
    importShipmentLines: needsOpsPackSeed
      ? mergeById(parsed.importShipmentLines ?? [], seed.importShipmentLines)
      : (parsed.importShipmentLines ?? []),
    exportShipments: needsOpsPackSeed
      ? mergeById(parsed.exportShipments ?? [], seed.exportShipments)
      : (parsed.exportShipments ?? []),
    exportShipmentLines: needsOpsPackSeed
      ? mergeById(parsed.exportShipmentLines ?? [], seed.exportShipmentLines)
      : (parsed.exportShipmentLines ?? []),
    opsRequests: parsed.opsRequests ?? [],
    opsRequestLines: parsed.opsRequestLines ?? [],
    opsDrivers: needsOpsHubSeed
      ? mergeById(parsed.opsDrivers ?? [], seed.opsDrivers)
      : (parsed.opsDrivers ?? seed.opsDrivers),
    opsMessages: parsed.opsMessages ?? [],
    opsActivity: parsed.opsActivity ?? [],
    opsCustody: parsed.opsCustody ?? [],
    opsDiscrepancies: parsed.opsDiscrepancies ?? [],
    opsApprovalRules: parsed.opsApprovalRules?.length
      ? parsed.opsApprovalRules
      : seed.opsApprovalRules,
    notifications: parsed.notifications ?? [],
    reservations: parsed.reservations ?? [],
    audit: parsed.audit ?? [],
    counters: floorMatureCommercialCounters({
      ...(needsCollectionSeed || needsPeriodSpanSeed
        ? {
            ...counters,
            receipt: Math.max(counters.receipt, seed.counters.receipt),
            payment: Math.max(counters.payment, seed.counters.payment),
            order: Math.max(counters.order, seed.counters.order),
          }
        : counters),
      ...(needsSupplierSeed
        ? {
            supplier: Math.max(counters.supplier, seed.counters.supplier),
            supplierPo: Math.max(counters.supplierPo, seed.counters.supplierPo),
            supplierReceipt: Math.max(counters.supplierReceipt, seed.counters.supplierReceipt),
            supplierPayment: Math.max(counters.supplierPayment, seed.counters.supplierPayment),
          }
        : {}),
      ...(needsInventorySeed
        ? {
            stockMovement: Math.max(counters.stockMovement ?? 0, seed.counters.stockMovement ?? 0),
            transfer: Math.max(counters.transfer ?? 0, seed.counters.transfer ?? 0),
            batch: Math.max(counters.batch ?? 0, seed.counters.batch ?? 0),
            supplierReceipt: Math.max(
              counters.supplierReceipt ?? 0,
              seed.counters.supplierReceipt ?? 0,
            ),
          }
        : {}),
      ...(needsOpsPackSeed
        ? {
            customerReturn: Math.max(
              counters.customerReturn ?? 0,
              seed.counters.customerReturn ?? 0,
            ),
            supplierReturn: Math.max(
              counters.supplierReturn ?? 0,
              seed.counters.supplierReturn ?? 0,
            ),
            nonPoPurchase: Math.max(counters.nonPoPurchase ?? 0, seed.counters.nonPoPurchase ?? 0),
            importShipment: Math.max(
              counters.importShipment ?? 0,
              seed.counters.importShipment ?? 0,
            ),
            exportShipment: Math.max(
              counters.exportShipment ?? 0,
              seed.counters.exportShipment ?? 0,
            ),
          }
        : {}),
      opsRequest: Math.max(counters.opsRequest ?? 0, seed.counters.opsRequest ?? 0),
      quotation: Math.max(
        counters.quotation ?? 0,
        seed.counters.quotation ?? 0,
        parsed.quotations?.length ?? 0,
      ),
    }),
    ageing,
    company: parsed.company ?? DEFAULT_COMPANY,
    vatRates: ensureTaxCatalog(parsed.vatRates),
    catalogDeletions: parsed.catalogDeletions ?? [],
    catalogPurgedIds: parsed.catalogPurgedIds ?? [],
    roles,
    users,
    currentUserId: parsed.currentUserId ?? OWNER_USER_ID,
    currentRoleId: parsed.currentRoleId ?? SYSTEM_ROLE_IDS.Owner,
    currentUser: parsed.currentUser ?? OWNER_DISPLAY_NAME,
    currentRole: parsed.currentRole ?? "Owner",
  };

  // Fix wrong demo identity: Kwame Asare / Manager → Owner session.
  const legacyDemoNames = new Set([
    "Kwame Asare",
    "John Doe",
    "Mary Smith",
    "John",
    "Mary",
    "Efua Addo",
  ]);
  if (
    priorVersion < 5 ||
    legacyDemoNames.has(next.currentUser) ||
    !next.users.some((u) => u.id === next.currentUserId) ||
    (next.currentRole === "Manager" && !parsed.currentUserId)
  ) {
    next.currentUserId = OWNER_USER_ID;
    const owner = next.users.find((u) => u.id === OWNER_USER_ID);
    if (owner) {
      owner.name = OWNER_DISPLAY_NAME;
      owner.roleId = SYSTEM_ROLE_IDS.Owner;
      owner.email = PORTAL_OWNER_AUTH_EMAIL;
    }
  }

  // v7/v11: trash + ops caps — merge missing defaults onto system roles.
  if (priorVersion < 7 || priorVersion < 11) {
    for (const role of next.roles) {
      if (!role.systemKey) continue;
      const defaults = SYSTEM_ROLE_PERMISSIONS[role.systemKey] as Permission[] | undefined;
      if (!defaults) continue;
      const missing = defaults.filter((p) => !role.permissions.includes(p));
      if (missing.length) role.permissions = [...role.permissions, ...missing];
    }
    // Owner/Admin always receive the full matrix (including trash caps).
    for (const role of next.roles) {
      if (role.systemKey === "Owner" || role.systemKey === "Admin") {
        const missing = ALL_PERMISSIONS.filter((p) => !role.permissions.includes(p));
        if (missing.length) role.permissions = [...role.permissions, ...missing];
      }
    }
  }

  // v13: permissions are fixed/predefined — reset system roles to the catalog
  // (clears any localStorage overrides from the old checkbox matrix).
  if (priorVersion < 13) {
    for (const role of next.roles) {
      if (!role.systemKey) continue;
      const defaults = SYSTEM_ROLE_PERMISSIONS[role.systemKey] as Permission[] | undefined;
      if (defaults) role.permissions = [...defaults];
    }
  }

  // Drop permanently purged rows so seed upgrades / mergeById cannot resurrect them.
  const purged = next.catalogPurgedIds ?? [];
  if (purged.length) {
    next.warehouses = omitPurgedEntities(next.warehouses, "warehouse", purged);
    next.products = omitPurgedEntities(next.products, "product", purged);
    next.customers = omitPurgedEntities(next.customers, "customer", purged);
    next.suppliers = omitPurgedEntities(next.suppliers, "supplier", purged);
    next.orders = omitPurgedEntities(next.orders, "order", purged);
    next.invoices = omitPurgedEntities(next.invoices, "invoice", purged);
    next.receipts = omitPurgedEntities(next.receipts, "receipt", purged);
    next.payments = omitPurgedEntities(next.payments, "payment", purged);
    next.deliveries = omitPurgedEntities(next.deliveries, "delivery", purged);
    next.supplies = omitPurgedEntities(next.supplies, "supply", purged);
    next.notifications = omitPurgedEntities(next.notifications, "notification", purged);
    next.quotations = omitPurgedEntities(next.quotations ?? [], "quotation", purged);
    next.users = omitPurgedEntities(next.users, "user", purged);
    next.roles = omitPurgedEntities(next.roles, "role", purged);
    next.batches = omitPurgedEntities(next.batches ?? [], "batch", purged);
    next.goodsReceipts = omitPurgedEntities(next.goodsReceipts ?? [], "goods_receipt", purged);
    next.transfers = omitPurgedEntities(next.transfers ?? [], "transfer", purged);
    next.adjustments = omitPurgedEntities(next.adjustments ?? [], "adjustment", purged);
    next.approvals = omitPurgedEntities(next.approvals ?? [], "approval", purged);
    next.opsDrivers = omitPurgedEntities(next.opsDrivers ?? [], "ops_driver", purged);
    next.opsRequests = omitPurgedEntities(next.opsRequests ?? [], "ops_request", purged);
    next.customerReturns = omitPurgedEntities(next.customerReturns ?? [], "customer_return", purged);
    next.supplierReturns = omitPurgedEntities(next.supplierReturns ?? [], "supplier_return", purged);
    next.nonPoPurchases = omitPurgedEntities(next.nonPoPurchases ?? [], "non_po_purchase", purged);
    next.importShipments = omitPurgedEntities(next.importShipments ?? [], "import_shipment", purged);
    next.exportShipments = omitPurgedEntities(next.exportShipments ?? [], "export_shipment", purged);
    next.supplierPurchaseOrders = omitPurgedEntities(
      next.supplierPurchaseOrders ?? [],
      "supplier_po",
      purged,
    );
    next.supplierReceipts = omitPurgedEntities(next.supplierReceipts ?? [], "supplier_receipt", purged);
    next.supplierPayments = omitPurgedEntities(next.supplierPayments ?? [], "supplier_payment", purged);
  }

  // v15: quotation line items + smart calculator rollups
  next.quotations = (next.quotations ?? []).map((q) => {
    const lines = ensureQuotationLines(q);
    const rollup = rollupQuotationLines(lines);
    return {
      ...q,
      ...rollup,
      lines,
    };
  });
  next.version = Math.max(next.version ?? 0, 15);

  syncSessionIdentity(next);
  lockWorkspaceToOwner(next);
  return next;
}

export { DEFAULT_COMPANY, DEFAULT_VAT, DEFAULT_AGEING };
