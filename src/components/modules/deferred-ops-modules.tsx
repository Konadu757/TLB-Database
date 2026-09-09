/**
 * Deferred ops UI: Returns, Non-PO Purchases, Import/Export shipments, stock ageing views.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { statusTone } from "@/lib/domain/calculations";
import {
  stockAgeingReport,
  stockVelocityReport,
  type StockAgeingRow,
} from "@/lib/domain/analytics-pack";
import { toCsv } from "@/lib/domain/reports";
import type {
  ExportShipmentStatus,
  ImportShipmentStatus,
  ReturnDisposition,
} from "@/lib/domain/types";
import { isSoftDeleted } from "@/lib/domain/trash";
import { formatMoney } from "@/lib/store/tlb-store";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

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
        <X />
      </button>
    </div>
  );
}

const IMPORT_STATUSES: ImportShipmentStatus[] = [
  "Ordered",
  "In Transit",
  "Arrived Port",
  "Clearance",
  "Customs Cleared",
  "Warehouse Received",
  "Cancelled",
];

const EXPORT_STATUSES: ExportShipmentStatus[] = [
  "Preparing",
  "Docs Ready",
  "Dispatched",
  "In Transit",
  "Delivered",
  "Cancelled",
];

export function ReturnsModule({
  store,
  focusId,
  onFocusConsumed,
}: {
  store: TlbStoreApi;
  focusId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const [tab, setTab] = useState<"customer" | "supplier">("customer");
  const [detailId, setDetailId] = useState<string | null>(null);

  // Customer form
  const [customerId, setCustomerId] = useState(store.state.customers[0]?.id ?? "");
  const [orderId, setOrderId] = useState("");
  const [productId, setProductId] = useState(store.state.products[0]?.id ?? "");
  const [batchId, setBatchId] = useState("");
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState<"Sellable" | "Damaged" | "Opened" | "Expired" | "Other">("Damaged");
  const [warehouseId, setWarehouseId] = useState("wh-main");
  const [disposition, setDisposition] = useState<ReturnDisposition>("usable");

  // Supplier form
  const [supplierId, setSupplierId] = useState(store.state.suppliers[0]?.id ?? "");
  const [grnId, setGrnId] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [replacement, setReplacement] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (focusId) {
      setDetailId(focusId);
      onFocusConsumed?.();
    }
  }, [focusId, onFocusConsumed]);

  const customerReturns = (store.state.customerReturns ?? []).filter((r) => !isSoftDeleted(r));
  const supplierReturns = (store.state.supplierReturns ?? []).filter((r) => !isSoftDeleted(r));

  const custDetail = customerReturns.find((r) => r.id === detailId);
  const supDetail = supplierReturns.find((r) => r.id === detailId);
  const detail = custDetail ?? supDetail;

  if (detail) {
    const isCust = Boolean(custDetail);
    const party = isCust
      ? store.state.customers.find((c) => c.id === (detail as typeof custDetail)!.customerId)?.name
      : store.state.suppliers.find((s) => s.id === (detail as typeof supDetail)!.supplierId)?.name;
    const product = store.state.products.find((p) => p.id === detail.productId);
    return (
      <div className="tlb-module tlb-record-detail">
        <div className="tlb-module-toolbar">
          <div>
            <span className="tlb-eyebrow">{isCust ? "Customer return" : "Supplier return"}</span>
            <strong>{detail.number}</strong>
            <p className="tlb-muted-line">{party} · {product?.sku}</p>
          </div>
          <div className="tlb-inline-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                store.moveToTrash({
                  entityType: isCust ? "customer_return" : "supplier_return",
                  entityId: detail.id,
                })
              }
            >
              Move to trash
            </Button>
            <Button type="button" variant="outline" onClick={() => setDetailId(null)}>
              Back
            </Button>
          </div>
        </div>
        <article className="tlb-panel">
          <div className="tlb-kv-grid" style={{ padding: 16 }}>
            <div>
              <span>Status</span>
              <strong>
                <StatusBadge tone={statusTone(detail.status)}>{detail.status}</StatusBadge>
              </strong>
            </div>
            <div>
              <span>Qty</span>
              <strong>{detail.quantity}</strong>
            </div>
            <div>
              <span>Reason</span>
              <strong>{detail.reason}</strong>
            </div>
            {isCust ? (
              <>
                <div>
                  <span>Condition</span>
                  <strong>{(detail as typeof custDetail)!.condition}</strong>
                </div>
                <div>
                  <span>Disposition</span>
                  <strong>{(detail as typeof custDetail)!.disposition}</strong>
                </div>
                <div>
                  <span>Received by</span>
                  <strong>{(detail as typeof custDetail)!.receivedBy}</strong>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>Credit note</span>
                  <strong>{(detail as typeof supDetail)!.creditNoteRef ?? "—"}</strong>
                </div>
                <div>
                  <span>Replacement</span>
                  <strong>{(detail as typeof supDetail)!.replacementExpected ? "Yes" : "No"}</strong>
                </div>
                <div>
                  <span>Requested by</span>
                  <strong>{(detail as typeof supDetail)!.requestedBy}</strong>
                </div>
              </>
            )}
            <div>
              <span>Approved by</span>
              <strong>{detail.approvedBy ?? "—"}</strong>
            </div>
            <div>
              <span>Notes</span>
              <strong>{detail.notes ?? "—"}</strong>
            </div>
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
          <strong>Returns</strong>
          <p className="tlb-muted-line">Customer & supplier returns with immutable ledger movements</p>
        </div>
        <Button type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Close form" : "New return"}
        </Button>
      </div>
      <section className="tlb-filter-bar tlb-module-filters">
        <div className="tlb-periods">
          <button type="button" className={tab === "customer" ? "active" : ""} onClick={() => setTab("customer")}>
            Customer returns
          </button>
          <button type="button" className={tab === "supplier" ? "active" : ""} onClick={() => setTab("supplier")}>
            Supplier returns
          </button>
        </div>
      </section>
      {open ? (
        <article className="tlb-panel" style={{ padding: 16, display: "grid", gap: 12 }}>
          {tab === "customer" ? (
            <>
              <div className="tlb-form-grid">
                <label>
                  Customer
                  <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    {store.state.customers.filter((c) => !isSoftDeleted(c)).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Order
                  <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                    <option value="">— Optional —</option>
                    {store.state.orders
                      .filter((o) => o.customerId === customerId && !isSoftDeleted(o))
                      .map((o) => (
                        <option key={o.id} value={o.id}>{o.number}</option>
                      ))}
                  </select>
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
                  Batch
                  <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                    <option value="">— Optional —</option>
                    {store.state.batches
                      .filter((b) => b.productId === productId)
                      .map((b) => (
                        <option key={b.id} value={b.id}>{b.code}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Qty
                  <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                </label>
                <label>
                  Condition
                  <select value={condition} onChange={(e) => setCondition(e.target.value as typeof condition)}>
                    {(["Sellable", "Damaged", "Opened", "Expired", "Other"] as const).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Disposition
                  <select value={disposition} onChange={(e) => setDisposition(e.target.value as ReturnDisposition)}>
                    <option value="usable">Usable</option>
                    <option value="quarantine">Quarantine</option>
                    <option value="damage">Damage</option>
                    <option value="supplier_return">Supplier return</option>
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
                  Reason
                  <input value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
              </div>
              <Button
                type="button"
                onClick={() => {
                  const ok = store.postCustomerReturn({
                    customerId,
                    orderId: orderId || undefined,
                    productId,
                    batchId: batchId || undefined,
                    quantity: qty,
                    reason,
                    condition,
                    warehouseId,
                    disposition,
                  });
                  if (ok) {
                    setOpen(false);
                    setReason("");
                  }
                }}
              >
                Post customer return
              </Button>
            </>
          ) : (
            <>
              <div className="tlb-form-grid">
                <label>
                  Supplier
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    {store.state.suppliers.filter((s) => !isSoftDeleted(s)).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
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
                  Batch
                  <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                    <option value="">— Optional —</option>
                    {store.state.batches
                      .filter((b) => b.productId === productId)
                      .map((b) => (
                        <option key={b.id} value={b.id}>{b.code}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Related GRN
                  <select value={grnId} onChange={(e) => setGrnId(e.target.value)}>
                    <option value="">— Optional —</option>
                    {store.state.goodsReceipts
                      .filter((g) => g.supplierId === supplierId)
                      .map((g) => (
                        <option key={g.id} value={g.id}>{g.number}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Qty
                  <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                </label>
                <label>
                  Credit note
                  <input value={creditNote} onChange={(e) => setCreditNote(e.target.value)} />
                </label>
                <label className="tlb-check-row">
                  <input type="checkbox" checked={replacement} onChange={(e) => setReplacement(e.target.checked)} />
                  Replacement expected
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
                  Reason
                  <input value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
              </div>
              <Button
                type="button"
                onClick={() => {
                  const ok = store.postSupplierReturn({
                    supplierId,
                    productId,
                    batchId: batchId || undefined,
                    quantity: qty,
                    reason,
                    warehouseId,
                    grnId: grnId || undefined,
                    creditNoteRef: creditNote || undefined,
                    replacementExpected: replacement,
                  });
                  if (ok) {
                    setOpen(false);
                    setReason("");
                  }
                }}
              >
                Post supplier return
              </Button>
            </>
          )}
        </article>
      ) : null}
      <article className="tlb-panel tlb-orders-panel">
        {(tab === "customer" ? customerReturns : supplierReturns).length === 0 ? (
          <EmptyState title="No returns" detail="Posted returns will appear here." />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Party</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(tab === "customer" ? customerReturns : supplierReturns).map((r) => {
                  const party =
                    tab === "customer"
                      ? store.state.customers.find((c) => c.id === (r as (typeof customerReturns)[0]).customerId)?.name
                      : store.state.suppliers.find((s) => s.id === (r as (typeof supplierReturns)[0]).supplierId)?.name;
                  const product = store.state.products.find((p) => p.id === r.productId);
                  return (
                    <tr key={r.id}>
                      <td><strong>{r.number}</strong></td>
                      <td>{party}</td>
                      <td>{product?.sku}</td>
                      <td>{r.quantity}</td>
                      <td><StatusBadge tone={statusTone(r.status)}>{r.status}</StatusBadge></td>
                      <td>
                        <button type="button" aria-label="Open return" onClick={() => setDetailId(r.id)}>
                          <ChevronRight />
                        </button>
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

export function NonPoPurchasesModule({
  store,
  focusId,
  onFocusConsumed,
  onOpenGrn,
}: {
  store: TlbStoreApi;
  focusId?: string | null;
  onFocusConsumed?: () => void;
  onOpenGrn?: (grnId: string) => void;
}) {
  const [detailId, setDetailId] = useState<string | null>(focusId ?? null);
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState(store.state.suppliers[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState("wh-main");
  const [reason, setReason] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [productId, setProductId] = useState(store.state.products[0]?.id ?? "");
  const [qty, setQty] = useState(1);
  const [unitPrice, setUnitPrice] = useState(100);

  useEffect(() => {
    if (focusId) {
      setDetailId(focusId);
      onFocusConsumed?.();
    }
  }, [focusId, onFocusConsumed]);

  const rows = (store.state.nonPoPurchases ?? []).filter((n) => !isSoftDeleted(n));
  const detail = rows.find((n) => n.id === detailId);

  if (detail) {
    const lines = (store.state.nonPoPurchaseLines ?? []).filter((l) => l.nonPoId === detail.id);
    const supplier = store.state.suppliers.find((s) => s.id === detail.supplierId);
    return (
      <div className="tlb-module tlb-record-detail">
        <div className="tlb-module-toolbar">
          <div>
            <span className="tlb-eyebrow">Non-PO purchase</span>
            <strong>{detail.number}</strong>
            <p className="tlb-muted-line">{supplier?.name} · {detail.status}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => setDetailId(null)}>Back</Button>
        </div>
        <article className="tlb-panel">
          <div className="tlb-kv-grid" style={{ padding: 16 }}>
            <div><span>Reason</span><strong>{detail.reason}</strong></div>
            <div><span>Requested by</span><strong>{detail.requestedBy}</strong></div>
            <div><span>Approved by</span><strong>{detail.approvedBy ?? "—"}</strong></div>
            <div><span>Invoice / receipt</span><strong>{[detail.invoiceRef, detail.receiptRef].filter(Boolean).join(" / ") || "—"}</strong></div>
            <div><span>Warehouse</span><strong>{store.state.warehouses.find((w) => w.id === detail.warehouseId)?.name}</strong></div>
            <div>
              <span>GRN</span>
              <strong>
                {detail.grnId ? (
                  <button type="button" className="tlb-text-link" onClick={() => onOpenGrn?.(detail.grnId!)}>
                    {store.state.goodsReceipts.find((g) => g.id === detail.grnId)?.number ?? detail.grnId}
                  </button>
                ) : (
                  "—"
                )}
              </strong>
            </div>
          </div>
          <div className="tlb-inline-actions" style={{ padding: 16 }}>
            {detail.status === "Pending Approval" ? (
              <>
                <Button type="button" onClick={() => store.decideNonPo(detail.id, "Approved")}>Approve</Button>
                <Button type="button" variant="outline" onClick={() => store.decideNonPo(detail.id, "Rejected")}>Reject</Button>
              </>
            ) : null}
            {detail.status === "Approved" ? (
              <Button type="button" onClick={() => store.receiveNonPo(detail.id)}>Post GRN / goods in</Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => store.moveToTrash({ entityType: "non_po_purchase", entityId: detail.id })}
            >
              Move to trash
            </Button>
          </div>
        </article>
        <article className="tlb-panel tlb-orders-panel">
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Unit price</th>
                  <th>Line total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const p = store.state.products.find((x) => x.id === l.productId);
                  return (
                    <tr key={l.id}>
                      <td>{p?.name}</td>
                      <td>{l.quantity}</td>
                      <td>{formatMoney(l.unitPrice)}</td>
                      <td>{formatMoney(l.quantity * l.unitPrice)}</td>
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
          <span className="tlb-eyebrow">Procurement</span>
          <strong>Non-PO Purchases</strong>
          <p className="tlb-muted-line">Request → approval gate → GRN goods in</p>
        </div>
        <Button type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Close form" : "New Non-PO"}
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
              Product
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                {store.state.products.map((p) => (
                  <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>
                ))}
              </select>
            </label>
            <label>
              Qty
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </label>
            <label>
              Unit price
              <input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} />
            </label>
            <label>
              Invoice / receipt ref
              <input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />
            </label>
            <label>
              Reason (required)
              <input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          </div>
          <Button
            type="button"
            onClick={() => {
              const ok = store.createNonPo({
                supplierId,
                warehouseId,
                reason,
                invoiceRef: invoiceRef || undefined,
                lines: [{ productId, quantity: qty, unitPrice }],
              });
              if (ok) {
                setOpen(false);
                setReason("");
              }
            }}
          >
            Submit for approval
          </Button>
        </article>
      ) : null}
      <article className="tlb-panel tlb-orders-panel">
        {rows.length === 0 ? (
          <EmptyState title="No Non-PO purchases" detail="Submit a Non-PO request to start the approval workflow." />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Supplier</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id}>
                    <td><strong>{n.number}</strong></td>
                    <td>{store.state.suppliers.find((s) => s.id === n.supplierId)?.name}</td>
                    <td>{n.reason}</td>
                    <td><StatusBadge tone={statusTone(n.status)}>{n.status}</StatusBadge></td>
                    <td>{n.requestedAt.slice(0, 10)}</td>
                    <td>
                      <button type="button" aria-label="Open Non-PO" onClick={() => setDetailId(n.id)}>
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

export function LiveImportExportModule({
  store,
  focusId,
  onFocusConsumed,
  onOpenGrn,
}: {
  store: TlbStoreApi;
  focusId?: string | null;
  onFocusConsumed?: () => void;
  onOpenGrn?: (id: string) => void;
}) {
  const [tab, setTab] = useState<"import" | "export">("import");
  const [detailId, setDetailId] = useState<string | null>(focusId ?? null);
  const [open, setOpen] = useState(false);

  const [supplierId, setSupplierId] = useState(store.state.suppliers[0]?.id ?? "");
  const [customerId, setCustomerId] = useState(store.state.customers[0]?.id ?? "");
  const [origin, setOrigin] = useState("China");
  const [dest, setDest] = useState("Ghana");
  const [container, setContainer] = useState("");
  const [line, setLine] = useState("");
  const [status, setStatus] = useState<ImportShipmentStatus>("Ordered");
  const [exportStatus, setExportStatus] = useState<ExportShipmentStatus>("Preparing");
  const [warehouseId, setWarehouseId] = useState("wh-main");
  const [productId, setProductId] = useState(store.state.products[0]?.id ?? "");
  const [qty, setQty] = useState(10);
  const [poId, setPoId] = useState("");

  useEffect(() => {
    if (focusId) {
      setDetailId(focusId);
      onFocusConsumed?.();
    }
  }, [focusId, onFocusConsumed]);

  const imports = (store.state.importShipments ?? []).filter((s) => !isSoftDeleted(s));
  const exports = (store.state.exportShipments ?? []).filter((s) => !isSoftDeleted(s));
  const impDetail = imports.find((s) => s.id === detailId);
  const expDetail = exports.find((s) => s.id === detailId);

  if (impDetail) {
    const lines = (store.state.importShipmentLines ?? []).filter((l) => l.shipmentId === impDetail.id);
    return (
      <div className="tlb-module tlb-record-detail">
        <div className="tlb-module-toolbar">
          <div>
            <span className="tlb-eyebrow">Import shipment</span>
            <strong>{impDetail.number}</strong>
            <p className="tlb-muted-line">{impDetail.originCountry} → {store.state.warehouses.find((w) => w.id === impDetail.warehouseId)?.name}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => setDetailId(null)}>Back</Button>
        </div>
        <article className="tlb-panel">
          <div className="tlb-kv-grid" style={{ padding: 16 }}>
            <div><span>Supplier</span><strong>{store.state.suppliers.find((s) => s.id === impDetail.supplierId)?.name}</strong></div>
            <div><span>Status</span><strong><StatusBadge tone={statusTone(impDetail.status)}>{impDetail.status}</StatusBadge></strong></div>
            <div><span>Container</span><strong>{impDetail.containerRef ?? "—"}</strong></div>
            <div><span>Shipping line</span><strong>{impDetail.shippingLine ?? "—"}</strong></div>
            <div><span>ETD / ETA</span><strong>{impDetail.etd ?? "—"} / {impDetail.eta ?? "—"}</strong></div>
            <div><span>Customs docs</span><strong>{impDetail.customsDocs ?? "—"}</strong></div>
            <div><span>Freight / duty</span><strong>{formatMoney(impDetail.freightCost ?? 0)} / {formatMoney(impDetail.dutyCost ?? 0)}</strong></div>
            <div>
              <span>GRN</span>
              <strong>
                {impDetail.grnId ? (
                  <button type="button" className="tlb-text-link" onClick={() => onOpenGrn?.(impDetail.grnId!)}>
                    Open GRN
                  </button>
                ) : (
                  "—"
                )}
              </strong>
            </div>
          </div>
          <div className="tlb-inline-actions" style={{ padding: 16 }}>
            {impDetail.status !== "Warehouse Received" && impDetail.status !== "Cancelled" ? (
              <Button type="button" onClick={() => store.receiveImport(impDetail.id)}>Receive to warehouse (GRN)</Button>
            ) : null}
            <label className="tlb-select">
              Advance status
              <select
                value={impDetail.status}
                onChange={(e) => {
                  const linesInput = lines.map((l) => ({
                    productId: l.productId,
                    quantity: l.quantity,
                    unitCost: l.unitCost,
                  }));
                  store.upsertImport({
                    id: impDetail.id,
                    supplierId: impDetail.supplierId,
                    originCountry: impDetail.originCountry,
                    purchaseOrderId: impDetail.purchaseOrderId,
                    containerRef: impDetail.containerRef,
                    shippingLine: impDetail.shippingLine,
                    etd: impDetail.etd,
                    eta: impDetail.eta,
                    clearanceNotes: impDetail.clearanceNotes,
                    customsDocs: impDetail.customsDocs,
                    warehouseId: impDetail.warehouseId,
                    status: e.target.value as ImportShipmentStatus,
                    freightCost: impDetail.freightCost,
                    dutyCost: impDetail.dutyCost,
                    notes: impDetail.notes,
                    lines: linesInput,
                  });
                }}
              >
                {IMPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
        </article>
        <article className="tlb-panel tlb-orders-panel">
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr><th>Product</th><th>Qty</th><th>Unit cost</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>{store.state.products.find((p) => p.id === l.productId)?.name}</td>
                    <td>{l.quantity}</td>
                    <td>{formatMoney(l.unitCost ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    );
  }

  if (expDetail) {
    const lines = (store.state.exportShipmentLines ?? []).filter((l) => l.shipmentId === expDetail.id);
    return (
      <div className="tlb-module tlb-record-detail">
        <div className="tlb-module-toolbar">
          <div>
            <span className="tlb-eyebrow">Export shipment</span>
            <strong>{expDetail.number}</strong>
            <p className="tlb-muted-line">→ {expDetail.destinationCountry}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => setDetailId(null)}>Back</Button>
        </div>
        <article className="tlb-panel">
          <div className="tlb-kv-grid" style={{ padding: 16 }}>
            <div><span>Customer</span><strong>{store.state.customers.find((c) => c.id === expDetail.customerId)?.name}</strong></div>
            <div><span>Status</span><strong><StatusBadge tone={statusTone(expDetail.status)}>{expDetail.status}</StatusBadge></strong></div>
            <div><span>Carrier</span><strong>{expDetail.carrier ?? "—"}</strong></div>
            <div><span>Docs</span><strong>{expDetail.docsRef ?? "—"}</strong></div>
            <div><span>Staff</span><strong>{expDetail.staffName}</strong></div>
          </div>
          <div className="tlb-inline-actions" style={{ padding: 16 }}>
            <label className="tlb-select">
              Advance status
              <select
                value={expDetail.status}
                onChange={(e) => {
                  store.upsertExport({
                    id: expDetail.id,
                    customerId: expDetail.customerId,
                    destinationCountry: expDetail.destinationCountry,
                    carrier: expDetail.carrier,
                    docsRef: expDetail.docsRef,
                    status: e.target.value as ExportShipmentStatus,
                    staffName: expDetail.staffName,
                    notes: expDetail.notes,
                    lines: lines.map((l) => ({
                      productId: l.productId,
                      batchId: l.batchId,
                      quantity: l.quantity,
                    })),
                  });
                }}
              >
                {EXPORT_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
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
          <span className="tlb-eyebrow">Operations</span>
          <strong>Import & Export</strong>
          <p className="tlb-muted-line">Shipment tracking with GRN / goods-out links</p>
        </div>
        <Button type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Close form" : tab === "import" ? "New import" : "New export"}
        </Button>
      </div>
      <section className="tlb-filter-bar tlb-module-filters">
        <div className="tlb-periods">
          <button type="button" className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}>Imports</button>
          <button type="button" className={tab === "export" ? "active" : ""} onClick={() => setTab("export")}>Exports</button>
        </div>
      </section>
      {open ? (
        <article className="tlb-panel" style={{ padding: 16, display: "grid", gap: 12 }}>
          {tab === "import" ? (
            <>
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
                  Origin country
                  <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
                </label>
                <label>
                  Supplier PO
                  <select value={poId} onChange={(e) => setPoId(e.target.value)}>
                    <option value="">— Optional —</option>
                    {store.state.supplierPurchaseOrders
                      .filter((p) => p.supplierId === supplierId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.number}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Container
                  <input value={container} onChange={(e) => setContainer(e.target.value)} />
                </label>
                <label>
                  Shipping line
                  <input value={line} onChange={(e) => setLine(e.target.value)} />
                </label>
                <label>
                  Status
                  <select value={status} onChange={(e) => setStatus(e.target.value as ImportShipmentStatus)}>
                    {IMPORT_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Warehouse dest
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
              </div>
              <Button
                type="button"
                onClick={() => {
                  const ok = store.upsertImport({
                    supplierId,
                    originCountry: origin,
                    purchaseOrderId: poId || undefined,
                    containerRef: container || undefined,
                    shippingLine: line || undefined,
                    warehouseId,
                    status,
                    lines: [{ productId, quantity: qty }],
                  });
                  if (ok) setOpen(false);
                }}
              >
                Save import shipment
              </Button>
            </>
          ) : (
            <>
              <div className="tlb-form-grid">
                <label>
                  Customer
                  <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    {store.state.customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Destination
                  <input value={dest} onChange={(e) => setDest(e.target.value)} />
                </label>
                <label>
                  Carrier
                  <input value={line} onChange={(e) => setLine(e.target.value)} />
                </label>
                <label>
                  Status
                  <select value={exportStatus} onChange={(e) => setExportStatus(e.target.value as ExportShipmentStatus)}>
                    {EXPORT_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
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
                onClick={() => {
                  const ok = store.upsertExport({
                    customerId,
                    destinationCountry: dest,
                    carrier: line || undefined,
                    status: exportStatus,
                    lines: [{ productId, quantity: qty }],
                  });
                  if (ok) setOpen(false);
                }}
              >
                Save export shipment
              </Button>
            </>
          )}
        </article>
      ) : null}
      <article className="tlb-panel tlb-orders-panel">
        {(tab === "import" ? imports : exports).length === 0 ? (
          <EmptyState title="No shipments" detail="Create an import or export shipment to track status." />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>{tab === "import" ? "Origin" : "Destination"}</th>
                  <th>Party</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(tab === "import" ? imports : exports).map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.number}</strong></td>
                    <td>{"originCountry" in s ? s.originCountry : s.destinationCountry}</td>
                    <td>
                      {"supplierId" in s
                        ? store.state.suppliers.find((x) => x.id === s.supplierId)?.name
                        : store.state.customers.find((x) => x.id === s.customerId)?.name}
                    </td>
                    <td><StatusBadge tone={statusTone(s.status)}>{s.status}</StatusBadge></td>
                    <td>
                      <button type="button" aria-label="Open shipment" onClick={() => setDetailId(s.id)}>
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

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function StockAgeingModule({ store }: { store: TlbStoreApi }) {
  const [band, setBand] = useState<"All" | StockAgeingRow["band"]>("All");
  const [velocity, setVelocity] = useState<"All" | "Fast" | "Slow" | "Dead">("All");
  const ageing = useMemo(() => stockAgeingReport(store.state), [store.state]);
  const velocities = useMemo(() => stockVelocityReport(store.state), [store.state]);
  const filteredAge = band === "All" ? ageing : ageing.filter((r) => r.band === band);
  const filteredVel = velocity === "All" ? velocities : velocities.filter((r) => r.velocity === velocity);

  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Inventory analytics</span>
          <strong>Stock ageing & velocity</strong>
          <p className="tlb-muted-line">Bands 0–30 / 31–90 / 91–180 / 181–365 / 365+ · Fast / Slow / Dead</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            downloadCsv(
              "stock-ageing.csv",
              toCsv(
                filteredAge.map((r) => ({
                  batch: r.batchCode,
                  sku: r.productSku,
                  qty: r.remainingQty,
                  value: r.value,
                  ageDays: r.ageDays,
                  band: r.band,
                })),
              ),
            );
          }}
        >
          <Download /> CSV ageing
        </Button>
      </div>
      <section className="tlb-filter-bar tlb-module-filters">
        <div className="tlb-periods">
          {(["All", "0-30", "31-90", "91-180", "181-365", "365+"] as const).map((b) => (
            <button key={b} type="button" className={band === b ? "active" : ""} onClick={() => setBand(b)}>
              {b}
            </button>
          ))}
        </div>
      </section>
      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Product</th>
                <th>Warehouse</th>
                <th>Qty</th>
                <th>Value</th>
                <th>Age</th>
                <th>Band</th>
              </tr>
            </thead>
            <tbody>
              {filteredAge.length === 0 ? (
                <tr><td colSpan={7}><EmptyState title="No batches" detail="No stock in this ageing band." /></td></tr>
              ) : (
                filteredAge.map((r) => (
                  <tr key={r.batchId}>
                    <td><strong>{r.batchCode}</strong></td>
                    <td>{r.productSku}</td>
                    <td>{r.warehouseName}</td>
                    <td>{r.remainingQty}</td>
                    <td>{formatMoney(r.value)}</td>
                    <td>{r.ageDays}d</td>
                    <td><StatusBadge tone={r.band === "365+" || r.band === "181-365" ? "danger" : r.band === "0-30" ? "success" : "warning"}>{r.band}</StatusBadge></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
      <section className="tlb-filter-bar tlb-module-filters">
        <div className="tlb-periods">
          {(["All", "Fast", "Slow", "Dead"] as const).map((v) => (
            <button key={v} type="button" className={velocity === v ? "active" : ""} onClick={() => setVelocity(v)}>
              {v}
            </button>
          ))}
        </div>
      </section>
      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-panel-heading">
          <div>
            <span>Velocity</span>
            <strong>Fast / slow / dead stock</strong>
          </div>
        </div>
        <div className="tlb-table-scroll">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>On hand</th>
                <th>Out 30d</th>
                <th>Days cover</th>
                <th>Class</th>
              </tr>
            </thead>
            <tbody>
              {filteredVel.map((r) => (
                <tr key={r.productId}>
                  <td><strong>{r.productSku}</strong> · {r.productName}</td>
                  <td>{r.onHand}</td>
                  <td>{r.outbound30d}</td>
                  <td>{r.daysOfCover ?? "—"}</td>
                  <td><StatusBadge tone={r.velocity === "Dead" ? "danger" : r.velocity === "Slow" ? "warning" : "success"}>{r.velocity}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
