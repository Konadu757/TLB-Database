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
import { nextDocumentNumber } from "../domain/numbering";
import type {
  AuditEvent,
  Customer,
  CustomerOrderLine,
  CustomerPurchaseOrder,
  OutstandingRow,
  StockBalance,
  StoreResult,
  SupplyRequestLine,
  TlbState,
} from "../domain/types";
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
  if (state.audit.length > 500) state.audit.length = 500;
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
    const parsed = JSON.parse(raw) as TlbState;
    if (!parsed || parsed.version !== 1) return createSeedState();
    // Refresh derived statuses on load
    recomputeAllOpenOrders(parsed);
    return parsed;
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
  const next = cloneState(state);
  const now = new Date().toISOString();

  if (!input.name.trim()) return { ok: false, error: "Customer name is required." };

  if (input.id) {
    const idx = next.customers.findIndex((c) => c.id === input.id);
    if (idx < 0) return { ok: false, error: "Customer not found." };
    const existing = next.customers[idx]!;
    const updated: Customer = {
      ...existing,
      name: input.name,
      category: input.category,
      contactName: input.contactName,
      phone: input.phone,
      email: input.email,
      address: input.address,
      tin: input.tin,
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
    tin: input.tin,
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
    lines: Array<{ productId: string; warehouseId: string; orderedQty: number; unitPrice: number }>;
  },
): MutResult<CustomerPurchaseOrder> {
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
  return { ok: true, data: { state: next, data: order } };
}

export function cancelOrderLine(
  state: TlbState,
  orderLineId: string,
  reason: string,
): MutResult<CustomerOrderLine> {
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
  return { ok: true, data: { state: next, data: line } };
}

export function reserveForOutstanding(
  state: TlbState,
  productId: string,
  warehouseId: string,
  maxQty?: number,
): MutResult<{ reserved: number }> {
  const next = cloneState(state);
  const bal = next.stock.find((s) => s.productId === productId && s.warehouseId === warehouseId);
  if (!bal) return { ok: false, error: "Stock balance not found." };

  let remaining = maxQty ?? calcAvailable(bal);
  if (remaining <= 0) return { ok: true, data: { state: next, data: { reserved: 0 } } };

  const candidates = getOutstandingRows(next)
    .filter((r) => r.productId === productId && r.warehouseId === warehouseId)
    .sort((a, b) => b.ageDays - a.ageDays);

  let reservedTotal = 0;
  for (const row of candidates) {
    if (remaining <= 0) break;
    const line = next.orderLines.find((l) => l.id === row.lineId);
    if (!line) continue;
    const need = Math.max(0, calcOutstanding(line) - line.reservedQty);
    if (need <= 0) continue;
    const take = Math.min(need, remaining, calcAvailable(bal));
    if (take <= 0) break;
    line.reservedQty += take;
    bal.reservedQty += take;
    remaining -= take;
    reservedTotal += take;
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
  }

  return { ok: true, data: { state: next, data: { reserved: reservedTotal } } };
}

export function receiveStock(
  state: TlbState,
  productId: string,
  warehouseId: string,
  quantity: number,
  autoReserve = true,
): MutResult<StockBalance> {
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

  const updated = next.stock.find((s) => s.productId === productId && s.warehouseId === warehouseId)!;
  return { ok: true, data: { state: next, data: updated } };
}

export function createSupply(
  state: TlbState,
  orderId: string,
  lines: SupplyRequestLine[],
  notes?: string,
): MutResult<{ supplyId: string; number: string }> {
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
  return { ok: true, data: { state: next, data: { supplyId, number: numbered.number } } };
}

export function markDelivered(state: TlbState, orderId: string): MutResult<CustomerPurchaseOrder> {
  const next = cloneState(state);
  const order = next.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "Fully Supplied") {
    return { ok: false, error: "Only fully supplied orders can be marked delivered." };
  }
  order.status = "Delivered";
  order.updatedAt = new Date().toISOString();
  pushAudit(next, {
    action: "order.status_changed",
    entityType: "customer_purchase_order",
    entityId: order.id,
    summary: `Marked ${order.number} as Delivered.`,
  });
  return { ok: true, data: { state: next, data: order } };
}

export function updateAgeingSettings(
  state: TlbState,
  normalMaxDays: number,
  attentionMaxDays: number,
): MutResult<TlbState["ageing"]> {
  if (!Number.isInteger(normalMaxDays) || normalMaxDays < 0) {
    return { ok: false, error: "Normal max days must be a non-negative integer." };
  }
  if (!Number.isInteger(attentionMaxDays) || attentionMaxDays < normalMaxDays) {
    return { ok: false, error: "Attention max days must be >= normal max days." };
  }
  const next = cloneState(state);
  next.ageing = { normalMaxDays, attentionMaxDays };
  return { ok: true, data: { state: next, data: next.ageing } };
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
