import {
  ALL_PERMISSIONS,
  createSystemRoles,
  isPortalOwnerAuth,
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
      roleId: ownerId,
      active: true,
    },
    {
      id: "user-warehouse",
      name: "Kofi Boateng",
      email: "warehouse@tlb.gh",
      roleId: ownerId,
      active: true,
    },
    {
      id: "user-finance",
      name: "Efua Addo",
      email: "finance@tlb.gh",
      roleId: ownerId,
      active: true,
    },
    {
      id: "user-manager",
      name: "Yaw Mensah",
      email: "manager@tlb.gh",
      roleId: ownerId,
      active: true,
    },
    {
      id: "user-driver",
      name: "Kwesi Owusu",
      email: "driver@tlb.gh",
      roleId: ownerId,
      active: true,
    },
    {
      id: "user-requester",
      name: "Abena Factory",
      email: "factory@tlb.gh",
      roleId: ownerId,
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
    if (!liveRoleIds.has(user.roleId)) user.roleId = owner.id;
  }
  ensureDeletableSystemRoles(state);
  ensurePortalOwnerStaffDirectory(state);
  const ownerUser = state.users.find((u) => u.id === OWNER_USER_ID);
  if (ownerUser) {
    ownerUser.active = true;
    ownerUser.roleId = owner.id;
  }
  const sessionUser = state.users.find((u) => u.id === state.currentUserId && u.active);
  if (!sessionUser) {
    state.currentUserId = PORTAL_OWNER_AUTH_USER_ID;
  }
  state.version = Math.max(state.version, 14);
  syncSessionIdentity(state);
}

/** Keep denormalized session fields aligned with the signed-in user's assigned role. */
export function syncSessionIdentity(state: TlbState): void {
  const user =
    state.users.find((u) => u.id === state.currentUserId && u.active) ??
    state.users.find((u) => u.id === state.currentUserId) ??
    state.users.find((u) => u.id === OWNER_USER_ID) ??
    state.users[0];
  if (!user) return;
  const role =
    state.roles.find((r) => r.id === user.roleId && r.active && !r.deletedAt) ??
    state.roles.find((r) => r.id === user.roleId) ??
    state.roles.find((r) => r.systemKey === "Owner" && r.active);
  state.currentUserId = user.id;
  state.currentUser = user.name;
  if (role) {
    state.currentRoleId = role.id;
    state.currentRole = (role.systemKey ?? role.name) as TlbState["currentRole"];
  }
}

/**
 * Same-email Finance (etc.) invite acceptance could demote the Auth Owner
 * profile in local/cloud staff while Auth UUID stayed the same — and could
 * leave the Owner display name as the Finance invitee. Always restore Owner
 * identity for the portal Owner Auth account; also restore when heuristics
 * show this Auth row is the workspace Owner.
 */
function shouldHealAuthOwner(
  state: TlbState,
  authUserId: string,
  authEmail: string,
): boolean {
  if (!authUserId) return false;
  if (isPortalOwnerAuth({ authUserId, email: authEmail })) return true;

  const authUser =
    state.users.find((user) => user.id === authUserId && user.active) ??
    state.users.find((user) => user.id === authUserId);
  const email = (authEmail || authUser?.email || "").trim().toLowerCase();
  if (!email) return false;

  const seedOwnerSameEmail = state.users.some(
    (user) =>
      user.id === OWNER_USER_ID &&
      user.email.trim().toLowerCase() === email &&
      state.roles.find((role) => role.id === user.roleId)?.systemKey === "Owner",
  );
  if (seedOwnerSameEmail) return true;

  const otherOwners = state.users.filter(
    (user) =>
      user.id !== authUserId &&
      user.active &&
      state.roles.find((role) => role.id === user.roleId)?.systemKey === "Owner",
  );
  if (otherOwners.some((user) => user.email.trim().toLowerCase() === email)) return true;
  // Seed Owner often keeps owner@tlb.gh while Auth uses the real Owner email —
  // still heal when this Auth UUID is the only non-seed Owner candidate.
  if (otherOwners.every((user) => user.id === OWNER_USER_ID)) return true;
  if (otherOwners.length === 0) return true;
  return false;
}

/**
 * Keep the portal Owner Auth staff row as TLB Owner / OWNER forever, and drop
 * same-email Finance leftovers from the directory. Does not steal the session
 * unless currentUserId pointed at a purged row.
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

  const seedOwner = state.users.find((user) => user.id === OWNER_USER_ID);
  if (seedOwner) {
    seedOwner.active = true;
    seedOwner.roleId = ownerRole.id;
    seedOwner.name = OWNER_DISPLAY_NAME;
    seedOwner.email = PORTAL_OWNER_AUTH_EMAIL;
  }

  const keepIds = new Set<string>([PORTAL_OWNER_AUTH_USER_ID, OWNER_USER_ID]);
  state.users = state.users.filter((user) => {
    if (keepIds.has(user.id)) return true;
    const userEmail = user.email.trim().toLowerCase();
    if (userEmail === PORTAL_OWNER_AUTH_EMAIL) return false;
    return true;
  });

  if (!state.users.some((user) => user.id === state.currentUserId && user.active)) {
    state.currentUserId = PORTAL_OWNER_AUTH_USER_ID;
  }
}

/**
 * Force Auth Owner staff row onto OWNER role + TLB Owner name, align seed
 * Owner email, and drop leftover Finance (etc.) staff that share the Owner
 * email so hydrate cannot resurrect the wrong "Signed in as" label.
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

  const seedOwner = state.users.find((user) => user.id === OWNER_USER_ID);
  if (seedOwner) {
    if (seedOwner.name !== OWNER_DISPLAY_NAME) return true;
    if (seedOwner.roleId !== ownerRole.id) return true;
    if (email && seedOwner.email.trim().toLowerCase() !== email) return true;
  }

  const colliding = state.users.some((user) => {
    if (user.id === authUserId || user.id === OWNER_USER_ID) return false;
    const userEmail = user.email.trim().toLowerCase();
    return Boolean(email && userEmail === email);
  });
  return colliding;
}

/**
 * Bind the local workspace session to the Auth user (profile id / email).
 * Prefer Auth UUID over email so same-email collisions cannot steal Owner.
 * Owner Auth always binds to Owner staff + OWNER role + TLB Owner name.
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
  const needsHeal = authUserId ? authOwnerNeedsHeal(state, authUserId, email) : false;

  const byId = authUserId
    ? state.users.find((u) => u.active && u.id === authUserId) ??
      state.users.find((u) => u.id === authUserId)
    : undefined;
  const byEmail = email
    ? state.users.find((u) => u.active && u.email.trim().toLowerCase() === email)
    : undefined;
  // Auth UUID wins. Email is only a fallback when the profile id is not in local users yet.
  // For portal Owner Auth, never bind to a leftover Finance staff row found by email alone.
  let user = byId ?? (portalOwner || needsHeal ? undefined : byEmail);
  if (!user && (portalOwner || needsHeal) && authUserId) {
    // Ensure heal can create/repair the Auth Owner row below.
    user = byId;
  }
  if (!user && !portalOwner && !needsHeal) return state;
  if (!user && !authUserId) return state;

  const sessionUserId = authUserId || user?.id || "";
  const role = user ? state.roles.find((r) => r.id === user.roleId) : undefined;
  const roleLabel = (role?.systemKey ?? role?.name ?? state.currentRole) as TlbState["currentRole"];
  if (
    !needsHeal &&
    user &&
    state.currentUserId === user.id &&
    state.currentUser === user.name &&
    state.currentRoleId === user.roleId &&
    state.currentRole === roleLabel &&
    (!portalOwner ||
      (user.name === OWNER_DISPLAY_NAME &&
        role?.systemKey === "Owner" &&
        state.currentRole === "Owner"))
  ) {
    return state;
  }

  const next = JSON.parse(JSON.stringify(state)) as TlbState;
  if (authUserId) healAuthOwnerIdentity(next, authUserId, email);
  const boundId =
    (authUserId && next.users.some((u) => u.id === authUserId) ? authUserId : undefined) ??
    sessionUserId ??
    user?.id;
  if (boundId) next.currentUserId = boundId;
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

  syncSessionIdentity(next);
  lockWorkspaceToOwner(next);
  return next;
}

export { DEFAULT_COMPANY, DEFAULT_VAT, DEFAULT_AGEING };
