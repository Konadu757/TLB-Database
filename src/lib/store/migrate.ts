import {
  ALL_PERMISSIONS,
  createSystemRoles,
  OWNER_USER_ID,
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
  TlbState,
  VatRate,
} from "../domain/types";
import { DEFAULT_INVENTORY_SETTINGS } from "../domain/inventory";
import { createSeedState } from "./seed";

const DEFAULT_COMPANY: CompanyProfile = {
  legalName: "TLB Enterprise Limited",
  tradingName: "TLB Enterprise",
  address: "Industrial Area, Tema, Ghana",
  phone: "+233 30 200 0000",
  email: "accounts@tlb.gh",
  logoNote: "Use company logo from brand assets",
};

const DEFAULT_VAT: VatRate[] = [
  {
    id: "vat-configurable",
    code: "CFG",
    label: "Configured VAT (set in Settings)",
    ratePercent: 0,
    active: true,
  },
];

const DEFAULT_AGEING: AgeingSettings = {
  normalMaxDays: 2,
  attentionMaxDays: 7,
  extendedUnfulfilledDays: 14,
  expectedApproachingDays: 2,
};

const DEFAULT_COUNTERS: DocumentCounters = {
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
  customerReturn: 0,
  supplierReturn: 0,
  nonPoPurchase: 0,
  importShipment: 0,
  exportShipment: 0,
  opsRequest: 0,
};

function defaultUsers(roles: RoleDefinition[]): AppUser[] {
  const byKey = (key: string) => roles.find((r) => r.systemKey === key)?.id ?? SYSTEM_ROLE_IDS.Owner;
  return [
    {
      id: OWNER_USER_ID,
      name: "TLB Owner",
      email: "owner@tlb.gh",
      roleId: byKey("Owner"),
      active: true,
    },
    {
      id: "user-sales",
      name: "Ama Mensah",
      email: "sales@tlb.gh",
      roleId: byKey("Sales"),
      active: true,
    },
    {
      id: "user-warehouse",
      name: "Kofi Boateng",
      email: "warehouse@tlb.gh",
      roleId: byKey("Warehouse"),
      active: true,
    },
    {
      id: "user-finance",
      name: "Efua Addo",
      email: "finance@tlb.gh",
      roleId: byKey("Finance"),
      active: true,
    },
    {
      id: "user-manager",
      name: "Yaw Mensah",
      email: "manager@tlb.gh",
      roleId: byKey("Manager"),
      active: true,
    },
    {
      id: "user-driver",
      name: "Kwesi Owusu",
      email: "driver@tlb.gh",
      roleId: byKey("Driver"),
      active: true,
    },
    {
      id: "user-requester",
      name: "Abena Factory",
      email: "factory@tlb.gh",
      roleId: byKey("Requester"),
      active: true,
    },
  ];
}

/** Keep denormalized session fields aligned with users/roles. */
export function syncSessionIdentity(state: TlbState): void {
  const user =
    state.users.find((u) => u.id === state.currentUserId) ??
    state.users.find((u) => u.id === OWNER_USER_ID) ??
    state.users[0];
  if (!user) return;
  const role =
    state.roles.find((r) => r.id === user.roleId) ??
    state.roles.find((r) => r.id === state.currentRoleId) ??
    state.roles.find((r) => r.systemKey === "Owner");
  state.currentUserId = user.id;
  state.currentUser = user.name;
  if (role) {
    state.currentRoleId = role.id;
    state.currentRole = role.name;
  }
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
    extendedUnfulfilledDays: parsed.ageing?.extendedUnfulfilledDays ?? DEFAULT_AGEING.extendedUnfulfilledDays,
    expectedApproachingDays: parsed.ageing?.expectedApproachingDays ?? DEFAULT_AGEING.expectedApproachingDays,
  };

  // v3: seed dated collections when upgrading from empty finance ledgers.
  const needsCollectionSeed =
    priorVersion < 3 && !(parsed.payments?.length) && !(parsed.receipts?.length);

  // v4: seed supplier master + period-dated procurement activity.
  const needsSupplierSeed = priorVersion < 4 || !(parsed.suppliers?.length);

  // v6: merge period-spanning commercial demo rows so Today ≠ Month ≠ Year is visible
  // without wiping user-created documents (merge-by-id only).
  const needsPeriodSpanSeed = priorVersion < 6;

  // v5: owner-managed roles/users + correct owner identity (replace demo Kwame/Manager session).
  const systemRoles = createSystemRoles();
  const roles: RoleDefinition[] =
    parsed.roles?.length
      ? [
          ...systemRoles.filter((sys) => !parsed.roles!.some((r) => r.id === sys.id || r.systemKey === sys.systemKey)),
          ...parsed.roles,
        ]
      : systemRoles;
  const users: AppUser[] = parsed.users?.length
    ? mergeById(parsed.users, defaultUsers(roles))
    : defaultUsers(roles);

  const baseOrders = parsed.orders?.length ? parsed.orders.map((o) => ({ ...o })) : seed.orders.map((o) => ({ ...o }));
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
    expiryAlertDays:
      parsed.inventorySettings?.expiryAlertDays?.length
        ? parsed.inventorySettings.expiryAlertDays
        : DEFAULT_INVENTORY_SETTINGS.expiryAlertDays,
  };

  const next: TlbState = {
    version: 11,
    warehouses: needsOpsHubSeed
      ? mergeById(parsed.warehouses?.length ? parsed.warehouses : seed.warehouses, seed.warehouses)
      : parsed.warehouses?.length
        ? parsed.warehouses
        : seed.warehouses,
    products: needsInventorySeed || needsOpsHubSeed
      ? mergeById(parsed.products?.length ? parsed.products : seed.products, seed.products)
      : parsed.products?.length
        ? parsed.products
        : seed.products,
    stock: needsOpsHubSeed
      ? mergeById(parsed.stock?.length ? parsed.stock.map((s) => ({ ...s })) : seed.stock, seed.stock)
      : parsed.stock?.length
        ? parsed.stock.map((s) => ({ ...s }))
        : seed.stock,
    batches: needsInventorySeed || needsOpsHubSeed
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
    receiptLines: needsPeriodSpanSeed ? mergeById(baseReceiptLines, seed.receiptLines) : baseReceiptLines,
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
    opsApprovalRules: parsed.opsApprovalRules?.length ? parsed.opsApprovalRules : seed.opsApprovalRules,
    notifications: parsed.notifications ?? [],
    reservations: parsed.reservations ?? [],
    audit: parsed.audit ?? [],
    counters: {
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
            supplierReceipt: Math.max(counters.supplierReceipt ?? 0, seed.counters.supplierReceipt ?? 0),
          }
        : {}),
      ...(needsOpsPackSeed
        ? {
            customerReturn: Math.max(counters.customerReturn ?? 0, seed.counters.customerReturn ?? 0),
            supplierReturn: Math.max(counters.supplierReturn ?? 0, seed.counters.supplierReturn ?? 0),
            nonPoPurchase: Math.max(counters.nonPoPurchase ?? 0, seed.counters.nonPoPurchase ?? 0),
            importShipment: Math.max(counters.importShipment ?? 0, seed.counters.importShipment ?? 0),
            exportShipment: Math.max(counters.exportShipment ?? 0, seed.counters.exportShipment ?? 0),
          }
        : {}),
      opsRequest: Math.max(counters.opsRequest ?? 0, seed.counters.opsRequest ?? 0),
      quotation: Math.max(counters.quotation ?? 0, seed.counters.quotation ?? 0, parsed.quotations?.length ?? 0),
    },
    ageing,
    company: parsed.company ?? DEFAULT_COMPANY,
    vatRates: parsed.vatRates?.length ? parsed.vatRates : DEFAULT_VAT,
    catalogDeletions: parsed.catalogDeletions ?? [],
    catalogPurgedIds: parsed.catalogPurgedIds ?? [],
    roles,
    users,
    currentUserId: parsed.currentUserId ?? OWNER_USER_ID,
    currentRoleId: parsed.currentRoleId ?? SYSTEM_ROLE_IDS.Owner,
    currentUser: parsed.currentUser ?? "TLB Owner",
    currentRole: parsed.currentRole ?? "Owner",
  };

  // Fix wrong demo identity: Kwame Asare / Manager → Owner session.
  const legacyDemoNames = new Set(["Kwame Asare", "John Doe", "Mary Smith", "John", "Mary"]);
  if (
    priorVersion < 5 ||
    legacyDemoNames.has(next.currentUser) ||
    !next.users.some((u) => u.id === next.currentUserId) ||
    next.currentRole === "Manager" && !parsed.currentUserId
  ) {
    next.currentUserId = OWNER_USER_ID;
    const owner = next.users.find((u) => u.id === OWNER_USER_ID);
    if (owner) {
      owner.name = "TLB Owner";
      owner.roleId = SYSTEM_ROLE_IDS.Owner;
    }
  }

  // v7: trash permissions — keep system roles aligned with the latest capability matrix.
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

  syncSessionIdentity(next);
  return next;
}

export { DEFAULT_COMPANY, DEFAULT_VAT, DEFAULT_AGEING };
