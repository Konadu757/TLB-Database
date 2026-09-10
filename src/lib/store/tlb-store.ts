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
import { hasPermission } from "../domain/permissions";
import { buildCatalogDeletion, isSoftDeleted, listTrashItems as collectTrashItems } from "../domain/trash";
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
  Quotation,
  RoleDefinition,
  SoftDeleteFields,
  StockBalance,
  StoreResult,
  Supplier,
  SupplyRequestLine,
  TlbState,
  TrashEntityType,
  TrashListItem,
  VatRate,
} from "../domain/types";
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

export function getOutstandingRows(state: TlbState, asOf = new Date().toISOString()): OutstandingRow[] {
  const stockMap = buildStockMap(state.stock);
  const rows: OutstandingRow[] = [];

  for (const line of state.orderLines) {
    const outstanding = calcOutstanding(line);
    if (outstanding <= 0) continue;
    const order = state.orders.find((o) => o.id === line.orderId);
    if (!order || isSoftDeleted(order) || order.status === "Draft" || order.status === "Cancelled") continue;
    const customer = state.customers.find((c) => c.id === order.customerId);
    if (customer && isSoftDeleted(customer)) continue;
    const product = state.products.find((p) => p.id === line.productId);
    const warehouse = state.warehouses.find((w) => w.id === line.warehouseId);
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
      else if (daysBetween(asOf, order.requiredDate) <= (state.ageing.expectedApproachingDays ?? 2)) {
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
    if (!order || isSoftDeleted(order) || order.status === "Draft" || order.status === "Cancelled") continue;
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
  const used = new Set([
    ...next.quotations.map((q) => q.number),
  ]);
  if (used.has(numbered.number)) {
    return { ok: false, error: `Quote number ${numbered.number} already exists.` };
  }

  const now = new Date();
  const quoteDate = now.toISOString();
  const validDays = input.validDays && input.validDays > 0 ? input.validDays : 14;
  const validUntil = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000).toISOString();
  const amount = Math.round(input.qty * input.unitPrice * 100) / 100;

  const quotation: Quotation = {
    id: uid("qt"),
    number: numbered.number,
    customerName,
    itemLabel,
    qty: input.qty,
    unitPrice: input.unitPrice,
    amount,
    paymentTerms: (input.paymentTerms?.trim() || "Net 30"),
    status: input.status ?? "Draft",
    quoteDate,
    validUntil,
    preparedBy: next.currentUser,
    createdAt: quoteDate,
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.contact?.trim() ? { contact: input.contact.trim() } : {}),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
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
  if (credit.overLimit) {
    if (!creditOverrideReason?.trim()) {
      return {
        ok: false,
        error: `Customer over credit limit (used ${credit.used} / limit ${credit.limit}). Provide an override reason to confirm.`,
      };
    }
    if (!hasPermission(next, "approvals.manage") && !hasPermission(next, "orders.confirm")) {
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
      meta: { used: credit.used, limit: credit.limit },
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
    const bal = next.stock.find((s) => s.productId === line.productId && s.warehouseId === line.warehouseId);
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
  const bal = next.stock.find((s) => s.productId === res.productId && s.warehouseId === res.warehouseId);
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

  const updated = next.stock.find((s) => s.productId === productId && s.warehouseId === warehouseId)!;
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
    const bal = next.stock.find((s) => s.productId === line.productId && s.warehouseId === line.warehouseId);
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
    for (const res of next.reservations.filter((r) => r.orderLineId === m.line.id && !r.releasedAt)) {
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
    return { ok: false, error: "Only fully supplied orders can be marked delivered (outstanding must be cleared or cancelled formally)." };
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

export function updateCompanyProfile(state: TlbState, company: CompanyProfile): MutResult<CompanyProfile> {
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
  if (!input.label.trim()) return { ok: false, error: "VAT rate label is required." };
  if (!Number.isFinite(input.ratePercent) || input.ratePercent < 0) {
    return { ok: false, error: "VAT rate percent must be a non-negative number (configure in settings)." };
  }
  const next = cloneState(state);
  if (input.id) {
    const idx = next.vatRates.findIndex((v) => v.id === input.id);
    if (idx < 0) return { ok: false, error: "VAT rate not found." };
    const updated: VatRate = {
      id: input.id,
      code: input.code,
      label: input.label,
      ratePercent: input.ratePercent,
      active: input.active,
    };
    next.vatRates[idx] = updated;
    pushAudit(next, {
      action: "settings.updated",
      entityType: "vat_rate",
      entityId: updated.id,
      summary: `Updated VAT rate ${updated.code} to ${updated.ratePercent}%.`,
    });
    return { ok: true, data: { state: next, data: updated } };
  }
  const created: VatRate = {
    id: uid("vat"),
    code: input.code,
    label: input.label,
    ratePercent: input.ratePercent,
    active: input.active,
  };
  next.vatRates.push(created);
  pushAudit(next, {
    action: "settings.updated",
    entityType: "vat_rate",
    entityId: created.id,
    summary: `Added VAT rate ${created.code} at ${created.ratePercent}%.`,
  });
  return { ok: true, data: { state: next, data: created } };
}

export function switchRole(state: TlbState, roleIdOrName: AppRole): MutResult<AppRole> {
  const next = cloneState(state);
  const role =
    next.roles.find((r) => r.id === roleIdOrName) ??
    next.roles.find((r) => r.name === roleIdOrName || r.systemKey === roleIdOrName);
  if (!role) return { ok: false, error: "Role not found." };
  if (!role.active) return { ok: false, error: "Role is inactive." };

  const user = next.users.find((u) => u.id === next.currentUserId);
  if (user) user.roleId = role.id;
  next.currentRoleId = role.id;
  next.currentRole = role.name;
  syncSessionIdentity(next);
  pushAudit(next, {
    action: "role.switched",
    entityType: "session",
    entityId: "current",
    summary: `Switched session role to ${role.name}.`,
  });
  return { ok: true, data: { state: next, data: role.name } };
}

export function switchSessionUser(state: TlbState, userId: string): MutResult<AppUser> {
  const next = cloneState(state);
  const user = next.users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: "User not found." };
  if (!user.active) return { ok: false, error: "User is inactive." };
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
  state: TlbState,
  input: { name: string; description?: string; permissions?: Permission[] },
): MutResult<RoleDefinition> {
  const blocked = requirePerm(state, "users.manage");
  if (blocked) return { ok: false, error: blocked };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Role name is required." };
  if (state.roles.some((r) => r.name.toLowerCase() === name.toLowerCase() && r.active)) {
    return { ok: false, error: "An active role with this name already exists." };
  }
  const next = cloneState(state);
  const created: RoleDefinition = {
    id: uid("role"),
    name,
    description: (input.description ?? "").trim(),
    permissions: [...(input.permissions ?? ["dashboard.view"])],
    active: true,
  };
  next.roles.push(created);
  pushAudit(next, {
    action: "role.created",
    entityType: "role",
    entityId: created.id,
    summary: `Created role ${created.name}.`,
  });
  return { ok: true, data: { state: next, data: created } };
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
  if (input.permissions !== undefined) role.permissions = [...input.permissions];

  // Keep Owner/Admin system roles from losing users.manage accidentally
  if ((role.systemKey === "Owner" || role.systemKey === "Admin") && !role.permissions.includes("users.manage")) {
    role.permissions.push("users.manage");
  }

  syncSessionIdentity(next);
  pushAudit(next, {
    action: "role.updated",
    entityType: "role",
    entityId: role.id,
    summary: `Updated role ${role.name}.`,
  });
  return { ok: true, data: { state: next, data: role } };
}

export function deactivateRole(state: TlbState, roleId: string): MutResult<RoleDefinition> {
  const blocked = requirePerm(state, "users.manage");
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  const role = next.roles.find((r) => r.id === roleId);
  if (!role) return { ok: false, error: "Role not found." };
  if (role.systemKey === "Owner") return { ok: false, error: "Cannot deactivate the Owner role." };
  const assigned = next.users.filter((u) => u.roleId === roleId && u.active);
  if (assigned.length > 0) {
    return {
      ok: false,
      error: `Cannot deactivate — assigned to ${assigned.length} active user(s). Reassign them first.`,
    };
  }
  role.active = false;
  pushAudit(next, {
    action: "role.deactivated",
    entityType: "role",
    entityId: role.id,
    summary: `Deactivated role ${role.name}.`,
  });
  return { ok: true, data: { state: next, data: role } };
}

export function assignUserRole(state: TlbState, userId: string, roleId: string): MutResult<AppUser> {
  const blocked = requirePerm(state, "users.manage");
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  const user = next.users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: "User not found." };
  const role = next.roles.find((r) => r.id === roleId);
  if (!role) return { ok: false, error: "Role not found." };
  if (!role.active) return { ok: false, error: "Cannot assign an inactive role." };
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
  input: { id?: string; name: string; email: string; roleId: string; active?: boolean },
): MutResult<AppUser> {
  const blocked = requirePerm(state, "users.manage");
  if (blocked) return { ok: false, error: blocked };
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) return { ok: false, error: "User name is required." };
  if (!email) return { ok: false, error: "User email is required." };
  const next = cloneState(state);
  const role = next.roles.find((r) => r.id === input.roleId);
  if (!role || !role.active) return { ok: false, error: "Select an active role." };

  if (input.id) {
    const user = next.users.find((u) => u.id === input.id);
    if (!user) return { ok: false, error: "User not found." };
    user.name = name;
    user.email = email;
    user.roleId = role.id;
    if (input.active !== undefined) user.active = input.active;
    if (next.currentUserId === user.id) syncSessionIdentity(next);
    pushAudit(next, {
      action: "user.updated",
      entityType: "user",
      entityId: user.id,
      summary: `Updated user ${user.name}.`,
    });
    return { ok: true, data: { state: next, data: user } };
  }

  if (next.users.some((u) => u.email === email)) {
    return { ok: false, error: "A user with this email already exists." };
  }
  const created: AppUser = {
    id: uid("user"),
    name,
    email,
    roleId: role.id,
    active: input.active ?? true,
  };
  next.users.push(created);
  pushAudit(next, {
    action: "user.updated",
    entityType: "user",
    entityId: created.id,
    summary: `Created user ${created.name}.`,
  });
  return { ok: true, data: { state: next, data: created } };
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

function applySoftDeleteMeta(target: SoftDeleteFields, actor: string, reason?: string): void {
  target.deletedAt = new Date().toISOString();
  target.deletedBy = actor;
  if (reason?.trim()) target.deletedReason = reason.trim();
  else delete target.deletedReason;
}

function clearSoftDeleteMeta(target: SoftDeleteFields): void {
  delete target.deletedAt;
  delete target.deletedBy;
  delete target.deletedReason;
}

export function listTrash(state: TlbState): TrashListItem[] {
  return collectTrashItems(state);
}

export function softDeleteRecord(
  state: TlbState,
  input: { entityType: TrashEntityType; entityId: string; reason?: string },
): MutResult<TrashListItem | null> {
  const blocked = requirePerm(state, "records.delete");
  if (blocked) return { ok: false, error: blocked };

  const next = cloneState(state);
  const reason = input.reason?.trim();
  const actor = next.currentUser;
  let summary = "";
  let entityTypeLabel = input.entityType;

  if (input.entityType === "customer") {
    const row = next.customers.find((c) => c.id === input.entityId);
    if (!row) return { ok: false, error: "Customer not found." };
    if (isSoftDeleted(row)) return { ok: false, error: "Customer is already in trash." };
    applySoftDeleteMeta(row, actor, reason);
    row.updatedAt = row.deletedAt!;
    summary = `Moved customer ${row.code} · ${row.name} to trash.`;
    entityTypeLabel = "customer";
  } else if (input.entityType === "supplier") {
    const row = next.suppliers.find((s) => s.id === input.entityId);
    if (!row) return { ok: false, error: "Supplier not found." };
    if (isSoftDeleted(row)) return { ok: false, error: "Supplier is already in trash." };
    applySoftDeleteMeta(row, actor, reason);
    row.updatedAt = row.deletedAt!;
    summary = `Moved supplier ${row.code} · ${row.name} to trash.`;
  } else if (input.entityType === "product") {
    const row = next.products.find((p) => p.id === input.entityId);
    if (!row) return { ok: false, error: "Product not found." };
    if (isSoftDeleted(row)) return { ok: false, error: "Product is already in trash." };
    applySoftDeleteMeta(row, actor, reason);
    summary = `Moved product ${row.sku} · ${row.name} to trash.`;
  } else if (input.entityType === "warehouse") {
    const row = next.warehouses.find((w) => w.id === input.entityId);
    if (!row) return { ok: false, error: "Warehouse not found." };
    if (isSoftDeleted(row)) return { ok: false, error: "Warehouse is already in trash." };
    applySoftDeleteMeta(row, actor, reason);
    summary = `Moved warehouse ${row.code} · ${row.name} to trash.`;
  } else if (input.entityType === "order") {
    const row = next.orders.find((o) => o.id === input.entityId);
    if (!row) return { ok: false, error: "Order not found." };
    if (isSoftDeleted(row)) return { ok: false, error: "Order is already in trash." };
    applySoftDeleteMeta(row, actor, reason);
    row.updatedAt = row.deletedAt!;
    summary = `Moved order ${row.number} to trash.`;
  } else if (input.entityType === "catalog") {
    if (next.catalogPurgedIds.includes(input.entityId)) {
      return { ok: false, error: "Record was permanently deleted." };
    }
    if (next.catalogDeletions.some((d) => d.catalogId === input.entityId)) {
      return { ok: false, error: "Record is already in trash." };
    }
    const deletion = buildCatalogDeletion(input.entityId, actor, reason, next.quotations);
    if (!deletion) return { ok: false, error: "Catalog record not found." };
    next.catalogDeletions.unshift(deletion);
    summary = `Moved ${deletion.module} ${deletion.label} to trash.`;
    entityTypeLabel = "catalog";
  } else if (input.entityType === "customer_return") {
    const row = (next.customerReturns ?? []).find((r) => r.id === input.entityId);
    if (!row) return { ok: false, error: "Customer return not found." };
    if (isSoftDeleted(row)) return { ok: false, error: "Already in trash." };
    applySoftDeleteMeta(row, actor, reason);
    summary = `Moved customer return ${row.number} to trash.`;
  } else if (input.entityType === "supplier_return") {
    const row = (next.supplierReturns ?? []).find((r) => r.id === input.entityId);
    if (!row) return { ok: false, error: "Supplier return not found." };
    if (isSoftDeleted(row)) return { ok: false, error: "Already in trash." };
    applySoftDeleteMeta(row, actor, reason);
    summary = `Moved supplier return ${row.number} to trash.`;
  } else if (input.entityType === "non_po_purchase") {
    const row = (next.nonPoPurchases ?? []).find((r) => r.id === input.entityId);
    if (!row) return { ok: false, error: "Non-PO not found." };
    if (isSoftDeleted(row)) return { ok: false, error: "Already in trash." };
    applySoftDeleteMeta(row, actor, reason);
    summary = `Moved Non-PO ${row.number} to trash.`;
  } else if (input.entityType === "import_shipment") {
    const row = (next.importShipments ?? []).find((r) => r.id === input.entityId);
    if (!row) return { ok: false, error: "Import not found." };
    if (isSoftDeleted(row)) return { ok: false, error: "Already in trash." };
    applySoftDeleteMeta(row, actor, reason);
    summary = `Moved import ${row.number} to trash.`;
  } else if (input.entityType === "export_shipment") {
    const row = (next.exportShipments ?? []).find((r) => r.id === input.entityId);
    if (!row) return { ok: false, error: "Export not found." };
    if (isSoftDeleted(row)) return { ok: false, error: "Already in trash." };
    applySoftDeleteMeta(row, actor, reason);
    summary = `Moved export ${row.number} to trash.`;
  } else {
    return { ok: false, error: "Unsupported record type." };
  }

  pushAudit(next, {
    action: "record.trashed",
    entityType: entityTypeLabel,
    entityId: input.entityId,
    summary,
    meta: {
      entityType: input.entityType,
      ...(reason ? { reason } : {}),
    },
  });
  refreshNotifications(next);
  const trashRow = collectTrashItems(next).find(
    (t) => t.entityType === input.entityType && t.entityId === input.entityId,
  );
  return { ok: true, data: { state: next, data: trashRow ?? null } };
}

export function restoreTrashItem(
  state: TlbState,
  input: { entityType: TrashEntityType; entityId: string },
): MutResult<null> {
  const blocked = requirePerm(state, "records.delete");
  if (blocked) return { ok: false, error: blocked };

  const next = cloneState(state);
  let summary = "";

  if (input.entityType === "customer") {
    const row = next.customers.find((c) => c.id === input.entityId);
    if (!row || !isSoftDeleted(row)) return { ok: false, error: "Trashed customer not found." };
    clearSoftDeleteMeta(row);
    row.updatedAt = new Date().toISOString();
    summary = `Restored customer ${row.code} · ${row.name} from trash.`;
  } else if (input.entityType === "supplier") {
    const row = next.suppliers.find((s) => s.id === input.entityId);
    if (!row || !isSoftDeleted(row)) return { ok: false, error: "Trashed supplier not found." };
    clearSoftDeleteMeta(row);
    row.updatedAt = new Date().toISOString();
    summary = `Restored supplier ${row.code} · ${row.name} from trash.`;
  } else if (input.entityType === "product") {
    const row = next.products.find((p) => p.id === input.entityId);
    if (!row || !isSoftDeleted(row)) return { ok: false, error: "Trashed product not found." };
    clearSoftDeleteMeta(row);
    summary = `Restored product ${row.sku} · ${row.name} from trash.`;
  } else if (input.entityType === "warehouse") {
    const row = next.warehouses.find((w) => w.id === input.entityId);
    if (!row || !isSoftDeleted(row)) return { ok: false, error: "Trashed warehouse not found." };
    clearSoftDeleteMeta(row);
    summary = `Restored warehouse ${row.code} · ${row.name} from trash.`;
  } else if (input.entityType === "order") {
    const row = next.orders.find((o) => o.id === input.entityId);
    if (!row || !isSoftDeleted(row)) return { ok: false, error: "Trashed order not found." };
    clearSoftDeleteMeta(row);
    row.updatedAt = new Date().toISOString();
    summary = `Restored order ${row.number} from trash.`;
  } else if (input.entityType === "catalog") {
    const idx = next.catalogDeletions.findIndex((d) => d.catalogId === input.entityId);
    if (idx < 0) return { ok: false, error: "Trashed catalog record not found." };
    const [removed] = next.catalogDeletions.splice(idx, 1);
    summary = `Restored ${removed?.module ?? "catalog"} ${removed?.label ?? input.entityId} from trash.`;
  } else if (input.entityType === "customer_return") {
    const row = (next.customerReturns ?? []).find((r) => r.id === input.entityId);
    if (!row || !isSoftDeleted(row)) return { ok: false, error: "Trashed customer return not found." };
    clearSoftDeleteMeta(row);
    summary = `Restored customer return ${row.number} from trash.`;
  } else if (input.entityType === "supplier_return") {
    const row = (next.supplierReturns ?? []).find((r) => r.id === input.entityId);
    if (!row || !isSoftDeleted(row)) return { ok: false, error: "Trashed supplier return not found." };
    clearSoftDeleteMeta(row);
    summary = `Restored supplier return ${row.number} from trash.`;
  } else if (input.entityType === "non_po_purchase") {
    const row = (next.nonPoPurchases ?? []).find((r) => r.id === input.entityId);
    if (!row || !isSoftDeleted(row)) return { ok: false, error: "Trashed Non-PO not found." };
    clearSoftDeleteMeta(row);
    summary = `Restored Non-PO ${row.number} from trash.`;
  } else if (input.entityType === "import_shipment") {
    const row = (next.importShipments ?? []).find((r) => r.id === input.entityId);
    if (!row || !isSoftDeleted(row)) return { ok: false, error: "Trashed import not found." };
    clearSoftDeleteMeta(row);
    summary = `Restored import ${row.number} from trash.`;
  } else if (input.entityType === "export_shipment") {
    const row = (next.exportShipments ?? []).find((r) => r.id === input.entityId);
    if (!row || !isSoftDeleted(row)) return { ok: false, error: "Trashed export not found." };
    clearSoftDeleteMeta(row);
    summary = `Restored export ${row.number} from trash.`;
  } else {
    return { ok: false, error: "Unsupported record type." };
  }

  pushAudit(next, {
    action: "record.restored",
    entityType: input.entityType,
    entityId: input.entityId,
    summary,
  });
  refreshNotifications(next);
  return { ok: true, data: { state: next, data: null } };
}

export function purgeTrashItem(
  state: TlbState,
  input: { entityType: TrashEntityType; entityId: string },
): MutResult<null> {
  const blocked = requirePerm(state, "trash.purge");
  if (blocked) return { ok: false, error: blocked };

  const next = cloneState(state);
  let summary = "";

  if (input.entityType === "customer") {
    const idx = next.customers.findIndex((c) => c.id === input.entityId && isSoftDeleted(c));
    if (idx < 0) return { ok: false, error: "Trashed customer not found." };
    const [removed] = next.customers.splice(idx, 1);
    summary = `Permanently deleted customer ${removed?.code ?? input.entityId}.`;
  } else if (input.entityType === "supplier") {
    const idx = next.suppliers.findIndex((s) => s.id === input.entityId && isSoftDeleted(s));
    if (idx < 0) return { ok: false, error: "Trashed supplier not found." };
    const [removed] = next.suppliers.splice(idx, 1);
    summary = `Permanently deleted supplier ${removed?.code ?? input.entityId}.`;
  } else if (input.entityType === "product") {
    const idx = next.products.findIndex((p) => p.id === input.entityId && isSoftDeleted(p));
    if (idx < 0) return { ok: false, error: "Trashed product not found." };
    const [removed] = next.products.splice(idx, 1);
    next.stock = next.stock.filter((s) => s.productId !== input.entityId);
    summary = `Permanently deleted product ${removed?.sku ?? input.entityId}.`;
  } else if (input.entityType === "warehouse") {
    const idx = next.warehouses.findIndex((w) => w.id === input.entityId && isSoftDeleted(w));
    if (idx < 0) return { ok: false, error: "Trashed warehouse not found." };
    const [removed] = next.warehouses.splice(idx, 1);
    next.stock = next.stock.filter((s) => s.warehouseId !== input.entityId);
    summary = `Permanently deleted warehouse ${removed?.code ?? input.entityId}.`;
  } else if (input.entityType === "order") {
    const idx = next.orders.findIndex((o) => o.id === input.entityId && isSoftDeleted(o));
    if (idx < 0) return { ok: false, error: "Trashed order not found." };
    const [removed] = next.orders.splice(idx, 1);
    next.orderLines = next.orderLines.filter((l) => l.orderId !== input.entityId);
    next.reservations = next.reservations.filter((r) => {
      const line = state.orderLines.find((l) => l.id === r.orderLineId);
      return line?.orderId !== input.entityId;
    });
    summary = `Permanently deleted order ${removed?.number ?? input.entityId}.`;
  } else if (input.entityType === "catalog") {
    const idx = next.catalogDeletions.findIndex((d) => d.catalogId === input.entityId);
    if (idx < 0) return { ok: false, error: "Trashed catalog record not found." };
    const [removed] = next.catalogDeletions.splice(idx, 1);
    if (!next.catalogPurgedIds.includes(input.entityId)) {
      next.catalogPurgedIds.push(input.entityId);
    }
    summary = `Permanently deleted ${removed?.module ?? "catalog"} ${removed?.label ?? input.entityId}.`;
  } else if (input.entityType === "customer_return") {
    next.customerReturns = (next.customerReturns ?? []).filter((r) => !(r.id === input.entityId && isSoftDeleted(r)));
    summary = `Permanently deleted customer return ${input.entityId}.`;
  } else if (input.entityType === "supplier_return") {
    next.supplierReturns = (next.supplierReturns ?? []).filter((r) => !(r.id === input.entityId && isSoftDeleted(r)));
    summary = `Permanently deleted supplier return ${input.entityId}.`;
  } else if (input.entityType === "non_po_purchase") {
    next.nonPoPurchases = (next.nonPoPurchases ?? []).filter((r) => !(r.id === input.entityId && isSoftDeleted(r)));
    next.nonPoPurchaseLines = (next.nonPoPurchaseLines ?? []).filter((l) => l.nonPoId !== input.entityId);
    summary = `Permanently deleted Non-PO ${input.entityId}.`;
  } else if (input.entityType === "import_shipment") {
    next.importShipments = (next.importShipments ?? []).filter((r) => !(r.id === input.entityId && isSoftDeleted(r)));
    next.importShipmentLines = (next.importShipmentLines ?? []).filter((l) => l.shipmentId !== input.entityId);
    summary = `Permanently deleted import ${input.entityId}.`;
  } else if (input.entityType === "export_shipment") {
    next.exportShipments = (next.exportShipments ?? []).filter((r) => !(r.id === input.entityId && isSoftDeleted(r)));
    next.exportShipmentLines = (next.exportShipmentLines ?? []).filter((l) => l.shipmentId !== input.entityId);
    summary = `Permanently deleted export ${input.entityId}.`;
  } else {
    return { ok: false, error: "Unsupported record type." };
  }

  pushAudit(next, {
    action: "record.purged",
    entityType: input.entityType,
    entityId: input.entityId,
    summary,
  });
  refreshNotifications(next);
  return { ok: true, data: { state: next, data: null } };
}

// Re-export document mutations
export {
  createDeliveryFromSupply,
  createInvoiceFromSupply,
  createOrdinaryReceipt,
  recordPayment,
  updateDeliveryStatus,
} from "./documents";
