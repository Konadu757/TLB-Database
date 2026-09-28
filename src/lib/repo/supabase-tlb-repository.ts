/**
 * Hybrid Supabase repository: P0/P1 entities live in Postgres; unmigrated
 * inventory/ops/auth/trash slices stay in localStorage until SQL exists.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { AppUser, Product, RoleDefinition, StockBalance, TlbState } from "@/lib/domain/types";
import { loadState, saveState } from "@/lib/store/tlb-store";
import { createSeedState } from "@/lib/store/seed";
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
  type SoftDeleteOverlay,
} from "./mappers";
import { mergeCanonicalBalances, mergeCanonicalMovements } from "./ledger-rpc";
import { mergeStaffUsers, staffUsersForRemoteDirectory } from "../domain/invites";
import type { TlbRepository } from "./tlb-repository";

const LOCAL_ONLY_KEY = "tlb.enterprise.local-only.v1";
const PRODUCT_EXTRAS_KEY = "tlb.enterprise.product-extras.v1";
const STOCK_EXTRAS_KEY = "tlb.enterprise.stock-extras.v1";

type Sb = SupabaseClient<Database>;

function mergeById<T extends { id: string }>(primary: T[], secondary: T[]): T[] {
  const ids = new Set(primary.map((e) => e.id));
  return [...primary, ...secondary.filter((e) => !ids.has(e.id))];
}

function authDirectoryFromSettings(value: unknown): {
  users?: AppUser[];
  roles?: RoleDefinition[];
} {
  if (!value || typeof value !== "object") return {};
  const v = value as { users?: unknown; roles?: unknown };
  return {
    users: Array.isArray(v.users) ? (v.users as AppUser[]) : undefined,
    roles: Array.isArray(v.roles) ? (v.roles as RoleDefinition[]) : undefined,
  };
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
    return {
      ...r,
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
    if (error) throw new Error(`list ${String(table)}: ${error.message}`);
    const remoteIds = ((data ?? []) as { id: string }[]).map((r) => r.id);
    const keep = new Set(keepIds);
    const toDelete = remoteIds.filter((id) => !keep.has(id));
    if (!toDelete.length) return;
    // Chunk deletes to avoid URL limits.
    for (let i = 0; i < toDelete.length; i += 100) {
      const chunk = toDelete.slice(i, i + 100);
      const { error: delErr } = await sb.from(table).delete().in("id", chunk);
      if (delErr) throw new Error(`delete ${String(table)}: ${delErr.message}`);
    }
  } catch (err) {
    if (err instanceof Error && /^(list|delete) /.test(err.message)) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`list ${String(table)}: ${detail}`);
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
        key: "auth_directory",
        value: {
          users: staffUsersForRemoteDirectory(state.users),
          roles: state.roles,
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
        await this.save(boot);
        return boot;
      }

      const settingsMap = new Map(settingsRows.map((s) => [s.key, s.value]));
      const ageing = ageingFromSettings(settingsMap.get("outstanding_ageing"), seed.ageing);
      const company = companyFromSettings(settingsMap.get("company_profile"), seed.company);
      const softOverlay = (settingsMap.get("soft_delete_overlay") ?? {}) as SoftDeleteOverlay;
      const authDir = authDirectoryFromSettings(settingsMap.get("auth_directory"));
      const mergedUsers = mergeStaffUsers(authDir.users, localOnly.users);
      const mergedRoles = authDir.roles?.length
        ? mergeById(authDir.roles, localOnly.roles)
        : localOnly.roles;

      const prior = loadState();
      const ledger = await readCanonicalLedger(this.sb);
      const prototypeStock = stock.map((row) => stockFromRow(row, stockExtras[row.id]));
      const merged: TlbState = {
        ...seed,
        ...localOnly,
        users: mergedUsers,
        roles: mergedRoles,
        warehouses: warehouses.map((row) => warehouseFromRow(row, softOverlay)),
        products: products.map((row) => productFromRow(row, productExtras[row.id], softOverlay)),
        stock: ledger ? mergeCanonicalBalances(prototypeStock, ledger.balances) : prototypeStock,
        stockMovements: ledger
          ? mergeCanonicalMovements(localOnly.stockMovements, ledger.movements)
          : localOnly.stockMovements,
        customers: customers.map((row) => customerFromRow(row, softOverlay)),
        orders: orders.map((row) => orderFromRow(row, softOverlay)),
        orderLines: orderLines.map(orderLineFromRow),
        supplies: supplies.map(supplyFromRow),
        supplyLines: supplyLines.map(supplyLineFromRow),
        audit: audit.map(auditFromRow).sort((a, b) => (a.at < b.at ? 1 : -1)),
        counters: {
          ...prior.counters,
          ...countersFromRow(countersRows[0] ?? null, prior.counters),
        },
        ageing,
        company,
        vatRates: vatRates.length ? vatRates.map(vatFromRow) : seed.vatRates,
        invoices: invoices.map(invoiceFromRow),
        invoiceLines: invoiceLines.map(invoiceLineFromRow),
        receipts: receipts.map(receiptFromRow),
        receiptLines: receiptLines.map(receiptLineFromRow),
        deliveries: deliveries.map(deliveryFromRow),
        deliveryItems: deliveryItems.map(deliveryItemFromRow),
        payments: payments.map(paymentFromRow),
        notifications: mergeNotificationsFromLocal(
          notifications.map(notificationFromRow),
          prior.notifications,
        ),
        reservations: reservations.map(reservationFromRow),
      };

      // After a successful remote load, treat current rows as synced so inbox/ops
      // mutations do not re-upsert warehouses (and other unchanged P0 tables).
      this.rememberRemoteFingerprints(merged);
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
    saveLocalOnly(pickLocalOnly(state));
    saveProductExtras(state.products);
    saveStockExtras(state.stock);
    // Keep a local full snapshot as offline safety net (not the source of truth for P0/P1).
    saveState(state);

    // Network already failed this session — stay fully local; no remote spam, no UI error.
    if (this.remotePausedForSession) return;

    try {
      // Parent → child order for FK safety. Skip tables unchanged since last successful sync/load.
      const changed = {
        warehouses: await this.upsertIfChanged("warehouses", state.warehouses.map(warehouseToRow)),
        products: await this.upsertIfChanged("products", state.products.map(productToRow)),
        vat_rates: await this.upsertIfChanged("vat_rates", state.vatRates.map(vatToRow)),
        customers: await this.upsertIfChanged("customers", state.customers.map(customerToRow)),
        stock_balances: await this.upsertIfChanged("stock_balances", state.stock.map(stockToRow)),
        customer_purchase_orders: await this.upsertIfChanged(
          "customer_purchase_orders",
          state.orders.map(orderToRow),
        ),
        customer_order_lines: await this.upsertIfChanged(
          "customer_order_lines",
          state.orderLines.map(orderLineToRow),
        ),
        supplies: await this.upsertIfChanged("supplies", state.supplies.map(supplyToRow)),
        supply_lines: await this.upsertIfChanged(
          "supply_lines",
          state.supplyLines.map(supplyLineToRow),
        ),
        stock_reservations: await this.upsertIfChanged(
          "stock_reservations",
          state.reservations.map(reservationToRow),
        ),
        invoices: await this.upsertIfChanged("invoices", state.invoices.map(invoiceToRow)),
        invoice_lines: await this.upsertIfChanged(
          "invoice_lines",
          state.invoiceLines.map(invoiceLineToRow),
        ),
        receipts: await this.upsertIfChanged("receipts", state.receipts.map(receiptToRow)),
        receipt_lines: await this.upsertIfChanged(
          "receipt_lines",
          state.receiptLines.map(receiptLineToRow),
        ),
        deliveries: await this.upsertIfChanged("deliveries", state.deliveries.map(deliveryToRow)),
        delivery_items: await this.upsertIfChanged(
          "delivery_items",
          state.deliveryItems.map(deliveryItemToRow),
        ),
        payments: await this.upsertIfChanged("payments", state.payments.map(paymentToRow)),
        notifications: await this.upsertIfChanged(
          "notifications",
          state.notifications.map(notificationToRow),
        ),
        // Audit is append-friendly; upsert by id keeps history stable.
        audit_events: await this.upsertIfChanged(
          "audit_events",
          state.audit.slice(0, 500).map(auditToRow),
        ),
        document_counters: await this.upsertIfChanged("document_counters", [
          countersToRow(state.counters),
        ]),
      };

      const settingsPayload: Database["public"]["Tables"]["app_settings"]["Insert"][] = [
        { key: "outstanding_ageing", value: state.ageing as unknown as Json },
        { key: "company_profile", value: state.company as unknown as Json },
        {
          key: "soft_delete_overlay",
          value: buildSoftDeleteOverlay(state) as unknown as Json,
        },
        {
          key: "auth_directory",
          value: {
            users: staffUsersForRemoteDirectory(state.users),
            roles: state.roles,
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

      // Remove remote rows purged from domain state — only for tables we just wrote.
      // Child → parent order for FK safety.
      if (changed.delivery_items) {
        await deleteMissing(
          this.sb,
          "delivery_items",
          state.deliveryItems.map((r) => r.id),
        );
      }
      if (changed.invoice_lines) {
        await deleteMissing(
          this.sb,
          "invoice_lines",
          state.invoiceLines.map((r) => r.id),
        );
      }
      if (changed.receipt_lines) {
        await deleteMissing(
          this.sb,
          "receipt_lines",
          state.receiptLines.map((r) => r.id),
        );
      }
      if (changed.supply_lines) {
        await deleteMissing(
          this.sb,
          "supply_lines",
          state.supplyLines.map((r) => r.id),
        );
      }
      if (changed.customer_order_lines) {
        await deleteMissing(
          this.sb,
          "customer_order_lines",
          state.orderLines.map((r) => r.id),
        );
      }
      if (changed.stock_reservations) {
        await deleteMissing(
          this.sb,
          "stock_reservations",
          state.reservations.map((r) => r.id),
        );
      }
      if (changed.notifications) {
        await deleteMissing(
          this.sb,
          "notifications",
          state.notifications.map((r) => r.id),
        );
      }
      if (changed.payments) {
        await deleteMissing(
          this.sb,
          "payments",
          state.payments.map((r) => r.id),
        );
      }
      if (changed.deliveries) {
        await deleteMissing(
          this.sb,
          "deliveries",
          state.deliveries.map((r) => r.id),
        );
      }
      if (changed.receipts) {
        await deleteMissing(
          this.sb,
          "receipts",
          state.receipts.map((r) => r.id),
        );
      }
      if (changed.invoices) {
        await deleteMissing(
          this.sb,
          "invoices",
          state.invoices.map((r) => r.id),
        );
      }
      if (changed.supplies) {
        await deleteMissing(
          this.sb,
          "supplies",
          state.supplies.map((r) => r.id),
        );
      }
      if (changed.customer_purchase_orders) {
        await deleteMissing(
          this.sb,
          "customer_purchase_orders",
          state.orders.map((r) => r.id),
        );
      }
      if (changed.stock_balances) {
        await deleteMissing(
          this.sb,
          "stock_balances",
          state.stock.map((r) => r.id),
        );
      }
      if (changed.customers) {
        await deleteMissing(
          this.sb,
          "customers",
          state.customers.map((r) => r.id),
        );
      }
      if (changed.vat_rates) {
        await deleteMissing(
          this.sb,
          "vat_rates",
          state.vatRates.map((r) => r.id),
        );
      }
      if (changed.products) {
        await deleteMissing(
          this.sb,
          "products",
          state.products.map((r) => r.id),
        );
      }
      if (changed.warehouses) {
        await deleteMissing(
          this.sb,
          "warehouses",
          state.warehouses.map((r) => r.id),
        );
      }
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
