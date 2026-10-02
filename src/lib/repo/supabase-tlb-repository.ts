/**
 * Hybrid Supabase repository: P0/P1 entities live in Postgres; unmigrated
 * inventory/ops/auth/trash slices stay in localStorage until SQL exists.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { AppUser, Product, RoleDefinition, StockBalance, TlbState } from "@/lib/domain/types";
import { loadState, saveState } from "@/lib/store/tlb-store";
import { createSeedState } from "@/lib/store/seed";
import { lockWorkspaceToOwner } from "@/lib/store/migrate";
import {
  ageingFromSettings,
  auditFromRow,
  auditToRow,
  buildSoftDeleteOverlay,
  companyFromSettings,
  countersFromRow,
  countersToRow,
  customerFromRow,
  customerToRow,
  deliveryFromRow,
  deliveryItemFromRow,
  deliveryItemToRow,
  deliveryToRow,
  invoiceFromRow,
  invoiceLineFromRow,
  invoiceLineToRow,
  invoiceToRow,
  notificationFromRow,
  notificationToRow,
  orderFromRow,
  orderLineFromRow,
  orderLineToRow,
  orderToRow,
  paymentFromRow,
  paymentToRow,
  productFromRow,
  productToRow,
  receiptFromRow,
  receiptLineFromRow,
  receiptLineToRow,
  receiptToRow,
  reservationFromRow,
  reservationToRow,
  stockFromRow,
  stockToRow,
  supplyFromRow,
  supplyLineFromRow,
  supplyLineToRow,
  supplyToRow,
  vatFromRow,
  vatToRow,
  warehouseFromRow,
  warehouseToRow,
  buildDocumentTaxOverlay,
  applyDocumentTaxOverlay,
  type SoftDeleteOverlay,
  type DocumentTaxOverlay,
} from "./mappers";
import { mergeCanonicalBalances, mergeCanonicalMovements } from "./ledger-rpc";
import { mergeStaffUsers, staffUsersForRemoteDirectory } from "../domain/invites";
import { omitPurgedEntities } from "../domain/trash";
import type { TlbRepository } from "./tlb-repository";
import { ensureTaxCatalog } from "../domain/tax";
import type { VatRate } from "../domain/types";

const LOCAL_ONLY_KEY = "tlb.enterprise.local-only.v1";
const PRODUCT_EXTRAS_KEY = "tlb.enterprise.product-extras.v1";
const STOCK_EXTRAS_KEY = "tlb.enterprise.stock-extras.v1";

type Sb = SupabaseClient<Database>;

function mergeById<T extends { id: string }>(primary: T[], secondary: T[]): T[] {
  const ids = new Set(primary.map((e) => e.id));
  return [...primary, ...secondary.filter((e) => !ids.has(e.id))];
}

/** Prefer remote roles but keep local soft-delete tombstones when remote is stale. */
function mergeRolesPreferringSoftDelete(
  remote: RoleDefinition[] | undefined,
  local: RoleDefinition[],
  purged: Set<string>,
): RoleDefinition[] {
  const base = remote?.length ? mergeById(remote, local) : local;
  const localById = new Map(local.map((role) => [role.id, role]));
  return base
    .filter((role) => !purged.has(`role:${role.id}`) && !purged.has(role.id))
    .map((role) => {
      if (role.deletedAt) return role;
      const localRole = localById.get(role.id);
      if (!localRole?.deletedAt) return role;
      return {
        ...role,
        deletedAt: localRole.deletedAt,
        deletedBy: localRole.deletedBy,
        deletedReason: localRole.deletedReason,
        active: false,
      };
    });
}

function authDirectoryFromSettings(value: unknown): {
  users?: AppUser[];
  roles?: RoleDefinition[];
  purgedRoleIds?: string[];
} {
  if (!value || typeof value !== "object") return {};
  const v = value as { users?: unknown; roles?: unknown; purgedRoleIds?: unknown };
  const directory: {
    users?: AppUser[];
    roles?: RoleDefinition[];
    purgedRoleIds?: string[];
  } = {};
  if (Array.isArray(v.users)) directory.users = v.users as AppUser[];
  if (Array.isArray(v.roles)) directory.roles = v.roles as RoleDefinition[];
  if (Array.isArray(v.purgedRoleIds)) {
    directory.purgedRoleIds = v.purgedRoleIds.filter((id): id is string => typeof id === "string");
  }
  return directory;
}

function purgedRoleIdsFromState(state: { catalogPurgedIds?: string[] }): string[] {
  return (state.catalogPurgedIds ?? []).filter((id) => id.startsWith("role-"));
}

type LocalOnlySlice = Pick<
  TlbState,
  | "batches"
  | "stockMovements"
  | "goodsReceipts"
  | "goodsReceiptLines"
  | "stockIssues"
  | "stockIssueLines"
  | "transfers"
  | "transferLines"
  | "adjustments"
  | "adjustmentLines"
  | "approvals"
  | "inventorySettings"
  | "suppliers"
  | "supplierPurchaseOrders"
  | "supplierReceipts"
  | "supplierPayments"
  | "quotations"
  | "customerReturns"
  | "supplierReturns"
  | "nonPoPurchases"
  | "nonPoPurchaseLines"
  | "importShipments"
  | "importShipmentLines"
  | "exportShipments"
  | "exportShipmentLines"
  | "opsRequests"
  | "opsRequestLines"
  | "opsDrivers"
  | "opsMessages"
  | "opsActivity"
  | "opsCustody"
  | "opsDiscrepancies"
  | "opsApprovalRules"
  | "catalogDeletions"
  | "catalogPurgedIds"
  | "roles"
  | "users"
  | "currentUserId"
  | "currentRoleId"
  | "currentUser"
  | "currentRole"
  | "version"
>;

function pickLocalOnly(state: TlbState): LocalOnlySlice {
  return {
    version: state.version,
    batches: state.batches,
    stockMovements: state.stockMovements,
    goodsReceipts: state.goodsReceipts,
    goodsReceiptLines: state.goodsReceiptLines,
    stockIssues: state.stockIssues,
    stockIssueLines: state.stockIssueLines,
    transfers: state.transfers,
    transferLines: state.transferLines,
    adjustments: state.adjustments,
    adjustmentLines: state.adjustmentLines,
    approvals: state.approvals,
    inventorySettings: state.inventorySettings,
    suppliers: state.suppliers,
    supplierPurchaseOrders: state.supplierPurchaseOrders,
    supplierReceipts: state.supplierReceipts,
    supplierPayments: state.supplierPayments,
    quotations: state.quotations,
    customerReturns: state.customerReturns,
    supplierReturns: state.supplierReturns,
    nonPoPurchases: state.nonPoPurchases,
    nonPoPurchaseLines: state.nonPoPurchaseLines,
    importShipments: state.importShipments,
    importShipmentLines: state.importShipmentLines,
    exportShipments: state.exportShipments,
    exportShipmentLines: state.exportShipmentLines,
    opsRequests: state.opsRequests,
    opsRequestLines: state.opsRequestLines,
    opsDrivers: state.opsDrivers,
    opsMessages: state.opsMessages,
    opsActivity: state.opsActivity,
    opsCustody: state.opsCustody,
    opsDiscrepancies: state.opsDiscrepancies,
    opsApprovalRules: state.opsApprovalRules,
    catalogDeletions: state.catalogDeletions,
    catalogPurgedIds: state.catalogPurgedIds,
    roles: state.roles,
    users: state.users,
    currentUserId: state.currentUserId,
    currentRoleId: state.currentRoleId,
    currentUser: state.currentUser,
    currentRole: state.currentRole,
  };
}

/** Browser/network failures (CORS, DNS, paused project, offline) — not PostgREST JSON errors. */
export function isUnreachableRemoteError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (err instanceof TypeError && lower.includes("fetch")) return true;
  return (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("fetch failed") ||
    lower.includes("load failed") ||
    lower.includes("err_name_not_resolved") ||
    lower.includes("err_connection") ||
    lower.includes("err_internet_disconnected") ||
    lower.includes("the internet connection appears to be offline")
  );
}

function rowFingerprint(rows: unknown[]): string {
  return JSON.stringify(rows);
}

let canonicalLedgerWarned = false;

type LooseLedgerQuery = {
  from: (table: string) => {
    select: (columns: string) => Promise<{
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    }>;
  };
};

/** Read canonical balances and movements. Missing views or RLS denials stay local. */
async function readCanonicalLedger(sb: Sb): Promise<{
  movements: Record<string, unknown>[];
  balances: Record<string, unknown>[];
} | null> {
  try {
    const loose = sb as unknown as LooseLedgerQuery;
    const [movements, balances] = await Promise.all([
      loose.from("tlb_inventory_movements").select("*"),
      loose.from("tlb_inventory_balances").select("*"),
    ]);
    if (movements.error || balances.error) {
      if (!canonicalLedgerWarned) {
        canonicalLedgerWarned = true;
        console.warn(
          "[SupabaseTlbRepository] canonical ledger read skipped:",
          movements.error?.message ?? balances.error?.message,
        );
      }
      return null;
    }
    return {
      movements: movements.data ?? [],
      balances: balances.data ?? [],
    };
  } catch (err) {
    if (!canonicalLedgerWarned) {
      canonicalLedgerWarned = true;
      console.warn(
        "[SupabaseTlbRepository] canonical ledger read skipped:",
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}

/** Prefer remote rows; restore ops targeting fields PostgREST schema does not store yet. */
function mergeNotificationsFromLocal(
  remote: TlbState["notifications"],
  local: TlbState["notifications"],
): TlbState["notifications"] {
  const localById = new Map(local.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const merged = remote.map((r) => {
    seen.add(r.id);
    const l = localById.get(r.id);
    if (!l) return r;
    const soft =
      r.deletedAt
        ? {
            deletedAt: r.deletedAt,
            deletedBy: r.deletedBy,
            deletedReason: r.deletedReason,
          }
        : l.deletedAt
          ? {
              deletedAt: l.deletedAt,
              deletedBy: l.deletedBy,
              deletedReason: l.deletedReason,
            }
          : {};
    return {
      ...r,
      ...soft,
      opsRequestId: r.opsRequestId ?? l.opsRequestId,
      targetUserId: r.targetUserId ?? l.targetUserId,
      targetRole: r.targetRole ?? l.targetRole,
      readAt: r.readAt ?? l.readAt,
    };
  });
  for (const l of local) {
    if (!seen.has(l.id)) merged.push(l);
  }
  return merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function loadLocalOnly(): LocalOnlySlice {
  if (typeof window === "undefined") return pickLocalOnly(createSeedState());
  try {
    const raw = window.localStorage.getItem(LOCAL_ONLY_KEY);
    if (raw) return JSON.parse(raw) as LocalOnlySlice;
  } catch {
    /* fall through */
  }
  // Prefer full local snapshot's local-only keys so demos keep inventory context.
  return pickLocalOnly(loadState());
}

function saveLocalOnly(slice: LocalOnlySlice): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_ONLY_KEY, JSON.stringify(slice));
}

function loadProductExtras(): Record<string, Partial<Product>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PRODUCT_EXTRAS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Partial<Product>>) : {};
  } catch {
    return {};
  }
}

function saveProductExtras(products: Product[]): void {
  if (typeof window === "undefined") return;
  const extras: Record<string, Partial<Product>> = {};
  for (const p of products) {
    extras[p.id] = {
      issueStrategy: p.issueStrategy,
      allowNegativeStock: p.allowNegativeStock,
      minQty: p.minQty,
      maxQty: p.maxQty,
      reorderPoint: p.reorderPoint,
      reorderQty: p.reorderQty,
      preferredSupplierId: p.preferredSupplierId,
      leadTimeDays: p.leadTimeDays,
      standardCost: p.standardCost,
    };
  }
  window.localStorage.setItem(PRODUCT_EXTRAS_KEY, JSON.stringify(extras));
}

function loadStockExtras(): Record<string, Partial<StockBalance>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STOCK_EXTRAS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Partial<StockBalance>>) : {};
  } catch {
    return {};
  }
}

function saveStockExtras(stock: StockBalance[]): void {
  if (typeof window === "undefined") return;
  const extras: Record<string, Partial<StockBalance>> = {};
  for (const s of stock) {
    extras[s.id] = {
      damagedQty: s.damagedQty,
      expiredQty: s.expiredQty,
      quarantineQty: s.quarantineQty,
      inTransitQty: s.inTransitQty,
      allocatedQty: s.allocatedQty,
    };
  }
  window.localStorage.setItem(STOCK_EXTRAS_KEY, JSON.stringify(extras));
}

async function fetchAll<T>(sb: Sb, table: keyof Database["public"]["Tables"]): Promise<T[]> {
  const { data, error } = await sb.from(table).select("*");
  if (error) throw new Error(`${String(table)}: ${error.message}`);
  return (data ?? []) as T[];
}

async function upsertRows(
  sb: Sb,
  table: keyof Database["public"]["Tables"],
  rows: Record<string, unknown>[],
): Promise<void> {
  if (!rows.length) return;
  try {
    const { error } = await sb.from(table).upsert(rows as never, { onConflict: "id" });
    if (error) throw new Error(`upsert ${String(table)}: ${error.message}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`upsert ${String(table)}:`)) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`upsert ${String(table)}: ${detail}`);
  }
}

async function deleteMissing(
  sb: Sb,
  table: keyof Database["public"]["Tables"],
  keepIds: string[],
): Promise<void> {
  try {
    const { data, error } = await sb.from(table).select("id");
    if (error) {
      console.warn(`[SupabaseTlbRepository] list ${String(table)}:`, error.message);
      return;
    }
    const remoteIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
    const keep = new Set(keepIds);
    const toDelete = remoteIds.filter((id) => !keep.has(id));
    if (!toDelete.length) return;
    // Chunk deletes to avoid URL limits.
    for (let i = 0; i < toDelete.length; i += 100) {
      const chunk = toDelete.slice(i, i + 100);
      const { error: delErr } = await sb.from(table).delete().in("id", chunk);
      // FK blocks are expected for some parents — purged_entity_ids still hide them on load.
      if (delErr) {
        console.warn(`[SupabaseTlbRepository] delete ${String(table)}:`, delErr.message);
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[SupabaseTlbRepository] deleteMissing ${String(table)}:`, detail);
  }
}

export class SupabaseTlbRepository implements TlbRepository {
  backend = "supabase" as const;
  /**
   * After the first unreachable network failure this session, skip remote upserts
   * so we do not spam audit_events/warehouses while local ops keep working.
   * Never surfaced to the UI — console.warn only.
   */
  private remotePausedForSession = false;
  /** Skip unchanged P0/P1 upserts so ops/local-only mutations do not re-hit warehouses every save. */
  private remoteFingerprints = new Map<string, string>();

  constructor(private readonly sb: Sb) {}

  /** Always null — cloud sync failures are never user-visible. */
  getLastError(): string | null {
    return null;
  }

  private pauseRemoteForSession(reason: string): void {
    if (this.remotePausedForSession) return;
    this.remotePausedForSession = true;
    console.warn("[SupabaseTlbRepository] remote paused for this session (local-only);", reason);
  }

  /** Snapshot current mapped rows as "already synced" so the next save only hits dirty tables. */
  private rememberRemoteFingerprints(state: TlbState): void {
    const set = (table: string, rows: unknown[]) => {
      this.remoteFingerprints.set(table, rows.length ? rowFingerprint(rows) : "[]");
    };
    set("warehouses", state.warehouses.map(warehouseToRow));
    set("products", state.products.map(productToRow));
    set("vat_rates", state.vatRates.map(vatToRow));
    set("customers", state.customers.map(customerToRow));
    set("stock_balances", state.stock.map(stockToRow));
    set("customer_purchase_orders", state.orders.map(orderToRow));
    set("customer_order_lines", state.orderLines.map(orderLineToRow));
    set("supplies", state.supplies.map(supplyToRow));
    set("supply_lines", state.supplyLines.map(supplyLineToRow));
    set("stock_reservations", state.reservations.map(reservationToRow));
    set("invoices", state.invoices.map(invoiceToRow));
    set("invoice_lines", state.invoiceLines.map(invoiceLineToRow));
    set("receipts", state.receipts.map(receiptToRow));
    set("receipt_lines", state.receiptLines.map(receiptLineToRow));
    set("deliveries", state.deliveries.map(deliveryToRow));
    set("delivery_items", state.deliveryItems.map(deliveryItemToRow));
    set("payments", state.payments.map(paymentToRow));
    set("notifications", state.notifications.map(notificationToRow));
    set("audit_events", state.audit.slice(0, 500).map(auditToRow));
    set("document_counters", [countersToRow(state.counters)]);
    const settingsPayload = [
      { key: "outstanding_ageing", value: state.ageing as unknown as Json },
      { key: "company_profile", value: state.company as unknown as Json },
      {
        key: "soft_delete_overlay",
        value: buildSoftDeleteOverlay(state) as unknown as Json,
      },
      {
        key: "purged_entity_ids",
        value: (state.catalogPurgedIds ?? []) as unknown as Json,
      },
      {
        key: "tax_rates",
        value: state.vatRates as unknown as Json,
      },
      {
        key: "document_tax_overlay",
        value: buildDocumentTaxOverlay(state) as unknown as Json,
      },
      {
        key: "auth_directory",
        value: {
          users: staffUsersForRemoteDirectory(state.users),
          roles: state.roles,
          purgedRoleIds: purgedRoleIdsFromState(state),
        } as unknown as Json,
      },
    ];
    this.remoteFingerprints.set("app_settings", rowFingerprint(settingsPayload));
  }

  /** @returns true when rows were written (caller should run deleteMissing for that table). */
  private async upsertIfChanged(
    table: keyof Database["public"]["Tables"],
    rows: Record<string, unknown>[],
  ): Promise<boolean> {
    if (!rows.length) {
      const prev = this.remoteFingerprints.get(String(table));
      this.remoteFingerprints.set(String(table), "[]");
      // Empty local set may still need remote purge when we previously had rows.
      return prev !== undefined && prev !== "[]";
    }
    const fp = rowFingerprint(rows);
    if (this.remoteFingerprints.get(String(table)) === fp) return false;
    await upsertRows(this.sb, table, rows);
    this.remoteFingerprints.set(String(table), fp);
    return true;
  }

  async load(): Promise<TlbState> {
    const localOnly = loadLocalOnly();
    const productExtras = loadProductExtras();
    const stockExtras = loadStockExtras();
    const seed = createSeedState();

    if (this.remotePausedForSession) {
      const fallback = loadState();
      this.rememberRemoteFingerprints(fallback);
      return fallback;
    }

    try {
      const [
        warehouses,
        products,
        stock,
        customers,
        orders,
        orderLines,
        supplies,
        supplyLines,
        audit,
        countersRows,
        settingsRows,
        vatRates,
        invoices,
        invoiceLines,
        receipts,
        receiptLines,
        deliveries,
        deliveryItems,
        payments,
        notifications,
        reservations,
      ] = await Promise.all([
        fetchAll<Database["public"]["Tables"]["warehouses"]["Row"]>(this.sb, "warehouses"),
        fetchAll<Database["public"]["Tables"]["products"]["Row"]>(this.sb, "products"),
        fetchAll<Database["public"]["Tables"]["stock_balances"]["Row"]>(this.sb, "stock_balances"),
        fetchAll<Database["public"]["Tables"]["customers"]["Row"]>(this.sb, "customers"),
        fetchAll<Database["public"]["Tables"]["customer_purchase_orders"]["Row"]>(
          this.sb,
          "customer_purchase_orders",
        ),
        fetchAll<Database["public"]["Tables"]["customer_order_lines"]["Row"]>(
          this.sb,
          "customer_order_lines",
        ),
        fetchAll<Database["public"]["Tables"]["supplies"]["Row"]>(this.sb, "supplies"),
        fetchAll<Database["public"]["Tables"]["supply_lines"]["Row"]>(this.sb, "supply_lines"),
        fetchAll<Database["public"]["Tables"]["audit_events"]["Row"]>(this.sb, "audit_events"),
        fetchAll<Database["public"]["Tables"]["document_counters"]["Row"]>(
          this.sb,
          "document_counters",
        ),
        fetchAll<Database["public"]["Tables"]["app_settings"]["Row"]>(this.sb, "app_settings"),
        fetchAll<Database["public"]["Tables"]["vat_rates"]["Row"]>(this.sb, "vat_rates"),
        fetchAll<Database["public"]["Tables"]["invoices"]["Row"]>(this.sb, "invoices"),
        fetchAll<Database["public"]["Tables"]["invoice_lines"]["Row"]>(this.sb, "invoice_lines"),
        fetchAll<Database["public"]["Tables"]["receipts"]["Row"]>(this.sb, "receipts"),
        fetchAll<Database["public"]["Tables"]["receipt_lines"]["Row"]>(this.sb, "receipt_lines"),
        fetchAll<Database["public"]["Tables"]["deliveries"]["Row"]>(this.sb, "deliveries"),
        fetchAll<Database["public"]["Tables"]["delivery_items"]["Row"]>(this.sb, "delivery_items"),
        fetchAll<Database["public"]["Tables"]["payments"]["Row"]>(this.sb, "payments"),
        fetchAll<Database["public"]["Tables"]["notifications"]["Row"]>(this.sb, "notifications"),
        fetchAll<Database["public"]["Tables"]["stock_reservations"]["Row"]>(
          this.sb,
          "stock_reservations",
        ),
      ]);

      const remoteEmpty =
        warehouses.length === 0 && products.length === 0 && customers.length === 0;

      if (remoteEmpty) {
        // Bootstrap once from seed — does not truncate; only runs when tables are empty.
        const boot = { ...seed, ...localOnly, version: Math.max(seed.version, localOnly.version) };
        lockWorkspaceToOwner(boot);
        await this.save(boot);
        return boot;
      }

      const settingsMap = new Map(settingsRows.map((s) => [s.key, s.value]));
      const ageing = ageingFromSettings(settingsMap.get("outstanding_ageing"), seed.ageing);
      const company = companyFromSettings(settingsMap.get("company_profile"), seed.company);
      const softOverlay = (settingsMap.get("soft_delete_overlay") ?? {}) as SoftDeleteOverlay;
      const taxRatesSetting = settingsMap.get("tax_rates");
      const taxOverlay = (settingsMap.get("document_tax_overlay") ?? {}) as DocumentTaxOverlay;
      const authDir = authDirectoryFromSettings(settingsMap.get("auth_directory"));
      const remotePurged = Array.isArray(settingsMap.get("purged_entity_ids"))
        ? (settingsMap.get("purged_entity_ids") as string[])
        : [];
      const purged = new Set<string>([
        ...(localOnly.catalogPurgedIds ?? []),
        ...remotePurged,
        ...(authDir.purgedRoleIds ?? []),
      ]);
      const mergedUsers = mergeStaffUsers(authDir.users, localOnly.users, purged);
      const mergedRoles = mergeRolesPreferringSoftDelete(authDir.roles, localOnly.roles, purged);

      const prior = loadState();
      const ledger = await readCanonicalLedger(this.sb);
      const prototypeStock = stock.map((row) => stockFromRow(row, stockExtras[row.id]));
      const baseCustomers = omitPurgedEntities(
        customers.map((row) => customerFromRow(row, softOverlay)),
        "customer",
        purged,
      );
      const baseInvoices = omitPurgedEntities(
        invoices.map((row) => invoiceFromRow(row, softOverlay)),
        "invoice",
        purged,
      );
      const withTax = applyDocumentTaxOverlay(baseCustomers, baseInvoices, taxOverlay);
      const remoteVat = vatRates.length ? vatRates.map(vatFromRow) : [];
      const settingVat = Array.isArray(taxRatesSetting)
        ? (taxRatesSetting as unknown as VatRate[])
        : undefined;
      const mergedVatRates = ensureTaxCatalog(settingVat?.length ? settingVat : remoteVat);

      const localOnlyFiltered: LocalOnlySlice = {
        ...localOnly,
        catalogPurgedIds: [...purged],
        users: mergedUsers,
        roles: mergedRoles,
        suppliers: omitPurgedEntities(localOnly.suppliers, "supplier", purged),
        quotations: omitPurgedEntities(localOnly.quotations ?? [], "quotation", purged),
        customerReturns: omitPurgedEntities(localOnly.customerReturns ?? [], "customer_return", purged),
        supplierReturns: omitPurgedEntities(localOnly.supplierReturns ?? [], "supplier_return", purged),
        nonPoPurchases: omitPurgedEntities(localOnly.nonPoPurchases ?? [], "non_po_purchase", purged),
        importShipments: omitPurgedEntities(localOnly.importShipments ?? [], "import_shipment", purged),
        exportShipments: omitPurgedEntities(localOnly.exportShipments ?? [], "export_shipment", purged),
        opsDrivers: omitPurgedEntities(localOnly.opsDrivers ?? [], "ops_driver", purged),
        opsRequests: omitPurgedEntities(localOnly.opsRequests ?? [], "ops_request", purged),
        opsDiscrepancies: omitPurgedEntities(localOnly.opsDiscrepancies ?? [], "ops_discrepancy", purged),
        opsMessages: omitPurgedEntities(localOnly.opsMessages ?? [], "ops_message", purged),
        goodsReceipts: omitPurgedEntities(localOnly.goodsReceipts ?? [], "goods_receipt", purged),
        stockIssues: omitPurgedEntities(localOnly.stockIssues ?? [], "stock_issue", purged),
        transfers: omitPurgedEntities(localOnly.transfers ?? [], "transfer", purged),
        adjustments: omitPurgedEntities(localOnly.adjustments ?? [], "adjustment", purged),
        batches: omitPurgedEntities(localOnly.batches ?? [], "batch", purged),
        supplierPurchaseOrders: omitPurgedEntities(
          localOnly.supplierPurchaseOrders ?? [],
          "supplier_po",
          purged,
        ),
        supplierReceipts: omitPurgedEntities(localOnly.supplierReceipts ?? [], "supplier_receipt", purged),
        supplierPayments: omitPurgedEntities(localOnly.supplierPayments ?? [], "supplier_payment", purged),
        approvals: omitPurgedEntities(localOnly.approvals ?? [], "approval", purged),
      };

      const merged: TlbState = {
        ...seed,
        ...localOnlyFiltered,
        users: mergedUsers,
        roles: mergedRoles,
        warehouses: omitPurgedEntities(
          warehouses.map((row) => warehouseFromRow(row, softOverlay)),
          "warehouse",
          purged,
        ),
        products: omitPurgedEntities(
          products.map((row) => productFromRow(row, productExtras[row.id], softOverlay)),
          "product",
          purged,
        ),
        stock: ledger ? mergeCanonicalBalances(prototypeStock, ledger.balances) : prototypeStock,
        stockMovements: ledger
          ? mergeCanonicalMovements(localOnly.stockMovements, ledger.movements)
          : localOnly.stockMovements,
        customers: withTax.customers,
        orders: omitPurgedEntities(
          orders.map((row) => orderFromRow(row, softOverlay)),
          "order",
          purged,
        ),
        orderLines: orderLines.map(orderLineFromRow),
        supplies: omitPurgedEntities(
          supplies.map((row) => supplyFromRow(row, softOverlay)),
          "supply",
          purged,
        ),
        supplyLines: supplyLines.map(supplyLineFromRow),
        audit: audit.map(auditFromRow).sort((a, b) => (a.at < b.at ? 1 : -1)),
        counters: {
          ...prior.counters,
          ...countersFromRow(countersRows[0] ?? null, prior.counters),
        },
        ageing,
        company,
        vatRates: mergedVatRates,
        invoices: withTax.invoices,
        invoiceLines: invoiceLines.map(invoiceLineFromRow),
        receipts: omitPurgedEntities(
          receipts.map((row) => receiptFromRow(row, softOverlay)),
          "receipt",
          purged,
        ),
        receiptLines: receiptLines.map(receiptLineFromRow),
        deliveries: omitPurgedEntities(
          deliveries.map((row) => deliveryFromRow(row, softOverlay)),
          "delivery",
          purged,
        ),
        deliveryItems: deliveryItems.map(deliveryItemFromRow),
        payments: omitPurgedEntities(
          payments.map((row) => paymentFromRow(row, softOverlay)),
          "payment",
          purged,
        ),
        notifications: omitPurgedEntities(
          mergeNotificationsFromLocal(
            notifications.map((row) => notificationFromRow(row, softOverlay)),
            prior.notifications,
          ),
          "notification",
          purged,
        ),
        reservations: reservations.map(reservationFromRow),
        catalogPurgedIds: [...purged],
      };

      // After a successful remote load, treat current rows as synced so inbox/ops
      // mutations do not re-upsert warehouses (and other unchanged P0 tables).
      const roleSnapshot = JSON.stringify({
        roles: merged.roles.map((role) => role.id).sort(),
        users: merged.users.map((user) => [user.id, user.roleId, user.active, user.name, user.email]),
        currentRoleId: merged.currentRoleId,
        currentUserId: merged.currentUserId,
        currentRole: merged.currentRole,
        currentUser: merged.currentUser,
      });
      this.rememberRemoteFingerprints(merged);
      lockWorkspaceToOwner(merged);
      const roleSnapshotAfter = JSON.stringify({
        roles: merged.roles.map((role) => role.id).sort(),
        users: merged.users.map((user) => [user.id, user.roleId, user.active, user.name, user.email]),
        currentRoleId: merged.currentRoleId,
        currentUserId: merged.currentUserId,
        currentRole: merged.currentRole,
        currentUser: merged.currentUser,
      });
      if (roleSnapshot !== roleSnapshotAfter) {
        try {
          await this.save(merged);
        } catch (persistErr) {
          console.warn(
            "[SupabaseTlbRepository] could not persist the role catalog:",
            persistErr,
          );
        }
      }
      return merged;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const unreachable =
        isUnreachableRemoteError(err) || isUnreachableRemoteError(new Error(message));
      if (unreachable) this.pauseRemoteForSession(message);
      console.warn("[SupabaseTlbRepository] load failed, using local fallback:", message);
      const fallback = loadState();
      // Avoid treating every local-only mutation as a full P0 resync when remote is down.
      this.rememberRemoteFingerprints(fallback);
      return fallback;
    }
  }

  async save(state: TlbState): Promise<void> {
    // Yield so Assign/Re-issue can paint the invitation panel before a large
    // localStorage JSON.stringify freezes the main thread.
    await Promise.resolve();

    saveLocalOnly(pickLocalOnly(state));
    saveProductExtras(state.products);
    saveStockExtras(state.stock);
    // Keep a local full snapshot as offline safety net (not the source of truth for P0/P1).
    saveState(state);

    // Network already failed this session — stay fully local; no remote spam, no UI error.
    if (this.remotePausedForSession) return;

    try {
      // Parent → child order for FK safety. Skip tables unchanged since last successful sync/load.
      await this.upsertIfChanged("warehouses", state.warehouses.map(warehouseToRow));
      await this.upsertIfChanged("products", state.products.map(productToRow));
      await this.upsertIfChanged("vat_rates", state.vatRates.map(vatToRow));
      await this.upsertIfChanged("customers", state.customers.map(customerToRow));
      await this.upsertIfChanged("stock_balances", state.stock.map(stockToRow));
      await this.upsertIfChanged("customer_purchase_orders", state.orders.map(orderToRow));
      await this.upsertIfChanged("customer_order_lines", state.orderLines.map(orderLineToRow));
      await this.upsertIfChanged("supplies", state.supplies.map(supplyToRow));
      await this.upsertIfChanged("supply_lines", state.supplyLines.map(supplyLineToRow));
      await this.upsertIfChanged("stock_reservations", state.reservations.map(reservationToRow));
      await this.upsertIfChanged("invoices", state.invoices.map(invoiceToRow));
      await this.upsertIfChanged("invoice_lines", state.invoiceLines.map(invoiceLineToRow));
      await this.upsertIfChanged("receipts", state.receipts.map(receiptToRow));
      await this.upsertIfChanged("receipt_lines", state.receiptLines.map(receiptLineToRow));
      await this.upsertIfChanged("deliveries", state.deliveries.map(deliveryToRow));
      await this.upsertIfChanged("delivery_items", state.deliveryItems.map(deliveryItemToRow));
      await this.upsertIfChanged("payments", state.payments.map(paymentToRow));
      await this.upsertIfChanged("notifications", state.notifications.map(notificationToRow));
      // Audit is append-friendly; upsert by id keeps history stable.
      await this.upsertIfChanged("audit_events", state.audit.slice(0, 500).map(auditToRow));
      await this.upsertIfChanged("document_counters", [countersToRow(state.counters)]);

      const settingsPayload: Database["public"]["Tables"]["app_settings"]["Insert"][] = [
        { key: "outstanding_ageing", value: state.ageing as unknown as Json },
        { key: "company_profile", value: state.company as unknown as Json },
        {
          key: "soft_delete_overlay",
          value: buildSoftDeleteOverlay(state) as unknown as Json,
        },
        {
          key: "purged_entity_ids",
          value: (state.catalogPurgedIds ?? []) as unknown as Json,
        },
        {
          key: "tax_rates",
          value: state.vatRates as unknown as Json,
        },
        {
          key: "document_tax_overlay",
          value: buildDocumentTaxOverlay(state) as unknown as Json,
        },
        {
          key: "auth_directory",
          value: {
            users: staffUsersForRemoteDirectory(state.users),
            roles: state.roles,
            purgedRoleIds: purgedRoleIdsFromState(state),
          } as unknown as Json,
        },
      ];
      const settingsFp = rowFingerprint(settingsPayload);
      if (this.remoteFingerprints.get("app_settings") !== settingsFp) {
        const { error: settingsErr } = await this.sb.from("app_settings").upsert(settingsPayload, {
          onConflict: "key",
        });
        if (settingsErr) throw new Error(`upsert app_settings: ${settingsErr.message}`);
        this.remoteFingerprints.set("app_settings", settingsFp);
      }

      // Always reconcile remote deletes so permanent purge sticks even when
      // FK blocks leave orphan rows (purged_entity_ids still hide them on load).
      // Child → parent order for FK safety.
      await deleteMissing(
        this.sb,
        "delivery_items",
        state.deliveryItems.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "invoice_lines",
        state.invoiceLines.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "receipt_lines",
        state.receiptLines.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "supply_lines",
        state.supplyLines.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "customer_order_lines",
        state.orderLines.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "stock_reservations",
        state.reservations.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "notifications",
        state.notifications.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "payments",
        state.payments.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "deliveries",
        state.deliveries.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "receipts",
        state.receipts.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "invoices",
        state.invoices.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "supplies",
        state.supplies.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "customer_purchase_orders",
        state.orders.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "stock_balances",
        state.stock.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "customers",
        state.customers.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "vat_rates",
        state.vatRates.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "products",
        state.products.map((r) => r.id),
      );
      await deleteMissing(
        this.sb,
        "warehouses",
        state.warehouses.map((r) => r.id),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const unreachable =
        isUnreachableRemoteError(err) || isUnreachableRemoteError(new Error(message));
      // Local snapshot already committed — never block UI or show cloud sync banners.
      if (unreachable) {
        this.pauseRemoteForSession(message);
      }
      console.warn("[SupabaseTlbRepository] save failed (local snapshot kept):", message);
    }
  }
}
