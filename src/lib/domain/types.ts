/** Domain models for TLB customer orders, documents & fulfilment (Supabase-ready). */

export type CustomerCategory =
  | "Hospital"
  | "Laboratory"
  | "Distributor"
  | "Industrial"
  | "Educational"
  | "Other";

export type PaymentTerms = "COD" | "Net 7" | "Net 15" | "Net 30" | "Net 45" | "Net 60";

export type CustomerOrderStatus =
  | "Draft"
  | "Pending"
  | "Confirmed"
  | "Awaiting Stock"
  | "Partially Supplied"
  | "Ready for Supply"
  | "Fully Supplied"
  | "Delivered"
  | "Cancelled";

export type LineStatus =
  | "Open"
  | "Awaiting Stock"
  | "Ready"
  | "Partially Supplied"
  | "Fully Supplied"
  | "Cancelled";

export type AgeingBand = "Normal" | "Attention" | "Overdue";

export type InvoicePaymentStatus = "Unpaid" | "Partial" | "Paid" | "Void";

export type DeliveryStatus =
  | "Preparing"
  | "Ready"
  | "Dispatched"
  | "Delivered"
  | "Failed"
  | "Returned";

export type PaymentMethod = "Cash" | "Bank Transfer" | "Mobile Money" | "Cheque" | "Card" | "Other";

export type NotificationType =
  | "partially_supplied"
  | "expected_date_approaching"
  | "expected_date_reached"
  | "overdue"
  | "stock_available"
  | "extended_unfulfilled";

export type AppRole = "Sales" | "Warehouse" | "Finance" | "Manager" | "Admin";

export type Permission =
  | "customers.manage"
  | "orders.create"
  | "orders.confirm"
  | "orders.cancel_line"
  | "supply.create"
  | "stock.receive"
  | "stock.reserve"
  | "invoice.create"
  | "receipt.create"
  | "delivery.manage"
  | "payment.record"
  | "reports.view"
  | "settings.manage"
  | "audit.view"
  | "tin.update";

export type AuditAction =
  | "customer.created"
  | "customer.updated"
  | "order.created"
  | "order.status_changed"
  | "order.confirmed"
  | "order.cancelled"
  | "line.cancelled"
  | "supply.created"
  | "stock.received"
  | "stock.reserved"
  | "stock.released"
  | "invoice.created"
  | "invoice.updated"
  | "invoice.voided"
  | "receipt.created"
  | "delivery.created"
  | "delivery.status_changed"
  | "payment.recorded"
  | "settings.updated"
  | "role.switched";

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  location: string;
  active: boolean;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string;
  active: boolean;
}

export interface StockBalance {
  id: string;
  productId: string;
  warehouseId: string;
  physicalQty: number;
  reservedQty: number;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  category: CustomerCategory;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  tin?: string;
  creditLimit: number;
  paymentTerms: PaymentTerms;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerOrderLine {
  id: string;
  orderId: string;
  productId: string;
  warehouseId: string;
  orderedQty: number;
  suppliedQty: number;
  cancelledQty: number;
  reservedQty: number;
  unitPrice: number;
  lineStatus: LineStatus;
  cancelReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

export interface CustomerPurchaseOrder {
  id: string;
  number: string;
  customerId: string;
  /** Optional customer-side PO / reference number */
  customerPoNumber?: string;
  status: CustomerOrderStatus;
  orderDate: string;
  requiredDate?: string;
  notes?: string;
  confirmedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface SupplyHeader {
  id: string;
  number: string;
  orderId: string;
  suppliedAt: string;
  suppliedBy: string;
  notes?: string;
}

export interface SupplyLine {
  id: string;
  supplyId: string;
  orderLineId: string;
  productId: string;
  warehouseId: string;
  quantity: number;
}

export interface VatRate {
  id: string;
  code: string;
  label: string;
  /** Percent e.g. 12.5 — configured in settings; never invent jurisdiction defaults. */
  ratePercent: number;
  active: boolean;
}

export interface CompanyProfile {
  legalName: string;
  tradingName: string;
  address: string;
  phone: string;
  email: string;
  tin?: string;
  logoNote?: string;
}

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  vatRateId: string;
  vatAmount: number;
  lineTotal: number;
  orderLineId?: string;
  supplyLineId?: string;
}

export interface Invoice {
  id: string;
  number: string;
  customerId: string;
  orderId: string;
  supplyId?: string;
  invoiceDate: string;
  customerPoNumber?: string;
  customerTin?: string;
  billingAddress: string;
  vatRateId: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  paymentStatus: InvoicePaymentStatus;
  amountPaid: number;
  preparedBy: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptLine {
  id: string;
  receiptId: string;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Receipt {
  id: string;
  number: string;
  customerId: string;
  orderId?: string;
  invoiceId?: string;
  receiptDate: string;
  paymentMethod: PaymentMethod;
  amount: number;
  amountPaid: number;
  balance: number;
  processedBy: string;
  notes?: string;
  createdAt: string;
}

export interface DeliveryItem {
  id: string;
  deliveryId: string;
  productId: string;
  quantity: number;
  supplyLineId?: string;
  orderLineId?: string;
}

export interface Delivery {
  id: string;
  number: string;
  customerId: string;
  orderId: string;
  supplyId: string;
  deliveryDate: string;
  address: string;
  method: string;
  vehicle?: string;
  driver?: string;
  receiverName?: string;
  receiverContact?: string;
  status: DeliveryStatus;
  confirmedAt?: string;
  confirmedBy?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface Payment {
  id: string;
  number: string;
  customerId: string;
  orderId?: string;
  invoiceId?: string;
  receiptId?: string;
  paymentDate: string;
  method: PaymentMethod;
  amount: number;
  reference?: string;
  recordedBy: string;
  notes?: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  orderId?: string;
  productId?: string;
  dedupeKey: string;
  createdAt: string;
  readAt?: string;
}

export interface StockReservation {
  id: string;
  orderLineId: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  reservedAt: string;
  reservedBy: string;
  expiresAt?: string;
  releasedAt?: string;
  releaseReason?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface AgeingSettings {
  normalMaxDays: number;
  attentionMaxDays: number;
  /** Days outstanding before "extended unfulfilled" reminder */
  extendedUnfulfilledDays: number;
  /** Days before required date to warn */
  expectedApproachingDays: number;
}

export interface DocumentCounters {
  order: number;
  supply: number;
  customer: number;
  invoice: number;
  receipt: number;
  delivery: number;
  payment: number;
}

export interface TlbState {
  version: 2;
  warehouses: Warehouse[];
  products: Product[];
  stock: StockBalance[];
  customers: Customer[];
  orders: CustomerPurchaseOrder[];
  orderLines: CustomerOrderLine[];
  supplies: SupplyHeader[];
  supplyLines: SupplyLine[];
  invoices: Invoice[];
  invoiceLines: InvoiceLine[];
  receipts: Receipt[];
  receiptLines: ReceiptLine[];
  deliveries: Delivery[];
  deliveryItems: DeliveryItem[];
  payments: Payment[];
  notifications: AppNotification[];
  reservations: StockReservation[];
  audit: AuditEvent[];
  counters: DocumentCounters;
  ageing: AgeingSettings;
  company: CompanyProfile;
  vatRates: VatRate[];
  currentUser: string;
  currentRole: AppRole;
}

export interface OutstandingRow {
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  lineId: string;
  productId: string;
  productName: string;
  productSku: string;
  warehouseId: string;
  warehouseName: string;
  orderedQty: number;
  suppliedQty: number;
  cancelledQty: number;
  outstandingQty: number;
  reservedQty: number;
  availableQty: number;
  orderStatus: CustomerOrderStatus;
  lineStatus: LineStatus;
  orderDate: string;
  requiredDate?: string;
  ageDays: number;
  ageingBand: AgeingBand;
  unitPrice: number;
}

export interface SupplyRequestLine {
  orderLineId: string;
  quantity: number;
}

export interface RelatedRecord {
  kind: "customer" | "order" | "supply" | "invoice" | "receipt" | "delivery" | "payment" | "reservation";
  id: string;
  number: string;
  label: string;
  status?: string;
}

export interface SearchHit {
  kind: string;
  id: string;
  label: string;
  subtitle?: string;
  nav: string;
  orderId?: string;
}

export type StoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
