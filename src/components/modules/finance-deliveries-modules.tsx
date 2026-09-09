import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, Search, X } from "lucide-react";

import {
  EmptyState,
  RecordDetailPage,
  RecordDetailSection,
  StatusBadge,
  matchesSearch,
} from "@/components/modules/record-browser";
import { Button } from "@/components/ui/button";
import { statusTone } from "@/lib/domain/calculations";
import type { DeliveryStatus, PaymentMethod } from "@/lib/domain/types";
import { formatMoney } from "@/lib/store/tlb-store";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

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

function resolveFinanceFocus(
  state: TlbStoreApi["state"],
  focusId: string | null | undefined,
): {
  tab: "invoices" | "receipts" | "payments";
  invoiceId: string | null;
  receiptId: string | null;
  paymentId: string | null;
} | null {
  if (!focusId) return null;
  if (state.invoices.some((i) => i.id === focusId)) {
    return { tab: "invoices", invoiceId: focusId, receiptId: null, paymentId: null };
  }
  if (state.receipts.some((r) => r.id === focusId)) {
    return { tab: "receipts", invoiceId: null, receiptId: focusId, paymentId: null };
  }
  if (state.payments.some((p) => p.id === focusId)) {
    return { tab: "payments", invoiceId: null, receiptId: null, paymentId: focusId };
  }
  return null;
}

export function FinanceModule({
  store,
  onOpenOrder,
  focusId,
  onFocusConsumed,
}: {
  store: TlbStoreApi;
  onOpenOrder: (orderId: string) => void;
  focusId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const { state } = store;
  const initialFocus = resolveFinanceFocus(state, focusId);
  const [tab, setTab] = useState<"invoices" | "receipts" | "payments">(initialFocus?.tab ?? "invoices");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(initialFocus?.invoiceId ?? null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(initialFocus?.receiptId ?? null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(initialFocus?.paymentId ?? null);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [creatingReceipt, setCreatingReceipt] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [receiptSearch, setReceiptSearch] = useState("");
  const [paymentSearch, setPaymentSearch] = useState("");
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
  });

  useEffect(() => {
    const next = resolveFinanceFocus(state, focusId);
    if (!next) return;
    setTab(next.tab);
    setSelectedInvoiceId(next.invoiceId);
    setSelectedReceiptId(next.receiptId);
    setSelectedPaymentId(next.paymentId);
    onFocusConsumed?.();
    // Apply deep-link focus once; parent clears focusId via onFocusConsumed.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot on focusId
  }, [focusId]);

  const orderSupplies = state.supplies.filter((s) => s.orderId === invoiceForm.orderId);

  const filteredInvoices = useMemo(() => {
    return state.invoices.filter((inv) => {
      const order = state.orders.find((o) => o.id === inv.orderId);
      const customer = state.customers.find((c) => c.id === inv.customerId);
      return matchesSearch(
        [inv.number, order?.number, customer?.name, customer?.code, inv.paymentStatus],
        invoiceSearch,
      );
    });
  }, [state.invoices, state.orders, state.customers, invoiceSearch]);

  const filteredReceipts = useMemo(() => {
    return state.receipts.filter((r) => {
      const customer = state.customers.find((c) => c.id === r.customerId);
      return matchesSearch([r.number, customer?.name, r.paymentMethod, r.processedBy], receiptSearch);
    });
  }, [state.receipts, state.customers, receiptSearch]);

  const filteredPayments = useMemo(() => {
    return state.payments.filter((p) => {
      const customer = state.customers.find((c) => c.id === p.customerId);
      const invoice = state.invoices.find((i) => i.id === p.invoiceId);
      return matchesSearch([p.number, customer?.name, p.method, invoice?.number, p.recordedBy], paymentSearch);
    });
  }, [state.payments, state.customers, state.invoices, paymentSearch]);

  const selectedInvoice = state.invoices.find((i) => i.id === selectedInvoiceId) ?? null;
  const selectedReceipt = state.receipts.find((r) => r.id === selectedReceiptId) ?? null;
  const selectedPayment = state.payments.find((p) => p.id === selectedPaymentId) ?? null;

  if (tab === "invoices" && selectedInvoice) {
    const invoiceLines = state.invoiceLines.filter((l) => l.invoiceId === selectedInvoice.id);
    const order = state.orders.find((o) => o.id === selectedInvoice.orderId);
    const customer = state.customers.find((c) => c.id === selectedInvoice.customerId);
    const vat = state.vatRates.find((v) => v.id === selectedInvoice.vatRateId);
    return (
      <RecordDetailPage
        backLabel="Finance · Invoices"
        onBack={() => setSelectedInvoiceId(null)}
        code={selectedInvoice.number}
        title={selectedInvoice.number}
        subtitle={customer?.name ?? "Invoice"}
        badges={<StatusBadge tone={statusTone(selectedInvoice.paymentStatus)}>{selectedInvoice.paymentStatus}</StatusBadge>}
        actions={
          <Button type="button" variant="outline" onClick={() => onOpenOrder(selectedInvoice.orderId)}>
            Open order <ChevronRight />
          </Button>
        }
        flash={<Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />}
      >
        <RecordDetailSection tone="summary" kicker="Amounts" title="Invoice totals" span2>
          <div className="tlb-customer-summary">
            <div className="tlb-customer-summary-tile--info">
              <span>Subtotal</span>
              <strong>{formatMoney(selectedInvoice.subtotal)}</strong>
            </div>
            <div className="tlb-customer-summary-tile--gold">
              <span>VAT ({vat?.ratePercent ?? 0}%)</span>
              <strong>{formatMoney(selectedInvoice.vatAmount)}</strong>
            </div>
            <div className="tlb-customer-summary-tile--success">
              <span>Total</span>
              <strong>{formatMoney(selectedInvoice.total)}</strong>
            </div>
            <div
              className={
                selectedInvoice.total - selectedInvoice.amountPaid > 0
                  ? "tlb-customer-summary-tile--danger"
                  : "tlb-customer-summary-tile--muted"
              }
            >
              <span>Balance</span>
              <strong>{formatMoney(Math.max(0, selectedInvoice.total - selectedInvoice.amountPaid))}</strong>
            </div>
          </div>
        </RecordDetailSection>
        <RecordDetailSection tone="invoices" kicker="Register" title="Invoice details" span2>
          <dl className="tlb-kv">
            <div>
              <dt>Company</dt>
              <dd>
                {state.company.tradingName}
                <div className="tlb-muted-line">{state.company.address}</div>
              </dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{new Date(selectedInvoice.invoiceDate).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Customer</dt>
              <dd>{customer?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>{selectedInvoice.billingAddress || "—"}</dd>
            </div>
            <div>
              <dt>TIN</dt>
              <dd>{selectedInvoice.customerTin || "— (optional)"}</dd>
            </div>
            <div>
              <dt>Customer PO #</dt>
              <dd>{selectedInvoice.customerPoNumber || "—"}</dd>
            </div>
            <div>
              <dt>Related order</dt>
              <dd>{order?.number ?? "—"}</dd>
            </div>
            <div>
              <dt>Related supply</dt>
              <dd>{state.supplies.find((s) => s.id === selectedInvoice.supplyId)?.number ?? "—"}</dd>
            </div>
            <div>
              <dt>Prepared by</dt>
              <dd>{selectedInvoice.preparedBy}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>{selectedInvoice.paymentStatus}</dd>
            </div>
            <div className="tlb-span-2">
              <dt>Notes</dt>
              <dd>{selectedInvoice.notes || "—"}</dd>
            </div>
          </dl>
        </RecordDetailSection>
        <RecordDetailSection tone="lines" kicker="Lines" title="Invoice line items" span2>
          <div className="tlb-table-scroll tlb-orders-panel">
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
        </RecordDetailSection>
      </RecordDetailPage>
    );
  }

  if (tab === "receipts" && selectedReceipt) {
    const customer = state.customers.find((c) => c.id === selectedReceipt.customerId);
    return (
      <RecordDetailPage
        backLabel="Finance · Receipts"
        onBack={() => setSelectedReceiptId(null)}
        code={selectedReceipt.number}
        title={selectedReceipt.number}
        subtitle={customer?.name ?? "Receipt"}
        badges={<StatusBadge tone="success">Paid</StatusBadge>}
        actions={
          selectedReceipt.orderId ? (
            <Button type="button" variant="outline" onClick={() => onOpenOrder(selectedReceipt.orderId!)}>
              Open order <ChevronRight />
            </Button>
          ) : undefined
        }
        flash={<Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />}
      >
        <RecordDetailSection tone="summary" kicker="Amounts" title="Receipt summary" span2>
          <div className="tlb-customer-summary">
            <div className="tlb-customer-summary-tile--success">
              <span>Amount paid</span>
              <strong>{formatMoney(selectedReceipt.amountPaid)}</strong>
            </div>
            <div className="tlb-customer-summary-tile--muted">
              <span>Balance</span>
              <strong>{formatMoney(selectedReceipt.balance)}</strong>
            </div>
            <div className="tlb-customer-summary-tile--info">
              <span>Method</span>
              <strong>{selectedReceipt.paymentMethod}</strong>
            </div>
            <div>
              <span>Date</span>
              <strong>{new Date(selectedReceipt.receiptDate).toLocaleDateString()}</strong>
            </div>
          </div>
        </RecordDetailSection>
        <RecordDetailSection tone="receipts" kicker="Register" title="Receipt details" span2>
          <dl className="tlb-kv">
            <div>
              <dt>Customer</dt>
              <dd>{customer?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Processed by</dt>
              <dd>{selectedReceipt.processedBy}</dd>
            </div>
            <div>
              <dt>Related order</dt>
              <dd>{state.orders.find((o) => o.id === selectedReceipt.orderId)?.number ?? "—"}</dd>
            </div>
            <div>
              <dt>Related invoice</dt>
              <dd>{state.invoices.find((i) => i.id === selectedReceipt.invoiceId)?.number ?? "—"}</dd>
            </div>
            <div className="tlb-span-2">
              <dt>Notes</dt>
              <dd>{selectedReceipt.notes || "—"}</dd>
            </div>
          </dl>
        </RecordDetailSection>
      </RecordDetailPage>
    );
  }

  if (tab === "payments" && selectedPayment) {
    const customer = state.customers.find((c) => c.id === selectedPayment.customerId);
    const invoice = state.invoices.find((i) => i.id === selectedPayment.invoiceId);
    return (
      <RecordDetailPage
        backLabel="Finance · Payments"
        onBack={() => setSelectedPaymentId(null)}
        code={selectedPayment.number}
        title={selectedPayment.number}
        subtitle={customer?.name ?? "Payment"}
        badges={<StatusBadge tone="success">{selectedPayment.method}</StatusBadge>}
        flash={<Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />}
      >
        <RecordDetailSection tone="summary" kicker="Amounts" title="Payment summary" span2>
          <div className="tlb-customer-summary">
            <div className="tlb-customer-summary-tile--success">
              <span>Amount</span>
              <strong>{formatMoney(selectedPayment.amount)}</strong>
            </div>
            <div className="tlb-customer-summary-tile--info">
              <span>Method</span>
              <strong>{selectedPayment.method}</strong>
            </div>
            <div>
              <span>Date</span>
              <strong>{new Date(selectedPayment.paymentDate).toLocaleDateString()}</strong>
            </div>
            <div>
              <span>Invoice</span>
              <strong>{invoice?.number ?? "—"}</strong>
            </div>
          </div>
        </RecordDetailSection>
        <RecordDetailSection tone="payments" kicker="Register" title="Payment details" span2>
          <dl className="tlb-kv">
            <div>
              <dt>Customer</dt>
              <dd>{customer?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Recorded by</dt>
              <dd>{selectedPayment.recordedBy}</dd>
            </div>
            <div>
              <dt>Invoice</dt>
              <dd>{invoice?.number ?? "—"}</dd>
            </div>
            <div>
              <dt>Receipt</dt>
              <dd>{state.receipts.find((r) => r.id === selectedPayment.receiptId)?.number ?? "—"}</dd>
            </div>
            <div className="tlb-span-2">
              <dt>Notes</dt>
              <dd>{selectedPayment.notes || "—"}</dd>
            </div>
          </dl>
        </RecordDetailSection>
      </RecordDetailPage>
    );
  }

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
            <button
              type="button"
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => {
                setTab(t);
                setSelectedInvoiceId(null);
                setSelectedReceiptId(null);
                setSelectedPaymentId(null);
              }}
            >
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {tab === "invoices" ? (
        <>
          <div className="tlb-module-toolbar" style={{ marginTop: 0 }}>
            <div />
            <div className="tlb-toolbar-actions">
              <label className="tlb-module-search">
                <Search aria-hidden />
                <input
                  type="search"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  placeholder="Search invoice #, order, customer…"
                  aria-label="Search invoices"
                />
              </label>
              {store.can("invoice.create") ? (
                <Button type="button" onClick={() => setCreatingInvoice((v) => !v)}>
                  <Plus /> New invoice
                </Button>
              ) : null}
            </div>
          </div>

          {creatingInvoice && store.can("invoice.create") ? (
            <article className="tlb-panel tlb-form-panel tlb-record-detail-section tlb-record-detail-section--invoices">
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
                  if (ok) {
                    setInvoiceForm((f) => ({ ...f, notes: "", updateTin: "", supplyId: "" }));
                    setCreatingInvoice(false);
                  }
                }}
              >
                <div className="tlb-panel-heading">
                  <div>
                    <span>VAT invoice</span>
                    <strong>Create from supply</strong>
                  </div>
                  <button type="button" onClick={() => setCreatingInvoice(false)}>
                    Cancel
                  </button>
                </div>
                <label>
                  Order
                  <select
                    required
                    value={invoiceForm.orderId}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, orderId: e.target.value, supplyId: "" })}
                  >
                    {state.orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.number}
                      </option>
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
                      <option key={s.id} value={s.id}>
                        {s.number}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  VAT rate
                  <select
                    required
                    value={invoiceForm.vatRateId}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, vatRateId: e.target.value })}
                  >
                    {state.vatRates
                      .filter((v) => v.active)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label} · {v.ratePercent}%
                        </option>
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
                  <input
                    value={invoiceForm.notes}
                    onChange={(e) => setInvoiceForm({ ...invoiceForm, notes: e.target.value })}
                  />
                </label>
                <div className="tlb-form-actions tlb-span-2">
                  <Button type="submit">Create VAT invoice</Button>
                </div>
              </form>
            </article>
          ) : null}

          <article className="tlb-panel tlb-orders-panel tlb-customers-list-panel">
            <div className="tlb-table-scroll">
              {state.invoices.length === 0 ? (
                <EmptyState title="No invoices" detail="Create a VAT invoice from a posted supply." />
              ) : filteredInvoices.length === 0 ? (
                <EmptyState title="No invoices match your search." detail="Try another number, order, or customer." />
              ) : (
                <table className="tlb-customers-table">
                  <thead>
                    <tr>
                      <th className="tlb-col-priority">Invoice</th>
                      <th className="tlb-col-priority">Customer</th>
                      <th className="tlb-col-priority">Order</th>
                      <th className="tlb-col-priority">Total</th>
                      <th className="tlb-col-priority">Date</th>
                      <th className="tlb-col-priority">Status</th>
                      <th>
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInvoices.map((inv) => {
                      const order = state.orders.find((o) => o.id === inv.orderId);
                      const customer = state.customers.find((c) => c.id === inv.customerId);
                      return (
                        <tr
                          key={inv.id}
                          className="tlb-row-clickable"
                          tabIndex={0}
                          onClick={() => setSelectedInvoiceId(inv.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedInvoiceId(inv.id);
                            }
                          }}
                        >
                          <td className="tlb-col-priority">
                            <strong>{inv.number}</strong>
                          </td>
                          <td className="tlb-col-priority">{customer?.name ?? "—"}</td>
                          <td className="tlb-col-priority">{order?.number ?? "—"}</td>
                          <td className="tlb-col-priority">{formatMoney(inv.total)}</td>
                          <td className="tlb-col-priority">{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                          <td className="tlb-col-priority">
                            <StatusBadge tone={statusTone(inv.paymentStatus)}>{inv.paymentStatus}</StatusBadge>
                          </td>
                          <td>
                            <button type="button" aria-label={`Open ${inv.number}`} onClick={() => setSelectedInvoiceId(inv.id)}>
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
        </>
      ) : null}

      {tab === "receipts" ? (
        <>
          <div className="tlb-module-toolbar" style={{ marginTop: 0 }}>
            <div />
            <div className="tlb-toolbar-actions">
              <label className="tlb-module-search">
                <Search aria-hidden />
                <input
                  type="search"
                  value={receiptSearch}
                  onChange={(e) => setReceiptSearch(e.target.value)}
                  placeholder="Search receipt #, customer…"
                  aria-label="Search receipts"
                />
              </label>
              {store.can("receipt.create") ? (
                <Button type="button" onClick={() => setCreatingReceipt((v) => !v)}>
                  <Plus /> New receipt
                </Button>
              ) : null}
            </div>
          </div>

          {creatingReceipt && store.can("receipt.create") ? (
            <article className="tlb-panel tlb-form-panel tlb-record-detail-section tlb-record-detail-section--receipts">
              <form
                className="tlb-form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  const ok = store.createReceipt({
                    customerId: receiptForm.customerId,
                    paymentMethod: receiptForm.paymentMethod,
                    amountPaid: Number(receiptForm.amountPaid),
                    ...(receiptForm.orderId ? { orderId: receiptForm.orderId } : {}),
                    ...(receiptForm.invoiceId ? { invoiceId: receiptForm.invoiceId } : {}),
                    ...(receiptForm.notes.trim() ? { notes: receiptForm.notes.trim() } : {}),
                  });
                  if (ok) {
                    setReceiptForm((f) => ({ ...f, notes: "", amountPaid: 0 }));
                    setCreatingReceipt(false);
                  }
                }}
              >
                <div className="tlb-panel-heading">
                  <div>
                    <span>Ordinary receipt</span>
                    <strong>TLB-RCT</strong>
                  </div>
                  <button type="button" onClick={() => setCreatingReceipt(false)}>
                    Cancel
                  </button>
                </div>
                <label>
                  Customer
                  <select
                    value={receiptForm.customerId}
                    onChange={(e) => setReceiptForm({ ...receiptForm, customerId: e.target.value })}
                  >
                    {state.customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Related order (optional)
                  <select
                    value={receiptForm.orderId}
                    onChange={(e) => setReceiptForm({ ...receiptForm, orderId: e.target.value })}
                  >
                    <option value="">—</option>
                    {state.orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.number}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Related invoice (optional)
                  <select
                    value={receiptForm.invoiceId}
                    onChange={(e) => setReceiptForm({ ...receiptForm, invoiceId: e.target.value })}
                  >
                    <option value="">—</option>
                    {state.invoices.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.number}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Payment method
                  <select
                    value={receiptForm.paymentMethod}
                    onChange={(e) =>
                      setReceiptForm({ ...receiptForm, paymentMethod: e.target.value as PaymentMethod })
                    }
                  >
                    {METHODS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount paid
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={receiptForm.amountPaid}
                    onChange={(e) => setReceiptForm({ ...receiptForm, amountPaid: Number(e.target.value) })}
                  />
                </label>
                <label className="tlb-span-2">
                  Notes
                  <input
                    value={receiptForm.notes}
                    onChange={(e) => setReceiptForm({ ...receiptForm, notes: e.target.value })}
                  />
                </label>
                <div className="tlb-form-actions tlb-span-2">
                  <Button type="submit">Create receipt</Button>
                </div>
              </form>
            </article>
          ) : null}

          <article className="tlb-panel tlb-orders-panel tlb-customers-list-panel">
            <div className="tlb-table-scroll">
              {state.receipts.length === 0 ? (
                <EmptyState title="No receipts" detail="Create an ordinary receipt after supply or payment." />
              ) : filteredReceipts.length === 0 ? (
                <EmptyState title="No receipts match your search." detail="Try another receipt number or customer." />
              ) : (
                <table className="tlb-customers-table">
                  <thead>
                    <tr>
                      <th className="tlb-col-priority">Receipt #</th>
                      <th className="tlb-col-priority">Customer</th>
                      <th className="tlb-col-priority">Date</th>
                      <th className="tlb-col-priority">Method</th>
                      <th className="tlb-col-priority">Paid</th>
                      <th>
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReceipts.map((r) => (
                      <tr
                        key={r.id}
                        className="tlb-row-clickable"
                        tabIndex={0}
                        onClick={() => setSelectedReceiptId(r.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedReceiptId(r.id);
                          }
                        }}
                      >
                        <td className="tlb-col-priority">
                          <strong>{r.number}</strong>
                        </td>
                        <td className="tlb-col-priority">{state.customers.find((c) => c.id === r.customerId)?.name}</td>
                        <td className="tlb-col-priority">{new Date(r.receiptDate).toLocaleDateString()}</td>
                        <td className="tlb-col-priority">{r.paymentMethod}</td>
                        <td className="tlb-col-priority">{formatMoney(r.amountPaid)}</td>
                        <td>
                          <button type="button" aria-label={`Open ${r.number}`} onClick={() => setSelectedReceiptId(r.id)}>
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
        </>
      ) : null}

      {tab === "payments" ? (
        <>
          <div className="tlb-module-toolbar" style={{ marginTop: 0 }}>
            <div />
            <div className="tlb-toolbar-actions">
              <label className="tlb-module-search">
                <Search aria-hidden />
                <input
                  type="search"
                  value={paymentSearch}
                  onChange={(e) => setPaymentSearch(e.target.value)}
                  placeholder="Search payment #, customer, invoice…"
                  aria-label="Search payments"
                />
              </label>
            </div>
          </div>
          <article className="tlb-panel tlb-orders-panel tlb-customers-list-panel">
            <div className="tlb-table-scroll">
              {state.payments.length === 0 ? (
                <EmptyState title="No payments" detail="Payments are audited when recorded against invoices/receipts." />
              ) : filteredPayments.length === 0 ? (
                <EmptyState title="No payments match your search." detail="Try another payment number or customer." />
              ) : (
                <table className="tlb-customers-table">
                  <thead>
                    <tr>
                      <th className="tlb-col-priority">Payment #</th>
                      <th className="tlb-col-priority">Customer</th>
                      <th className="tlb-col-priority">Amount</th>
                      <th className="tlb-col-priority">Method</th>
                      <th className="tlb-col-priority">Invoice</th>
                      <th>
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.map((p) => (
                      <tr
                        key={p.id}
                        className="tlb-row-clickable"
                        tabIndex={0}
                        onClick={() => setSelectedPaymentId(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedPaymentId(p.id);
                          }
                        }}
                      >
                        <td className="tlb-col-priority">
                          <strong>{p.number}</strong>
                        </td>
                        <td className="tlb-col-priority">{state.customers.find((c) => c.id === p.customerId)?.name}</td>
                        <td className="tlb-col-priority">{formatMoney(p.amount)}</td>
                        <td className="tlb-col-priority">{p.method}</td>
                        <td className="tlb-col-priority">
                          {state.invoices.find((i) => i.id === p.invoiceId)?.number ?? "—"}
                        </td>
                        <td>
                          <button type="button" aria-label={`Open ${p.number}`} onClick={() => setSelectedPaymentId(p.id)}>
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
        </>
      ) : null}
    </div>
  );
}

export function DeliveriesModule({
  store,
  onOpenOrder,
  focusId,
  onFocusConsumed,
}: {
  store: TlbStoreApi;
  onOpenOrder: (orderId: string) => void;
  focusId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const { state } = store;
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
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

  useEffect(() => {
    if (!focusId) return;
    setSelectedId(focusId);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot on focusId
  }, [focusId]);

  const supplies = state.supplies.filter((s) => s.orderId === form.orderId);
  const selected = state.deliveries.find((d) => d.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    return state.deliveries.filter((d) => {
      const order = state.orders.find((o) => o.id === d.orderId);
      const customer = state.customers.find((c) => c.id === d.customerId);
      const supply = state.supplies.find((s) => s.id === d.supplyId);
      return matchesSearch(
        [d.number, order?.number, customer?.name, supply?.number, d.status, d.method, d.driver],
        search,
      );
    });
  }, [state.deliveries, state.orders, state.customers, state.supplies, search]);

  if (selected) {
    const items = state.deliveryItems.filter((i) => i.deliveryId === selected.id);
    const order = state.orders.find((o) => o.id === selected.orderId);
    const customer = state.customers.find((c) => c.id === selected.customerId);
    const supply = state.supplies.find((s) => s.id === selected.supplyId);
    return (
      <RecordDetailPage
        backLabel="Deliveries"
        onBack={() => setSelectedId(null)}
        code={selected.number}
        title={selected.number}
        subtitle={customer?.name ?? order?.number ?? "Delivery"}
        badges={<StatusBadge tone={statusTone(selected.status)}>{selected.status}</StatusBadge>}
        actions={
          <Button type="button" variant="outline" onClick={() => onOpenOrder(selected.orderId)}>
            Open order <ChevronRight />
          </Button>
        }
        flash={<Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />}
      >
        <RecordDetailSection tone="summary" kicker="Overview" title="Delivery summary" span2>
          <div className="tlb-customer-summary">
            <div className="tlb-customer-summary-tile--info">
              <span>Order</span>
              <strong>{order?.number ?? "—"}</strong>
            </div>
            <div className="tlb-customer-summary-tile--gold">
              <span>Supply</span>
              <strong>{supply?.number ?? "—"}</strong>
            </div>
            <div>
              <span>Items</span>
              <strong>{items.length}</strong>
            </div>
            <div className="tlb-customer-summary-tile--success">
              <span>Status</span>
              <strong>{selected.status}</strong>
            </div>
          </div>
        </RecordDetailSection>

        <RecordDetailSection tone="deliveries" kicker="Logistics" title="Delivery details" span2>
          <dl className="tlb-kv">
            <div>
              <dt>Customer</dt>
              <dd>{customer?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{new Date(selected.deliveryDate).toLocaleString()}</dd>
            </div>
            <div className="tlb-span-2">
              <dt>Address</dt>
              <dd>{selected.address}</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>{selected.method}</dd>
            </div>
            <div>
              <dt>Vehicle</dt>
              <dd>{selected.vehicle || "—"}</dd>
            </div>
            <div>
              <dt>Driver</dt>
              <dd>{selected.driver || "—"}</dd>
            </div>
            <div>
              <dt>Receiver</dt>
              <dd>
                {selected.receiverName || "—"} · {selected.receiverContact || "—"}
              </dd>
            </div>
            <div>
              <dt>Confirmation</dt>
              <dd>{selected.confirmedAt ? new Date(selected.confirmedAt).toLocaleString() : "Pending"}</dd>
            </div>
            <div className="tlb-span-2">
              <dt>Notes</dt>
              <dd>{selected.notes || "—"}</dd>
            </div>
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
        </RecordDetailSection>

        <RecordDetailSection tone="lines" kicker="Cargo" title="Delivery items" span2>
          <div className="tlb-table-scroll tlb-orders-panel">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const product = state.products.find((p) => p.id === item.productId);
                  return (
                    <tr key={item.id}>
                      <td>{product?.name ?? "—"}</td>
                      <td>{product?.sku ?? "—"}</td>
                      <td>{item.quantity}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </RecordDetailSection>
      </RecordDetailPage>
    );
  }

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Operations</span>
          <strong>Deliveries</strong>
          <p className="tlb-muted-line">Linked to supplies — order stays open while outstanding remains</p>
        </div>
        <div className="tlb-toolbar-actions">
          <label className="tlb-module-search">
            <Search aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search delivery #, order, customer, status…"
              aria-label="Search deliveries"
            />
          </label>
          {store.can("delivery.manage") ? (
            <Button type="button" onClick={() => setCreating((v) => !v)}>
              <Plus /> New delivery
            </Button>
          ) : null}
        </div>
      </div>

      {creating && store.can("delivery.manage") ? (
        <article className="tlb-panel tlb-form-panel tlb-record-detail-section tlb-record-detail-section--deliveries">
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
              if (ok) {
                setForm((f) => ({ ...f, supplyId: "", notes: "" }));
                setCreating(false);
              }
            }}
          >
            <div className="tlb-panel-heading">
              <div>
                <span>New delivery</span>
                <strong>From supply</strong>
              </div>
              <button type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
            <label>
              Order
              <select
                required
                value={form.orderId}
                onChange={(e) => {
                  const order = state.orders.find((o) => o.id === e.target.value);
                  const cust = state.customers.find((c) => c.id === order?.customerId);
                  setForm({
                    ...form,
                    orderId: e.target.value,
                    supplyId: "",
                    address: cust?.address ?? form.address,
                  });
                }}
              >
                {state.orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Supply
              <select required value={form.supplyId} onChange={(e) => setForm({ ...form, supplyId: e.target.value })}>
                <option value="">Select supply</option>
                {supplies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number}
                  </option>
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
              <input
                value={form.receiverContact}
                onChange={(e) => setForm({ ...form, receiverContact: e.target.value })}
              />
            </label>
            <label className="tlb-span-2">
              Notes
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            <div className="tlb-form-actions tlb-span-2">
              <Button type="submit">Create delivery</Button>
            </div>
          </form>
        </article>
      ) : null}

      <article className="tlb-panel tlb-orders-panel tlb-customers-list-panel">
        <div className="tlb-table-scroll">
          {state.deliveries.length === 0 ? (
            <EmptyState title="No deliveries" detail="Create a delivery from a posted supply." />
          ) : filtered.length === 0 ? (
            <EmptyState title="No deliveries match your search." detail="Try another number, order, or customer." />
          ) : (
            <table className="tlb-customers-table">
              <thead>
                <tr>
                  <th className="tlb-col-priority">Delivery #</th>
                  <th className="tlb-col-priority">Customer</th>
                  <th className="tlb-col-priority">Order</th>
                  <th className="tlb-col-priority">Date</th>
                  <th className="tlb-col-priority">Status</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr
                    key={d.id}
                    className="tlb-row-clickable"
                    tabIndex={0}
                    onClick={() => setSelectedId(d.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(d.id);
                      }
                    }}
                  >
                    <td className="tlb-col-priority">
                      <strong>{d.number}</strong>
                    </td>
                    <td className="tlb-col-priority">
                      {state.customers.find((c) => c.id === d.customerId)?.name ?? "—"}
                    </td>
                    <td className="tlb-col-priority">{state.orders.find((o) => o.id === d.orderId)?.number ?? "—"}</td>
                    <td className="tlb-col-priority">{new Date(d.deliveryDate).toLocaleDateString()}</td>
                    <td className="tlb-col-priority">
                      <StatusBadge tone={statusTone(d.status)}>{d.status}</StatusBadge>
                    </td>
                    <td>
                      <button type="button" aria-label={`Open ${d.number}`} onClick={() => setSelectedId(d.id)}>
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
    </div>
  );
}
