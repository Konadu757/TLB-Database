/** Domain models for TLB customer orders, documents & fulfilment (Supabase-ready). */

export type CustomerCategory =
  | "Hospital"
  | "Laboratory"
  | "Distributor"
  | "Industrial"
  | "Educational"
  | "Other";

export type SupplierCategory =
  | "Chemical"
  | "Packaging"
  | "Equipment"
  | "Logistics"
  | "Other";

export type PaymentTerms = "COD" | "Net 7" | "Net 15" | "Net 30" | "Net 45" | "Net 60";

export type SupplierPoStatus =
  | "Draft"
  | "Open"
  | "Ordered"
  | "In transit"
  | "Partially received"
  | "Received"
  | "Cancelled";

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

/** Built-in role keys used when seeding system roles (custom roles have no systemKey). */
export type SystemRoleKey = "Owner" | "Sales" | "Warehouse" | "Finance" | "Manager" | "Admin";

/** Role id string — system or custom. Display name lives on RoleDefinition.name. */
export type AppRole = string;

export type Permission =
  | "dashboard.view"
  | "customers.manage"
  | "suppliers.manage"
  | "quotations.view"
  | "orders.create"
  | "orders.confirm"
  | "orders.cancel_line"
  | "supply.create"
  | "stock.view"
  | "stock.receive"
  | "stock.reserve"
  | "stock.issue"
  | "stock.transfer"
  | "stock.adjust"
  | "stock.approve"
  | "approvals.manage"
  | "bi.view"
  | "invoice.create"
  | "receipt.create"
  | "delivery.manage"
  | "payment.record"
  | "finance.view"
  | "reports.view"
  | "settings.manage"
  | "audit.view"
  | "tin.update"
  | "users.manage"
  | "trash.view"
  | "records.delete"
  | "trash.purge";

/** Immutable stock ledger movement kinds. */
export type StockMovementType =
  | "opening"
  | "grn"
  | "issue"
  | "transfer_out"
  | "transfer_in"
  | "adjustment_plus"
  | "adjustment_minus"
  | "return_customer"
  | "return_supplier"
  | "reservation"
  | "release"
  | "damage"
  | "expiry"
  | "production"
  | "sample"
  | "supply";

export type IssueStrategy = "FIFO" | "LIFO" | "FEFO";

export type TransferStatus =
  | "Requested"
  | "Approved"
  | "Released"
  | "In Transit"
  | "Received"
  | "Cancelled";

export type AdjustmentStatus = "Draft" | "Posted" | "Pending Approval" | "Rejected" | "Cancelled";

export type ApprovalKind =
  | "supplier_po"
  | "non_po_purchase"
  | "credit_override"
  | "high_discount"
  | "stock_adjustment"
  | "write_off"
  | "transfer"
  | "cancellation"
  | "high_value";

export type ApprovalStatus = "Pending" | "Approved" | "Rejected" | "Cancelled";

export type GrnStatus = "Draft" | "Received" | "Checked" | "Approved" | "Rejected" | "Cancelled";

export type StockIssueReason =
  | "Customer supply"
  | "Production"
  | "Sample"
  | "Damage"
  | "Expiry"
  | "Internal use"
  | "Other";

export type FinanceAgeingBucket = "0-30" | "31-60" | "61-90" | "90+";

export type AuditAction =
  | "customer.created"
  | "customer.updated"
  | "supplier.created"
  | "supplier.updated"
  | "order.created"
  | "quotation.created"
  | "order.status_changed"
  | "order.confirmed"
  | "order.cancelled"
  | "line.cancelled"
  | "supply.created"
  | "stock.received"
  | "stock.reserved"
  | "stock.released"
  | "stock.issued"
  | "stock.transferred"
  | "stock.adjusted"
  | "stock.movement"
  | "grn.created"
  | "grn.approved"
  | "batch.created"
  | "approval.requested"
  | "approval.decided"
  | "credit.override"
  | "invoice.created"
  | "invoice.updated"
  | "invoice.voided"
  | "receipt.created"
  | "delivery.created"
  | "delivery.status_changed"
  | "payment.recorded"
  | "settings.updated"
  | "role.switched"
  | "role.created"
  | "role.updated"
  | "role.deactivated"
  | "user.updated"
  | "user.role_assigned"
  | "session.user_switched"
  | "record.trashed"
  | "record.restored"
  | "record.purged";

/** Soft-delete metadata applied to domain records moved to Trash. */
export interface SoftDeleteFields {
  deletedAt?: string;
  deletedBy?: string;
  deletedReason?: string;
}

export type TrashEntityType =
  | "customer"
  | "supplier"
  | "product"
  | "warehouse"
  | "order"
  | "catalog";

/** Soft-deleted catalog (quotations / sandbox list) rows. */
export interface CatalogDeletion {
  catalogId: string;
  module: string;
  label: string;
  subtitle?: string;
  deletedAt: string;
  deletedBy: string;
  deletedReason?: string;
}

/** Unified trash list row for the Trash module UI. */
export interface TrashListItem {
  id: string;
  entityType: TrashEntityType;
  entityId: string;
  typeLabel: string;
  label: string;
  subtitle?: string;
  deletedAt: string;
  deletedBy: string;
  deletedReason?: string;
  module?: string;
}
/** Owner-managed role definition (permissions drive nav + actions). */
export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  active: boolean;
  /** Present only for seeded system roles; custom roles omit this. */
  systemKey?: SystemRoleKey;
}

/** Local mock-auth user — swap for Supabase auth user later. */
export interface AppUser {
  id: string;
  name: string;
  email: string;
  roleId: string;
  active: boolean;
}
export interface Warehouse extends SoftDeleteFields {
  id: string;
  code: string;
  name: string;
  location: string;
  active: boolean;
}

export interface Product extends SoftDeleteFields {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string;
  active: boolean;
  /** Per-product issue strategy for batch picks. */
  issueStrategy?: IssueStrategy;
  allowNegativeStock?: boolean;
  minQty?: number;
  maxQty?: number;
  reorderPoint?: number;
  reorderQty?: number;
  preferredSupplierId?: string;
  leadTimeDays?: number;
  /** Unit cost for valuation (GHS). */
  standardCost?: number;
}

export interface StockBalance {
  id: string;
  productId: string;
  warehouseId: string;
  physicalQty: number;
  reservedQty: number;
  /** Unavailable buckets — excluded from available. */
  damagedQty?: number;
  expiredQty?: number;
  quarantineQty?: number;
  inTransitQty?: number;
  allocatedQty?: number;
}

/** Immutable stock movement ledger row. */
export interface StockMovement {
  id: string;
  number: string;
  type: StockMovementType;
  productId: string;
  warehouseId: string;
  batchId?: string;
  qtyBefore: number;
  qtyMove: number;
  qtyAfter: number;
  /** Signed direction: + inbound, − outbound for physical. */
  signedQty: number;
  reason?: string;
  refType?: string;
  refId?: string;
  refNumber?: string;
  notes?: string;
  actor: string;
  at: string;
}

/** Batch / lot with remaining qty and recall timeline. */
export interface BatchLot {
  id: string;
  code: string;
  productId: string;
  warehouseId: string;
  supplierId?: string;
  receivedQty: number;
  remainingQty: number;
  unitCost: number;
  manufacturedAt?: string;
  expiresAt?: string;
  receivedAt: string;
  grnId?: string;
  supplierPoId?: string;
  status: "Open" | "Closed" | "Quarantine" | "Expired" | "Damaged";
  notes?: string;
}

export interface GoodsReceiptLine {
  id: string;
  grnId: string;
  productId: string;
  warehouseId: string;
  batchCode: string;
  orderedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  damagedQty: number;
  unitCost: number;
  manufacturedAt?: string;
  expiresAt?: string;
  batchId?: string;
}

/** Full goods-in (GRN) — extends supplier receipt with QC / approval. */
export interface GoodsReceiptNote {
  id: string;
  number: string;
  supplierId: string;
  purchaseOrderId?: string;
  /** true = Non-PO purchase */
  nonPo: boolean;
  status: GrnStatus;
  receivedAt: string;
  receivedBy: string;
  checkedBy?: string;
  checkedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  warehouseId: string;
  documentRefs?: string;
  notes?: string;
  createdAt: string;
}

export interface StockIssueLine {
  id: string;
  issueId: string;
  productId: string;
  warehouseId: string;
  batchId?: string;
  quantity: number;
}

export interface StockIssue {
  id: string;
  number: string;
  reason: StockIssueReason;
  warehouseId: string;
  issuedAt: string;
  issuedBy: string;
  orderId?: string;
  supplyId?: string;
  deliveryId?: string;
  notes?: string;
}

export interface WarehouseTransferLine {
  id: string;
  transferId: string;
  productId: string;
  batchId?: string;
  quantity: number;
}

export interface WarehouseTransfer {
  id: string;
  number: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  status: TransferStatus;
  requestedAt: string;
  requestedBy: string;
  approvedAt?: string;
  approvedBy?: string;
  releasedAt?: string;
  releasedBy?: string;
  inTransitAt?: string;
  receivedAt?: string;
  receivedBy?: string;
  notes?: string;
}

export interface StockAdjustmentLine {
  id: string;
  adjustmentId: string;
  productId: string;
  warehouseId: string;
  batchId?: string;
  qtyBefore: number;
  qtyAfter: number;
  variance: number;
  reason: string;
}

export interface StockAdjustment {
  id: string;
  number: string;
  status: AdjustmentStatus;
  kind: "adjustment" | "count";
  createdAt: string;
  createdBy: string;
  postedAt?: string;
  postedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  notes?: string;
  /** Absolute variance qty requiring approval when above threshold. */
  requiresApproval: boolean;
}

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  title: string;
  summary: string;
  refType: string;
  refId: string;
  amount?: number;
  requestedAt: string;
  requestedBy: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
}

export interface InventorySettings {
  expiryAlertDays: number[];
  adjustmentApprovalThreshold: number;
  highValueApprovalAmount: number;
  allowNegativeStockDefault: boolean;
}

export interface Customer extends SoftDeleteFields {
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

export interface Supplier extends SoftDeleteFields {
  id: string;
  code: string;
  name: string;
  category: SupplierCategory;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  tin?: string;
  paymentTerms: PaymentTerms;
  notes?: string;
  active: boolean;
  preferred?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Purchase order placed with a supplier (inbound procurement). */
export interface SupplierPurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  status: SupplierPoStatus;
  orderDate: string;
  expectedDate?: string;
  total: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Goods receipt / stock intake linked to a supplier. */
export interface SupplierStockReceipt {
  id: string;
  number: string;
  supplierId: string;
  purchaseOrderId?: string;
  receivedAt: string;
  productId?: string;
  quantity?: number;
  warehouseId?: string;
  notes?: string;
}

/** Outbound payment to a supplier. */
export interface SupplierPayment {
  id: string;
  number: string;
  supplierId: string;
  purchaseOrderId?: string;
  paymentDate: string;
  amount: number;
  method: PaymentMethod;
  notes?: string;
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

export interface CustomerPurchaseOrder extends SoftDeleteFields {
  id: string;
  number: string;
  customerId: string;
  /** Optional customer-side PO / reference number */
  customerPoNumber?: string;
  /** PO-backed vs walk-in / Non-PO */
  orderSource?: "Customer PO" | "Non-PO" | "Phone" | "Email" | "Walk-in" | "Portal" | "Other";
  status: CustomerOrderStatus;
  orderDate: string;
  requiredDate?: string;
  notes?: string;
  confirmedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  /** Set when order exceeded credit and was still confirmed. */
  creditOverrideBy?: string;
  creditOverrideAt?: string;
  creditOverrideReason?: string;
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
  batchId?: string;
  batchCode?: string;
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
  supplier: number;
  supplierPo: number;
  supplierReceipt: number;
  supplierPayment: number;
  invoice: number;
  receipt: number;
  delivery: number;
  payment: number;
  quotation: number;
  stockMovement: number;
  stockIssue: number;
  transfer: number;
  adjustment: number;
  batch: number;
}

/** User-created commercial quotations (unique TLB-QTE numbers). */
export interface Quotation {
  id: string;
  number: string;
  customerId?: string;
  customerName: string;
  contact?: string;
  itemLabel: string;
  qty: number;
  unitPrice: number;
  amount: number;
  paymentTerms: string;
  notes?: string;
  status: "Draft" | "Sent";
  quoteDate: string;
  validUntil: string;
  preparedBy: string;
  createdAt: string;
}

export interface TlbState {
  version: number;
  warehouses: Warehouse[];
  products: Product[];
  stock: StockBalance[];
  batches: BatchLot[];
  stockMovements: StockMovement[];
  goodsReceipts: GoodsReceiptNote[];
  goodsReceiptLines: GoodsReceiptLine[];
  stockIssues: StockIssue[];
  stockIssueLines: StockIssueLine[];
  transfers: WarehouseTransfer[];
  transferLines: WarehouseTransferLine[];
  adjustments: StockAdjustment[];
  adjustmentLines: StockAdjustmentLine[];
  approvals: ApprovalRequest[];
  inventorySettings: InventorySettings;
  customers: Customer[];
  suppliers: Supplier[];
  supplierPurchaseOrders: SupplierPurchaseOrder[];
  supplierReceipts: SupplierStockReceipt[];
  supplierPayments: SupplierPayment[];
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
  quotations: Quotation[];
  notifications: AppNotification[];
  reservations: StockReservation[];
  audit: AuditEvent[];
  counters: DocumentCounters;
  ageing: AgeingSettings;
  company: CompanyProfile;
  vatRates: VatRate[];
  /** Soft-deleted catalog / sandbox list records (still restorable). */
  catalogDeletions: CatalogDeletion[];
  /** Permanently purged catalog ids — never shown again. */
  catalogPurgedIds: string[];
  /** Owner-managed role catalog (system + custom). */
  roles: RoleDefinition[];
  /** Local users with assigned role ids (mock auth → real auth later). */
  users: AppUser[];
  currentUserId: string;
  currentRoleId: string;
  /** Denormalized display name — kept in sync with currentUserId. */
  currentUser: string;
  /** Denormalized role display name — kept in sync with currentRoleId. */
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
  /** due_soon | due_today | overdue | awaiting_stock | normal */
  demandFlag?: "due_soon" | "due_today" | "overdue" | "awaiting_stock" | "normal";
}

export interface SupplyRequestLine {
  orderLineId: string;
  quantity: number;
  /** Optional forced batch; otherwise FEFO/FIFO/LIFO recommends. */
  batchId?: string;
}

export interface RelatedRecord {
  kind:
    | "customer"
    | "order"
    | "supply"
    | "invoice"
    | "receipt"
    | "delivery"
    | "payment"
    | "reservation"
    | "batch"
    | "grn"
    | "transfer"
    | "movement"
    | "supplier"
    | "supplier_po";
  id: string;
  number: string;
  label: string;
  status?: string;
}

export interface TraceNode {
  id: string;
  at: string;
  kind: string;
  title: string;
  detail: string;
  refNav?: string;
  refId?: string;
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
