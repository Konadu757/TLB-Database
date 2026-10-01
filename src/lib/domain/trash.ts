import type {
  CatalogDeletion,
  SoftDeleteFields,
  TlbState,
  TrashEntityType,
  TrashListItem,
} from "./types";
import { findCatalogRecord } from "./list-catalog";

/** Soft-delete confirmation phrase (case-insensitive). */
export const TRASH_CONFIRM_PHRASE = "DELETE";

/** Permanent purge confirmation phrase (case-insensitive). Distinct from DELETE. */
export const PURGE_CONFIRM_PHRASE = "PERMANENT";

/** Restore confirmation phrase (case-insensitive). Distinct from DELETE and PERMANENT. */
export const RESTORE_CONFIRM_PHRASE = "RESTORE";

export function isSoftDeleted(item: SoftDeleteFields | null | undefined): boolean {
  return Boolean(item?.deletedAt);
}

export function notSoftDeleted<T extends SoftDeleteFields>(items: T[]): T[] {
  return items.filter((item) => !isSoftDeleted(item));
}

export function catalogDeletionSet(state: Pick<TlbState, "catalogDeletions">): Set<string> {
  return new Set(state.catalogDeletions.map((d) => d.catalogId));
}

export function catalogPurgedSet(state: Pick<TlbState, "catalogPurgedIds">): Set<string> {
  return new Set(state.catalogPurgedIds);
}

/** Stable tombstone key so permanent deletes survive cloud hydrate / FK-blocked remote deletes. */
export function purgedEntityKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

export function isEntityPurged(
  entityType: string,
  entityId: string,
  purged: Iterable<string> | null | undefined,
): boolean {
  if (!purged) return false;
  const set = purged instanceof Set ? purged : new Set(purged);
  return set.has(purgedEntityKey(entityType, entityId)) || set.has(entityId);
}

export function omitPurgedEntities<T extends { id: string }>(
  rows: T[],
  entityType: string,
  purged: Iterable<string> | null | undefined,
): T[] {
  if (!purged) return rows;
  const set = purged instanceof Set ? purged : new Set(purged);
  if (!set.size) return rows;
  return rows.filter((row) => !isEntityPurged(entityType, row.id, set));
}

export function isCatalogHidden(
  catalogId: string,
  state: Pick<TlbState, "catalogDeletions" | "catalogPurgedIds">,
): boolean {
  return catalogDeletionSet(state).has(catalogId) || catalogPurgedSet(state).has(catalogId);
}

export function trashTypeLabel(entityType: TrashEntityType, module?: string): string {
  switch (entityType) {
    case "customer":
      return "Customer";
    case "supplier":
      return "Supplier";
    case "product":
      return "Product";
    case "warehouse":
      return "Warehouse";
    case "order":
      return "Sales Order";
    case "catalog":
      return module ?? "Catalog";
    case "customer_return":
      return "Customer Return";
    case "supplier_return":
      return "Supplier Return";
    case "non_po_purchase":
      return "Non-PO Purchase";
    case "import_shipment":
      return "Import Shipment";
    case "export_shipment":
      return "Export Shipment";
    case "ops_request":
      return "Ops Request";
    case "ops_driver":
      return "Driver";
    case "ops_discrepancy":
      return "Ops Discrepancy";
    case "ops_message":
      return "Ops Message";
    case "quotation":
      return "Quotation";
    case "invoice":
      return "Invoice";
    case "receipt":
      return "Receipt";
    case "payment":
      return "Payment";
    case "delivery":
      return "Delivery";
    case "goods_receipt":
      return "Goods Receipt";
    case "stock_issue":
      return "Stock Issue";
    case "transfer":
      return "Transfer";
    case "adjustment":
      return "Adjustment";
    case "batch":
      return "Batch";
    case "stock_movement":
      return "Stock Movement";
    case "supply":
      return "Supply";
    case "supplier_po":
      return "Supplier PO";
    case "supplier_receipt":
      return "Supplier Receipt";
    case "supplier_payment":
      return "Supplier Payment";
    case "approval":
      return "Approval";
    case "notification":
      return "Notification";
    case "role":
      return "Role";
    case "user":
      return "Role assignment";
    default:
      return entityType;
  }
}

function pushTrash(
  items: TrashListItem[],
  entityType: TrashEntityType,
  entityId: string,
  label: string,
  meta: SoftDeleteFields,
  subtitle?: string,
): void {
  if (!meta.deletedAt) return;
  items.push({
    id: `${entityType}:${entityId}`,
    entityType,
    entityId,
    typeLabel: trashTypeLabel(entityType),
    label,
    ...(subtitle ? { subtitle } : {}),
    deletedAt: meta.deletedAt,
    deletedBy: meta.deletedBy ?? "—",
    ...(meta.deletedReason ? { deletedReason: meta.deletedReason } : {}),
  });
}

export function listTrashItems(state: TlbState): TrashListItem[] {
  const items: TrashListItem[] = [];

  for (const c of state.customers) {
    pushTrash(items, "customer", c.id, `${c.code} · ${c.name}`, c, c.category);
  }
  for (const s of state.suppliers) {
    pushTrash(items, "supplier", s.id, `${s.code} · ${s.name}`, s, s.category);
  }
  for (const p of state.products) {
    pushTrash(items, "product", p.id, `${p.sku} · ${p.name}`, p, p.category);
  }
  for (const w of state.warehouses) {
    pushTrash(items, "warehouse", w.id, `${w.code} · ${w.name}`, w, w.location);
  }
  for (const o of state.orders) {
    const customer = state.customers.find((c) => c.id === o.customerId);
    pushTrash(items, "order", o.id, o.number, o, customer?.name ?? o.status);
  }
  for (const r of state.customerReturns ?? []) {
    pushTrash(items, "customer_return", r.id, r.number, r, r.disposition);
  }
  for (const r of state.supplierReturns ?? []) {
    pushTrash(items, "supplier_return", r.id, r.number, r, r.status);
  }
  for (const n of state.nonPoPurchases ?? []) {
    pushTrash(items, "non_po_purchase", n.id, n.number, n, n.reason);
  }
  for (const s of state.importShipments ?? []) {
    pushTrash(items, "import_shipment", s.id, s.number, s, s.originCountry);
  }
  for (const s of state.exportShipments ?? []) {
    pushTrash(items, "export_shipment", s.id, s.number, s, s.destinationCountry);
  }
  for (const d of state.opsDrivers ?? []) {
    pushTrash(items, "ops_driver", d.id, `${d.code} · ${d.name}`, d, d.vehicle ?? d.phone);
  }
  for (const r of state.opsRequests ?? []) {
    pushTrash(items, "ops_request", r.id, r.number, r, `${r.title} · ${r.status}`);
  }
  for (const d of state.opsDiscrepancies ?? []) {
    pushTrash(items, "ops_discrepancy", d.id, `${d.kind} × ${d.quantity}`, d, d.requestId);
  }
  for (const m of state.opsMessages ?? []) {
    pushTrash(items, "ops_message", m.id, m.body.slice(0, 60) || m.id, m, m.actor);
  }
  for (const q of state.quotations ?? []) {
    pushTrash(items, "quotation", q.id, q.number, q, q.customerName);
  }
  for (const i of state.invoices) {
    pushTrash(items, "invoice", i.id, i.number, i, i.paymentStatus);
  }
  for (const r of state.receipts) {
    pushTrash(items, "receipt", r.id, r.number, r, r.paymentMethod);
  }
  for (const p of state.payments) {
    pushTrash(items, "payment", p.id, p.number, p, p.method);
  }
  for (const d of state.deliveries) {
    pushTrash(items, "delivery", d.id, d.number, d, d.status);
  }
  for (const g of state.goodsReceipts ?? []) {
    pushTrash(items, "goods_receipt", g.id, g.number, g, g.status);
  }
  for (const g of state.stockIssues ?? []) {
    pushTrash(items, "stock_issue", g.id, g.number, g, g.reason);
  }
  for (const t of state.transfers ?? []) {
    pushTrash(items, "transfer", t.id, t.number, t, t.status);
  }
  for (const a of state.adjustments ?? []) {
    pushTrash(items, "adjustment", a.id, a.number, a, a.status);
  }
  for (const b of state.batches ?? []) {
    pushTrash(items, "batch", b.id, b.code, b, b.status);
  }
  for (const m of state.stockMovements ?? []) {
    pushTrash(items, "stock_movement", m.id, m.number, m, m.type);
  }
  for (const s of state.supplies) {
    pushTrash(items, "supply", s.id, s.number, s, s.suppliedBy);
  }
  for (const p of state.supplierPurchaseOrders ?? []) {
    pushTrash(items, "supplier_po", p.id, p.number, p, p.status);
  }
  for (const r of state.supplierReceipts ?? []) {
    pushTrash(items, "supplier_receipt", r.id, r.number, r);
  }
  for (const p of state.supplierPayments ?? []) {
    pushTrash(items, "supplier_payment", p.id, p.number, p, String(p.amount));
  }
  for (const a of state.approvals ?? []) {
    pushTrash(items, "approval", a.id, a.title, a, a.status);
  }
  for (const n of state.notifications) {
    pushTrash(items, "notification", n.id, n.title, n, n.type);
  }
  for (const user of state.users) {
    const roleName = state.roles.find((role) => role.id === user.roleId)?.name;
    pushTrash(items, "user", user.id, user.name, user, roleName ?? user.email);
  }
  for (const role of state.roles) {
    if (role.systemKey === "Owner") continue;
    pushTrash(
      items,
      "role",
      role.id,
      role.name,
      role,
      role.systemKey ? "System role" : "Custom role",
    );
  }

  for (const d of state.catalogDeletions) {
    items.push({
      id: `catalog:${d.catalogId}`,
      entityType: "catalog",
      entityId: d.catalogId,
      typeLabel: d.module,
      label: d.label,
      ...(d.subtitle ? { subtitle: d.subtitle } : {}),
      deletedAt: d.deletedAt,
      deletedBy: d.deletedBy,
      ...(d.deletedReason ? { deletedReason: d.deletedReason } : {}),
      module: d.module,
    });
  }

  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export function buildCatalogDeletion(
  catalogId: string,
  actor: string,
  reason?: string,
  userQuotations?: TlbState["quotations"],
): CatalogDeletion | null {
  const record = findCatalogRecord(catalogId, userQuotations);
  if (!record) return null;
  return {
    catalogId: record.id,
    module: record.module,
    label: record.primary,
    subtitle: record.secondary,
    deletedAt: new Date().toISOString(),
    deletedBy: actor,
    ...(reason?.trim() ? { deletedReason: reason.trim() } : {}),
  };
}
