import {
  ageingBand,
  buildStockMap,
  calcAvailable,
  calcOutstanding,
  daysBetween,
  deriveOrderStatus,
  fulfilmentPercent,
  refreshLineStatuses,
  stockKey,
  validateSupplyQty,
} from "../domain/calculations";
import { buildNotifications } from "../domain/notifications";
import { nextDocumentNumber } from "../domain/numbering";
import {
  applyFreshInvite,
  findUserByInviteCode,
  findUserByInviteToken,
  isInvitePending,
  markInviteAccepted,
  normalizeAccessCode,
} from "../domain/invites";
import {
  dbRoleCodeForRoleId,
  createSystemRoles,
  hasPermission,
  isAssignableSystemRole,
  isSoleOwnerUserId,
  OWNER_USER_ID,
  resolveRole,
  systemRoleKeyForDbCode,
} from "../domain/permissions";

export { buildInviteLink, isInvitePending } from "../domain/invites";
import { isSoftDeleted } from "../domain/trash";
import type {
  AppRole,
  AppUser,
  AuditEvent,
  CompanyProfile,
  Customer,
  CustomerOrderLine,
  CustomerPurchaseOrder,
  OutstandingRow,
  Permission,
  Product,
  Quotation,
  RoleDefinition,
  StockBalance,
  StoreResult,
  Supplier,
  SupplyRequestLine,
  TaxKind,
  TaxMode,
  TlbState,
  VatRate,
  Warehouse,
} from "../domain/types";

import {
  listTrash,
  purgeTrashItem,
  restoreTrashItem,
  softDeleteRecord,
  trashBlockReason,
} from "./trash-store";

export { listTrash, purgeTrashItem, restoreTrashItem, softDeleteRecord, trashBlockReason };
import { migrateState, syncSessionIdentity } from "./migrate";
import { createSeedState } from "./seed";
import { applySupplyBatchPicks, getOrCreateBalance, postStockMovement } from "./inventory-store";
import { creditPosition } from "../domain/inventory";

export const STORAGE_KEY = "tlb.enterprise.state.v1";

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function pushAudit(
  state: TlbState,
  partial: Omit<AuditEvent, "id" | "at" | "actor"> & { actor?: string; at?: string },
): void {
  state.audit.unshift({
    id: uid("aud"),
    at: partial.at ?? new Date().toISOString(),
    actor: partial.actor ?? state.currentUser,
    action: partial.action,
    entityType: partial.entityType,
    entityId: partial.entityId,
    summary: partial.summary,
    meta: partial.meta,
  });
  // Audit history is append-only from the UI — never expose delete. Cap for storage only.
  if (state.audit.length > 500) state.audit.length = 500;
}

function requirePerm(state: TlbState, permission: Permission): string | null {
  if (!hasPermission(state, permission)) {
    return `Role ${state.currentRole} cannot perform ${permission}.`;
  }
  return null;
}

function requireAnyPerm(state: TlbState, permissions: Permission[]): string | null {
  if (permissions.some((p) => hasPermission(state, p))) return null;
  return `Role ${state.currentRole} cannot perform ${permissions.join(" / ")}.`;
}

function refreshNotifications(state: TlbState): void {
  const outstanding = getOutstandingRows(state);
  state.notifications = buildNotifications(state, new Date().toISOString(), outstanding);
}

function recomputeOrder(state: TlbState, orderId: string): void {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return;
  const lines = state.orderLines.filter((l) => l.orderId === orderId);
  const stockMap = buildStockMap(state.stock);
  const refreshed = refreshLineStatuses(lines, stockMap);
  for (const line of refreshed) {
    const idx = state.orderLines.findIndex((l) => l.id === line.id);
    if (idx >= 0) state.orderLines[idx] = line;
  }
  const prev = order.status;
  const nextStatus = deriveOrderStatus({
    current: order.status,
    lines: refreshed,
    stockByKey: stockMap,
  });
  order.status = nextStatus;
  order.updatedAt = new Date().toISOString();
  if (prev !== nextStatus) {
    pushAudit(state, {
      action: "order.status_changed",
      entityType: "customer_purchase_order",
      entityId: order.id,
      summary: `Order ${order.number} status ${prev} → ${nextStatus}.`,
      meta: { from: prev, to: nextStatus },
    });
  }
}

function recomputeAllOpenOrders(state: TlbState): void {
  for (const order of state.orders) {
    if (
      order.status === "Draft" ||
      order.status === "Pending" ||
      order.status === "Delivered" ||
      order.status === "Cancelled"
    ) {
      continue;
    }
    recomputeOrder(state, order.id);
  }
}

export function loadState(): TlbState {
  if (typeof window === "undefined") return createSeedState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedState();
    const parsed = JSON.parse(raw) as unknown;
    const migrated = migrateState(parsed);
    recomputeAllOpenOrders(migrated);
    refreshNotifications(migrated);
    saveState(migrated);
    return migrated;
  } catch {
    return createSeedState();
  }
}

export function saveState(state: TlbState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetToSeed(): TlbState {
  const seed = createSeedState();
  recomputeAllOpenOrders(seed);
  refreshNotifications(seed);
  saveState(seed);
  return seed;
}

export function getOutstandingRows(
  state: TlbState,
  asOf = new Date().toISOString(),
): OutstandingRow[] {
  const stockMap = buildStockMap(state.stock);
  const rows: OutstandingRow[] = [];

  for (const line of state.orderLines) {
    const outstanding = calcOutstanding(line);
    if (outstanding <= 0) continue;
    const order = state.orders.find((o) => o.id === line.orderId);
    if (!order || isSoftDeleted(order) || order.status === "Draft" || order.status === "Cancelled")
      continue;
    const customer = state.customers.find((c) => c.id === order.customerId);
    if (customer && isSoftDeleted(customer)) continue;
    const product = state.products.find((p) => p.id === line.productId);
    if (product && isSoftDeleted(product)) continue;
    const warehouse = state.warehouses.find((w) => w.id === line.warehouseId);
    if (warehouse && isSoftDeleted(warehouse)) continue;
    const bal = stockMap.get(stockKey(line.productId, line.warehouseId));
    const available = bal ? calcAvailable(bal) : 0;
    const ageDays = daysBetween(order.confirmedAt ?? order.orderDate, asOf);
    const band = ageingBand(ageDays, state.ageing);
    let demandFlag: OutstandingRow["demandFlag"] = "normal";
    if (available < outstanding) demandFlag = "awaiting_stock";
    else if (order.requiredDate) {
      const due = order.requiredDate.slice(0, 10);
      const today = asOf.slice(0, 10);
      if (due < today) demandFlag = "overdue";
      else if (due === today) demandFlag = "due_today";
      else if (
        daysBetween(asOf, order.requiredDate) <= (state.ageing.expectedApproachingDays ?? 2)
      ) {
        demandFlag = "due_soon";
      }
    } else if (band === "Overdue") {
      demandFlag = "overdue";
    }
    rows.push({
      orderId: order.id,
      orderNumber: order.number,
      customerId: order.customerId,
      customerName: customer?.name ?? "Unknown",
      lineId: line.id,
      productId: line.productId,
      productName: product?.name ?? "Unknown",
      productSku: product?.sku ?? "",
      warehouseId: line.warehouseId,
      warehouseName: warehouse?.name ?? "Unknown",
      orderedQty: line.orderedQty,
      suppliedQty: line.suppliedQty,
      cancelledQty: line.cancelledQty,
      outstandingQty: outstanding,
      reservedQty: line.reservedQty,
      availableQty: available,
      orderStatus: order.status,
      lineStatus: line.lineStatus,
      orderDate: order.orderDate,
      requiredDate: order.requiredDate,
      ageDays,
      ageingBand: band,
      unitPrice: line.unitPrice,
      demandFlag,
    });
  }

  return rows.sort((a, b) => b.ageDays - a.ageDays || a.orderNumber.localeCompare(b.orderNumber));
}

export function countOutstandingOrdersForProduct(state: TlbState, productId: string): number {
  const orderIds = new Set<string>();
  for (const line of state.orderLines) {
    if (line.productId !== productId) continue;
    if (calcOutstanding(line) <= 0) continue;
    const order = state.orders.find((o) => o.id === line.orderId);
    if (!order || isSoftDeleted(order) || order.status === "Draft" || order.status === "Cancelled")
      continue;
    const product = state.products.find((p) => p.id === line.productId);
    if (product && isSoftDeleted(product)) continue;
    const warehouse = state.warehouses.find((w) => w.id === line.warehouseId);
    if (warehouse && isSoftDeleted(warehouse)) continue;
    orderIds.add(order.id);
  }
  return orderIds.size;
}

type MutResult<T> = StoreResult<{ state: TlbState; data: T }>;

export function upsertCustomer(
  state: TlbState,
  input: Omit<Customer, "id" | "code" | "createdAt" | "updatedAt"> & { id?: string },
): MutResult<Customer> {
  const blocked = requirePerm(state, "customers.manage");
  if (blocked) return { ok: false, error: blocked };

  const next = cloneState(state);
  const now = new Date().toISOString();

  if (!input.name.trim()) return { ok: false, error: "Customer name is required." };

  if (input.id) {
    const idx = next.customers.findIndex((c) => c.id === input.id);
    if (idx < 0) return { ok: false, error: "Customer not found." };
    const existing = next.customers[idx]!;
    if (isSoftDeleted(existing)) {
      return { ok: false, error: "Restore this customer from trash before editing." };
    }
    if ((input.tin ?? "") !== (existing.tin ?? "")) {
      const tinBlocked = requirePerm(next, "tin.update");
      if (tinBlocked) return { ok: false, error: tinBlocked };
    }
    const updated: Customer = {
      ...existing,
      name: input.name,
      category: input.category,
      contactName: input.contactName,
      phone: input.phone,
      email: input.email,
      address: input.address,
      tin: input.tin?.trim() || undefined,
      taxExempt: input.taxExempt ? true : undefined,
      creditLimit: input.creditLimit,
      paymentTerms: input.paymentTerms,
      notes: input.notes,
      active: input.active,
      updatedAt: now,
    };
    next.customers[idx] = updated;
    pushAudit(next, {
      action: "customer.updated",
      entityType: "customer",
      entityId: existing.id,
      summary: `Updated customer ${existing.code} · ${input.name}.`,
    });
    return { ok: true, data: { state: next, data: updated } };
  }

  const numbered = nextDocumentNumber("customer", next.counters);
  next.counters = numbered.counters;
  const customer: Customer = {
    id: uid("cus"),
    code: numbered.number,
    name: input.name.trim(),
    category: input.category,
    contactName: input.contactName,
    phone: input.phone,
    email: input.email,
    address: input.address,
    tin: input.tin?.trim() || undefined,
    taxExempt: input.taxExempt ? true : undefined,
    creditLimit: input.creditLimit,
    paymentTerms: input.paymentTerms,
    notes: input.notes,
    active: input.active,
    createdAt: now,
    updatedAt: now,
  };
  next.customers.unshift(customer);
  pushAudit(next, {
    action: "customer.created",
    entityType: "customer",
    entityId: customer.id,
    summary: `Created customer ${customer.code} · ${customer.name}.`,
  });
  return { ok: true, data: { state: next, data: customer } };
}

export function upsertSupplier(
  state: TlbState,
  input: Omit<Supplier, "id" | "code" | "createdAt" | "updatedAt"> & { id?: string },
): MutResult<Supplier> {
  const blocked = requirePerm(state, "suppliers.manage");
  if (blocked) return { ok: false, error: blocked };

  const next = cloneState(state);
  const now = new Date().toISOString();

  if (!input.name.trim()) return { ok: false, error: "Supplier name is required." };

  if (input.id) {
    const idx = next.suppliers.findIndex((s) => s.id === input.id);
    if (idx < 0) return { ok: false, error: "Supplier not found." };
    const existing = next.suppliers[idx]!;
    if (isSoftDeleted(existing)) {
      return { ok: false, error: "Restore this supplier from trash before editing." };
    }
    if ((input.tin ?? "") !== (existing.tin ?? "")) {
      const tinBlocked = requirePerm(next, "tin.update");
      if (tinBlocked) return { ok: false, error: tinBlocked };
    }
    const tin = input.tin?.trim();
    const notes = input.notes?.trim();
    const updated: Supplier = {
      id: existing.id,
      code: existing.code,
      name: input.name.trim(),
      category: input.category,
      contactName: input.contactName,
      phone: input.phone,
      email: input.email,
      address: input.address,
      paymentTerms: input.paymentTerms,
      active: input.active,
      createdAt: existing.createdAt,
      updatedAt: now,
      ...(tin ? { tin } : {}),
      ...(notes ? { notes } : {}),
      ...(input.preferred ? { preferred: true } : {}),
    };
    next.suppliers[idx] = updated;
    pushAudit(next, {
      action: "supplier.updated",
      entityType: "supplier",
      entityId: existing.id,
      summary: `Updated supplier ${existing.code} · ${input.name}.`,
    });
    return { ok: true, data: { state: next, data: updated } };
  }

  const numbered = nextDocumentNumber("supplier", next.counters);
  next.counters = numbered.counters;
  const tin = input.tin?.trim();
  const notes = input.notes?.trim();
  const supplier: Supplier = {
    id: uid("sup"),
    code: numbered.number,
    name: input.name.trim(),
    category: input.category,
    contactName: input.contactName,
    phone: input.phone,
    email: input.email,
    address: input.address,
    paymentTerms: input.paymentTerms,
    active: input.active,
    createdAt: now,
    updatedAt: now,
    ...(tin ? { tin } : {}),
    ...(notes ? { notes } : {}),
    ...(input.preferred ? { preferred: true } : {}),
  };
  next.suppliers.unshift(supplier);
  pushAudit(next, {
    action: "supplier.created",
    entityType: "supplier",
    entityId: supplier.id,
    summary: `Created supplier ${supplier.code} · ${supplier.name}.`,
  });
  return { ok: true, data: { state: next, data: supplier } };
}

export function createQuotation(
  state: TlbState,
  input: {
    customerId?: string;
    customerName: string;
    contact?: string;
    itemLabel: string;
    qty: number;
    unitPrice: number;
    paymentTerms?: string;
    notes?: string;
    validDays?: number;
    status?: "Draft" | "Sent";
    taxExempt?: boolean;
  },
): MutResult<Quotation> {
  const blocked = requirePerm(state, "quotations.view");
  if (blocked) return { ok: false, error: blocked };

  const customerName = input.customerName.trim();
  const itemLabel = input.itemLabel.trim();
  if (!customerName) return { ok: false, error: "Customer name is required." };
  if (!itemLabel) return { ok: false, error: "Item / description is required." };
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { ok: false, error: "Quantity must be greater than zero." };
  }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) {
    return { ok: false, error: "Unit price must be zero or greater." };
  }

  const next = cloneState(state);
  const numbered = nextDocumentNumber("quotation", next.counters);
  next.counters = numbered.counters;

  // Hard uniqueness guard — never reuse an existing quote number.
  const used = new Set([...next.quotations.map((q) => q.number)]);
  if (used.has(numbered.number)) {
    return { ok: false, error: `Quote number ${numbered.number} already exists.` };
  }

  const now = new Date();
  const quoteDate = now.toISOString();
  const validDays = input.validDays && input.validDays > 0 ? input.validDays : 14;
  const validUntil = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000).toISOString();
  const amount = Math.round(input.qty * input.unitPrice * 100) / 100;

  // Honour linked customer tax-exempt flag when creating.
  const linkedCustomer = input.customerId
    ? next.customers.find((c) => c.id === input.customerId)
    : undefined;
  const taxExempt = Boolean(input.taxExempt || linkedCustomer?.taxExempt);

  const quotation: Quotation = {
    id: uid("qt"),
    number: numbered.number,
    customerName,
    itemLabel,
    qty: input.qty,
    unitPrice: input.unitPrice,
    amount,
    paymentTerms: input.paymentTerms?.trim() || "Net 30",
    status: input.status ?? "Draft",
    quoteDate,
    validUntil,
    preparedBy: next.currentUser,
    createdAt: quoteDate,
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.contact?.trim() ? { contact: input.contact.trim() } : {}),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    ...(taxExempt ? { taxExempt: true } : {}),
  };

  next.quotations.unshift(quotation);
  pushAudit(next, {
    action: "quotation.created",
    entityType: "quotation",
    entityId: quotation.id,
    summary: `Created quotation ${quotation.number} for ${quotation.customerName}.`,
  });
  return { ok: true, data: { state: next, data: quotation } };
}

export function updateQuotation(
  state: TlbState,
  quotationId: string,
  input: {
    customerId?: string;
    customerName: string;
    contact?: string;
    itemLabel: string;
    qty: number;
    unitPrice: number;
    paymentTerms?: string;
    notes?: string;
    status?: "Draft" | "Sent";
    validUntil?: string;
    taxExempt?: boolean;
  },
): MutResult<Quotation> {
  const blocked = requireAnyPerm(state, ["quotations.view", "records.edit"]);
  if (blocked) return { ok: false, error: blocked };

  const customerName = input.customerName.trim();
  const itemLabel = input.itemLabel.trim();
  if (!customerName) return { ok: false, error: "Customer name is required." };
  if (!itemLabel) return { ok: false, error: "Item / description is required." };
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return { ok: false, error: "Quantity must be greater than zero." };
  }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) {
    return { ok: false, error: "Unit price must be zero or greater." };
  }

  const next = cloneState(state);
  const idx = next.quotations.findIndex((q) => q.id === quotationId);
  if (idx < 0) return { ok: false, error: "Quotation not found." };
  const existing = next.quotations[idx]!;
  const amount = Math.round(input.qty * input.unitPrice * 100) / 100;
  const updated: Quotation = {
    ...existing,
    customerName,
    itemLabel,
    qty: input.qty,
    unitPrice: input.unitPrice,
    amount,
    paymentTerms: input.paymentTerms?.trim() || existing.paymentTerms || "Net 30",
    status: input.status ?? existing.status,
    taxExempt: input.taxExempt ? true : undefined,
    ...(input.validUntil ? { validUntil: input.validUntil } : {}),
    ...(input.customerId ? { customerId: input.customerId } : { customerId: undefined }),
    ...(input.contact?.trim() ? { contact: input.contact.trim() } : { contact: undefined }),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : { notes: undefined }),
  };
  next.quotations[idx] = updated;
  pushAudit(next, {
    action: "quotation.updated",
    entityType: "quotation",
    entityId: updated.id,
    summary: `Updated quotation ${updated.number} for ${updated.customerName}.`,
  });
  pushAudit(next, {
    action: "record.edited",
    entityType: "quotation",
    entityId: updated.id,
    summary: `Edited quotation ${updated.number}.`,
  });
  return { ok: true, data: { state: next, data: updated } };
}

export function upsertProduct(
  state: TlbState,
  input: {
    id?: string;
    sku: string;
    name: string;
    unit: string;
    category: string;
    active?: boolean;
    issueStrategy?: import("../domain/types").IssueStrategy;
    allowNegativeStock?: boolean;
    minQty?: number;
    maxQty?: number;
    reorderPoint?: number;
    reorderQty?: number;
    preferredSupplierId?: string;
    leadTimeDays?: number;
    standardCost?: number;
  },
): MutResult<Product> {
  const blocked = requireAnyPerm(state, ["records.edit", "stock.view", "settings.manage"]);
  if (blocked) return { ok: false, error: blocked };

  const sku = input.sku.trim();
  const name = input.name.trim();
  const unit = input.unit.trim() || "ea";
  const category = input.category.trim() || "General";
  if (!sku) return { ok: false, error: "SKU is required." };
  if (!name) return { ok: false, error: "Product name is required." };

  const next = cloneState(state);
  const now = new Date().toISOString();

  if (input.id) {
    const idx = next.products.findIndex((p) => p.id === input.id);
    if (idx < 0) return { ok: false, error: "Product not found." };
    const existing = next.products[idx]!;
    if (isSoftDeleted(existing)) {
      return { ok: false, error: "Restore this product from trash before editing." };
    }
    const skuClash = next.products.find(
      (p) => p.id !== existing.id && p.sku.toLowerCase() === sku.toLowerCase() && !isSoftDeleted(p),
    );
    if (skuClash) return { ok: false, error: `SKU ${sku} is already used by another product.` };
    const updated: Product = {
      ...existing,
      sku,
      name,
      unit,
      category,
      active: input.active ?? existing.active,
      ...(input.issueStrategy != null ? { issueStrategy: input.issueStrategy } : {}),
      ...(input.allowNegativeStock != null ? { allowNegativeStock: input.allowNegativeStock } : {}),
      ...(input.minQty != null ? { minQty: input.minQty } : {}),
      ...(input.maxQty != null ? { maxQty: input.maxQty } : {}),
      ...(input.reorderPoint != null ? { reorderPoint: input.reorderPoint } : {}),
      ...(input.reorderQty != null ? { reorderQty: input.reorderQty } : {}),
      ...(input.preferredSupplierId != null
        ? { preferredSupplierId: input.preferredSupplierId }
        : {}),
      ...(input.leadTimeDays != null ? { leadTimeDays: input.leadTimeDays } : {}),
      ...(input.standardCost != null ? { standardCost: input.standardCost } : {}),
    };
    next.products[idx] = updated;
    pushAudit(next, {
      action: "product.updated",
      entityType: "product",
      entityId: updated.id,
      summary: `Updated product ${updated.sku} · ${updated.name}.`,
    });
    pushAudit(next, {
      action: "record.edited",
      entityType: "product",
      entityId: updated.id,
      summary: `Edited product ${updated.sku}.`,
    });
    return { ok: true, data: { state: next, data: updated } };
  }

  const skuClash = next.products.find(
    (p) => p.sku.toLowerCase() === sku.toLowerCase() && !isSoftDeleted(p),
  );
  if (skuClash) return { ok: false, error: `SKU ${sku} already exists.` };
  const product: Product = {
    id: uid("prd"),
    sku,
    name,
    unit,
    category,
    active: input.active ?? true,
    ...(input.issueStrategy != null ? { issueStrategy: input.issueStrategy } : {}),
    ...(input.allowNegativeStock != null ? { allowNegativeStock: input.allowNegativeStock } : {}),
    ...(input.minQty != null ? { minQty: input.minQty } : {}),
    ...(input.maxQty != null ? { maxQty: input.maxQty } : {}),
    ...(input.reorderPoint != null ? { reorderPoint: input.reorderPoint } : {}),
    ...(input.reorderQty != null ? { reorderQty: input.reorderQty } : {}),
    ...(input.preferredSupplierId != null
      ? { preferredSupplierId: input.preferredSupplierId }
      : {}),
    ...(input.leadTimeDays != null ? { leadTimeDays: input.leadTimeDays } : {}),
    ...(input.standardCost != null ? { standardCost: input.standardCost } : {}),
  };
  next.products.unshift(product);
  pushAudit(next, {
    action: "product.created",
    entityType: "product",
    entityId: product.id,
    summary: `Created product ${product.sku} · ${product.name}.`,
    at: now,
  });
  return { ok: true, data: { state: next, data: product } };
}

export function upsertWarehouse(
  state: TlbState,
  input: {
    id?: string;
    code: string;
    name: string;
    location: string;
    active?: boolean;
  },
): MutResult<Warehouse> {
  const blocked = requireAnyPerm(state, ["records.edit", "stock.view", "settings.manage"]);
  if (blocked) return { ok: false, error: blocked };

  const code = input.code.trim();
  const name = input.name.trim();
  const location = input.location.trim();
  if (!code) return { ok: false, error: "Warehouse code is required." };
  if (!name) return { ok: false, error: "Warehouse name is required." };
  if (!location) return { ok: false, error: "Location is required." };

  const next = cloneState(state);

  if (input.id) {
    const idx = next.warehouses.findIndex((w) => w.id === input.id);
    if (idx < 0) return { ok: false, error: "Warehouse not found." };
    const existing = next.warehouses[idx]!;
    if (isSoftDeleted(existing)) {
      return { ok: false, error: "Restore this warehouse from trash before editing." };
    }
    const codeClash = next.warehouses.find(
      (w) =>
        w.id !== existing.id && w.code.toLowerCase() === code.toLowerCase() && !isSoftDeleted(w),
    );
    if (codeClash)
      return { ok: false, error: `Code ${code} is already used by another warehouse.` };
    const updated: Warehouse = {
      ...existing,
      code,
      name,
      location,
      active: input.active ?? existing.active,
    };
    next.warehouses[idx] = updated;
    pushAudit(next, {
      action: "warehouse.updated",
      entityType: "warehouse",
      entityId: updated.id,
      summary: `Updated warehouse ${updated.code} · ${updated.name}.`,
    });
    pushAudit(next, {
      action: "record.edited",
      entityType: "warehouse",
      entityId: updated.id,
      summary: `Edited warehouse ${updated.code}.`,
    });
    return { ok: true, data: { state: next, data: updated } };
  }

  const codeClash = next.warehouses.find(
    (w) => w.code.toLowerCase() === code.toLowerCase() && !isSoftDeleted(w),
  );
  if (codeClash) return { ok: false, error: `Code ${code} already exists.` };
  const warehouse: Warehouse = {
    id: uid("wh"),
    code,
    name,
    location,
    active: input.active ?? true,
  };
  next.warehouses.unshift(warehouse);
  pushAudit(next, {
    action: "warehouse.created",
    entityType: "warehouse",
    entityId: warehouse.id,
    summary: `Created warehouse ${warehouse.code} · ${warehouse.name}.`,
  });
  return { ok: true, data: { state: next, data: warehouse } };
}

export function updateCustomerOrderHeader(
  state: TlbState,
  orderId: string,
  input: {
    customerPoNumber?: string;
    requiredDate?: string;
    notes?: string;
    orderSource?: CustomerPurchaseOrder["orderSource"];
  },
): MutResult<CustomerPurchaseOrder> {
  const blocked = requireAnyPerm(state, ["orders.create", "records.edit"]);
  if (blocked) return { ok: false, error: blocked };

  const next = cloneState(state);
  const order = next.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (isSoftDeleted(order)) {
    return { ok: false, error: "Restore this order from trash before editing." };
  }
  if (order.status === "Delivered" || order.status === "Cancelled") {
    return {
      ok: false,
      error: `Cannot edit a ${order.status.toLowerCase()} order. Only Draft / Pending (and open) headers can be updated.`,
    };
  }
  const now = new Date().toISOString();
  if (input.customerPoNumber !== undefined) {
    order.customerPoNumber = input.customerPoNumber.trim() || undefined;
  }
  if (input.requiredDate !== undefined) {
    order.requiredDate = input.requiredDate.trim() || undefined;
  }
  if (input.notes !== undefined) {
    order.notes = input.notes.trim() || undefined;
  }
  if (input.orderSource !== undefined) {
    order.orderSource = input.orderSource;
  }
  order.updatedAt = now;
  pushAudit(next, {
    action: "order.updated",
    entityType: "customer_purchase_order",
    entityId: order.id,
    summary: `Updated order ${order.number} header fields.`,
  });
  pushAudit(next, {
    action: "record.edited",
    entityType: "customer_purchase_order",
    entityId: order.id,
    summary: `Edited order ${order.number}.`,
  });
  return { ok: true, data: { state: next, data: order } };
}

export function createCustomerOrder(
  state: TlbState,
  input: {
    customerId: string;
    notes?: string;
    requiredDate?: string;
    customerPoNumber?: string;
    lines: Array<{ productId: string; warehouseId: string; orderedQty: number; unitPrice: number }>;
  },
): MutResult<CustomerPurchaseOrder> {
  const blocked = requirePerm(state, "orders.create");
  if (blocked) return { ok: false, error: blocked };
  if (!input.customerId) return { ok: false, error: "Customer is required." };
  if (!input.lines.length) return { ok: false, error: "Add at least one order line." };
  for (const line of input.lines) {
    if (!Number.isInteger(line.orderedQty) || line.orderedQty <= 0) {
      return { ok: false, error: "Ordered quantity must be a positive whole number." };
    }
  }

  const next = cloneState(state);
  const now = new Date().toISOString();
  const numbered = nextDocumentNumber("order", next.counters);
  next.counters = numbered.counters;
  const order: CustomerPurchaseOrder = {
    id: uid("ord"),
    number: numbered.number,
    customerId: input.customerId,
    customerPoNumber: input.customerPoNumber?.trim() || undefined,
    status: "Draft",
    orderDate: now,
    requiredDate: input.requiredDate,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
    createdBy: next.currentUser,
  };
  next.orders.unshift(order);
  for (const line of input.lines) {
    next.orderLines.push({
      id: uid("ol"),
      orderId: order.id,
      productId: line.productId,
      warehouseId: line.warehouseId,
      orderedQty: line.orderedQty,
      suppliedQty: 0,
      cancelledQty: 0,
      reservedQty: 0,
      unitPrice: line.unitPrice,
      lineStatus: "Open",
    });
  }
  pushAudit(next, {
    action: "order.created",
    entityType: "customer_purchase_order",
    entityId: order.id,
    summary: `Created customer order ${order.number}.`,
  });
  return { ok: true, data: { state: next, data: order } };
}

export function confirmCustomerOrder(
  state: TlbState,
  orderId: string,
  creditOverrideReason?: string,
): MutResult<CustomerPurchaseOrder> {
  const blocked = requirePerm(state, "orders.confirm");
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  const order = next.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "Draft" && order.status !== "Pending") {
    return { ok: false, error: `Cannot confirm order in status ${order.status}.` };
  }

  const credit = creditPosition(next, order.customerId);
  // Draft value is excluded from creditPosition until status leaves Draft.
  const thisOrderValue =
    order.status === "Draft"
      ? next.orderLines
          .filter((l) => l.orderId === order.id)
          .reduce((sum, l) => sum + Math.max(0, l.orderedQty - l.cancelledQty) * l.unitPrice, 0)
      : 0;
  const projectedUsed = credit.used + thisOrderValue;
  const overLimit = credit.limit > 0 && projectedUsed > credit.limit;
  if (overLimit) {
    if (!creditOverrideReason?.trim()) {
      return {
        ok: false,
        error: `Customer over credit limit (used ${projectedUsed} / limit ${credit.limit}). Provide an override reason to confirm.`,
      };
    }
    if (!hasPermission(next, "approvals.manage")) {
      return { ok: false, error: "Credit override requires manager approval permission." };
    }
    order.creditOverrideBy = next.currentUser;
    order.creditOverrideAt = new Date().toISOString();
    order.creditOverrideReason = creditOverrideReason.trim();
    pushAudit(next, {
      action: "credit.override",
      entityType: "customer_purchase_order",
      entityId: order.id,
      summary: `Credit override on ${order.number}: ${creditOverrideReason.trim()}`,
      meta: { used: projectedUsed, limit: credit.limit },
    });
  }

  order.status = "Confirmed";
  order.confirmedAt = new Date().toISOString();
  order.updatedAt = order.confirmedAt;
  pushAudit(next, {
    action: "order.confirmed",
    entityType: "customer_purchase_order",
    entityId: order.id,
    summary: `Confirmed ${order.number}.`,
  });
  recomputeOrder(next, order.id);
  refreshNotifications(next);
  return { ok: true, data: { state: next, data: order } };
}

export function cancelOrderLine(
  state: TlbState,
  orderLineId: string,
  reason: string,
): MutResult<CustomerOrderLine> {
  const blocked = requirePerm(state, "orders.cancel_line");
  if (blocked) return { ok: false, error: blocked };
  if (!reason.trim()) return { ok: false, error: "Cancellation reason is required." };
  const next = cloneState(state);
  const line = next.orderLines.find((l) => l.id === orderLineId);
  if (!line) return { ok: false, error: "Order line not found." };
  const outstanding = calcOutstanding(line);
  if (outstanding <= 0) return { ok: false, error: "Nothing outstanding to cancel on this line." };

  const release = Math.min(line.reservedQty, outstanding);
  if (release > 0) {
    line.reservedQty -= release;
    const bal = next.stock.find(
      (s) => s.productId === line.productId && s.warehouseId === line.warehouseId,
    );
    if (bal) bal.reservedQty = Math.max(0, bal.reservedQty - release);
    for (const res of next.reservations.filter((r) => r.orderLineId === line.id && !r.releasedAt)) {
      res.releasedAt = new Date().toISOString();
      res.releaseReason = "Line outstanding cancelled";
    }
  }

  line.cancelledQty += outstanding;
  line.cancelReason = reason.trim();
  line.cancelledAt = new Date().toISOString();
  line.cancelledBy = next.currentUser;

  pushAudit(next, {
    action: "line.cancelled",
    entityType: "customer_order_line",
    entityId: line.id,
    summary: `Cancelled outstanding ${outstanding} on line ${line.id}: ${reason.trim()}`,
    meta: { quantity: outstanding, reason: reason.trim() },
  });

  recomputeOrder(next, line.orderId);
  refreshNotifications(next);
  return { ok: true, data: { state: next, data: line } };
}

export function reserveForOutstanding(
  state: TlbState,
  productId: string,
  warehouseId: string,
  maxQty?: number,
  expiresAt?: string,
): MutResult<{ reserved: number }> {
  const blocked = requirePerm(state, "stock.reserve");
  if (blocked) return { ok: false, error: blocked };

  const next = cloneState(state);
  const bal = next.stock.find((s) => s.productId === productId && s.warehouseId === warehouseId);
  if (!bal) return { ok: false, error: "Stock balance not found." };

  let remaining = maxQty ?? calcAvailable(bal);
  if (remaining <= 0) return { ok: true, data: { state: next, data: { reserved: 0 } } };

  const candidates = getOutstandingRows(next)
    .filter((r) => r.productId === productId && r.warehouseId === warehouseId)
    .sort((a, b) => b.ageDays - a.ageDays);

  let reservedTotal = 0;
  const now = new Date().toISOString();
  for (const row of candidates) {
    if (remaining <= 0) break;
    const line = next.orderLines.find((l) => l.id === row.lineId);
    if (!line) continue;
    // No double-reserve beyond outstanding need
    const need = Math.max(0, calcOutstanding(line) - line.reservedQty);
    if (need <= 0) continue;
    const take = Math.min(need, remaining, calcAvailable(bal));
    if (take <= 0) break;
    line.reservedQty += take;
    bal.reservedQty += take;
    remaining -= take;
    reservedTotal += take;
    next.reservations.unshift({
      id: uid("rsv"),
      orderLineId: line.id,
      productId,
      warehouseId,
      quantity: take,
      reservedAt: now,
      reservedBy: next.currentUser,
      expiresAt,
    });
  }

  if (reservedTotal > 0) {
    pushAudit(next, {
      action: "stock.reserved",
      entityType: "stock_balance",
      entityId: bal.id,
      summary: `Reserved ${reservedTotal} for outstanding customer orders.`,
      meta: { reserved: reservedTotal, productId, warehouseId },
    });
    recomputeAllOpenOrders(next);
    refreshNotifications(next);
  }

  return { ok: true, data: { state: next, data: { reserved: reservedTotal } } };
}

export function releaseReservation(
  state: TlbState,
  reservationId: string,
  reason = "Released",
): MutResult<{ released: number }> {
  const blocked = requirePerm(state, "stock.reserve");
  if (blocked) return { ok: false, error: blocked };

  const next = cloneState(state);
  const res = next.reservations.find((r) => r.id === reservationId);
  if (!res) return { ok: false, error: "Reservation not found." };
  if (res.releasedAt) return { ok: false, error: "Reservation already released." };

  const line = next.orderLines.find((l) => l.id === res.orderLineId);
  const bal = next.stock.find(
    (s) => s.productId === res.productId && s.warehouseId === res.warehouseId,
  );
  const qty = res.quantity;
  if (line) line.reservedQty = Math.max(0, line.reservedQty - qty);
  if (bal) bal.reservedQty = Math.max(0, bal.reservedQty - qty);
  res.releasedAt = new Date().toISOString();
  res.releaseReason = reason;

  pushAudit(next, {
    action: "stock.released",
    entityType: "stock_reservation",
    entityId: res.id,
    summary: `Released reservation of ${qty}: ${reason}`,
    meta: { quantity: qty },
  });
  if (line) recomputeOrder(next, line.orderId);
  refreshNotifications(next);
  return { ok: true, data: { state: next, data: { released: qty } } };
}

export function receiveStock(
  state: TlbState,
  productId: string,
  warehouseId: string,
  quantity: number,
  autoReserve = true,
): MutResult<StockBalance> {
  const blocked = requirePerm(state, "stock.receive");
  if (blocked) return { ok: false, error: blocked };
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: "Receipt quantity must be a positive whole number." };
  }
  let next = cloneState(state);
  const bal = getOrCreateBalance(next, productId, warehouseId);
  try {
    postStockMovement(next, {
      type: "grn",
      productId,
      warehouseId,
      quantity,
      reason: "Quick receive",
      refType: "stock_balance",
      refId: bal.id,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Receive failed." };
  }
  pushAudit(next, {
    action: "stock.received",
    entityType: "stock_balance",
    entityId: bal.id,
    summary: `Received ${quantity} into stock.`,
    meta: { quantity, productId, warehouseId },
  });

  if (autoReserve) {
    const reserved = reserveForOutstanding(next, productId, warehouseId);
    if (reserved.ok) next = reserved.data.state;
  } else {
    recomputeAllOpenOrders(next);
  }
  refreshNotifications(next);

  const updated = next.stock.find(
    (s) => s.productId === productId && s.warehouseId === warehouseId,
  )!;
  return { ok: true, data: { state: next, data: updated } };
}

export function createSupply(
  state: TlbState,
  orderId: string,
  lines: SupplyRequestLine[],
  notes?: string,
): MutResult<{ supplyId: string; number: string }> {
  const blocked = requirePerm(state, "supply.create");
  if (blocked) return { ok: false, error: blocked };
  if (!lines.length) return { ok: false, error: "Select at least one line to supply." };

  const next = cloneState(state);
  const order = next.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (
    order.status === "Draft" ||
    order.status === "Pending" ||
    order.status === "Cancelled" ||
    order.status === "Delivered"
  ) {
    return { ok: false, error: `Cannot supply order in status ${order.status}.` };
  }

  const mutations: Array<{ line: CustomerOrderLine; qty: number; bal: StockBalance }> = [];

  for (const req of lines) {
    if (!Number.isInteger(req.quantity) || req.quantity <= 0) {
      return { ok: false, error: "Supply quantities must be positive whole numbers." };
    }
    const line = next.orderLines.find((l) => l.id === req.orderLineId && l.orderId === orderId);
    if (!line) return { ok: false, error: "Order line not found on this order." };
    const outstanding = calcOutstanding(line);
    const bal = next.stock.find(
      (s) => s.productId === line.productId && s.warehouseId === line.warehouseId,
    );
    if (!bal) return { ok: false, error: "Stock balance missing for a supply line." };
    const available = calcAvailable(bal);
    const usable = available + Math.min(line.reservedQty, outstanding);
    const err = validateSupplyQty({ supplyNow: req.quantity, outstanding, available: usable });
    if (err) return { ok: false, error: err };
    mutations.push({ line, qty: req.quantity, bal });
  }

  const numbered = nextDocumentNumber("supply", next.counters);
  next.counters = numbered.counters;
  const now = new Date().toISOString();
  const supplyId = uid("sup");
  next.supplies.unshift({
    id: supplyId,
    number: numbered.number,
    orderId,
    suppliedAt: now,
    suppliedBy: next.currentUser,
    notes,
  });

  for (const m of mutations) {
    const fromReserved = Math.min(m.line.reservedQty, m.qty);
    m.line.reservedQty -= fromReserved;
    m.bal.reservedQty = Math.max(0, m.bal.reservedQty - fromReserved);
    // Physical + ledger + batch via supply movement (do not double-decrement physical)
    let batchMeta: { batchId?: string; batchCode?: string } = {};
    try {
      batchMeta = applySupplyBatchPicks(
        next,
        supplyId,
        numbered.number,
        m.line.productId,
        m.line.warehouseId,
        m.qty,
        undefined,
        now,
      );
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Supply stock movement failed." };
    }
    m.line.suppliedQty += m.qty;

    // Consume active reservations for this line
    let left = fromReserved;
    for (const res of next.reservations.filter(
      (r) => r.orderLineId === m.line.id && !r.releasedAt,
    )) {
      if (left <= 0) break;
      const take = Math.min(res.quantity, left);
      if (take >= res.quantity) {
        res.releasedAt = now;
        res.releaseReason = `Consumed by supply ${numbered.number}`;
        left -= take;
      } else {
        res.quantity -= take;
        left -= take;
      }
    }

    next.supplyLines.push({
      id: uid("sl"),
      supplyId,
      orderLineId: m.line.id,
      productId: m.line.productId,
      warehouseId: m.line.warehouseId,
      quantity: m.qty,
      batchId: batchMeta.batchId,
      batchCode: batchMeta.batchCode,
    });
  }

  pushAudit(next, {
    action: "supply.created",
    entityType: "supply",
    entityId: supplyId,
    summary: `Created supply ${numbered.number} for ${order.number}.`,
    meta: { orderId, lines: mutations.length },
  });

  recomputeOrder(next, orderId);
  refreshNotifications(next);
  return { ok: true, data: { state: next, data: { supplyId, number: numbered.number } } };
}

export function markDelivered(state: TlbState, orderId: string): MutResult<CustomerPurchaseOrder> {
  const blocked = requirePerm(state, "delivery.manage");
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  const order = next.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "Fully Supplied") {
    return {
      ok: false,
      error:
        "Only fully supplied orders can be marked delivered (outstanding must be cleared or cancelled formally).",
    };
  }
  const anyOutstanding = next.orderLines
    .filter((l) => l.orderId === orderId)
    .some((l) => calcOutstanding(l) > 0);
  if (anyOutstanding) {
    return { ok: false, error: "Cannot mark delivered while outstanding quantities remain." };
  }
  order.status = "Delivered";
  order.updatedAt = new Date().toISOString();
  pushAudit(next, {
    action: "order.status_changed",
    entityType: "customer_purchase_order",
    entityId: order.id,
    summary: `Marked ${order.number} as Delivered.`,
  });
  refreshNotifications(next);
  return { ok: true, data: { state: next, data: order } };
}

export function updateAgeingSettings(
  state: TlbState,
  normalMaxDays: number,
  attentionMaxDays: number,
  extendedUnfulfilledDays?: number,
  expectedApproachingDays?: number,
): MutResult<TlbState["ageing"]> {
  const blocked = requirePerm(state, "settings.manage");
  if (blocked) return { ok: false, error: blocked };
  if (!Number.isInteger(normalMaxDays) || normalMaxDays < 0) {
    return { ok: false, error: "Normal max days must be a non-negative integer." };
  }
  if (!Number.isInteger(attentionMaxDays) || attentionMaxDays < normalMaxDays) {
    return { ok: false, error: "Attention max days must be >= normal max days." };
  }
  const next = cloneState(state);
  next.ageing = {
    normalMaxDays,
    attentionMaxDays,
    extendedUnfulfilledDays: extendedUnfulfilledDays ?? next.ageing.extendedUnfulfilledDays,
    expectedApproachingDays: expectedApproachingDays ?? next.ageing.expectedApproachingDays,
  };
  pushAudit(next, {
    action: "settings.updated",
    entityType: "app_settings",
    entityId: "ageing",
    summary: `Updated ageing thresholds (${normalMaxDays}/${attentionMaxDays}).`,
  });
  refreshNotifications(next);
  return { ok: true, data: { state: next, data: next.ageing } };
}

export function updateCompanyProfile(
  state: TlbState,
  company: CompanyProfile,
): MutResult<CompanyProfile> {
  const blocked = requirePerm(state, "settings.manage");
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  next.company = { ...company };
  pushAudit(next, {
    action: "settings.updated",
    entityType: "app_settings",
    entityId: "company",
    summary: "Updated company profile for invoices.",
  });
  return { ok: true, data: { state: next, data: next.company } };
}

export function upsertVatRate(
  state: TlbState,
  input: Omit<VatRate, "id"> & { id?: string },
): MutResult<VatRate> {
  const blocked = requirePerm(state, "settings.manage");
  if (blocked) return { ok: false, error: blocked };
  if (!input.label.trim()) return { ok: false, error: "Tax label is required." };
  if (!Number.isFinite(input.ratePercent) || input.ratePercent < 0) {
    return {
      ok: false,
      error: "Tax rate percent must be a non-negative number (configure in settings).",
    };
  }
  const mode: TaxMode =
    input.mode === "active" || input.mode === "exempt" || input.mode === "off"
      ? input.mode
      : input.active
        ? "active"
        : "off";
  const kind: TaxKind = input.kind === "levy" ? "levy" : "vat";
  const next = cloneState(state);
  if (input.id) {
    const idx = next.vatRates.findIndex((v) => v.id === input.id);
    const updated: VatRate = {
      id: input.id,
      code: input.code,
      label: input.label,
      ratePercent: input.ratePercent,
      mode,
      kind,
      active: mode === "active",
      sortOrder:
        input.sortOrder ??
        (idx >= 0 ? next.vatRates[idx]?.sortOrder : undefined) ??
        (kind === "vat" ? 0 : 40),
    };
    if (idx >= 0) {
      next.vatRates[idx] = updated;
    } else {
      next.vatRates.push(updated);
    }
    pushAudit(next, {
      action: "settings.updated",
      entityType: "vat_rate",
      entityId: updated.id,
      summary: `Updated tax ${updated.code}: ${updated.ratePercent}% · ${mode}.`,
    });
    return { ok: true, data: { state: next, data: updated } };
  }
  const created: VatRate = {
    id: uid("tax"),
    code: input.code,
    label: input.label,
    ratePercent: input.ratePercent,
    mode,
    kind,
    active: mode === "active",
    sortOrder: input.sortOrder ?? (kind === "vat" ? 0 : 40),
  };
  next.vatRates.push(created);
  pushAudit(next, {
    action: "settings.updated",
    entityType: "vat_rate",
    entityId: created.id,
    summary: `Added tax ${created.code} at ${created.ratePercent}% · ${mode}.`,
  });
  return { ok: true, data: { state: next, data: created } };
}

/** Batch-save the Settings tax catalog in one mutation (avoids stale overwrites). */
export function saveTaxRates(
  state: TlbState,
  rates: Array<Omit<VatRate, "id"> & { id: string }>,
): MutResult<VatRate[]> {
  const blocked = requirePerm(state, "settings.manage");
  if (blocked) return { ok: false, error: blocked };
  if (!rates.length) return { ok: false, error: "At least one tax definition is required." };

  let next = cloneState(state);
  const saved: VatRate[] = [];
  for (const input of rates) {
    const result = upsertVatRate(next, input);
    if (!result.ok) return result;
    next = result.data.state;
    saved.push(result.data.data);
  }
  return { ok: true, data: { state: next, data: saved } };
}

export function switchRole(state: TlbState, _roleIdOrName: AppRole): MutResult<AppRole> {
  return { ok: false, error: "The session stays Owner." };
}

export function switchSessionUser(state: TlbState, userId: string): MutResult<AppUser> {
  const next = cloneState(state);
  const user = next.users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: "User not found." };
  if (!user.active) return { ok: false, error: "User is inactive." };
  const role = next.roles.find((r) => r.id === user.roleId);
  if (role?.systemKey !== "Owner") {
    return { ok: false, error: "The session stays Owner." };
  }
  next.currentUserId = user.id;
  syncSessionIdentity(next);
  pushAudit(next, {
    action: "session.user_switched",
    entityType: "session",
    entityId: user.id,
    summary: `Signed in as ${user.name} (${next.currentRole}).`,
  });
  return { ok: true, data: { state: next, data: user } };
}

export function createRole(
  _state: TlbState,
  _input: { name: string; description?: string; permissions?: Permission[] },
): MutResult<RoleDefinition> {
  const blocked = requirePerm(_state, "users.manage");
  if (blocked) return { ok: false, error: blocked };
  // Custom role matrices were removed — only predefined system roles are supported.
  return {
    ok: false,
    error:
      "Roles are predefined. Assign users to an existing system role instead of creating custom ones.",
  };
}

export function updateRole(
  state: TlbState,
  roleId: string,
  input: { name?: string; description?: string; permissions?: Permission[] },
): MutResult<RoleDefinition> {
  const blocked = requirePerm(state, "users.manage");
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  const role = next.roles.find((r) => r.id === roleId);
  if (!role) return { ok: false, error: "Role not found." };
  if (!role.active) return { ok: false, error: "Cannot edit an inactive role." };

  // Permissions are fixed per system role — never persist UI toggles / overrides.
  if (input.permissions !== undefined) {
    return { ok: false, error: "Role permissions are predefined and cannot be customized." };
  }

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { ok: false, error: "Role name is required." };
    if (
      next.roles.some(
        (r) => r.id !== roleId && r.active && r.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      return { ok: false, error: "An active role with this name already exists." };
    }
    role.name = name;
  }
  if (input.description !== undefined) role.description = input.description.trim();

  syncSessionIdentity(next);
  pushAudit(next, {
    action: "role.updated",
    entityType: "role",
    entityId: role.id,
    summary: `Updated role ${role.name}.`,
  });
  return { ok: true, data: { state: next, data: role } };
}

/**
 * Owner-only role delete. Assigned users move to Owner even when tasks already
 * target the role. The role is soft-deleted into Trash. The Owner role cannot
 * be deleted. Assigned tasks are left in place and do not block this.
 */
export function deleteRole(
  state: TlbState,
  roleId: string,
  reason?: string,
): MutResult<RoleDefinition> {
  const current = resolveRole(state);
  if (current?.systemKey !== "Owner") {
    return { ok: false, error: "Only the Owner can delete roles." };
  }
  const result = softDeleteRecord(state, {
    entityType: "role",
    entityId: roleId,
    ...(reason ? { reason } : {}),
  });
  if (!result.ok) return result;
  const role = result.data.state.roles.find((r) => r.id === roleId);
  if (!role) return { ok: false, error: "Role not found." };
  return { ok: true, data: { state: result.data.state, data: role } };
}

/** @deprecated Use deleteRole — kept for older call sites / tests. */
export function deactivateRole(state: TlbState, roleId: string): MutResult<RoleDefinition> {
  return deleteRole(state, roleId);
}

/** Blocks demoting or deactivating the last active Owner. */
function guardLastActiveOwner(
  state: TlbState,
  userId: string,
  next: { roleId?: string; active?: boolean },
): string | null {
  const user = state.users.find((u) => u.id === userId);
  if (!user || !user.active) return null;
  const currentRole = state.roles.find((r) => r.id === user.roleId);
  if (currentRole?.systemKey !== "Owner") return null;

  const nextRoleId = next.roleId ?? user.roleId;
  const nextActive = next.active ?? user.active;
  const nextRole = state.roles.find((r) => r.id === nextRoleId);
  const staysActiveOwner = nextActive && nextRole?.systemKey === "Owner";
  if (staysActiveOwner) return null;

  const otherActiveOwners = state.users.filter(
    (u) =>
      u.id !== userId &&
      u.active &&
      state.roles.find((r) => r.id === u.roleId)?.systemKey === "Owner",
  );
  if (otherActiveOwners.length === 0) {
    return "Cannot demote or deactivate the last active Owner.";
  }
  return null;
}

export function assignUserRole(
  state: TlbState,
  userId: string,
  roleId: string,
): MutResult<AppUser> {
  const blocked = requirePerm(state, "users.manage");
  if (blocked) return { ok: false, error: blocked };
  const lastOwner = guardLastActiveOwner(state, userId, { roleId });
  if (lastOwner) return { ok: false, error: lastOwner };
  const next = cloneState(state);
  const user = next.users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: "User not found." };
  const role = next.roles.find((r) => r.id === roleId);
  if (!isAssignableSystemRole(role)) {
    return { ok: false, error: "Select a predefined role." };
  }
  if (role.systemKey === "Owner" && !isSoleOwnerUserId(userId)) {
    return { ok: false, error: "Only one Owner account is allowed on this system." };
  }
  if (userId === state.currentUserId && role.systemKey !== "Owner") {
    return { ok: false, error: "The signed-in account stays on the Owner role." };
  }
  user.roleId = role.id;
  if (next.currentUserId === user.id) syncSessionIdentity(next);
  pushAudit(next, {
    action: "user.role_assigned",
    entityType: "user",
    entityId: user.id,
    summary: `Assigned ${user.name} to role ${role.name}.`,
  });
  return { ok: true, data: { state: next, data: user } };
}

export function upsertAppUser(
  state: TlbState,
  input: {
    id?: string;
    name: string;
    email: string;
    contact?: string;
    roleId: string;
    active?: boolean;
  },
): MutResult<AppUser> {
  const blocked = requirePerm(state, "users.manage");
  if (blocked) return { ok: false, error: blocked };
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const contact = input.contact?.trim() ?? "";
  if (!name) return { ok: false, error: "User name is required." };
  if (!email) return { ok: false, error: "User email is required." };
  const next = cloneState(state);
  const role = next.roles.find((r) => r.id === input.roleId);
  if (!isAssignableSystemRole(role)) return { ok: false, error: "Select a predefined role." };
  if (role.systemKey === "Owner" && !isSoleOwnerUserId(input.id)) {
    return { ok: false, error: "Only one Owner account is allowed on this system." };
  }
  if (input.id && input.id === state.currentUserId && role.systemKey !== "Owner") {
    return { ok: false, error: "The signed-in account stays on the Owner role." };
  }

  if (input.id) {
    const lastOwner = guardLastActiveOwner(state, input.id, {
      roleId: input.roleId,
      active: input.active,
    });
    if (lastOwner) return { ok: false, error: lastOwner };
    const user = next.users.find((u) => u.id === input.id);
    if (!user) return { ok: false, error: "User not found." };
    if (
      next.users.some(
        (u) => u.id !== user.id && u.email.trim().toLowerCase() === email,
      )
    ) {
      return {
        ok: false,
        error:
          "A user with this email already exists. Each staff member needs a unique email (one email = one login).",
      };
    }
    const prevRole = next.roles.find((r) => r.id === user.roleId);
    const prevActive = user.active;
    user.name = name;
    user.email = email;
    if (input.contact !== undefined) {
      if (contact) user.contact = contact;
      else delete user.contact;
    }
    user.roleId = role.id;
    if (input.active !== undefined) user.active = input.active;
    if (next.currentUserId === user.id) syncSessionIdentity(next);
    const changes: string[] = [];
    if (prevRole?.id !== role.id) changes.push(`role ${prevRole?.name ?? "?"} → ${role.name}`);
    if (input.active !== undefined && prevActive !== user.active) {
      changes.push(user.active ? "activated" : "deactivated");
    }
    pushAudit(next, {
      action: "user.updated",
      entityType: "user",
      entityId: user.id,
      summary:
        changes.length > 0
          ? `Updated user ${user.name} (${changes.join(", ")}).`
          : `Updated user ${user.name}.`,
      meta: {
        roleId: role.id,
        active: user.active,
        email: user.email,
      },
    });
    return { ok: true, data: { state: next, data: user } };
  }

  const ownerEmailTaken = next.users.some((u) => {
    if (u.email.trim().toLowerCase() !== email) return false;
    if (u.id === OWNER_USER_ID) return true;
    const ownerRole = next.roles.find((r) => r.id === u.roleId);
    return ownerRole?.systemKey === "Owner";
  });
  if (ownerEmailTaken && role.systemKey !== "Owner") {
    return {
      ok: false,
      error:
        "That email belongs to the Owner account. Invite this staff member with a different email — one email can only be one person.",
    };
  }
  if (next.users.some((u) => u.email.trim().toLowerCase() === email)) {
    return {
      ok: false,
      error:
        "A user with this email already exists. Each staff member needs a unique email (one email = one login).",
    };
  }
  let created: AppUser = {
    id: uid("user"),
    name,
    email,
    ...(contact ? { contact } : {}),
    roleId: role.id,
    active: input.active ?? true,
  };
  created = applyFreshInvite(created);
  next.users.push(created);
  pushAudit(next, {
    action: "user.updated",
    entityType: "user",
    entityId: created.id,
    summary: `Created user ${created.name}.`,
  });
  pushAudit(next, {
    action: "user.invite_issued",
    entityType: "user",
    entityId: created.id,
    summary: `Issued invite for ${created.name}.`,
  });
  return { ok: true, data: { state: next, data: created } };
}

export function issueUserInvite(state: TlbState, userId: string): MutResult<AppUser> {
  const blocked = requirePerm(state, "users.manage");
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  const idx = next.users.findIndex((u) => u.id === userId);
  if (idx === -1) return { ok: false, error: "User not found." };
  const existing = next.users[idx]!;
  if (!existing.active) return { ok: false, error: "User is inactive." };
  const updated = applyFreshInvite(existing);
  next.users[idx] = updated;
  pushAudit(next, {
    action: "user.invite_issued",
    entityType: "user",
    entityId: updated.id,
    summary: `Re-issued invite for ${updated.name}.`,
  });
  return { ok: true, data: { state: next, data: updated } };
}

export function previewLocalInvite(
  state: TlbState,
  input: { token?: string; code?: string },
): MutResult<{
  email: string;
  fullName: string;
  accessCode?: string;
  contact?: string;
  roleCode?: string;
}> {
  const token = input.token?.trim();
  const code = input.code?.trim();
  if (!token && !code) {
    return { ok: false, error: "Enter an access code or open your invite link." };
  }

  let user: AppUser | undefined;
  if (token) user = findUserByInviteToken(state.users, token);
  if (!user && code) user = findUserByInviteCode(state.users, code);
  if (!user) return { ok: false, error: "Invalid or expired invite." };
  if (!user.active) return { ok: false, error: "User account is inactive." };
  if (!isInvitePending(user) && !user.inviteToken && !user.inviteCode) {
    return { ok: false, error: "Invalid or expired invite." };
  }
  if (!isInvitePending(user)) {
    return { ok: false, error: "Invite already used." };
  }

  if (token && code) {
    const byCode = findUserByInviteCode(state.users, code);
    if (byCode && byCode.id !== user.id) {
      return { ok: false, error: "Invite link and access code do not match." };
    }
  }
  if (token && user.inviteToken !== token) {
    return { ok: false, error: "Invalid or expired invite." };
  }
  if (
    code &&
    user.inviteCode &&
    normalizeAccessCode(user.inviteCode) !== normalizeAccessCode(code)
  ) {
    return { ok: false, error: "Invalid or expired invite." };
  }

  const roleCode = dbRoleCodeForRoleId(user.roleId) ?? undefined;

  return {
    ok: true,
    data: {
      state,
      data: {
        email: user.email,
        fullName: user.name,
        ...(user.inviteCode ? { accessCode: user.inviteCode } : {}),
        ...(user.contact?.trim() ? { contact: user.contact.trim() } : {}),
        ...(roleCode ? { roleCode } : {}),
      },
    },
  };
}

export function acceptInvite(
  state: TlbState,
  input: { token?: string; code?: string; password?: string },
): MutResult<AppUser> {
  const token = input.token?.trim();
  const code = input.code?.trim();
  const password = input.password ?? "";
  if (!token && !code) {
    return { ok: false, error: "Enter an access code or open your invite link." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  let user: AppUser | undefined;
  if (token) user = findUserByInviteToken(state.users, token);
  if (!user && code) user = findUserByInviteCode(state.users, code);
  if (!user) return { ok: false, error: "Invalid or expired invite." };
  if (!user.active) return { ok: false, error: "User account is inactive." };

  if (token && code) {
    const byCode = findUserByInviteCode(state.users, code);
    if (byCode && byCode.id !== user.id) {
      return { ok: false, error: "Invite link and access code do not match." };
    }
  }

  const next = cloneState(state);
  const idx = next.users.findIndex((u) => u.id === user!.id);
  if (idx === -1) return { ok: false, error: "User not found." };
  let updated = next.users[idx]!;

  if (token && updated.inviteToken !== token) {
    return { ok: false, error: "Invalid or expired invite." };
  }
  if (
    code &&
    updated.inviteCode &&
    normalizeAccessCode(updated.inviteCode) !== normalizeAccessCode(code)
  ) {
    return { ok: false, error: "Invalid or expired invite." };
  }
  if (!updated.inviteToken && !updated.inviteCode) {
    return { ok: false, error: "No active invite for this user." };
  }

  if (isInvitePending(updated)) {
    updated = markInviteAccepted(updated);
    next.users[idx] = updated;
    pushAudit(next, {
      action: "user.invite_accepted",
      entityType: "user",
      entityId: updated.id,
      summary: `${updated.name} activated invite and set a password.`,
    });
  }

  // Keep the Owner-assigned predefined role (Finance, Sales, …) — never elevate to Owner.
  next.currentUserId = updated.id;
  syncSessionIdentity(next);
  pushAudit(next, {
    action: "session.user_switched",
    entityType: "session",
    entityId: updated.id,
    summary: `Signed in as ${updated.name} (${next.currentRole}) via invite.`,
  });
  return { ok: true, data: { state: next, data: updated } };
}

export type HostedInviteAcceptance = {
  profileId: string;
  email: string;
  fullName: string;
  roleCode: string;
};

/**
 * Mirror a profile that tlb.accept_invite already accepted.
 * Does not validate the raw token — the database call is the gate.
 * Binds session to the invited staff user and their predefined role (never Owner unless invited as Owner).
 */
export function applyHostedInviteAcceptance(
  state: TlbState,
  input: HostedInviteAcceptance,
): MutResult<AppUser> {
  const roleKey = systemRoleKeyForDbCode(input.roleCode);
  if (!roleKey) return { ok: false, error: "Invite role is not a system role." };

  const email = input.email.trim().toLowerCase();
  const name = input.fullName.trim();
  if (!email || !name) return { ok: false, error: "Invite profile is incomplete." };
  const profileId = input.profileId.trim();
  if (!profileId) return { ok: false, error: "Invite profile is incomplete." };

  const next = cloneState(state);
  let role = next.roles.find(
    (candidate) => candidate.systemKey === roleKey && candidate.active && !candidate.deletedAt,
  );
  if (!role) {
    const catalog = createSystemRoles().find((candidate) => candidate.systemKey === roleKey);
    if (!catalog) return { ok: false, error: `Role ${roleKey} is missing.` };
    next.roles.push(catalog);
    role = catalog;
  }

  const roleId = role.id;
  const at = new Date().toISOString();

  const isOwnerStaffRow = (candidate: AppUser): boolean => {
    if (candidate.id === OWNER_USER_ID) return true;
    const candidateRole = next.roles.find((r) => r.id === candidate.roleId);
    return candidateRole?.systemKey === "Owner";
  };

  let user = next.users.find((candidate) => candidate.id === profileId);
  if (!user) {
    const byEmail = next.users.find((candidate) => candidate.email.toLowerCase() === email);
    if (byEmail) {
      if (isOwnerStaffRow(byEmail) && roleKey !== "Owner") {
        return {
          ok: false,
          error:
            "This invite email belongs to the Owner account. Ask an Owner to invite a different email for this staff member.",
        };
      }
      // Remap local invite row onto Auth profile id so bindSession prefers UUID.
      if (byEmail.id !== profileId) {
        const previousId = byEmail.id;
        byEmail.id = profileId;
        if (next.currentUserId === previousId) next.currentUserId = profileId;
      }
      user = byEmail;
    }
  }

  if (!user) {
    user = {
      id: profileId,
      name,
      email,
      roleId,
      active: true,
      invitePending: false,
      inviteAcceptedAt: at,
    };
    next.users.push(user);
  } else if (!user.active) {
    return { ok: false, error: "User account is inactive." };
  } else if (isOwnerStaffRow(user) && roleKey !== "Owner") {
    return {
      ok: false,
      error:
        "This invite email belongs to the Owner account. Ask an Owner to invite a different email for this staff member.",
    };
  } else {
    user.name = name;
    user.email = email;
    user.roleId = roleId;
    user.invitePending = false;
    user.inviteAcceptedAt = user.inviteAcceptedAt ?? at;
    delete user.inviteToken;
    delete user.inviteCode;
  }

  next.currentUserId = user.id;
  syncSessionIdentity(next);
  pushAudit(next, {
    action: "user.invite_accepted",
    entityType: "user",
    entityId: user.id,
    summary: `${user.name} activated invite as ${next.currentRole}.`,
  });
  pushAudit(next, {
    action: "session.user_switched",
    entityType: "session",
    entityId: user.id,
    summary: `Signed in as ${user.name} (${next.currentRole}) via invite.`,
  });
  return { ok: true, data: { state: next, data: user } };
}

export function markNotificationRead(state: TlbState, id: string): MutResult<null> {
  const next = cloneState(state);
  const n = next.notifications.find((x) => x.id === id);
  if (!n) return { ok: false, error: "Notification not found." };
  n.readAt = n.readAt ?? new Date().toISOString();
  return { ok: true, data: { state: next, data: null } };
}

export function markNotificationsRead(state: TlbState, ids: string[]): MutResult<number> {
  if (ids.length === 0) return { ok: true, data: { state, data: 0 } };
  const next = cloneState(state);
  const idSet = new Set(ids);
  const now = new Date().toISOString();
  let marked = 0;
  for (const n of next.notifications) {
    if (idSet.has(n.id) && !n.readAt) {
      n.readAt = now;
      marked += 1;
    }
  }
  return { ok: true, data: { state: next, data: marked } };
}

export function markAllNotificationsRead(state: TlbState, ids?: string[]): MutResult<number> {
  const next = cloneState(state);
  const idSet = ids && ids.length > 0 ? new Set(ids) : null;
  const now = new Date().toISOString();
  let marked = 0;
  for (const n of next.notifications) {
    if (idSet && !idSet.has(n.id)) continue;
    if (!n.readAt) {
      n.readAt = now;
      marked += 1;
    }
  }
  return { ok: true, data: { state: next, data: marked } };
}

export function deleteNotification(state: TlbState, id: string): MutResult<null> {
  const next = cloneState(state);
  const before = next.notifications.length;
  next.notifications = next.notifications.filter((n) => n.id !== id);
  if (next.notifications.length === before) return { ok: false, error: "Notification not found." };
  return { ok: true, data: { state: next, data: null } };
}

export function deleteNotifications(state: TlbState, ids: string[]): MutResult<number> {
  if (ids.length === 0) return { ok: true, data: { state, data: 0 } };
  const next = cloneState(state);
  const idSet = new Set(ids);
  const before = next.notifications.length;
  next.notifications = next.notifications.filter((n) => !idSet.has(n.id));
  return { ok: true, data: { state: next, data: before - next.notifications.length } };
}

export function refreshOpsNotifications(state: TlbState): MutResult<number> {
  const next = cloneState(state);
  refreshNotifications(next);
  return { ok: true, data: { state: next, data: next.notifications.length } };
}

export function orderValue(state: TlbState, orderId: string): number {
  return state.orderLines
    .filter((l) => l.orderId === orderId)
    .reduce((sum, l) => sum + (l.orderedQty - l.cancelledQty) * l.unitPrice, 0);
}

export function orderFulfilment(state: TlbState, orderId: string): number {
  return fulfilmentPercent(state.orderLines.filter((l) => l.orderId === orderId));
}

export function formatMoney(amount: number): string {
  return `GH₵ ${amount.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function can(state: TlbState, permission: Permission): boolean {
  return hasPermission(state, permission);
}

// Re-export document mutations
export {
  createDeliveryFromSupply,
  createInvoiceFromSupply,
  createOrdinaryReceipt,
  createReceiptFromSupply,
  recordPayment,
  updateDeliveryStatus,
} from "./documents";
