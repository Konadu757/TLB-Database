/**
 * Hybrid Supabase repository: P0/P1 entities live in Postgres; unmigrated
 * inventory/ops/auth/trash slices stay in localStorage until SQL exists.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Product, StockBalance, TlbState } from "@/lib/domain/types";
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
import type { TlbRepository } from "./tlb-repository";

const LOCAL_ONLY_KEY = "tlb.enterprise.local-only.v1";
const PRODUCT_EXTRAS_KEY = "tlb.enterprise.product-extras.v1";
const STOCK_EXTRAS_KEY = "tlb.enterprise.stock-extras.v1";

type Sb = SupabaseClient<Database>;

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
  const { error } = await sb.from(table).upsert(rows as never, { onConflict: "id" });
  if (error) throw new Error(`upsert ${String(table)}: ${error.message}`);
}

async function deleteMissing(
  sb: Sb,
  table: keyof Database["public"]["Tables"],
  keepIds: string[],
): Promise<void> {
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
}

export class SupabaseTlbRepository implements TlbRepository {
  backend = "supabase" as const;
  private lastRemoteError: string | null = null;

  constructor(private readonly sb: Sb) {}

  getLastError(): string | null {
    return this.lastRemoteError;
  }

  async load(): Promise<TlbState> {
    this.lastRemoteError = null;
    const localOnly = loadLocalOnly();
    const productExtras = loadProductExtras();
    const stockExtras = loadStockExtras();
    const seed = createSeedState();

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
        fetchAll<Database["public"]["Tables"]["customer_order_lines"]["Row"]>(this.sb, "customer_order_lines"),
        fetchAll<Database["public"]["Tables"]["supplies"]["Row"]>(this.sb, "supplies"),
        fetchAll<Database["public"]["Tables"]["supply_lines"]["Row"]>(this.sb, "supply_lines"),
        fetchAll<Database["public"]["Tables"]["audit_events"]["Row"]>(this.sb, "audit_events"),
        fetchAll<Database["public"]["Tables"]["document_counters"]["Row"]>(this.sb, "document_counters"),
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
        fetchAll<Database["public"]["Tables"]["stock_reservations"]["Row"]>(this.sb, "stock_reservations"),
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

      const prior = loadState();
      const merged: TlbState = {
        ...seed,
        ...localOnly,
        warehouses: warehouses.map((row) => warehouseFromRow(row, softOverlay)),
        products: products.map((row) => productFromRow(row, productExtras[row.id], softOverlay)),
        stock: stock.map((row) => stockFromRow(row, stockExtras[row.id])),
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
        notifications: notifications.map(notificationFromRow),
        reservations: reservations.map(reservationFromRow),
      };

      return merged;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastRemoteError = message;
      console.error("[SupabaseTlbRepository] load failed, using local fallback:", message);
      return loadState();
    }
  }

  async save(state: TlbState): Promise<void> {
    this.lastRemoteError = null;
    saveLocalOnly(pickLocalOnly(state));
    saveProductExtras(state.products);
    saveStockExtras(state.stock);
    // Keep a local full snapshot as offline safety net (not the source of truth for P0/P1).
    saveState(state);

    try {
      // Parent → child order for FK safety.
      await upsertRows(this.sb, "warehouses", state.warehouses.map(warehouseToRow));
      await upsertRows(this.sb, "products", state.products.map(productToRow));
      await upsertRows(this.sb, "vat_rates", state.vatRates.map(vatToRow));
      await upsertRows(this.sb, "customers", state.customers.map(customerToRow));
      await upsertRows(this.sb, "stock_balances", state.stock.map(stockToRow));
      await upsertRows(this.sb, "customer_purchase_orders", state.orders.map(orderToRow));
      await upsertRows(this.sb, "customer_order_lines", state.orderLines.map(orderLineToRow));
      await upsertRows(this.sb, "supplies", state.supplies.map(supplyToRow));
      await upsertRows(this.sb, "supply_lines", state.supplyLines.map(supplyLineToRow));
      await upsertRows(this.sb, "stock_reservations", state.reservations.map(reservationToRow));
      await upsertRows(this.sb, "invoices", state.invoices.map(invoiceToRow));
      await upsertRows(this.sb, "invoice_lines", state.invoiceLines.map(invoiceLineToRow));
      await upsertRows(this.sb, "receipts", state.receipts.map(receiptToRow));
      await upsertRows(this.sb, "receipt_lines", state.receiptLines.map(receiptLineToRow));
      await upsertRows(this.sb, "deliveries", state.deliveries.map(deliveryToRow));
      await upsertRows(this.sb, "delivery_items", state.deliveryItems.map(deliveryItemToRow));
      await upsertRows(this.sb, "payments", state.payments.map(paymentToRow));
      await upsertRows(this.sb, "notifications", state.notifications.map(notificationToRow));
      // Audit is append-friendly; upsert by id keeps history stable.
      await upsertRows(this.sb, "audit_events", state.audit.slice(0, 500).map(auditToRow));
      await upsertRows(this.sb, "document_counters", [countersToRow(state.counters)]);

      const settingsPayload: Database["public"]["Tables"]["app_settings"]["Insert"][] = [
        { key: "outstanding_ageing", value: state.ageing as unknown as Json },
        { key: "company_profile", value: state.company as unknown as Json },
        {
          key: "soft_delete_overlay",
          value: buildSoftDeleteOverlay(state) as unknown as Json,
        },
      ];
      const { error: settingsErr } = await this.sb.from("app_settings").upsert(settingsPayload, {
        onConflict: "key",
      });
      if (settingsErr) throw new Error(`upsert app_settings: ${settingsErr.message}`);

      // Remove remote rows purged from domain state (soft-deleted rows remain upserted).
      await deleteMissing(this.sb, "delivery_items", state.deliveryItems.map((r) => r.id));
      await deleteMissing(this.sb, "invoice_lines", state.invoiceLines.map((r) => r.id));
      await deleteMissing(this.sb, "receipt_lines", state.receiptLines.map((r) => r.id));
      await deleteMissing(this.sb, "supply_lines", state.supplyLines.map((r) => r.id));
      await deleteMissing(this.sb, "customer_order_lines", state.orderLines.map((r) => r.id));
      await deleteMissing(this.sb, "stock_reservations", state.reservations.map((r) => r.id));
      await deleteMissing(this.sb, "notifications", state.notifications.map((r) => r.id));
      await deleteMissing(this.sb, "payments", state.payments.map((r) => r.id));
      await deleteMissing(this.sb, "deliveries", state.deliveries.map((r) => r.id));
      await deleteMissing(this.sb, "receipts", state.receipts.map((r) => r.id));
      await deleteMissing(this.sb, "invoices", state.invoices.map((r) => r.id));
      await deleteMissing(this.sb, "supplies", state.supplies.map((r) => r.id));
      await deleteMissing(this.sb, "customer_purchase_orders", state.orders.map((r) => r.id));
      await deleteMissing(this.sb, "stock_balances", state.stock.map((r) => r.id));
      await deleteMissing(this.sb, "customers", state.customers.map((r) => r.id));
      await deleteMissing(this.sb, "vat_rates", state.vatRates.map((r) => r.id));
      await deleteMissing(this.sb, "products", state.products.map((r) => r.id));
      await deleteMissing(this.sb, "warehouses", state.warehouses.map((r) => r.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastRemoteError = message;
      console.error("[SupabaseTlbRepository] save failed (local snapshot kept):", message);
      throw err;
    }
  }
}
