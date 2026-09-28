/**
 * Canonical ledger RPC.
 *
 * Data API names (schema public):
 *   post_movement
 *   issue_document_number
 *
 * Reads:
 *   public.tlb_inventory_movements
 *   public.tlb_inventory_balances
 *
 * Stock posting and numbering are synchronous call sites. When a browser
 * session exists, this module uses one blocking request so the number that
 * comes back is the number the UI stores. If Supabase is unset, the user
 * has no session, or the RPC fails, callers keep the local result.
 * Failures are console-only.
 */
import type { StockBalance, StockMovement, StockMovementType } from "@/lib/domain/types";
import { ledgerProductId, ledgerWarehouseId } from "@/lib/repo/ledger-catalog";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEDGER_TYPES = new Set<StockMovementType>([
  "opening",
  "grn",
  "issue",
  "transfer_out",
  "transfer_in",
  "adjustment_plus",
  "adjustment_minus",
  "return_customer",
  "return_supplier",
  "damage",
  "expiry",
  "production",
  "sample",
  "supply",
]);

export type PostedMovement = {
  id: string;
  movementNumber: string;
  movementType: string;
  direction: number;
  quantity: number;
  qtyBefore: number;
  qtyAfter: number;
  signedQty: number;
  createdAt: string;
};

const warned = new Set<string>();

function warnOnce(key: string, detail: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[ledger] ${key} failed; local ledger kept.`, detail);
}

function envValue(name: string): string | undefined {
  try {
    const vite = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    if (vite?.[name]) return vite[name];
  } catch {
    /* node test runners may not expose import.meta.env */
  }
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function supabaseConfig(): { url: string; key: string } | null {
  const url = envValue("VITE_SUPABASE_URL") || envValue("SUPABASE_URL");
  const key = envValue("VITE_SUPABASE_PUBLISHABLE_KEY") || envValue("SUPABASE_PUBLISHABLE_KEY");
  const flag = (
    envValue("VITE_TLB_USE_SUPABASE") ||
    envValue("TLB_USE_SUPABASE") ||
    "1"
  ).toLowerCase();
  if (!url || !key) return null;
  if (flag === "0" || flag === "false" || flag === "off") return null;
  return { url: url.replace(/\/$/, ""), key };
}

function readAccessToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        access_token?: unknown;
        currentSession?: { access_token?: unknown };
      };
      const token = parsed.access_token ?? parsed.currentSession?.access_token;
      if (typeof token === "string" && token.length > 20) return token;
    } catch {
      /* try the next auth key */
    }
  }
  return null;
}

function canCallRpc(): { url: string; key: string; token: string } | null {
  if (typeof XMLHttpRequest === "undefined") return null;
  const config = supabaseConfig();
  if (!config) return null;
  const token = readAccessToken();
  if (!token) return null;
  return { ...config, token };
}

function rpcSync(name: string, args: Record<string, unknown>): string | null {
  const config = canCallRpc();
  if (!config) return null;
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${config.url}/rest/v1/rpc/${name}`, false);
    xhr.setRequestHeader("apikey", config.key);
    xhr.setRequestHeader("Authorization", `Bearer ${config.token}`);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.send(JSON.stringify(args));
    if (xhr.status < 200 || xhr.status >= 300) {
      warnOnce(name, `${xhr.status} ${xhr.responseText || ""}`.trim());
      return null;
    }
    return xhr.responseText;
  } catch (err) {
    warnOnce(name, err instanceof Error ? err.message : String(err));
    return null;
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const ensuredRefs = new Map<string, { productId: string; warehouseId: string }>();

function resolveLedgerTargets(input: {
  productId: string;
  warehouseId: string;
  productSku?: string;
  productName?: string;
  productUnit?: string;
  issueStrategy?: string;
  warehouseCode?: string;
  warehouseName?: string;
  warehouseLocation?: string;
}): { productId: string; warehouseId: string } {
  const mapped = {
    productId: ledgerProductId(input.productId),
    warehouseId: ledgerWarehouseId(input.warehouseId),
  };
  const cacheKey = `${input.productId}\n${input.warehouseId}`;
  const cached = ensuredRefs.get(cacheKey);
  if (cached) return cached;

  const sku = input.productSku?.trim() ?? "";
  const code = input.warehouseCode?.trim() ?? "";
  if (!sku || !code || !canCallRpc()) return mapped;

  const body = rpcSync("ensure_ledger_ref", {
    p_product_key: input.productId,
    p_sku: sku,
    p_product_name: input.productName?.trim() || sku,
    p_unit: input.productUnit?.trim() || "EA",
    p_issue_strategy: input.issueStrategy ?? null,
    p_warehouse_key: input.warehouseId,
    p_warehouse_code: code,
    p_warehouse_name: input.warehouseName?.trim() || code,
    p_warehouse_location: input.warehouseLocation ?? "",
  });
  if (!body) return mapped;

  try {
    const row = JSON.parse(body) as Record<string, unknown>;
    const productId = typeof row.product_id === "string" ? row.product_id : "";
    const warehouseId = typeof row.warehouse_id === "string" ? row.warehouse_id : "";
    if (UUID_RE.test(productId) && UUID_RE.test(warehouseId)) {
      const resolved = { productId, warehouseId };
      ensuredRefs.set(cacheKey, resolved);
      return resolved;
    }
  } catch (err) {
    warnOnce("ensure_ledger_ref", err instanceof Error ? err.message : String(err));
  }
  return mapped;
}

/** Server document number, or null when the app should keep the local number. */
export function tryIssueDocumentNumber(kind: string): string | null {
  if (!kind.trim()) return null;
  const body = rpcSync("issue_document_number", { p_document_type: kind });
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
  } catch {
    const plain = body.trim().replace(/^"|"$/g, "");
    if (plain) return plain;
  }
  warnOnce("issue_document_number", "empty document number");
  return null;
}

export function tryPostMovement(input: {
  type: StockMovementType;
  productId: string;
  warehouseId: string;
  quantity: number;
  batchId?: string;
  reason?: string;
  refType?: string;
  refId?: string;
  refNumber?: string;
  notes?: string;
  applyPhysical?: boolean;
  productSku?: string;
  productName?: string;
  productUnit?: string;
  issueStrategy?: string;
  warehouseCode?: string;
  warehouseName?: string;
  warehouseLocation?: string;
}): PostedMovement | null {
  if (input.applyPhysical === false) return null;
  if (!LEDGER_TYPES.has(input.type)) return null;
  const resolved = resolveLedgerTargets(input);
  if (!UUID_RE.test(resolved.productId) || !UUID_RE.test(resolved.warehouseId)) return null;
  const batchId = input.batchId && UUID_RE.test(input.batchId) ? input.batchId : null;
  const quantity = Math.abs(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const body = rpcSync("post_movement", {
    p_movement_type: input.type,
    p_product_id: resolved.productId,
    p_warehouse_id: resolved.warehouseId,
    p_quantity: quantity,
    p_batch_id: batchId,
    p_reason: input.reason ?? null,
    p_reference_type: input.refType ?? null,
    p_reference_id: input.refId ?? null,
    p_reference_number: input.refNumber ?? null,
    p_notes: input.notes ?? null,
  });
  if (!body) return null;

  try {
    const row = JSON.parse(body) as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const movementNumber = typeof row.movement_number === "string" ? row.movement_number : "";
    const direction = asNumber(row.direction);
    const qty = asNumber(row.quantity);
    const qtyBefore = asNumber(row.qty_before);
    const qtyAfter = asNumber(row.qty_after);
    if (
      !id ||
      !movementNumber ||
      direction == null ||
      qty == null ||
      qtyBefore == null ||
      qtyAfter == null
    ) {
      warnOnce("post_movement", "response missing movement fields");
      return null;
    }
    const signed = asNumber(row.signed_qty);
    return {
      id,
      movementNumber,
      movementType: typeof row.movement_type === "string" ? row.movement_type : input.type,
      direction,
      quantity: qty,
      qtyBefore,
      qtyAfter,
      signedQty: signed ?? direction * qty,
      createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    };
  } catch (err) {
    warnOnce("post_movement", err instanceof Error ? err.message : String(err));
    return null;
  }
}

function rowObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function mergeCanonicalMovements(local: StockMovement[], rows: unknown[]): StockMovement[] {
  const byId = new Map(local.map((move) => [move.id, move]));
  const seen = new Set<string>();
  const merged: StockMovement[] = [];

  for (const raw of rows) {
    const row = rowObject(raw);
    if (!row) continue;
    const id = text(row.id);
    const number = text(row.movement_number);
    const type = text(row.movement_type) as StockMovementType | undefined;
    const productId = text(row.product_id);
    const warehouseId = text(row.warehouse_id);
    const qtyBefore = asNumber(row.qty_before);
    const quantity = asNumber(row.quantity);
    const qtyAfter = asNumber(row.qty_after);
    const direction = asNumber(row.direction);
    const createdAt = text(row.created_at);
    if (!id || !number || !type || !productId || !warehouseId) continue;
    if (
      qtyBefore == null ||
      quantity == null ||
      qtyAfter == null ||
      direction == null ||
      !createdAt
    )
      continue;
    seen.add(id);
    const existing = byId.get(id);
    merged.push({
      id,
      number,
      type,
      productId,
      warehouseId,
      batchId: text(row.batch_id),
      qtyBefore,
      qtyMove: quantity,
      qtyAfter,
      signedQty: direction * quantity,
      reason: text(row.reason) ?? existing?.reason,
      refType: text(row.reference_type) ?? existing?.refType,
      refId: text(row.reference_id) ?? existing?.refId,
      refNumber: text(row.reference_number) ?? existing?.refNumber,
      notes: text(row.notes) ?? existing?.notes,
      actor: existing?.actor ?? text(row.actor_id) ?? "system",
      at: createdAt,
      deletedAt: existing?.deletedAt,
      deletedBy: existing?.deletedBy,
      deletedReason: existing?.deletedReason,
    });
  }

  for (const move of local) {
    if (!seen.has(move.id)) merged.push(move);
  }

  return merged.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function mergeCanonicalBalances(local: StockBalance[], rows: unknown[]): StockBalance[] {
  const next = local.map((row) => ({ ...row }));

  for (const raw of rows) {
    const row = rowObject(raw);
    if (!row) continue;
    const productId = text(row.product_id);
    const warehouseId = text(row.warehouse_id);
    const onHand = asNumber(row.quantity_on_hand);
    if (!productId || !warehouseId || onHand == null) continue;
    const idx = next.findIndex((s) => s.productId === productId && s.warehouseId === warehouseId);
    const previous = idx >= 0 ? next[idx] : undefined;
    const mapped: StockBalance = {
      id: previous?.id ?? `${productId}:${warehouseId}`,
      productId,
      warehouseId,
      physicalQty: onHand,
      reservedQty: asNumber(row.quantity_reserved) ?? previous?.reservedQty ?? 0,
      damagedQty: asNumber(row.quantity_damaged) ?? previous?.damagedQty ?? 0,
      expiredQty: asNumber(row.quantity_expired) ?? previous?.expiredQty ?? 0,
      quarantineQty: asNumber(row.quantity_quarantine) ?? previous?.quarantineQty ?? 0,
      inTransitQty: asNumber(row.quantity_in_transit) ?? previous?.inTransitQty ?? 0,
      allocatedQty: asNumber(row.quantity_allocated) ?? previous?.allocatedQty ?? 0,
    };
    if (idx >= 0) next[idx] = mapped;
    else next.push(mapped);
  }

  return next;
}
