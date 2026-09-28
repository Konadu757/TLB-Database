/** Row ↔ domain mappers for P0/P1 Supabase tables. */

import type { Database, Json } from "@/integrations/supabase/types";
import type {
  AgeingSettings,
  AppNotification,
  AuditAction,
  AuditEvent,
  CompanyProfile,
  Customer,
  CustomerCategory,
  CustomerOrderLine,
  CustomerOrderStatus,
  CustomerPurchaseOrder,
  Delivery,
  DeliveryItem,
  DeliveryStatus,
  DocumentCounters,
  Invoice,
  InvoiceLine,
  InvoicePaymentStatus,
  LineStatus,
  NotificationType,
  Payment,
  PaymentMethod,
  PaymentTerms,
  Product,
  Receipt,
  ReceiptLine,
  SoftDeleteFields,
  StockBalance,
  StockReservation,
  SupplyHeader,
  SupplyLine,
  VatRate,
  Warehouse,
} from "@/lib/domain/types";
import { floorMatureCommercialCounters } from "@/lib/domain/numbering";

type Tables = Database["public"]["Tables"];

/** Soft-delete may live in app_settings overlay or optional P2 columns. */
export type SoftDeleteOverlay = Record<
  string,
  Record<string, { deletedAt?: string; deletedBy?: string; deletedReason?: string }>
>;

function softFromRow(row: {
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_reason?: string | null;
}) {
  return {
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    ...(row.deleted_by ? { deletedBy: row.deleted_by } : {}),
    ...(row.deleted_reason ? { deletedReason: row.deleted_reason } : {}),
  };
}

function applySoft(
  id: string,
  entityType: string,
  overlay: SoftDeleteOverlay | undefined,
  rowSoft: { deletedAt?: string; deletedBy?: string; deletedReason?: string },
) {
  const fromOverlay = overlay?.[entityType]?.[id];
  return { ...rowSoft, ...fromOverlay };
}

export function warehouseFromRow(
  row: Tables["warehouses"]["Row"],
  overlay?: SoftDeleteOverlay,
): Warehouse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    location: row.location ?? "",
    active: row.active,
    ...applySoft(row.id, "warehouse", overlay, softFromRow(row)),
  };
}

export function warehouseToRow(w: Warehouse): Tables["warehouses"]["Insert"] {
  return {
    id: w.id,
    code: w.code,
    name: w.name,
    location: w.location || null,
    active: w.active,
  };
}

export function productFromRow(
  row: Tables["products"]["Row"],
  extra?: Partial<Product>,
  overlay?: SoftDeleteOverlay,
): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    category: row.category ?? "",
    active: row.active,
    ...applySoft(row.id, "product", overlay, softFromRow(row)),
    ...extra,
  };
}

export function productToRow(p: Product): Tables["products"]["Insert"] {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    category: p.category || null,
    active: p.active,
  };
}

export function stockFromRow(
  row: Tables["stock_balances"]["Row"],
  extra?: Partial<StockBalance>,
): StockBalance {
  return {
    id: row.id,
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    physicalQty: row.physical_qty,
    reservedQty: row.reserved_qty,
    ...extra,
  };
}

export function stockToRow(s: StockBalance): Tables["stock_balances"]["Insert"] {
  return {
    id: s.id,
    product_id: s.productId,
    warehouse_id: s.warehouseId,
    physical_qty: s.physicalQty,
    reserved_qty: s.reservedQty,
  };
}

export function customerFromRow(
  row: Tables["customers"]["Row"],
  overlay?: SoftDeleteOverlay,
): Customer {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category as CustomerCategory,
    contactName: row.contact_name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    tin: row.tin ?? undefined,
    creditLimit: Number(row.credit_limit),
    paymentTerms: row.payment_terms as PaymentTerms,
    notes: row.notes ?? undefined,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...applySoft(row.id, "customer", overlay, softFromRow(row)),
  };
}

export function customerToRow(c: Customer): Tables["customers"]["Insert"] {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    category: c.category,
    contact_name: c.contactName || null,
    phone: c.phone || null,
    email: c.email || null,
    address: c.address || null,
    tin: c.tin ?? null,
    credit_limit: c.creditLimit,
    payment_terms: c.paymentTerms,
    notes: c.notes ?? null,
    active: c.active,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

export function orderFromRow(
  row: Tables["customer_purchase_orders"]["Row"],
  overlay?: SoftDeleteOverlay,
): CustomerPurchaseOrder {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    customerPoNumber: row.customer_po_number ?? undefined,
    status: row.status as CustomerOrderStatus,
    orderDate: row.order_date,
    requiredDate: row.required_date ?? undefined,
    notes: row.notes ?? undefined,
    confirmedAt: row.confirmed_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    cancelReason: row.cancel_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? "",
    ...applySoft(row.id, "order", overlay, softFromRow(row)),
  };
}

export function orderToRow(o: CustomerPurchaseOrder): Tables["customer_purchase_orders"]["Insert"] {
  return {
    id: o.id,
    number: o.number,
    customer_id: o.customerId,
    customer_po_number: o.customerPoNumber ?? null,
    status: o.status,
    order_date: o.orderDate,
    required_date: o.requiredDate ?? null,
    notes: o.notes ?? null,
    confirmed_at: o.confirmedAt ?? null,
    cancelled_at: o.cancelledAt ?? null,
    cancel_reason: o.cancelReason ?? null,
    created_by: o.createdBy || null,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

export function buildSoftDeleteOverlay(state: {
  warehouses: Warehouse[];
  products: Product[];
  customers: Customer[];
  orders: CustomerPurchaseOrder[];
  invoices?: Invoice[];
  receipts?: Receipt[];
  payments?: Payment[];
  deliveries?: Delivery[];
  supplies?: SupplyHeader[];
  notifications?: AppNotification[];
}): SoftDeleteOverlay {
  const overlay: SoftDeleteOverlay = {};
  const put = (
    type: string,
    id: string,
    fields: { deletedAt?: string; deletedBy?: string; deletedReason?: string },
  ) => {
    if (!fields.deletedAt && !fields.deletedBy && !fields.deletedReason) return;
    overlay[type] ??= {};
    const soft: SoftDeleteFields = {};
    if (fields.deletedAt) soft.deletedAt = fields.deletedAt;
    if (fields.deletedBy) soft.deletedBy = fields.deletedBy;
    if (fields.deletedReason) soft.deletedReason = fields.deletedReason;
    overlay[type][id] = soft;
  };
  for (const w of state.warehouses) put("warehouse", w.id, w);
  for (const p of state.products) put("product", p.id, p);
  for (const c of state.customers) put("customer", c.id, c);
  for (const o of state.orders) put("order", o.id, o);
  for (const i of state.invoices ?? []) put("invoice", i.id, i);
  for (const r of state.receipts ?? []) put("receipt", r.id, r);
  for (const p of state.payments ?? []) put("payment", p.id, p);
  for (const d of state.deliveries ?? []) put("delivery", d.id, d);
  for (const s of state.supplies ?? []) put("supply", s.id, s);
  for (const n of state.notifications ?? []) put("notification", n.id, n);
  return overlay;
}

export function orderLineFromRow(row: Tables["customer_order_lines"]["Row"]): CustomerOrderLine {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    orderedQty: row.ordered_qty,
    suppliedQty: row.supplied_qty,
    cancelledQty: row.cancelled_qty,
    reservedQty: row.reserved_qty,
    unitPrice: Number(row.unit_price),
    lineStatus: row.line_status as LineStatus,
    cancelReason: row.cancel_reason ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    cancelledBy: row.cancelled_by ?? undefined,
  };
}

export function orderLineToRow(l: CustomerOrderLine): Tables["customer_order_lines"]["Insert"] {
  return {
    id: l.id,
    order_id: l.orderId,
    product_id: l.productId,
    warehouse_id: l.warehouseId,
    ordered_qty: l.orderedQty,
    supplied_qty: l.suppliedQty,
    cancelled_qty: l.cancelledQty,
    reserved_qty: l.reservedQty,
    unit_price: l.unitPrice,
    line_status: l.lineStatus,
    cancel_reason: l.cancelReason ?? null,
    cancelled_at: l.cancelledAt ?? null,
    cancelled_by: l.cancelledBy ?? null,
  };
}

export function supplyFromRow(
  row: Tables["supplies"]["Row"],
  overlay?: SoftDeleteOverlay,
): SupplyHeader {
  return {
    id: row.id,
    number: row.number,
    orderId: row.order_id,
    suppliedAt: row.supplied_at,
    suppliedBy: row.supplied_by,
    notes: row.notes ?? undefined,
    ...applySoft(row.id, "supply", overlay, {}),
  };
}

export function supplyToRow(s: SupplyHeader): Tables["supplies"]["Insert"] {
  return {
    id: s.id,
    number: s.number,
    order_id: s.orderId,
    supplied_at: s.suppliedAt,
    supplied_by: s.suppliedBy,
    notes: s.notes ?? null,
  };
}

export function supplyLineFromRow(row: Tables["supply_lines"]["Row"]): SupplyLine {
  return {
    id: row.id,
    supplyId: row.supply_id,
    orderLineId: row.order_line_id,
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    quantity: row.quantity,
  };
}

export function supplyLineToRow(l: SupplyLine): Tables["supply_lines"]["Insert"] {
  return {
    id: l.id,
    supply_id: l.supplyId,
    order_line_id: l.orderLineId,
    product_id: l.productId,
    warehouse_id: l.warehouseId,
    quantity: l.quantity,
  };
}

export function auditFromRow(row: Tables["audit_events"]["Row"]): AuditEvent {
  return {
    id: row.id,
    at: row.at,
    actor: row.actor,
    action: row.action as AuditAction,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    meta: (row.meta as AuditEvent["meta"]) ?? undefined,
  };
}

export function auditToRow(a: AuditEvent): Tables["audit_events"]["Insert"] {
  return {
    id: a.id,
    at: a.at,
    actor: a.actor,
    action: a.action,
    entity_type: a.entityType,
    entity_id: a.entityId,
    summary: a.summary,
    meta: (a.meta as Json) ?? null,
  };
}

export function vatFromRow(row: Tables["vat_rates"]["Row"]): VatRate {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    ratePercent: Number(row.rate_percent),
    active: row.active,
  };
}

export function vatToRow(v: VatRate): Tables["vat_rates"]["Insert"] {
  return {
    id: v.id,
    code: v.code,
    label: v.label,
    rate_percent: v.ratePercent,
    active: v.active,
  };
}

export function invoiceFromRow(
  row: Tables["invoices"]["Row"],
  overlay?: SoftDeleteOverlay,
): Invoice {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    orderId: row.order_id,
    supplyId: row.supply_id ?? undefined,
    invoiceDate: row.invoice_date,
    customerPoNumber: row.customer_po_number ?? undefined,
    customerTin: row.customer_tin ?? undefined,
    billingAddress: row.billing_address ?? "",
    vatRateId: row.vat_rate_id ?? "",
    subtotal: Number(row.subtotal),
    vatAmount: Number(row.vat_amount),
    total: Number(row.total),
    paymentStatus: row.payment_status as InvoicePaymentStatus,
    amountPaid: Number(row.amount_paid),
    preparedBy: row.prepared_by,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...applySoft(row.id, "invoice", overlay, {}),
  };
}

export function invoiceToRow(i: Invoice): Tables["invoices"]["Insert"] {
  return {
    id: i.id,
    number: i.number,
    customer_id: i.customerId,
    order_id: i.orderId,
    supply_id: i.supplyId ?? null,
    invoice_date: i.invoiceDate,
    customer_po_number: i.customerPoNumber ?? null,
    customer_tin: i.customerTin ?? null,
    billing_address: i.billingAddress || null,
    vat_rate_id: i.vatRateId || null,
    subtotal: i.subtotal,
    vat_amount: i.vatAmount,
    total: i.total,
    payment_status: i.paymentStatus,
    amount_paid: i.amountPaid,
    prepared_by: i.preparedBy,
    notes: i.notes ?? null,
    created_at: i.createdAt,
    updated_at: i.updatedAt,
  };
}

export function invoiceLineFromRow(row: Tables["invoice_lines"]["Row"]): InvoiceLine {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    productId: row.product_id,
    description: row.description,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
    lineSubtotal: Number(row.line_subtotal),
    vatRateId: row.vat_rate_id ?? "",
    vatAmount: Number(row.vat_amount),
    lineTotal: Number(row.line_total),
    orderLineId: row.order_line_id ?? undefined,
    supplyLineId: row.supply_line_id ?? undefined,
  };
}

export function invoiceLineToRow(l: InvoiceLine): Tables["invoice_lines"]["Insert"] {
  return {
    id: l.id,
    invoice_id: l.invoiceId,
    product_id: l.productId,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    line_subtotal: l.lineSubtotal,
    vat_rate_id: l.vatRateId || null,
    vat_amount: l.vatAmount,
    line_total: l.lineTotal,
    order_line_id: l.orderLineId ?? null,
    supply_line_id: l.supplyLineId ?? null,
  };
}

export function receiptFromRow(
  row: Tables["receipts"]["Row"],
  overlay?: SoftDeleteOverlay,
): Receipt {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    orderId: row.order_id ?? undefined,
    invoiceId: row.invoice_id ?? undefined,
    receiptDate: row.receipt_date,
    paymentMethod: row.payment_method as PaymentMethod,
    amount: Number(row.amount),
    amountPaid: Number(row.amount_paid),
    balance: Number(row.balance),
    processedBy: row.processed_by,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    ...applySoft(row.id, "receipt", overlay, {}),
  };
}

export function receiptToRow(r: Receipt): Tables["receipts"]["Insert"] {
  return {
    id: r.id,
    number: r.number,
    customer_id: r.customerId,
    order_id: r.orderId ?? null,
    invoice_id: r.invoiceId ?? null,
    receipt_date: r.receiptDate,
    payment_method: r.paymentMethod,
    amount: r.amount,
    amount_paid: r.amountPaid,
    balance: r.balance,
    processed_by: r.processedBy,
    notes: r.notes ?? null,
    created_at: r.createdAt,
  };
}

export function receiptLineFromRow(row: Tables["receipt_lines"]["Row"]): ReceiptLine {
  return {
    id: row.id,
    receiptId: row.receipt_id,
    productId: row.product_id ?? undefined,
    description: row.description,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
    lineTotal: Number(row.line_total),
  };
}

export function receiptLineToRow(l: ReceiptLine): Tables["receipt_lines"]["Insert"] {
  return {
    id: l.id,
    receipt_id: l.receiptId,
    product_id: l.productId ?? null,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    line_total: l.lineTotal,
  };
}

export function deliveryFromRow(
  row: Tables["deliveries"]["Row"],
  overlay?: SoftDeleteOverlay,
): Delivery {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    orderId: row.order_id,
    supplyId: row.supply_id,
    deliveryDate: row.delivery_date,
    address: row.address,
    method: row.method,
    vehicle: row.vehicle ?? undefined,
    driver: row.driver ?? undefined,
    receiverName: row.receiver_name ?? undefined,
    receiverContact: row.receiver_contact ?? undefined,
    status: row.status as DeliveryStatus,
    confirmedAt: row.confirmed_at ?? undefined,
    confirmedBy: row.confirmed_by ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    ...applySoft(row.id, "delivery", overlay, {}),
  };
}

export function deliveryToRow(d: Delivery): Tables["deliveries"]["Insert"] {
  return {
    id: d.id,
    number: d.number,
    customer_id: d.customerId,
    order_id: d.orderId,
    supply_id: d.supplyId,
    delivery_date: d.deliveryDate,
    address: d.address,
    method: d.method,
    vehicle: d.vehicle ?? null,
    driver: d.driver ?? null,
    receiver_name: d.receiverName ?? null,
    receiver_contact: d.receiverContact ?? null,
    status: d.status,
    confirmed_at: d.confirmedAt ?? null,
    confirmed_by: d.confirmedBy ?? null,
    notes: d.notes ?? null,
    created_by: d.createdBy,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };
}

export function deliveryItemFromRow(row: Tables["delivery_items"]["Row"]): DeliveryItem {
  return {
    id: row.id,
    deliveryId: row.delivery_id,
    productId: row.product_id,
    quantity: row.quantity,
    supplyLineId: row.supply_line_id ?? undefined,
    orderLineId: row.order_line_id ?? undefined,
  };
}

export function deliveryItemToRow(i: DeliveryItem): Tables["delivery_items"]["Insert"] {
  return {
    id: i.id,
    delivery_id: i.deliveryId,
    product_id: i.productId,
    quantity: i.quantity,
    supply_line_id: i.supplyLineId ?? null,
    order_line_id: i.orderLineId ?? null,
  };
}

export function paymentFromRow(
  row: Tables["payments"]["Row"],
  overlay?: SoftDeleteOverlay,
): Payment {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customer_id,
    orderId: row.order_id ?? undefined,
    invoiceId: row.invoice_id ?? undefined,
    receiptId: row.receipt_id ?? undefined,
    paymentDate: row.payment_date,
    method: row.method as PaymentMethod,
    amount: Number(row.amount),
    reference: row.reference ?? undefined,
    recordedBy: row.recorded_by,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    ...applySoft(row.id, "payment", overlay, {}),
  };
}

export function paymentToRow(p: Payment): Tables["payments"]["Insert"] {
  return {
    id: p.id,
    number: p.number,
    customer_id: p.customerId,
    order_id: p.orderId ?? null,
    invoice_id: p.invoiceId ?? null,
    receipt_id: p.receiptId ?? null,
    payment_date: p.paymentDate,
    method: p.method,
    amount: p.amount,
    reference: p.reference ?? null,
    recorded_by: p.recordedBy,
    notes: p.notes ?? null,
    created_at: p.createdAt,
  };
}

export function notificationFromRow(
  row: Tables["notifications"]["Row"],
  overlay?: SoftDeleteOverlay,
): AppNotification {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    orderId: row.order_id ?? undefined,
    productId: row.product_id ?? undefined,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
    ...applySoft(row.id, "notification", overlay, {}),
  };
}

export function notificationToRow(n: AppNotification): Tables["notifications"]["Insert"] {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    order_id: n.orderId ?? null,
    product_id: n.productId ?? null,
    dedupe_key: n.dedupeKey,
    created_at: n.createdAt,
    read_at: n.readAt ?? null,
  };
}

export function reservationFromRow(row: Tables["stock_reservations"]["Row"]): StockReservation {
  return {
    id: row.id,
    orderLineId: row.order_line_id,
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    quantity: row.quantity,
    reservedAt: row.reserved_at,
    reservedBy: row.reserved_by,
    expiresAt: row.expires_at ?? undefined,
    releasedAt: row.released_at ?? undefined,
    releaseReason: row.release_reason ?? undefined,
  };
}

export function reservationToRow(r: StockReservation): Tables["stock_reservations"]["Insert"] {
  return {
    id: r.id,
    order_line_id: r.orderLineId,
    product_id: r.productId,
    warehouse_id: r.warehouseId,
    quantity: r.quantity,
    reserved_at: r.reservedAt,
    reserved_by: r.reservedBy,
    expires_at: r.expiresAt ?? null,
    released_at: r.releasedAt ?? null,
    release_reason: r.releaseReason ?? null,
  };
}

export function countersFromRow(
  row: Tables["document_counters"]["Row"] | null,
  local: DocumentCounters,
): DocumentCounters {
  if (!row) return floorMatureCommercialCounters(local);
  return floorMatureCommercialCounters({
    ...local,
    order: row.order_seq,
    supply: row.supply_seq,
    customer: row.customer_seq,
    invoice: row.invoice_seq,
    receipt: row.receipt_seq,
    delivery: row.delivery_seq,
    payment: row.payment_seq,
  });
}

export function countersToRow(c: DocumentCounters): Tables["document_counters"]["Insert"] {
  return {
    id: 1,
    order_seq: c.order,
    supply_seq: c.supply,
    customer_seq: c.customer,
    invoice_seq: c.invoice,
    receipt_seq: c.receipt,
    delivery_seq: c.delivery,
    payment_seq: c.payment,
  };
}

export function ageingFromSettings(value: unknown, fallback: AgeingSettings): AgeingSettings {
  if (!value || typeof value !== "object") return fallback;
  const v = value as Record<string, unknown>;
  return {
    normalMaxDays: Number(v.normalMaxDays ?? fallback.normalMaxDays),
    attentionMaxDays: Number(v.attentionMaxDays ?? fallback.attentionMaxDays),
    extendedUnfulfilledDays: Number(v.extendedUnfulfilledDays ?? fallback.extendedUnfulfilledDays),
    expectedApproachingDays: Number(v.expectedApproachingDays ?? fallback.expectedApproachingDays),
  };
}

export function companyFromSettings(value: unknown, fallback: CompanyProfile): CompanyProfile {
  if (!value || typeof value !== "object") return fallback;
  const v = value as Record<string, unknown>;
  return {
    legalName: String(v.legalName ?? fallback.legalName),
    tradingName: String(v.tradingName ?? fallback.tradingName),
    address: String(v.address ?? fallback.address),
    phone: String(v.phone ?? fallback.phone),
    email: String(v.email ?? fallback.email),
    tin: v.tin != null ? String(v.tin) : fallback.tin,
    logoNote: v.logoNote != null ? String(v.logoNote) : fallback.logoNote,
  };
}
