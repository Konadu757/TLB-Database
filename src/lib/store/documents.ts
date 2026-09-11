import { calcOutstanding } from "../domain/calculations";
import { nextDocumentNumber } from "../domain/numbering";
import { hasPermission } from "../domain/permissions";
import type {
  Delivery,
  DeliveryStatus,
  Invoice,
  Payment,
  PaymentMethod,
  Receipt,
  StoreResult,
  TlbState,
} from "../domain/types";

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function pushAudit(
  state: TlbState,
  partial: {
    action: TlbState["audit"][number]["action"];
    entityType: string;
    entityId: string;
    summary: string;
    meta?: Record<string, string | number | boolean | null>;
  },
): void {
  state.audit.unshift({
    id: uid("aud"),
    at: new Date().toISOString(),
    actor: state.currentUser,
    ...partial,
  });
  if (state.audit.length > 500) state.audit.length = 500;
}

function deny(state: TlbState, permission: Parameters<typeof hasPermission>[1]): string | null {
  if (!hasPermission(state, permission)) {
    return `Role ${state.currentRole} cannot perform ${permission}.`;
  }
  return null;
}

type MutResult<T> = StoreResult<{ state: TlbState; data: T }>;

export function createInvoiceFromSupply(
  state: TlbState,
  input: {
    orderId: string;
    supplyId: string;
    vatRateId: string;
    notes?: string;
    updateCustomerTin?: string;
  },
): MutResult<Invoice> {
  const blocked = deny(state, "invoice.create");
  if (blocked) return { ok: false, error: blocked };

  const next = cloneState(state);
  const order = next.orders.find((o) => o.id === input.orderId);
  if (!order) return { ok: false, error: "Order not found." };
  const supply = next.supplies.find((s) => s.id === input.supplyId && s.orderId === input.orderId);
  if (!supply) return { ok: false, error: "Supply not found for this order." };
  const customer = next.customers.find((c) => c.id === order.customerId);
  if (!customer) return { ok: false, error: "Customer not found." };
  const vat = next.vatRates.find((v) => v.id === input.vatRateId && v.active);
  if (!vat) return { ok: false, error: "Select an active VAT rate from settings." };

  if (input.updateCustomerTin !== undefined) {
    const tinBlocked = deny(next, "tin.update");
    if (tinBlocked) return { ok: false, error: tinBlocked };
    const tin = input.updateCustomerTin.trim();
    customer.tin = tin || undefined;
    customer.updatedAt = new Date().toISOString();
    pushAudit(next, {
      action: "customer.updated",
      entityType: "customer",
      entityId: customer.id,
      summary: tin ? `Updated TIN on ${customer.code}.` : `Cleared TIN on ${customer.code}.`,
    });
  }

  const numbered = nextDocumentNumber("invoice", next.counters);
  next.counters = numbered.counters;
  const now = new Date().toISOString();
  const invoiceId = uid("inv");
  const supplyLines = next.supplyLines.filter((sl) => sl.supplyId === supply.id);

  let subtotal = 0;
  let vatAmount = 0;
  for (const sl of supplyLines) {
    const orderLine = next.orderLines.find((l) => l.id === sl.orderLineId);
    const product = next.products.find((p) => p.id === sl.productId);
    const unitPrice = orderLine?.unitPrice ?? 0;
    const lineSubtotal = unitPrice * sl.quantity;
    const lineVat = Math.round(lineSubtotal * (vat.ratePercent / 100) * 100) / 100;
    subtotal += lineSubtotal;
    vatAmount += lineVat;
    next.invoiceLines.push({
      id: uid("il"),
      invoiceId,
      productId: sl.productId,
      description: product ? `${product.name} (${product.sku})` : sl.productId,
      quantity: sl.quantity,
      unitPrice,
      lineSubtotal,
      vatRateId: vat.id,
      vatAmount: lineVat,
      lineTotal: lineSubtotal + lineVat,
      orderLineId: sl.orderLineId,
      supplyLineId: sl.id,
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;
  vatAmount = Math.round(vatAmount * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;

  const invoice: Invoice = {
    id: invoiceId,
    number: numbered.number,
    customerId: customer.id,
    orderId: order.id,
    supplyId: supply.id,
    invoiceDate: now,
    customerPoNumber: order.customerPoNumber,
    customerTin: customer.tin,
    billingAddress: customer.address,
    vatRateId: vat.id,
    subtotal,
    vatAmount,
    total,
    paymentStatus: "Unpaid",
    amountPaid: 0,
    preparedBy: next.currentUser,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  next.invoices.unshift(invoice);
  pushAudit(next, {
    action: "invoice.created",
    entityType: "invoice",
    entityId: invoice.id,
    summary: `Created invoice ${invoice.number} for ${order.number} / ${supply.number}.`,
    meta: { orderId: order.id, supplyId: supply.id, total },
  });
  return { ok: true, data: { state: next, data: invoice } };
}

export function createOrdinaryReceipt(
  state: TlbState,
  input: {
    customerId: string;
    orderId?: string;
    invoiceId?: string;
    paymentMethod: PaymentMethod;
    amountPaid: number;
    notes?: string;
    lines?: Array<{ productId?: string; description: string; quantity: number; unitPrice: number }>;
  },
): MutResult<Receipt> {
  const blocked = deny(state, "receipt.create");
  if (blocked) return { ok: false, error: blocked };
  if (!input.customerId) return { ok: false, error: "Customer is required." };
  if (!Number.isFinite(input.amountPaid) || input.amountPaid < 0) {
    return { ok: false, error: "Amount paid must be a non-negative number." };
  }

  const next = cloneState(state);
  const customer = next.customers.find((c) => c.id === input.customerId);
  if (!customer) return { ok: false, error: "Customer not found." };

  let amount = input.amountPaid;
  const draftLines = input.lines?.length
    ? input.lines
    : input.invoiceId
      ? next.invoiceLines
          .filter((l) => l.invoiceId === input.invoiceId)
          .map((l) => ({
            productId: l.productId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          }))
      : [];

  if (draftLines.length) {
    amount = draftLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  }

  const numbered = nextDocumentNumber("receipt", next.counters);
  next.counters = numbered.counters;
  const now = new Date().toISOString();
  const receiptId = uid("rct");
  const amountPaid = input.amountPaid;
  const balance = Math.round((amount - amountPaid) * 100) / 100;

  const receipt: Receipt = {
    id: receiptId,
    number: numbered.number,
    customerId: customer.id,
    orderId: input.orderId,
    invoiceId: input.invoiceId,
    receiptDate: now,
    paymentMethod: input.paymentMethod,
    amount: Math.round(amount * 100) / 100,
    amountPaid,
    balance,
    processedBy: next.currentUser,
    notes: input.notes,
    createdAt: now,
  };
  next.receipts.unshift(receipt);

  for (const line of draftLines) {
    next.receiptLines.push({
      id: uid("rl"),
      receiptId,
      productId: line.productId,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: Math.round(line.quantity * line.unitPrice * 100) / 100,
    });
  }

  pushAudit(next, {
    action: "receipt.created",
    entityType: "receipt",
    entityId: receipt.id,
    summary: `Created receipt ${receipt.number} for ${customer.name}.`,
    meta: { amountPaid, method: input.paymentMethod },
  });

  if (input.invoiceId && amountPaid > 0) {
    const inv = next.invoices.find((i) => i.id === input.invoiceId);
    if (inv) {
      inv.amountPaid = Math.round((inv.amountPaid + amountPaid) * 100) / 100;
      if (inv.amountPaid <= 0) inv.paymentStatus = "Unpaid";
      else if (inv.amountPaid + 0.001 >= inv.total) inv.paymentStatus = "Paid";
      else inv.paymentStatus = "Partial";
      inv.updatedAt = now;
      pushAudit(next, {
        action: "invoice.updated",
        entityType: "invoice",
        entityId: inv.id,
        summary: `Invoice ${inv.number} payment status → ${inv.paymentStatus}.`,
      });
    }
  }

  return { ok: true, data: { state: next, data: receipt } };
}

/** Build an ordinary receipt from a posted supply's quantities × order-line prices. */
export function createReceiptFromSupply(
  state: TlbState,
  input: {
    orderId: string;
    supplyId: string;
    paymentMethod: PaymentMethod;
    amountPaid?: number;
    invoiceId?: string;
    notes?: string;
  },
): MutResult<Receipt> {
  const blocked = deny(state, "receipt.create");
  if (blocked) return { ok: false, error: blocked };

  const order = state.orders.find((o) => o.id === input.orderId);
  if (!order) return { ok: false, error: "Order not found." };
  const supply = state.supplies.find((s) => s.id === input.supplyId && s.orderId === input.orderId);
  if (!supply) return { ok: false, error: "Supply not found for this order." };

  const supplyLines = state.supplyLines.filter((sl) => sl.supplyId === supply.id);
  if (supplyLines.length === 0) return { ok: false, error: "Supply has no lines to receipt." };

  const lines = supplyLines.map((sl) => {
    const orderLine = state.orderLines.find((l) => l.id === sl.orderLineId);
    const product = state.products.find((p) => p.id === sl.productId);
    return {
      productId: sl.productId,
      description: product ? `${product.name} (${product.sku})` : sl.productId,
      quantity: sl.quantity,
      unitPrice: orderLine?.unitPrice ?? 0,
    };
  });
  const amount = Math.round(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) * 100) / 100;

  return createOrdinaryReceipt(state, {
    customerId: order.customerId,
    orderId: order.id,
    paymentMethod: input.paymentMethod,
    amountPaid: input.amountPaid !== undefined ? input.amountPaid : amount,
    lines,
    ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
  });
}

export function createDeliveryFromSupply(
  state: TlbState,
  input: {
    orderId: string;
    supplyId: string;
    address: string;
    method: string;
    vehicle?: string;
    driver?: string;
    receiverName?: string;
    receiverContact?: string;
    notes?: string;
    status?: DeliveryStatus;
  },
): MutResult<Delivery> {
  const blocked = deny(state, "delivery.manage");
  if (blocked) return { ok: false, error: blocked };

  const next = cloneState(state);
  const order = next.orders.find((o) => o.id === input.orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status === "Cancelled") return { ok: false, error: "Cannot deliver a cancelled order." };
  const supply = next.supplies.find((s) => s.id === input.supplyId && s.orderId === input.orderId);
  if (!supply) return { ok: false, error: "Supply not found for this order." };
  const customer = next.customers.find((c) => c.id === order.customerId);
  if (!customer) return { ok: false, error: "Customer not found." };
  if (!input.address.trim()) return { ok: false, error: "Delivery address is required." };

  const numbered = nextDocumentNumber("delivery", next.counters);
  next.counters = numbered.counters;
  const now = new Date().toISOString();
  const deliveryId = uid("dlv");
  const status: DeliveryStatus = input.status ?? "Preparing";

  const delivery: Delivery = {
    id: deliveryId,
    number: numbered.number,
    customerId: customer.id,
    orderId: order.id,
    supplyId: supply.id,
    deliveryDate: now,
    address: input.address.trim(),
    method: input.method.trim() || "Own fleet",
    vehicle: input.vehicle?.trim() || undefined,
    driver: input.driver?.trim() || undefined,
    receiverName: input.receiverName?.trim() || undefined,
    receiverContact: input.receiverContact?.trim() || undefined,
    status,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
    createdBy: next.currentUser,
  };
  next.deliveries.unshift(delivery);

  for (const sl of next.supplyLines.filter((x) => x.supplyId === supply.id)) {
    next.deliveryItems.push({
      id: uid("di"),
      deliveryId,
      productId: sl.productId,
      quantity: sl.quantity,
      supplyLineId: sl.id,
      orderLineId: sl.orderLineId,
    });
  }

  pushAudit(next, {
    action: "delivery.created",
    entityType: "delivery",
    entityId: delivery.id,
    summary: `Created delivery ${delivery.number} linked to ${supply.number}.`,
    meta: { orderId: order.id, supplyId: supply.id, status },
  });

  return { ok: true, data: { state: next, data: delivery } };
}

export function updateDeliveryStatus(
  state: TlbState,
  deliveryId: string,
  status: DeliveryStatus,
  confirmation?: { receiverName?: string; notes?: string },
): MutResult<Delivery> {
  const blocked = deny(state, "delivery.manage");
  if (blocked) return { ok: false, error: blocked };

  const next = cloneState(state);
  const delivery = next.deliveries.find((d) => d.id === deliveryId);
  if (!delivery) return { ok: false, error: "Delivery not found." };
  const order = next.orders.find((o) => o.id === delivery.orderId);
  if (!order) return { ok: false, error: "Order not found." };

  const prev = delivery.status;
  delivery.status = status;
  delivery.updatedAt = new Date().toISOString();
  if (confirmation?.receiverName) delivery.receiverName = confirmation.receiverName;
  if (confirmation?.notes) delivery.notes = confirmation.notes;

  if (status === "Delivered") {
    delivery.confirmedAt = delivery.updatedAt;
    delivery.confirmedBy = next.currentUser;

    // Only mark the whole order Delivered when nothing remains outstanding
    // (or all remaining was formally cancelled) and order is fully supplied.
    const lines = next.orderLines.filter((l) => l.orderId === order.id);
    const anyOutstanding = lines.some((l) => calcOutstanding(l) > 0);
    if (!anyOutstanding && (order.status === "Fully Supplied" || order.status === "Delivered")) {
      const from = order.status;
      order.status = "Delivered";
      order.updatedAt = delivery.updatedAt;
      if (from !== "Delivered") {
        pushAudit(next, {
          action: "order.status_changed",
          entityType: "customer_purchase_order",
          entityId: order.id,
          summary: `Order ${order.number} marked Delivered after delivery ${delivery.number} confirmation (no outstanding remaining).`,
          meta: { from, to: "Delivered" },
        });
      }
    }
  }

  pushAudit(next, {
    action: "delivery.status_changed",
    entityType: "delivery",
    entityId: delivery.id,
    summary: `Delivery ${delivery.number} status ${prev} → ${status}.`,
    meta: { from: prev, to: status },
  });

  return { ok: true, data: { state: next, data: delivery } };
}

export function updateInvoiceHeader(
  state: TlbState,
  invoiceId: string,
  input: {
    billingAddress?: string;
    customerPoNumber?: string;
    customerTin?: string;
    notes?: string;
  },
): MutResult<Invoice> {
  if (!hasPermission(state, "invoice.create") && !hasPermission(state, "records.edit")) {
    return { ok: false, error: `Role ${state.currentRole} cannot edit invoices.` };
  }

  const next = cloneState(state);
  const invoice = next.invoices.find((i) => i.id === invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.paymentStatus === "Void" || invoice.paymentStatus === "Paid") {
    return {
      ok: false,
      error: `Cannot edit a ${invoice.paymentStatus.toLowerCase()} invoice. Only Unpaid / Partial invoices allow header edits.`,
    };
  }
  if (input.customerTin !== undefined && (input.customerTin ?? "") !== (invoice.customerTin ?? "")) {
    const tinBlocked = deny(next, "tin.update");
    if (tinBlocked) return { ok: false, error: tinBlocked };
  }
  if (input.billingAddress !== undefined) invoice.billingAddress = input.billingAddress.trim();
  if (input.customerPoNumber !== undefined) {
    invoice.customerPoNumber = input.customerPoNumber.trim() || undefined;
  }
  if (input.customerTin !== undefined) {
    invoice.customerTin = input.customerTin.trim() || undefined;
  }
  if (input.notes !== undefined) invoice.notes = input.notes.trim() || undefined;
  invoice.updatedAt = new Date().toISOString();
  pushAudit(next, {
    action: "invoice.updated",
    entityType: "invoice",
    entityId: invoice.id,
    summary: `Updated invoice ${invoice.number} header fields.`,
  });
  pushAudit(next, {
    action: "record.edited",
    entityType: "invoice",
    entityId: invoice.id,
    summary: `Edited invoice ${invoice.number}.`,
  });
  return { ok: true, data: { state: next, data: invoice } };
}

export function updateDeliveryDetails(
  state: TlbState,
  deliveryId: string,
  input: {
    address?: string;
    method?: string;
    vehicle?: string;
    driver?: string;
    receiverName?: string;
    receiverContact?: string;
    notes?: string;
  },
): MutResult<Delivery> {
  if (!hasPermission(state, "delivery.manage") && !hasPermission(state, "records.edit")) {
    return { ok: false, error: `Role ${state.currentRole} cannot edit deliveries.` };
  }

  const next = cloneState(state);
  const delivery = next.deliveries.find((d) => d.id === deliveryId);
  if (!delivery) return { ok: false, error: "Delivery not found." };
  if (delivery.status === "Delivered" || delivery.status === "Returned") {
    return {
      ok: false,
      error: `Cannot edit logistics fields on a ${delivery.status.toLowerCase()} delivery.`,
    };
  }
  if (input.address !== undefined) delivery.address = input.address.trim();
  if (input.method !== undefined) delivery.method = input.method.trim();
  if (input.vehicle !== undefined) delivery.vehicle = input.vehicle.trim() || undefined;
  if (input.driver !== undefined) delivery.driver = input.driver.trim() || undefined;
  if (input.receiverName !== undefined) delivery.receiverName = input.receiverName.trim() || undefined;
  if (input.receiverContact !== undefined) {
    delivery.receiverContact = input.receiverContact.trim() || undefined;
  }
  if (input.notes !== undefined) delivery.notes = input.notes.trim() || undefined;
  delivery.updatedAt = new Date().toISOString();
  pushAudit(next, {
    action: "delivery.updated",
    entityType: "delivery",
    entityId: delivery.id,
    summary: `Updated delivery ${delivery.number} logistics details.`,
  });
  pushAudit(next, {
    action: "record.edited",
    entityType: "delivery",
    entityId: delivery.id,
    summary: `Edited delivery ${delivery.number}.`,
  });
  return { ok: true, data: { state: next, data: delivery } };
}

export function recordPayment(
  state: TlbState,
  input: {
    customerId: string;
    amount: number;
    method: PaymentMethod;
    orderId?: string;
    invoiceId?: string;
    receiptId?: string;
    reference?: string;
    notes?: string;
  },
): MutResult<Payment> {
  const blocked = deny(state, "payment.record");
  if (blocked) return { ok: false, error: blocked };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "Payment amount must be positive." };
  }

  const next = cloneState(state);
  const customer = next.customers.find((c) => c.id === input.customerId);
  if (!customer) return { ok: false, error: "Customer not found." };

  const numbered = nextDocumentNumber("payment", next.counters);
  next.counters = numbered.counters;
  const now = new Date().toISOString();
  const payment: Payment = {
    id: uid("pay"),
    number: numbered.number,
    customerId: customer.id,
    orderId: input.orderId,
    invoiceId: input.invoiceId,
    receiptId: input.receiptId,
    paymentDate: now,
    method: input.method,
    amount: Math.round(input.amount * 100) / 100,
    reference: input.reference,
    recordedBy: next.currentUser,
    notes: input.notes,
    createdAt: now,
  };
  next.payments.unshift(payment);

  if (input.invoiceId) {
    const inv = next.invoices.find((i) => i.id === input.invoiceId);
    if (inv) {
      inv.amountPaid = Math.round((inv.amountPaid + payment.amount) * 100) / 100;
      if (inv.amountPaid + 0.001 >= inv.total) inv.paymentStatus = "Paid";
      else if (inv.amountPaid > 0) inv.paymentStatus = "Partial";
      inv.updatedAt = now;
    }
  }

  pushAudit(next, {
    action: "payment.recorded",
    entityType: "payment",
    entityId: payment.id,
    summary: `Recorded payment ${payment.number} · ${payment.amount}.`,
    meta: { method: input.method, amount: payment.amount },
  });

  return { ok: true, data: { state: next, data: payment } };
}
