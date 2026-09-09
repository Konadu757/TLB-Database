/** Domain models for TLB customer orders & partial supply (Supabase-ready). */

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
  | "stock.released";

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
}

export interface DocumentCounters {
  order: number;
  supply: number;
  customer: number;
}

export interface TlbState {
  version: 1;
  warehouses: Warehouse[];
  products: Product[];
  stock: StockBalance[];
  customers: Customer[];
  orders: CustomerPurchaseOrder[];
  orderLines: CustomerOrderLine[];
  supplies: SupplyHeader[];
  supplyLines: SupplyLine[];
  audit: AuditEvent[];
  counters: DocumentCounters;
  ageing: AgeingSettings;
  currentUser: string;
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
  ageDays: number;
  ageingBand: AgeingBand;
  unitPrice: number;
}

export interface SupplyRequestLine {
  orderLineId: string;
  quantity: number;
}

export type StoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
