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
import type {
  AppRole,
  AuditEvent,
  CompanyProfile,
  Customer,
  CustomerOrderLine,
  CustomerPurchaseOrder,
  OutstandingRow,
  Permission,
  StockBalance,
  StoreResult,
  SupplyRequestLine,
  TlbState,
  VatRate,
} from "../domain/types";
import { migrateState } from "./migrate";
import { createSeedState } from "./seed";

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
  if (!hasPermission(state.currentRole, permission)) {
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
    if (!order || order.status === "Draft" || order.status === "Cancelled") continue;
    const customer = state.customers.find((c) => c.id === order.customerId);
    const product = state.products.find((p) => p.id === line.productId);
    const warehouse = state.warehouses.find((w) => w.id === line.warehouseId);
    const bal = stockMap.get(stockKey(line.productId, line.warehouseId));
    const available = bal ? calcAvailable(bal) : 0;
    const ageDays = daysBetween(order.confirmedAt ?? order.orderDate, asOf);
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
      ageingBand: ageingBand(ageDays, state.ageing),
      unitPrice: line.unitPrice,
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
    if (!order || order.status === "Draft" || order.status === "Cancelled") continue;
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

export function confirmCustomerOrder(state: TlbState, orderId: string): MutResult<CustomerPurchaseOrder> {
  const blocked = requirePerm(state, "orders.confirm");
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  const order = next.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "Draft" && order.status !== "Pending") {
    return { ok: false, error: `Cannot confirm order in status ${order.status}.` };
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
  let bal = next.stock.find((s) => s.productId === productId && s.warehouseId === warehouseId);
  if (!bal) {
    bal = {
      id: uid("stk"),
      productId,
      warehouseId,
      physicalQty: 0,
      reservedQty: 0,
    };
    next.stock.push(bal);
  }
  bal.physicalQty += quantity;
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
    m.bal.physicalQty = Math.max(0, m.bal.physicalQty - m.qty);
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

export function switchRole(state: TlbState, role: AppRole): MutResult<AppRole> {
  const next = cloneState(state);
  next.currentRole = role;
  pushAudit(next, {
    action: "role.switched",
    entityType: "session",
    entityId: "current",
    summary: `Switched simulated role to ${role}.`,
  });
  return { ok: true, data: { state: next, data: role } };
}

export function markNotificationRead(state: TlbState, id: string): MutResult<null> {
  const next = cloneState(state);
  const n = next.notifications.find((x) => x.id === id);
  if (!n) return { ok: false, error: "Notification not found." };
  n.readAt = n.readAt ?? new Date().toISOString();
  return { ok: true, data: { state: next, data: null } };
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
  return hasPermission(state.currentRole, permission);
}

// Re-export document mutations
export {
  createDeliveryFromSupply,
  createInvoiceFromSupply,
  createOrdinaryReceipt,
  recordPayment,
  updateDeliveryStatus,
} from "./documents";
