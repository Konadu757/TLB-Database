import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";

import { MoveToTrashButton } from "@/components/modules/move-to-trash-button";
import { Button } from "@/components/ui/button";
import { statusTone } from "@/lib/domain/calculations";
import { notSoftDeleted } from "@/lib/domain/trash";
import {
  ASK_TLB_PRESETS,
  accountsPayable,
  accountsReceivable,
  batchExpiryBand,
  buildBatchTrace,
  buildProductTrace,
  listExpiryAlerts,
  listLowStock,
  runAskTlbPreset,
  stockPosition,
  type AskTlbPresetId,
} from "@/lib/domain/inventory";
import { formatMoney, trashBlockReason } from "@/lib/store/tlb-store";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";
import type { StockIssueReason, TransferStatus } from "@/lib/domain/types";

function StatusBadge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="tlb-empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function Flash({ error, notice, onClear }: { error: string | null; notice: string | null; onClear: () => void }) {
  if (!error && !notice) return null;
  return (
    <div className={`tlb-flash ${error ? "tlb-flash-error" : "tlb-flash-ok"}`} role="status">
      <span>{error ?? notice}</span>
      <button type="button" aria-label="Dismiss" onClick={onClear}>
        ×
      </button>
    </div>
  );
}

export function LiveStockMovementsModule({
  store,
  range,
  periodLabel,
}: {
  store: TlbStoreApi;
  range?: { from: string; to: string } | null;
  periodLabel?: string;
}) {
  const rows = useMemo(() => {
    return notSoftDeleted(store.state.stockMovements).filter((m) => {
      if (!range) return true;
      const d = m.at.slice(0, 10);
      return d >= range.from && d <= range.to;
    });
  }, [store.state.stockMovements, range]);

  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Inventory</span>
          <strong>Stock Movements</strong>
          <p className="tlb-muted-line">
            Immutable ledger · {rows.length} movement{rows.length === 1 ? "" : "s"}
            {periodLabel ? ` · ${periodLabel}` : ""}
          </p>
        </div>
      </div>
      <article className="tlb-panel tlb-orders-panel">
        {rows.length === 0 ? (
          <EmptyState title="No movements" detail="No stock movements in this period." />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Number</th>
                  <th>Type</th>
                  <th>Product</th>
                  <th>Warehouse</th>
                  <th>Before</th>
                  <th>Move</th>
                  <th>After</th>
                  <th>Ref</th>
                  <th>Who</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const product = store.state.products.find((p) => p.id === m.productId);
                  const wh = store.state.warehouses.find((w) => w.id === m.warehouseId);
                  return (
                    <tr key={m.id}>
                      <td>{m.at.slice(0, 16).replace("T", " ")}</td>
                      <td><strong>{m.number}</strong></td>
                      <td><StatusBadge tone={statusTone(m.type)}>{m.type}</StatusBadge></td>
                      <td>{product?.sku}</td>
                      <td>{wh?.code}</td>
                      <td>{m.qtyBefore}</td>
                      <td><strong>{m.signedQty >= 0 ? `+${m.signedQty}` : m.signedQty}</strong></td>
                      <td>{m.qtyAfter}</td>
                      <td>{m.refNumber ?? m.reason ?? "—"}</td>
                      <td>{m.actor}</td>
                      <td>
                        <MoveToTrashButton
                          store={store}
                          entityType="stock_movement"
                          entityId={m.id}
                          recordLabel={m.number}
                          variant="outline"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

export function LiveBatchesModule({
  store,
  onOpenBatch,
  focusId,
  onFocusConsumed,
}: {
  store: TlbStoreApi;
  onOpenBatch?: (id: string) => void;
  focusId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(focusId ?? null);
  useEffect(() => {
    if (!focusId) return;
    setSelected(focusId);
    onFocusConsumed?.();
  }, [focusId, onFocusConsumed]);
  const batch = notSoftDeleted(store.state.batches).find((b) => b.id === selected);

  if (batch) {
    const product = store.state.products.find((p) => p.id === batch.productId);
    const nodes = buildBatchTrace(store.state, batch.id);
    const band = batchExpiryBand(batch);
    return (
      <div className="tlb-module tlb-record-detail">
        <div className="tlb-module-toolbar">
          <div>
            <span className="tlb-eyebrow">Batch</span>
            <strong>{batch.code}</strong>
            <p className="tlb-muted-line">
              {product?.name} · remain {batch.remainingQty} · cost {formatMoney(batch.unitCost)}
            </p>
          </div>
          <div className="tlb-inline-actions">
            <MoveToTrashButton
              store={store}
              entityType="batch"
              entityId={batch.id}
              recordLabel={batch.code}
              onTrashed={() => setSelected(null)}
            />
            <Button type="button" variant="outline" onClick={() => setSelected(null)}>
              Back to batches
            </Button>
          </div>
        </div>
        <article className="tlb-panel">
          <div className="tlb-panel-heading">
            <div>
              <span>Status</span>
              <strong>
                <StatusBadge tone={band === "expired" || band === "30" ? "danger" : statusTone(batch.status)}>
                  {batch.status}
                  {band !== "ok" ? ` · ${band}` : ""}
                </StatusBadge>
              </strong>
            </div>
          </div>
          <div className="tlb-kv-grid" style={{ padding: 16 }}>
            <div><span>MFD</span><strong>{batch.manufacturedAt ?? "—"}</strong></div>
            <div><span>EXP</span><strong>{batch.expiresAt ?? "—"}</strong></div>
            <div><span>Received</span><strong>{batch.receivedAt.slice(0, 10)}</strong></div>
            <div><span>Supplier</span><strong>{store.state.suppliers.find((s) => s.id === batch.supplierId)?.name ?? "—"}</strong></div>
          </div>
        </article>
        <article className="tlb-panel tlb-orders-panel">
          <div className="tlb-panel-heading">
            <div>
              <span>Recall chain</span>
              <strong>Supplier → GRN → Batch → Movements → Customers</strong>
            </div>
          </div>
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Kind</th>
                  <th>Title</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={`${n.id}-${n.kind}`}>
                    <td>{n.at ? n.at.slice(0, 10) : "—"}</td>
                    <td><StatusBadge tone="info">{n.kind}</StatusBadge></td>
                    <td><strong>{n.title}</strong></td>
                    <td>{n.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Inventory</span>
          <strong>Batches</strong>
          <p className="tlb-muted-line">Lot remaining, expiry, and recall timeline</p>
        </div>
      </div>
      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Product</th>
                <th>Warehouse</th>
                <th>Remain</th>
                <th>Cost</th>
                <th>EXP</th>
                <th>Alert</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {notSoftDeleted(store.state.batches).map((b) => {
                const product = store.state.products.find((p) => p.id === b.productId);
                const wh = store.state.warehouses.find((w) => w.id === b.warehouseId);
                const band = batchExpiryBand(b);
                return (
                  <tr key={b.id}>
                    <td><strong>{b.code}</strong></td>
                    <td>{product?.sku}</td>
                    <td>{wh?.code}</td>
                    <td>{b.remainingQty}</td>
                    <td>{formatMoney(b.unitCost)}</td>
                    <td>{b.expiresAt?.slice(0, 10) ?? "—"}</td>
                    <td>
                      <StatusBadge tone={band === "ok" ? "success" : band === "expired" ? "danger" : "warning"}>
                        {band === "ok" ? "OK" : band}
                      </StatusBadge>
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label="Open batch"
                        onClick={() => {
                          setSelected(b.id);
                          onOpenBatch?.(b.id);
                        }}
                      >
                        <ChevronRight />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export function GoodsInModule({
  store,
  focusId,
  onFocusConsumed,
}: {
  store: TlbStoreApi;
  focusId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState(store.state.suppliers[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState("wh-main");
  const [poId, setPoId] = useState("");
  const [nonPo, setNonPo] = useState(false);
  const [notes, setNotes] = useState("");
  const [productId, setProductId] = useState("prod-hcl");
  const [batchCode, setBatchCode] = useState("");
  const [accepted, setAccepted] = useState(10);
  const [rejected, setRejected] = useState(0);
  const [damaged, setDamaged] = useState(0);
  const [unitCost, setUnitCost] = useState(610);
  const [expiresAt, setExpiresAt] = useState("2027-12-01");
  const [detailId, setDetailId] = useState<string | null>(focusId ?? null);

  useEffect(() => {
    if (!focusId) return;
    setDetailId(focusId);
    onFocusConsumed?.();
  }, [focusId, onFocusConsumed]);

  const detail = notSoftDeleted(store.state.goodsReceipts).find((g) => g.id === detailId);

  if (detail) {
    const lines = store.state.goodsReceiptLines.filter((l) => l.grnId === detail.id);
    const supplier = store.state.suppliers.find((s) => s.id === detail.supplierId);
    const grnTrashBlock = trashBlockReason(store.state, "goods_receipt", detail.id);
    return (
      <div className="tlb-module tlb-record-detail">
        <div className="tlb-module-toolbar">
          <div>
            <span className="tlb-eyebrow">Goods In</span>
            <strong>{detail.number}</strong>
            <p className="tlb-muted-line">{supplier?.name} · {detail.nonPo ? "Non-PO" : "PO-linked"}</p>
          </div>
          <div className="tlb-inline-actions">
            <MoveToTrashButton
              store={store}
              entityType="goods_receipt"
              entityId={detail.id}
              recordLabel={detail.number}
              disabled={Boolean(grnTrashBlock)}
              disabledReason={grnTrashBlock ?? undefined}
              onTrashed={() => setDetailId(null)}
            />
            <Button type="button" variant="outline" onClick={() => setDetailId(null)}>Back</Button>
          </div>
        </div>
        <article className="tlb-panel">
          <div className="tlb-kv-grid" style={{ padding: 16 }}>
            <div><span>Status</span><strong><StatusBadge tone={statusTone(detail.status)}>{detail.status}</StatusBadge></strong></div>
            <div><span>Received by</span><strong>{detail.receivedBy}</strong></div>
            <div><span>Checked by</span><strong>{detail.checkedBy ?? "—"}</strong></div>
            <div><span>Approved by</span><strong>{detail.approvedBy ?? "—"}</strong></div>
            <div><span>Docs</span><strong>{detail.documentRefs ?? "—"}</strong></div>
            <div><span>Notes</span><strong>{detail.notes ?? "—"}</strong></div>
          </div>
        </article>
        <article className="tlb-panel tlb-orders-panel">
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Batch</th>
                  <th>Ordered</th>
                  <th>Accepted</th>
                  <th>Rejected</th>
                  <th>Damaged</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const p = store.state.products.find((x) => x.id === l.productId);
                  return (
                    <tr key={l.id}>
                      <td>{p?.name}</td>
                      <td>{l.batchCode}</td>
                      <td>{l.orderedQty}</td>
                      <td>{l.acceptedQty}</td>
                      <td>{l.rejectedQty}</td>
                      <td>{l.damagedQty}</td>
                      <td>{formatMoney(l.unitCost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Inventory</span>
          <strong>Goods In (GRN)</strong>
          <p className="tlb-muted-line">PO and Non-PO receipts with accepted / rejected / damaged</p>
        </div>
        <Button type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Close form" : "Post GRN"}
        </Button>
      </div>
      {open ? (
        <article className="tlb-panel" style={{ padding: 16, display: "grid", gap: 12 }}>
          <div className="tlb-form-grid">
            <label>
              Supplier
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                {store.state.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>
              Warehouse
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                {store.state.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
            <label>
              Supplier PO
              <select
                value={poId}
                onChange={(e) => setPoId(e.target.value)}
                disabled={nonPo}
              >
                <option value="">— None —</option>
                {store.state.supplierPurchaseOrders
                  .filter((p) => p.supplierId === supplierId && p.status !== "Cancelled")
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.number}</option>
                  ))}
              </select>
            </label>
            <label className="tlb-check-row">
              <input type="checkbox" checked={nonPo} onChange={(e) => { setNonPo(e.target.checked); if (e.target.checked) setPoId(""); }} />
              Non-PO purchase
            </label>
            <label>
              Product
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                {store.state.products.map((p) => (
                  <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>
                ))}
              </select>
            </label>
            <label>
              Batch code
              <input value={batchCode} onChange={(e) => setBatchCode(e.target.value)} placeholder="HCL-26xxx" />
            </label>
            <label>
              Accepted
              <input type="number" min={0} value={accepted} onChange={(e) => setAccepted(Number(e.target.value))} />
            </label>
            <label>
              Rejected
              <input type="number" min={0} value={rejected} onChange={(e) => setRejected(Number(e.target.value))} />
            </label>
            <label>
              Damaged
              <input type="number" min={0} value={damaged} onChange={(e) => setDamaged(Number(e.target.value))} />
            </label>
            <label>
              Unit cost
              <input type="number" min={0} value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value))} />
            </label>
            <label>
              Expiry
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </label>
            <label>
              Notes {nonPo ? "(required for Non-PO)" : ""}
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          <Button
            type="button"
            onClick={() => {
              const ok = store.postGrn({
                supplierId,
                purchaseOrderId: poId || undefined,
                nonPo,
                warehouseId,
                notes,
                lines: [
                  {
                    productId,
                    batchCode: batchCode || `BAT-${Date.now().toString(36).toUpperCase()}`,
                    orderedQty: accepted + rejected + damaged,
                    acceptedQty: accepted,
                    rejectedQty: rejected,
                    damagedQty: damaged,
                    unitCost,
                    expiresAt,
                  },
                ],
              });
              if (ok) {
                setOpen(false);
                setBatchCode("");
                setNotes("");
              }
            }}
          >
            Post goods receipt
          </Button>
        </article>
      ) : null}
      <article className="tlb-panel tlb-orders-panel">
        {notSoftDeleted(store.state.goodsReceipts).length === 0 ? (
          <EmptyState title="No GRNs" detail="Post a goods receipt to start the inbound ledger." />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>GRN</th>
                  <th>Supplier</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Received</th>
                  <th>By</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {notSoftDeleted(store.state.goodsReceipts).map((g) => (
                  <tr key={g.id}>
                    <td><strong>{g.number}</strong></td>
                    <td>{store.state.suppliers.find((s) => s.id === g.supplierId)?.name}</td>
                    <td>{g.nonPo ? "Non-PO" : "PO"}</td>
                    <td><StatusBadge tone={statusTone(g.status)}>{g.status}</StatusBadge></td>
                    <td>{g.receivedAt.slice(0, 10)}</td>
                    <td>{g.receivedBy}</td>
                    <td>
                      <button type="button" onClick={() => setDetailId(g.id)} aria-label="Open GRN">
                        <ChevronRight />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

export function GoodsOutModule({ store }: { store: TlbStoreApi }) {
  const [warehouseId, setWarehouseId] = useState("wh-main");
  const [productId, setProductId] = useState("prod-hcl");
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState<StockIssueReason>("Internal use");
  const [notes, setNotes] = useState("");

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Inventory</span>
          <strong>Goods Out</strong>
          <p className="tlb-muted-line">Stock issues with FEFO/FIFO batch picks</p>
        </div>
      </div>
      <article className="tlb-panel" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div className="tlb-form-grid">
          <label>
            Warehouse
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {store.state.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
          <label>
            Product
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              {store.state.products.map((p) => (
                <option key={p.id} value={p.id}>{p.sku}</option>
              ))}
            </select>
          </label>
          <label>
            Qty
            <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          </label>
          <label>
            Reason
            <select value={reason} onChange={(e) => setReason(e.target.value as StockIssueReason)}>
              {(["Customer supply", "Production", "Sample", "Damage", "Expiry", "Internal use", "Other"] as StockIssueReason[]).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <Button
          type="button"
          onClick={() =>
            store.postIssue({
              warehouseId,
              reason,
              notes,
              lines: [{ productId, quantity: qty }],
            })
          }
        >
          Post issue
        </Button>
      </article>
      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Issue</th>
                <th>Reason</th>
                <th>When</th>
                <th>By</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {notSoftDeleted(store.state.stockIssues).length === 0 ? (
                <tr><td colSpan={5}><EmptyState title="No issues yet" detail="Post a goods-out to create ledger rows." /></td></tr>
              ) : (
                notSoftDeleted(store.state.stockIssues).map((i) => (
                  <tr key={i.id}>
                    <td><strong>{i.number}</strong></td>
                    <td>{i.reason}</td>
                    <td>{i.issuedAt.slice(0, 16).replace("T", " ")}</td>
                    <td>{i.issuedBy}</td>
                    <td>
                      <MoveToTrashButton
                        store={store}
                        entityType="stock_issue"
                        entityId={i.id}
                        recordLabel={i.number}
                        variant="outline"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export function TransfersModule({ store }: { store: TlbStoreApi }) {
  const [fromWarehouseId, setFrom] = useState("wh-main");
  const [toWarehouseId, setTo] = useState("wh-factory");
  const [productId, setProductId] = useState("prod-hcl");
  const [qty, setQty] = useState(5);

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Inventory</span>
          <strong>Warehouse Transfers</strong>
          <p className="tlb-muted-line">Requested → Approved → In Transit → Received (stock at destination only on confirm)</p>
        </div>
      </div>
      <article className="tlb-panel" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div className="tlb-form-grid">
          <label>
            From
            <select value={fromWarehouseId} onChange={(e) => setFrom(e.target.value)}>
              {store.state.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
          <label>
            To
            <select value={toWarehouseId} onChange={(e) => setTo(e.target.value)}>
              {store.state.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
          <label>
            Product
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              {store.state.products.map((p) => (
                <option key={p.id} value={p.id}>{p.sku}</option>
              ))}
            </select>
          </label>
          <label>
            Qty
            <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          </label>
        </div>
        <Button
          type="button"
          onClick={() =>
            store.requestTransfer({
              fromWarehouseId,
              toWarehouseId,
              lines: [{ productId, quantity: qty }],
            })
          }
        >
          Request transfer
        </Button>
      </article>
      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Transfer</th>
                <th>Route</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {notSoftDeleted(store.state.transfers).map((t) => {
                const from = store.state.warehouses.find((w) => w.id === t.fromWarehouseId)?.code;
                const to = store.state.warehouses.find((w) => w.id === t.toWarehouseId)?.code;
                const transferTrashBlock = trashBlockReason(store.state, "transfer", t.id);
                return (
                  <tr key={t.id}>
                    <td><strong>{t.number}</strong></td>
                    <td>{from} → {to}</td>
                    <td><StatusBadge tone={statusTone(t.status)}>{t.status}</StatusBadge></td>
                    <td>
                      <div className="tlb-inline-actions compact">
                        {t.status === "Requested" ? (
                          <Button type="button" variant="outline" onClick={() => store.advanceTransfer(t.id, "Approved")}>
                            Approve
                          </Button>
                        ) : null}
                        {t.status === "Approved" ? (
                          <Button type="button" variant="outline" onClick={() => store.advanceTransfer(t.id, "In Transit")}>
                            Release
                          </Button>
                        ) : null}
                        {t.status === "In Transit" ? (
                          <Button type="button" variant="outline" onClick={() => store.advanceTransfer(t.id, "Received" as TransferStatus)}>
                            Receive
                          </Button>
                        ) : null}
                        <MoveToTrashButton
                          store={store}
                          entityType="transfer"
                          entityId={t.id}
                          recordLabel={t.number}
                          variant="outline"
                          disabled={Boolean(transferTrashBlock)}
                          disabledReason={transferTrashBlock ?? undefined}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export function AdjustmentsModule({ store }: { store: TlbStoreApi }) {
  const [productId, setProductId] = useState("prod-hcl");
  const [warehouseId, setWarehouseId] = useState("wh-main");
  const [qtyAfter, setQtyAfter] = useState(200);
  const [reason, setReason] = useState("Cycle count variance");

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Inventory</span>
          <strong>Adjustments & Counts</strong>
          <p className="tlb-muted-line">
            Variances ≥ {store.state.inventorySettings?.adjustmentApprovalThreshold ?? 10} require approval
          </p>
        </div>
      </div>
      <article className="tlb-panel" style={{ padding: 16, display: "grid", gap: 12 }}>
        <div className="tlb-form-grid">
          <label>
            Product
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              {store.state.products.map((p) => (
                <option key={p.id} value={p.id}>{p.sku}</option>
              ))}
            </select>
          </label>
          <label>
            Warehouse
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {store.state.warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
          <label>
            Counted qty (after)
            <input type="number" value={qtyAfter} onChange={(e) => setQtyAfter(Number(e.target.value))} />
          </label>
          <label>
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        <Button
          type="button"
          onClick={() =>
            store.postAdjustment({
              kind: "count",
              lines: [{ productId, warehouseId, qtyAfter, reason }],
            })
          }
        >
          Post adjustment
        </Button>
      </article>
      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Kind</th>
                <th>Status</th>
                <th>By</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {notSoftDeleted(store.state.adjustments).length === 0 ? (
                <tr><td colSpan={5}><EmptyState title="No adjustments" detail="Post a count or variance." /></td></tr>
              ) : (
                notSoftDeleted(store.state.adjustments).map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.number}</strong></td>
                    <td>{a.kind}</td>
                    <td><StatusBadge tone={statusTone(a.status)}>{a.status}</StatusBadge></td>
                    <td>{a.createdBy}</td>
                    <td>
                      <MoveToTrashButton
                        store={store}
                        entityType="adjustment"
                        entityId={a.id}
                        recordLabel={a.number}
                        variant="outline"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export function TraceProductModule({
  store,
  initialProductId,
  onNavigate,
}: {
  store: TlbStoreApi;
  initialProductId?: string | null;
  onNavigate?: (nav: string, id?: string) => void;
}) {
  const [productId, setProductId] = useState(initialProductId ?? "prod-hcl");
  const nodes = useMemo(() => buildProductTrace(store.state, productId), [store.state, productId]);
  const product = store.state.products.find((p) => p.id === productId);

  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Traceability</span>
          <strong>Trace Product</strong>
          <p className="tlb-muted-line">WHAT · WHERE · WHEN · WHO · HOW MUCH · WHY</p>
        </div>
        <label>
          Product
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            {store.state.products.map((p) => (
              <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>
            ))}
          </select>
        </label>
      </div>
      <article className="tlb-panel">
        <div className="tlb-panel-heading">
          <div>
            <span>{product?.sku}</span>
            <strong>{product?.name}</strong>
          </div>
        </div>
        <div className="tlb-table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Node</th>
                <th>Title</th>
                <th>Detail</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {nodes.length === 0 ? (
                <tr><td colSpan={5}><EmptyState title="No trace nodes" detail="No matching records for this product." /></td></tr>
              ) : (
                nodes.map((n) => (
                  <tr key={`${n.kind}-${n.id}-${n.at}`}>
                    <td>{n.at ? n.at.slice(0, 10) : "—"}</td>
                    <td><StatusBadge tone="info">{n.kind}</StatusBadge></td>
                    <td><strong>{n.title}</strong></td>
                    <td>{n.detail}</td>
                    <td>
                      {n.refNav ? (
                        <button type="button" className="tlb-text-link" onClick={() => onNavigate?.(n.refNav!, n.refId)}>
                          Open
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export function AskTlbModule({
  store,
  onNavigate,
}: {
  store: TlbStoreApi;
  onNavigate: (nav: string, entityId?: string) => void;
}) {
  const [preset, setPreset] = useState<AskTlbPresetId>("outstanding");
  const hits = useMemo(() => runAskTlbPreset(store.state, preset), [store.state, preset]);

  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Business Intelligence</span>
          <strong>Ask TLB</strong>
          <p className="tlb-muted-line">Structured presets over live store data — never invents records</p>
        </div>
      </div>
      <article className="tlb-panel" style={{ padding: 16 }}>
        <div className="tlb-chip-row" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ASK_TLB_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={preset === p.id ? "tlb-chip tlb-chip-active" : "tlb-chip"}
              onClick={() => setPreset(p.id)}
              style={{
                border: "1px solid var(--border)",
                background: preset === p.id ? "var(--primary)" : "#fff",
                color: preset === p.id ? "#fff" : "inherit",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </article>
      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-panel-heading">
          <div>
            <span>Results</span>
            <strong>{ASK_TLB_PRESETS.find((p) => p.id === preset)?.label}</strong>
          </div>
        </div>
        {hits.length === 0 ? (
          <EmptyState title="No matching records were found." detail="This preset returned an empty result from the live store." />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Detail</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {hits.map((h) => (
                  <tr key={h.id}>
                    <td><strong>{h.label}</strong></td>
                    <td>{h.subtitle}</td>
                    <td>
                      <button type="button" onClick={() => onNavigate(h.nav, h.entityId)} aria-label="Open record">
                        <ChevronRight />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

export function ApprovalsModule({ store }: { store: TlbStoreApi }) {
  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Control</span>
          <strong>Approvals</strong>
          <p className="tlb-muted-line">PO / Non-PO / credit / adjustments / transfers</p>
        </div>
      </div>
      <article className="tlb-panel tlb-orders-panel">
        {notSoftDeleted(store.state.approvals).length === 0 ? (
          <EmptyState title="No approvals" detail="Approval requests will appear here." />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {notSoftDeleted(store.state.approvals).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.title}</strong>
                      <div className="tlb-muted-line">{a.summary}</div>
                    </td>
                    <td>{a.kind}</td>
                    <td><StatusBadge tone={statusTone(a.status)}>{a.status}</StatusBadge></td>
                    <td>{a.requestedAt.slice(0, 10)} · {a.requestedBy}</td>
                    <td>
                      <div className="tlb-inline-actions compact">
                        {a.status === "Pending" ? (
                          <>
                            <Button type="button" variant="outline" onClick={() => store.decideApproval(a.id, "Approved")}>
                              Approve
                            </Button>
                            <Button type="button" variant="outline" onClick={() => store.decideApproval(a.id, "Rejected")}>
                              Reject
                            </Button>
                          </>
                        ) : (
                          <span className="tlb-muted-line">{a.decidedBy ?? "—"}</span>
                        )}
                        <MoveToTrashButton
                          store={store}
                          entityType="approval"
                          entityId={a.id}
                          recordLabel={a.title}
                          variant="outline"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

export function AccountsReceivableModule({ store }: { store: TlbStoreApi }) {
  const rows = useMemo(() => accountsReceivable(store.state), [store.state]);
  const buckets = useMemo(() => {
    const init = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    for (const r of rows) init[r.bucket] += r.balance;
    return init;
  }, [rows]);

  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Finance</span>
          <strong>Accounts Receivable</strong>
          <p className="tlb-muted-line">Customer → Invoice → Payment ageing</p>
        </div>
      </div>
      <div className="tlb-kpi-strip" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {(["0-30", "31-60", "61-90", "90+"] as const).map((b) => (
          <article key={b} className="tlb-panel" style={{ padding: 12 }}>
            <span className="tlb-eyebrow">{b} days</span>
            <strong>{formatMoney(buckets[b])}</strong>
          </article>
        ))}
      </div>
      <article className="tlb-panel tlb-orders-panel">
        {rows.length === 0 ? (
          <EmptyState title="No AR balances" detail="Unpaid / partial invoices will age here." />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Due</th>
                  <th>Balance</th>
                  <th>Age</th>
                  <th>Bucket</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.docId}>
                    <td><strong>{r.docNumber}</strong></td>
                    <td>{r.partyName}</td>
                    <td>{r.dueDate.slice(0, 10)}</td>
                    <td>{formatMoney(r.balance)}</td>
                    <td>{r.ageDays}d</td>
                    <td><StatusBadge tone={r.bucket === "90+" ? "danger" : r.bucket === "0-30" ? "success" : "warning"}>{r.bucket}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

export function AccountsPayableModule({ store }: { store: TlbStoreApi }) {
  const rows = useMemo(() => accountsPayable(store.state), [store.state]);
  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Finance</span>
          <strong>Accounts Payable</strong>
          <p className="tlb-muted-line">Supplier → PO → GRN → Payment</p>
        </div>
      </div>
      <article className="tlb-panel tlb-orders-panel">
        {rows.length === 0 ? (
          <EmptyState title="No AP balances" detail="Open supplier PO balances will appear here." />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Supplier</th>
                  <th>Due</th>
                  <th>Balance</th>
                  <th>Bucket</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.docId}>
                    <td><strong>{r.docNumber}</strong></td>
                    <td>{r.partyName}</td>
                    <td>{r.dueDate.slice(0, 10)}</td>
                    <td>{formatMoney(r.balance)}</td>
                    <td><StatusBadge tone={r.bucket === "90+" ? "danger" : "warning"}>{r.bucket}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

export function InventoryAlertsWidget({
  store,
  onOpenNav,
}: {
  store: TlbStoreApi;
  onOpenNav: (nav: string) => void;
}) {
  const low = listLowStock(store.state).slice(0, 4);
  const exp = listExpiryAlerts(store.state).slice(0, 4);
  return (
    <article className="tlb-panel tlb-orders-panel">
      <div className="tlb-panel-heading">
        <div>
          <span>Inventory alerts</span>
          <strong>Low stock & expiry</strong>
        </div>
        <button type="button" onClick={() => onOpenNav("Ask TLB")}>
          Ask TLB <ChevronRight />
        </button>
      </div>
      {low.length === 0 && exp.length === 0 ? (
        <EmptyState title="No alerts" detail="Reorder points and expiry windows are clear." />
      ) : (
        <div className="tlb-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Item</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {low.map((r) => (
                <tr key={`low-${r.productId}-${r.warehouseId}`}>
                  <td><StatusBadge tone="warning">Low</StatusBadge></td>
                  <td>{r.sku}</td>
                  <td>Avail {r.available} / reorder {r.reorderPoint}</td>
                </tr>
              ))}
              {exp.map((r) => (
                <tr key={`exp-${r.batch.id}`}>
                  <td><StatusBadge tone={r.band === "expired" ? "danger" : "warning"}>{r.band}</StatusBadge></td>
                  <td>{r.batch.code}</td>
                  <td>{r.productSku} · remain {r.batch.remainingQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

/** Enhanced stock position table used by Stock module. */
export function enrichStockRows(store: TlbStoreApi) {
  return store.state.stock.map((bal) => {
    const product = store.state.products.find((p) => p.id === bal.productId);
    const warehouse = store.state.warehouses.find((w) => w.id === bal.warehouseId);
    return { bal, product, warehouse, pos: stockPosition(bal) };
  });
}

export function StockSearchHint() {
  return (
    <p className="tlb-muted-line" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Search size={14} /> Available = physical − reserved − damaged − expired − quarantine
    </p>
  );
}
