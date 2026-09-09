import type {
  CatalogDeletion,
  SoftDeleteFields,
  TlbState,
  TrashEntityType,
  TrashListItem,
} from "./types";
import { findCatalogRecord } from "./list-catalog";

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
    default:
      return entityType;
  }
}

export function listTrashItems(state: TlbState): TrashListItem[] {
  const items: TrashListItem[] = [];

  for (const c of state.customers) {
    if (!c.deletedAt) continue;
    items.push({
      id: `customer:${c.id}`,
      entityType: "customer",
      entityId: c.id,
      typeLabel: "Customer",
      label: `${c.code} · ${c.name}`,
      subtitle: c.category,
      deletedAt: c.deletedAt,
      deletedBy: c.deletedBy ?? "—",
      ...(c.deletedReason ? { deletedReason: c.deletedReason } : {}),
    });
  }

  for (const s of state.suppliers) {
    if (!s.deletedAt) continue;
    items.push({
      id: `supplier:${s.id}`,
      entityType: "supplier",
      entityId: s.id,
      typeLabel: "Supplier",
      label: `${s.code} · ${s.name}`,
      subtitle: s.category,
      deletedAt: s.deletedAt,
      deletedBy: s.deletedBy ?? "—",
      ...(s.deletedReason ? { deletedReason: s.deletedReason } : {}),
    });
  }

  for (const p of state.products) {
    if (!p.deletedAt) continue;
    items.push({
      id: `product:${p.id}`,
      entityType: "product",
      entityId: p.id,
      typeLabel: "Product",
      label: `${p.sku} · ${p.name}`,
      subtitle: p.category,
      deletedAt: p.deletedAt,
      deletedBy: p.deletedBy ?? "—",
      ...(p.deletedReason ? { deletedReason: p.deletedReason } : {}),
    });
  }

  for (const w of state.warehouses) {
    if (!w.deletedAt) continue;
    items.push({
      id: `warehouse:${w.id}`,
      entityType: "warehouse",
      entityId: w.id,
      typeLabel: "Warehouse",
      label: `${w.code} · ${w.name}`,
      subtitle: w.location,
      deletedAt: w.deletedAt,
      deletedBy: w.deletedBy ?? "—",
      ...(w.deletedReason ? { deletedReason: w.deletedReason } : {}),
    });
  }

  for (const o of state.orders) {
    if (!o.deletedAt) continue;
    const customer = state.customers.find((c) => c.id === o.customerId);
    items.push({
      id: `order:${o.id}`,
      entityType: "order",
      entityId: o.id,
      typeLabel: "Sales Order",
      label: o.number,
      subtitle: customer?.name ?? o.status,
      deletedAt: o.deletedAt,
      deletedBy: o.deletedBy ?? "—",
      ...(o.deletedReason ? { deletedReason: o.deletedReason } : {}),
    });
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
