import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { statusTone } from "@/lib/domain/calculations";
import {
  customerOutstandingReport,
  fulfilmentPerformanceReport,
  outstandingOrdersReport,
  partialSupplyReport,
  toCsv,
} from "@/lib/domain/reports";
import { ALL_PERMISSIONS, PERMISSION_LABELS, listAssignableRoles } from "@/lib/domain/permissions";
import type {
  DeliveryStatus,
  PaymentMethod,
  Permission,
} from "@/lib/domain/types";
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

const METHODS: PaymentMethod[] = ["Cash", "Bank Transfer", "Mobile Money", "Cheque", "Card", "Other"];
const DELIVERY_STATUSES: DeliveryStatus[] = ["Preparing", "Ready", "Dispatched", "Delivered", "Failed", "Returned"];

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function FinanceModule({
  store,
  onOpenOrder,
  focusId,
}: {
  store: TlbStoreApi;
  onOpenOrder: (orderId: string) => void;
  focusId?: string | null;
}) {
  const { state } = store;
  const [tab, setTab] = useState<"invoices" | "receipts" | "payments">("invoices");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(focusId ?? state.invoices[0]?.id ?? null);
  const [invoiceForm, setInvoiceForm] = useState({
    orderId: state.orders[0]?.id ?? "",
    supplyId: "",
    vatRateId: state.vatRates.find((v) => v.active)?.id ?? "",
    updateTin: "",
    notes: "",
  });
  const [receiptForm, setReceiptForm] = useState({
    customerId: state.customers[0]?.id ?? "",
    orderId: "",
    invoiceId: "",
    paymentMethod: "Bank Transfer" as PaymentMethod,
    amountPaid: 0,
    notes: "",
    receiptSearch: "",
  });

  const orderSupplies = state.supplies.filter((s) => s.orderId === invoiceForm.orderId);
  const selectedInvoice = state.invoices.find((i) => i.id === selectedInvoiceId) ?? null;
  const invoiceLines = selectedInvoice
    ? state.invoiceLines.filter((l) => l.invoiceId === selectedInvoice.id)
    : [];

  const filteredReceipts = state.receipts.filter((r) => {
    const q = receiptForm.receiptSearch.trim().toLowerCase();
    if (!q) return true;
    return r.number.toLowerCase().includes(q);
  });

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Control · Finance</span>
          <strong>Invoices, receipts & payments</strong>
        </div>
        <div className="tlb-periods">
          {(["invoices", "receipts", "payments"] as const).map((t) => (
            <button type="button" key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {tab === "invoices" && (
        <div className="tlb-split">
          <article className="tlb-panel tlb-form-panel">
            <div className="tlb-panel-heading">
              <div><span>VAT invoice</span><strong>Create from supply</strong></div>
            </div>
            {!store.can("invoice.create") ? (
              <p className="tlb-muted-line" style={{ padding: 12 }}>Your role cannot create invoices.</p>
            ) : (
              <form
                className="tlb-form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  const ok = store.createInvoice({
                    orderId: invoiceForm.orderId,
                    supplyId: invoiceForm.supplyId,
                    vatRateId: invoiceForm.vatRateId,
                    ...(invoiceForm.notes.trim() ? { notes: invoiceForm.notes.trim() } : {}),
                    ...(invoiceForm.updateTin.trim() ? { updateCustomerTin: invoiceForm.updateTin.trim() } : {}),
                  });
                  if (ok) setInvoiceForm((f) => ({ ...f, notes: "", updateTin: "" }));
                }}
              >
                <label>
                  Order
                  <select
                    required
                    value={invoiceForm.orderId}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, orderId: e.target.value, supplyId: "" })}
                  >
                    {state.orders.map((o) => (
                      <option key={o.id} value={o.id}>{o.number}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Supply
                  <select
                    required
                    value={invoiceForm.supplyId}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, supplyId: e.target.value })}
                  >
                    <option value="">Select supply</option>
                    {orderSupplies.map((s) => (
                      <option key={s.id} value={s.id}>{s.number}</option>
                    ))}
                  </select>
                </label>
                <label>
                  VAT rate (from settings)
                  <select
                    required
                    value={invoiceForm.vatRateId}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, vatRateId: e.target.value })}
                  >
                    {state.vatRates.filter((v) => v.active).map((v) => (
                      <option key={v.id} value={v.id}>{v.label} · {v.ratePercent}%</option>
                    ))}
                  </select>
                </label>
                <label>
                  Update customer TIN (optional)
                  <input
                    placeholder="Leave blank to keep profile TIN"
                    value={invoiceForm.updateTin}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, updateTin: e.target.value })}
                  />
                </label>
                <label className="tlb-span-2">
                  Notes
                  <input value={invoiceForm.notes} onChange={(e) => setInvoiceForm({ ...invoiceForm, notes: e.target.value })} />
                </label>
                <div className="tlb-form-actions tlb-span-2">
                  <Button type="submit">Create VAT invoice</Button>
                </div>
              </form>
            )}
          </article>

          <article className="tlb-panel tlb-orders-panel">
            <div className="tlb-panel-heading">
              <div><span>Register</span><strong>{state.invoices.length} invoice(s)</strong></div>
            </div>
            <div className="tlb-table-scroll">
              {state.invoices.length === 0 ? (
                <EmptyState title="No invoices" detail="Create a VAT invoice from a posted supply." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Order</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {state.invoices.map((inv) => {
                      const order = state.orders.find((o) => o.id === inv.orderId);
                      return (
                        <tr key={inv.id} className={selectedInvoiceId === inv.id ? "tlb-row-active" : undefined}>
                          <td><strong>{inv.number}</strong></td>
                          <td>{order?.number}</td>
                          <td>{formatMoney(inv.total)}</td>
                          <td><StatusBadge tone={statusTone(inv.paymentStatus)}>{inv.paymentStatus}</StatusBadge></td>
                          <td>
                            <button type="button" onClick={() => setSelectedInvoiceId(inv.id)} aria-label={`Open ${inv.number}`}>
                              <ChevronRight />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </article>

          {selectedInvoice && (
            <article className="tlb-panel tlb-detail-panel tlb-span-2">
              <div className="tlb-panel-heading">
                <div>
                  <span>{state.company.legalName}</span>
                  <strong>{selectedInvoice.number}</strong>
                </div>
                <button type="button" onClick={() => onOpenOrder(selectedInvoice.orderId)}>
                  Open order <ChevronRight />
                </button>
              </div>
              <dl className="tlb-kv">
                <div><dt>Company</dt><dd>{state.company.tradingName}<div className="tlb-muted-line">{state.company.address}</div></dd></div>
                <div><dt>Date</dt><dd>{new Date(selectedInvoice.invoiceDate).toLocaleString()}</dd></div>
                <div><dt>Customer</dt><dd>{state.customers.find((c) => c.id === selectedInvoice.customerId)?.name}</dd></div>
                <div><dt>Address</dt><dd>{selectedInvoice.billingAddress || "—"}</dd></div>
                <div><dt>TIN</dt><dd>{selectedInvoice.customerTin || "— (optional)"}</dd></div>
                <div><dt>Customer PO #</dt><dd>{selectedInvoice.customerPoNumber || "—"}</dd></div>
                <div><dt>Related order</dt><dd>{state.orders.find((o) => o.id === selectedInvoice.orderId)?.number}</dd></div>
                <div><dt>Related supply</dt><dd>{state.supplies.find((s) => s.id === selectedInvoice.supplyId)?.number ?? "—"}</dd></div>
                <div><dt>Prepared by</dt><dd>{selectedInvoice.preparedBy}</dd></div>
                <div><dt>Payment</dt><dd>{selectedInvoice.paymentStatus}</dd></div>
                <div><dt>Subtotal</dt><dd>{formatMoney(selectedInvoice.subtotal)}</dd></div>
                <div><dt>VAT ({state.vatRates.find((v) => v.id === selectedInvoice.vatRateId)?.ratePercent ?? 0}%)</dt><dd>{formatMoney(selectedInvoice.vatAmount)}</dd></div>
                <div><dt>Total</dt><dd><strong>{formatMoney(selectedInvoice.total)}</strong></dd></div>
              </dl>
              <div className="tlb-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Price</th>
                      <th>Subtotal</th>
                      <th>VAT</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceLines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.description}</td>
                        <td>{l.quantity}</td>
                        <td>{formatMoney(l.unitPrice)}</td>
                        <td>{formatMoney(l.lineSubtotal)}</td>
                        <td>{formatMoney(l.vatAmount)}</td>
                        <td>{formatMoney(l.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}
        </div>
      )}

      {tab === "receipts" && (
        <div className="tlb-split">
          <article className="tlb-panel tlb-form-panel">
            <div className="tlb-panel-heading">
              <div><span>Ordinary receipt</span><strong>TLB-RCT</strong></div>
            </div>
            {!store.can("receipt.create") ? (
              <p className="tlb-muted-line" style={{ padding: 12 }}>Your role cannot create receipts.</p>
            ) : (
              <form
                className="tlb-form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  store.createReceipt({
                    customerId: receiptForm.customerId,
                    paymentMethod: receiptForm.paymentMethod,
                    amountPaid: Number(receiptForm.amountPaid),
                    ...(receiptForm.orderId ? { orderId: receiptForm.orderId } : {}),
                    ...(receiptForm.invoiceId ? { invoiceId: receiptForm.invoiceId } : {}),
                    ...(receiptForm.notes.trim() ? { notes: receiptForm.notes.trim() } : {}),
                  });
                }}
              >
                <label>
                  Customer
                  <select value={receiptForm.customerId} onChange={(e) => setReceiptForm({ ...receiptForm, customerId: e.target.value })}>
                    {state.customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Related order (optional)
                  <select value={receiptForm.orderId} onChange={(e) => setReceiptForm({ ...receiptForm, orderId: e.target.value })}>
                    <option value="">—</option>
                    {state.orders.map((o) => (
                      <option key={o.id} value={o.id}>{o.number}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Related invoice (optional)
                  <select value={receiptForm.invoiceId} onChange={(e) => setReceiptForm({ ...receiptForm, invoiceId: e.target.value })}>
                    <option value="">—</option>
                    {state.invoices.map((i) => (
                      <option key={i.id} value={i.id}>{i.number}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Payment method
                  <select value={receiptForm.paymentMethod} onChange={(e) => setReceiptForm({ ...receiptForm, paymentMethod: e.target.value as PaymentMethod })}>
                    {METHODS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount paid
                  <input type="number" min={0} step="0.01" value={receiptForm.amountPaid} onChange={(e) => setReceiptForm({ ...receiptForm, amountPaid: Number(e.target.value) })} />
                </label>
                <label className="tlb-span-2">
                  Notes
                  <input value={receiptForm.notes} onChange={(e) => setReceiptForm({ ...receiptForm, notes: e.target.value })} />
                </label>
                <div className="tlb-form-actions tlb-span-2">
                  <Button type="submit">Create receipt</Button>
                </div>
              </form>
            )}
          </article>
          <article className="tlb-panel tlb-orders-panel">
            <div className="tlb-panel-heading">
              <div><span>Searchable register</span><strong>Receipts</strong></div>
            </div>
            <div style={{ padding: "0 12px 8px" }}>
              <input
                placeholder="Search receipt number…"
                value={receiptForm.receiptSearch}
                onChange={(e) => setReceiptForm({ ...receiptForm, receiptSearch: e.target.value })}
                aria-label="Search receipt numbers"
              />
            </div>
            <div className="tlb-table-scroll">
              {filteredReceipts.length === 0 ? (
                <EmptyState title="No receipts" detail="Create an ordinary receipt after supply or payment." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Receipt #</th>
                      <th>Customer</th>
                      <th>Date</th>
                      <th>Method</th>
                      <th>Paid</th>
                      <th>Balance</th>
                      <th>By</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReceipts.map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.number}</strong></td>
                        <td>{state.customers.find((c) => c.id === r.customerId)?.name}</td>
                        <td>{new Date(r.receiptDate).toLocaleDateString()}</td>
                        <td>{r.paymentMethod}</td>
                        <td>{formatMoney(r.amountPaid)}</td>
                        <td>{formatMoney(r.balance)}</td>
                        <td>{r.processedBy}</td>
                        <td>
                          {r.orderId ? (
                            <button type="button" onClick={() => onOpenOrder(r.orderId!)} aria-label="Open related order">
                              <ChevronRight />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </article>
        </div>
      )}

      {tab === "payments" && (
        <article className="tlb-panel tlb-orders-panel">
          <div className="tlb-panel-heading">
            <div><span>Payments</span><strong>Recorded receipts of funds</strong></div>
          </div>
          <div className="tlb-table-scroll">
            {state.payments.length === 0 ? (
              <EmptyState title="No payments" detail="Payments are audited when recorded against invoices/receipts." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Payment #</th>
                    <th>Customer</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Invoice</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {state.payments.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.number}</strong></td>
                      <td>{state.customers.find((c) => c.id === p.customerId)?.name}</td>
                      <td>{formatMoney(p.amount)}</td>
                      <td>{p.method}</td>
                      <td>{state.invoices.find((i) => i.id === p.invoiceId)?.number ?? "—"}</td>
                      <td>{p.recordedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </article>
      )}
    </div>
  );
}

export function DeliveriesModule({
  store,
  onOpenOrder,
  focusId,
}: {
  store: TlbStoreApi;
  onOpenOrder: (orderId: string) => void;
  focusId?: string | null;
}) {
  const { state } = store;
  const [selectedId, setSelectedId] = useState(focusId ?? state.deliveries[0]?.id ?? null);
  const [form, setForm] = useState({
    orderId: state.orders[0]?.id ?? "",
    supplyId: "",
    address: "",
    method: "Own fleet",
    vehicle: "",
    driver: "",
    receiverName: "",
    receiverContact: "",
    notes: "",
  });

  const supplies = state.supplies.filter((s) => s.orderId === form.orderId);
  const selected = state.deliveries.find((d) => d.id === selectedId) ?? null;
  const items = selected ? state.deliveryItems.filter((i) => i.deliveryId === selected.id) : [];

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Operations</span>
          <strong>Deliveries</strong>
          <p className="tlb-muted-line">Linked to supplies — order stays open while outstanding remains</p>
        </div>
      </div>
      <div className="tlb-split">
        <article className="tlb-panel tlb-form-panel">
          <div className="tlb-panel-heading">
            <div><span>New delivery</span><strong>From supply</strong></div>
          </div>
          {!store.can("delivery.manage") ? (
            <p className="tlb-muted-line" style={{ padding: 12 }}>Your role cannot manage deliveries.</p>
          ) : (
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const ok = store.createDelivery({
                  orderId: form.orderId,
                  supplyId: form.supplyId,
                  address: form.address,
                  method: form.method,
                  ...(form.vehicle ? { vehicle: form.vehicle } : {}),
                  ...(form.driver ? { driver: form.driver } : {}),
                  ...(form.receiverName ? { receiverName: form.receiverName } : {}),
                  ...(form.receiverContact ? { receiverContact: form.receiverContact } : {}),
                  ...(form.notes ? { notes: form.notes } : {}),
                });
                if (ok) setForm((f) => ({ ...f, supplyId: "", notes: "" }));
              }}
            >
              <label>
                Order
                <select required value={form.orderId} onChange={(e) => {
                  const order = state.orders.find((o) => o.id === e.target.value);
                  const cust = state.customers.find((c) => c.id === order?.customerId);
                  setForm({ ...form, orderId: e.target.value, supplyId: "", address: cust?.address ?? form.address });
                }}>
                  {state.orders.map((o) => (
                    <option key={o.id} value={o.id}>{o.number}</option>
                  ))}
                </select>
              </label>
              <label>
                Supply
                <select required value={form.supplyId} onChange={(e) => setForm({ ...form, supplyId: e.target.value })}>
                  <option value="">Select supply</option>
                  {supplies.map((s) => (
                    <option key={s.id} value={s.id}>{s.number}</option>
                  ))}
                </select>
              </label>
              <label className="tlb-span-2">
                Address
                <input required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </label>
              <label>
                Method
                <input value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} />
              </label>
              <label>
                Vehicle
                <input value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} />
              </label>
              <label>
                Driver
                <input value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value })} />
              </label>
              <label>
                Receiver
                <input value={form.receiverName} onChange={(e) => setForm({ ...form, receiverName: e.target.value })} />
              </label>
              <label>
                Receiver contact
                <input value={form.receiverContact} onChange={(e) => setForm({ ...form, receiverContact: e.target.value })} />
              </label>
              <label className="tlb-span-2">
                Notes
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>
              <div className="tlb-form-actions tlb-span-2">
                <Button type="submit">Create delivery</Button>
              </div>
            </form>
          )}
        </article>

        <article className="tlb-panel tlb-orders-panel">
          <div className="tlb-table-scroll">
            {state.deliveries.length === 0 ? (
              <EmptyState title="No deliveries" detail="Create a delivery from a posted supply." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Delivery #</th>
                    <th>Order</th>
                    <th>Supply</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {state.deliveries.map((d) => (
                    <tr key={d.id} className={selectedId === d.id ? "tlb-row-active" : undefined}>
                      <td><strong>{d.number}</strong></td>
                      <td>{state.orders.find((o) => o.id === d.orderId)?.number}</td>
                      <td>{state.supplies.find((s) => s.id === d.supplyId)?.number}</td>
                      <td><StatusBadge tone={statusTone(d.status)}>{d.status}</StatusBadge></td>
                      <td>
                        <button type="button" onClick={() => setSelectedId(d.id)} aria-label={`Open ${d.number}`}>
                          <ChevronRight />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </article>

        {selected && (
          <article className="tlb-panel tlb-detail-panel tlb-span-2">
            <div className="tlb-panel-heading">
              <div>
                <span>Delivery detail</span>
                <strong>{selected.number}</strong>
              </div>
              <button type="button" onClick={() => onOpenOrder(selected.orderId)}>Open order <ChevronRight /></button>
            </div>
            <dl className="tlb-kv">
              <div><dt>Customer</dt><dd>{state.customers.find((c) => c.id === selected.customerId)?.name}</dd></div>
              <div><dt>Date</dt><dd>{new Date(selected.deliveryDate).toLocaleString()}</dd></div>
              <div><dt>Address</dt><dd>{selected.address}</dd></div>
              <div><dt>Method</dt><dd>{selected.method}</dd></div>
              <div><dt>Vehicle</dt><dd>{selected.vehicle || "—"}</dd></div>
              <div><dt>Driver</dt><dd>{selected.driver || "—"}</dd></div>
              <div><dt>Receiver</dt><dd>{selected.receiverName || "—"} · {selected.receiverContact || "—"}</dd></div>
              <div><dt>Confirmation</dt><dd>{selected.confirmedAt ? new Date(selected.confirmedAt).toLocaleString() : "Pending"}</dd></div>
              <div className="tlb-span-2"><dt>Notes</dt><dd>{selected.notes || "—"}</dd></div>
            </dl>
            <div className="tlb-inline-actions" style={{ padding: 12 }}>
              <label className="tlb-select">
                Status
                <select
                  value={selected.status}
                  disabled={!store.can("delivery.manage")}
                  onChange={(e) => store.setDeliveryStatus(selected.id, e.target.value as DeliveryStatus)}
                >
                  {DELIVERY_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="tlb-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const product = state.products.find((p) => p.id === item.productId);
                    return (
                      <tr key={item.id}>
                        <td>{product?.name}<div className="tlb-muted-line">{product?.sku}</div></td>
                        <td>{item.quantity}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}

export function ReportsModule({ store }: { store: TlbStoreApi }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tab, setTab] = useState<"outstanding" | "partial" | "performance" | "customer">("outstanding");
  const filter = useMemo(() => {
    const f: { from?: string; to?: string } = {};
    if (from) f.from = from;
    if (to) f.to = to;
    return f;
  }, [from, to]);

  if (!store.can("reports.view")) {
    return (
      <div className="tlb-module">
        <EmptyState title="Reports restricted" detail={`Role ${store.state.currentRole} cannot view reports.`} />
      </div>
    );
  }

  const outstanding = outstandingOrdersReport(store.state, filter);
  const partial = partialSupplyReport(store.state, filter);
  const performance = fulfilmentPerformanceReport(store.state, filter);
  const customers = customerOutstandingReport(store.state, filter);

  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Control</span>
          <strong>Fulfilment reports</strong>
        </div>
        <div className="tlb-inline-actions">
          <label className="tlb-select">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="tlb-select">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>
      <section className="tlb-filter-bar tlb-module-filters">
        <div className="tlb-periods">
          {([
            ["outstanding", "Outstanding Orders"],
            ["partial", "Partial Supply"],
            ["performance", "Fulfilment Performance"],
            ["customer", "Customer Outstanding"],
          ] as const).map(([key, label]) => (
            <button type="button" key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {tab === "performance" && (
        <article className="tlb-panel" style={{ marginBottom: 14 }}>
          <dl className="tlb-kv">
            <div><dt>Received</dt><dd>{performance.summary.received}</dd></div>
            <div><dt>Fully supplied</dt><dd>{performance.summary.fullySupplied}</dd></div>
            <div><dt>Partially supplied</dt><dd>{performance.summary.partiallySupplied}</dd></div>
            <div><dt>Awaiting stock</dt><dd>{performance.summary.awaitingStock}</dd></div>
            <div><dt>Avg fulfilment days</dt><dd>{performance.summary.avgFulfilmentDays}</dd></div>
            <div><dt>Overdue lines</dt><dd>{performance.summary.overdueLines}</dd></div>
          </dl>
        </article>
      )}

      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-panel-heading">
          <div><span>Export</span><strong>CSV</strong></div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (tab === "outstanding") downloadCsv("outstanding-orders.csv", toCsv(outstanding));
              else if (tab === "partial") downloadCsv("partial-supply.csv", toCsv(partial));
              else if (tab === "performance") downloadCsv("fulfilment-performance.csv", toCsv(performance.rows));
              else downloadCsv("customer-outstanding.csv", toCsv(customers));
            }}
          >
            <Download /> Export CSV
          </Button>
        </div>
        <div className="tlb-table-scroll">
          {tab === "outstanding" && (
            <table>
              <thead>
                <tr>
                  <th>Order</th><th>Customer</th><th>SKU</th><th>Qty</th><th>Age</th><th>Band</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((r, i) => (
                  <tr key={i}>
                    <td><strong>{r.orderNumber}</strong></td>
                    <td>{r.customerName}</td>
                    <td>{r.productSku}</td>
                    <td>{r.outstandingQty}</td>
                    <td>{r.ageDays}d</td>
                    <td><StatusBadge tone={statusTone(r.ageingBand)}>{r.ageingBand}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "partial" && (
            <table>
              <thead>
                <tr>
                  <th>Order</th><th>Customer</th><th>Fulfilment</th><th>Open lines</th><th>Supplies</th>
                </tr>
              </thead>
              <tbody>
                {partial.map((r) => (
                  <tr key={r.orderNumber}>
                    <td><strong>{r.orderNumber}</strong></td>
                    <td>{r.customerName}</td>
                    <td>{r.fulfilmentPercent}%</td>
                    <td>{r.outstandingLines}</td>
                    <td>{r.supplies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "performance" && (
            <table>
              <thead>
                <tr>
                  <th>Order</th><th>Customer</th><th>Status</th><th>Fulfilment</th><th>Age</th>
                </tr>
              </thead>
              <tbody>
                {performance.rows.map((r) => (
                  <tr key={r.orderNumber}>
                    <td><strong>{r.orderNumber}</strong></td>
                    <td>{r.customerName}</td>
                    <td><StatusBadge tone={statusTone(r.status)}>{r.status}</StatusBadge></td>
                    <td>{r.fulfilmentPercent}%</td>
                    <td>{r.ageDays}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "customer" && (
            <table>
              <thead>
                <tr>
                  <th>Code</th><th>Customer</th><th>Lines</th><th>Qty</th><th>Value</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((r) => (
                  <tr key={r.customerCode}>
                    <td><strong>{r.customerCode}</strong></td>
                    <td>{r.customerName}</td>
                    <td>{r.lines}</td>
                    <td>{r.qty}</td>
                    <td>{formatMoney(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </article>
    </div>
  );
}

export function AuditModule({ store }: { store: TlbStoreApi }) {
  if (!store.can("audit.view")) {
    return <EmptyState title="Audit restricted" detail="Your role cannot view the audit trail." />;
  }
  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Control</span>
          <strong>Audit log</strong>
          <p className="tlb-muted-line">Append-only — users cannot delete audit history</p>
        </div>
      </div>
      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {store.state.audit.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.at).toLocaleString()}</td>
                  <td>{a.actor}</td>
                  <td>{a.action}</td>
                  <td>{a.entityType}</td>
                  <td>{a.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export function SettingsModule({ store }: { store: TlbStoreApi }) {
  const [company, setCompany] = useState(store.state.company);
  const [vat, setVat] = useState({
    id: store.state.vatRates[0]?.id,
    code: store.state.vatRates[0]?.code ?? "CFG",
    label: store.state.vatRates[0]?.label ?? "Configured VAT",
    ratePercent: store.state.vatRates[0]?.ratePercent ?? 0,
    active: true,
  });
  const [ageing, setAgeing] = useState(store.state.ageing);
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(
    store.state.roles.find((r) => r.active)?.id ?? null,
  );
  const [draftPermissions, setDraftPermissions] = useState<Permission[]>([]);
  const [newUser, setNewUser] = useState({ name: "", email: "", roleId: store.state.roles[0]?.id ?? "" });

  const activeRoles = useMemo(() => listAssignableRoles(store.state.roles), [store.state.roles]);
  const selectedRole = store.state.roles.find((r) => r.id === selectedRoleId) ?? null;
  const canManageUsers = store.can("users.manage");
  const canManageSettings = store.can("settings.manage");

  useEffect(() => {
    if (selectedRole) setDraftPermissions([...selectedRole.permissions]);
  }, [selectedRole]);

  const permissionGroups = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const perm of ALL_PERMISSIONS) {
      const module = PERMISSION_LABELS[perm].module;
      const list = groups.get(module) ?? [];
      list.push(perm);
      groups.set(module, list);
    }
    return [...groups.entries()];
  }, []);

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Control</span>
          <strong>Settings</strong>
        </div>
      </div>

      <article className="tlb-panel" style={{ marginBottom: 14 }}>
        <div className="tlb-panel-heading">
          <div><span>Session</span><strong>Signed-in identity (mock auth)</strong></div>
        </div>
        <div className="tlb-inline-actions" style={{ padding: 12 }}>
          <label className="tlb-select">
            Act as user
            <select
              value={store.state.currentUserId}
              onChange={(e) => store.switchUser(e.target.value)}
            >
              {store.state.users.filter((u) => u.active).map((u) => {
                const role = store.state.roles.find((r) => r.id === u.roleId);
                return (
                  <option key={u.id} value={u.id}>
                    {u.name} · {role?.name ?? "—"}
                  </option>
                );
              })}
            </select>
          </label>
          <span className="tlb-muted-line">
            Display: {store.state.currentUser} · Role: {store.state.currentRole}
          </span>
        </div>
      </article>

      {canManageUsers ? (
        <>
          <article className="tlb-panel" style={{ marginBottom: 14 }}>
            <div className="tlb-panel-heading">
              <div><span>Access</span><strong>Users &amp; role assignment</strong></div>
            </div>
            {store.state.users.length === 0 ? (
              <EmptyState title="No users" detail="Create a user to assign roles." />
            ) : (
              <div className="tlb-table-scroll tlb-orders-panel">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Session</th>
                    </tr>
                  </thead>
                  <tbody>
                    {store.state.users.map((user) => (
                      <tr key={user.id}>
                        <td>{user.name}</td>
                        <td>{user.email}</td>
                        <td>
                          <select
                            className="tlb-inline-select"
                            value={user.roleId}
                            disabled={!user.active}
                            onChange={(e) => store.assignUserRole(user.id, e.target.value)}
                          >
                            {activeRoles.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>{user.active ? "Active" : "Inactive"}</td>
                        <td>
                          {store.state.currentUserId === user.id ? (
                            <StatusBadge tone="success">Signed in</StatusBadge>
                          ) : (
                            <button type="button" className="tlb-link-btn" onClick={() => store.switchUser(user.id)}>
                              Switch
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                if (store.saveUser(newUser)) {
                  setNewUser({ name: "", email: "", roleId: activeRoles[0]?.id ?? "" });
                }
              }}
            >
              <label>New user name<input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} /></label>
              <label>Email<input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></label>
              <label>
                Role
                <select value={newUser.roleId} onChange={(e) => setNewUser({ ...newUser, roleId: e.target.value })}>
                  {activeRoles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </label>
              <div className="tlb-form-actions"><Button type="submit">Add user</Button></div>
            </form>
          </article>

          <article className="tlb-panel" style={{ marginBottom: 14 }}>
            <div className="tlb-panel-heading">
              <div><span>Access</span><strong>Roles &amp; permissions</strong></div>
            </div>
            <div className="tlb-roles-layout">
              <div className="tlb-roles-list">
                {activeRoles.length === 0 ? (
                  <EmptyState title="No roles" detail="Create a custom role to get started." />
                ) : (
                  activeRoles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      className={`tlb-role-chip ${selectedRoleId === role.id ? "active" : ""}`}
                      onClick={() => {
                        setSelectedRoleId(role.id);
                        setDraftPermissions([...role.permissions]);
                      }}
                    >
                      <strong>{role.name}</strong>
                      <span>{role.systemKey ? "System" : "Custom"} · {role.permissions.length} caps</span>
                    </button>
                  ))}
                )}
              </div>
              <div className="tlb-roles-detail">
                {selectedRole ? (
                  <>
                    <div className="tlb-inline-actions compact" style={{ marginBottom: 10 }}>
                      <label className="tlb-select" style={{ flex: 1 }}>
                        Role name
                        <input
                          value={selectedRole.name}
                          disabled={!!selectedRole.systemKey}
                          onChange={(e) => store.updateRole(selectedRole.id, { name: e.target.value })}
                        />
                      </label>
                      {!selectedRole.systemKey && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            if (store.deactivateRole(selectedRole.id)) {
                              const next = activeRoles.find((r) => r.id !== selectedRole.id);
                              setSelectedRoleId(next?.id ?? null);
                            }
                          }}
                        >
                          Deactivate
                        </Button>
                      )}
                    </div>
                    <p className="tlb-muted-line" style={{ padding: "0 0 10px" }}>
                      {selectedRole.description || "No description"}
                    </p>
                    <div className="tlb-perm-matrix">
                      {permissionGroups.map(([module, perms]) => (
                        <div key={module} className="tlb-perm-group">
                          <strong>{module}</strong>
                          {perms.map((perm) => (
                            <label key={perm} className="tlb-perm-row">
                              <input
                                type="checkbox"
                                checked={draftPermissions.includes(perm)}
                                onChange={(e) => {
                                  setDraftPermissions((prev) =>
                                    e.target.checked ? [...prev, perm] : prev.filter((p) => p !== perm),
                                  );
                                }}
                              />
                              <span>{PERMISSION_LABELS[perm].label}</span>
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="tlb-form-actions" style={{ paddingTop: 12 }}>
                      <Button
                        type="button"
                        onClick={() => store.updateRole(selectedRole.id, { permissions: draftPermissions })}
                      >
                        Save permissions
                      </Button>
                    </div>
                  </>
                ) : (
                  <EmptyState title="Select a role" detail="Choose a role to edit its permission matrix." />
                )}
              </div>
            </div>
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                if (store.createRole({ name: roleName, description: roleDescription, permissions: ["dashboard.view"] })) {
                  setRoleName("");
                  setRoleDescription("");
                }
              }}
            >
              <label>New role name<input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Procurement" /></label>
              <label>Description<input value={roleDescription} onChange={(e) => setRoleDescription(e.target.value)} placeholder="What this role can access" /></label>
              <div className="tlb-form-actions tlb-span-2"><Button type="submit">Create role</Button></div>
            </form>
          </article>
        </>
      ) : (
        <article className="tlb-panel" style={{ marginBottom: 14 }}>
          <EmptyState title="Users & roles restricted" detail="Owner or Admin required to create roles and assign users." />
        </article>
      )}

      {!canManageSettings ? (
        <EmptyState title="Settings restricted" detail="Manager, Owner, or Admin required to edit company, VAT, and ageing." />
      ) : (
        <>
          <article className="tlb-panel" style={{ marginBottom: 14 }}>
            <div className="tlb-panel-heading">
              <div><span>Company</span><strong>Invoice letterhead</strong></div>
            </div>
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                store.saveCompany(company);
              }}
            >
              <label>Legal name<input value={company.legalName} onChange={(e) => setCompany({ ...company, legalName: e.target.value })} /></label>
              <label>Trading name<input value={company.tradingName} onChange={(e) => setCompany({ ...company, tradingName: e.target.value })} /></label>
              <label className="tlb-span-2">Address<input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} /></label>
              <label>Phone<input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} /></label>
              <label>Email<input value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} /></label>
              <label>Company TIN (optional)<input value={company.tin ?? ""} onChange={(e) => {
                const tin = e.target.value;
                setCompany((prev) => {
                  const next = { ...prev };
                  if (tin) next.tin = tin;
                  else delete next.tin;
                  return next;
                });
              }} /></label>
              <div className="tlb-form-actions tlb-span-2"><Button type="submit">Save company</Button></div>
            </form>
          </article>

          <article className="tlb-panel" style={{ marginBottom: 14 }}>
            <div className="tlb-panel-heading">
              <div><span>VAT rates</span><strong>Configurable — do not hard-code jurisdiction %</strong></div>
            </div>
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                store.saveVatRate({
                  code: vat.code,
                  label: vat.label,
                  ratePercent: vat.ratePercent,
                  active: vat.active,
                  ...(vat.id ? { id: vat.id } : {}),
                });
              }}
            >
              <label>Code<input value={vat.code} onChange={(e) => setVat({ ...vat, code: e.target.value })} /></label>
              <label>Label<input value={vat.label} onChange={(e) => setVat({ ...vat, label: e.target.value })} /></label>
              <label>Rate %<input type="number" min={0} step="0.01" value={vat.ratePercent} onChange={(e) => setVat({ ...vat, ratePercent: Number(e.target.value) })} /></label>
              <div className="tlb-form-actions tlb-span-2"><Button type="submit">Save VAT rate</Button></div>
            </form>
          </article>

          <article className="tlb-panel">
            <div className="tlb-panel-heading">
              <div><span>Outstanding ageing & reminders</span><strong>Thresholds</strong></div>
            </div>
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                store.setAgeing(
                  ageing.normalMaxDays,
                  ageing.attentionMaxDays,
                  ageing.extendedUnfulfilledDays,
                  ageing.expectedApproachingDays,
                );
              }}
            >
              <label>Normal max days<input type="number" min={0} value={ageing.normalMaxDays} onChange={(e) => setAgeing({ ...ageing, normalMaxDays: Number(e.target.value) })} /></label>
              <label>Attention max days<input type="number" min={0} value={ageing.attentionMaxDays} onChange={(e) => setAgeing({ ...ageing, attentionMaxDays: Number(e.target.value) })} /></label>
              <label>Extended unfulfilled days<input type="number" min={1} value={ageing.extendedUnfulfilledDays} onChange={(e) => setAgeing({ ...ageing, extendedUnfulfilledDays: Number(e.target.value) })} /></label>
              <label>Expected approaching days<input type="number" min={0} value={ageing.expectedApproachingDays} onChange={(e) => setAgeing({ ...ageing, expectedApproachingDays: Number(e.target.value) })} /></label>
              <div className="tlb-form-actions tlb-span-2"><Button type="submit">Save reminder settings</Button></div>
            </form>
          </article>
        </>
      )}
    </div>
  );
}
