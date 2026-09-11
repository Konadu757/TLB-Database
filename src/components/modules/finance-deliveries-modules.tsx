import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, Plus, Printer, Search, X } from "lucide-react";

import {
  BulkTrashToolbar,
  SelectAllHeader,
  SelectRowCell,
  useListSelection,
} from "@/components/modules/list-bulk-trash";
import { MoveToTrashButton } from "@/components/modules/move-to-trash-button";
import {
  EmptyState,
  RecordDetailPage,
  RecordDetailSection,
  StatusBadge,
  matchesSearch,
} from "@/components/modules/record-browser";
import { Button } from "@/components/ui/button";
import { statusTone } from "@/lib/domain/calculations";
import {
  downloadInvoice,
  downloadReceipt,
  printInvoiceAsPdf,
  printReceiptAsPdf,
  type InvoiceDownloadContext,
  type ReceiptDownloadContext,
} from "@/lib/documents/download-printable";
import { isoInRange } from "@/lib/domain/period-range";
import { notSoftDeleted } from "@/lib/domain/trash";
import type { DeliveryStatus, PaymentMethod } from "@/lib/domain/types";
import { formatMoney, trashBlockReason } from "@/lib/store/tlb-store";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

function invoiceDownloadCtx(
  store: TlbStoreApi,
  invoiceId: string,
): InvoiceDownloadContext | null {
  const invoice = store.state.invoices.find((i) => i.id === invoiceId);
  if (!invoice) return null;
  const customer = store.state.customers.find((c) => c.id === invoice.customerId);
  const vat = store.state.vatRates.find((v) => v.id === invoice.vatRateId);
  const order = store.state.orders.find((o) => o.id === invoice.orderId);
  return {
    invoice,
    lines: store.state.invoiceLines.filter((l) => l.invoiceId === invoice.id),
    company: store.state.company,
    customerName: customer?.name ?? "—",
    vatRatePercent: vat?.ratePercent ?? 0,
    ...(order?.number ? { orderNumber: order.number } : {}),
  };
}

function receiptDownloadCtx(
  store: TlbStoreApi,
  receiptId: string,
): ReceiptDownloadContext | null {
  const receipt = store.state.receipts.find((r) => r.id === receiptId);
  if (!receipt) return null;
  const customer = store.state.customers.find((c) => c.id === receipt.customerId);
  const invoice = receipt.invoiceId
    ? store.state.invoices.find((i) => i.id === receipt.invoiceId)
    : undefined;
  const order = receipt.orderId ? store.state.orders.find((o) => o.id === receipt.orderId) : undefined;
  return {
    receipt,
    lines: store.state.receiptLines.filter((l) => l.receiptId === receipt.id),
    company: store.state.company,
    customerName: customer?.name ?? "—",
    ...(invoice?.number ? { invoiceNumber: invoice.number } : {}),
    ...(order?.number ? { orderNumber: order.number } : {}),
  };
}

async function handleInvoiceDownload(store: TlbStoreApi, invoiceId: string) {
  const ctx = invoiceDownloadCtx(store, invoiceId);
  if (!ctx) return;
  await downloadInvoice(ctx);
}

async function handleInvoicePrintPdf(store: TlbStoreApi, invoiceId: string) {
  const ctx = invoiceDownloadCtx(store, invoiceId);
  if (!ctx) return;
  if (!(await printInvoiceAsPdf(ctx))) {
    window.alert("Allow pop-ups to use Save as PDF (opens the print dialog).");
  }
}

async function handleReceiptDownload(store: TlbStoreApi, receiptId: string) {
  const ctx = receiptDownloadCtx(store, receiptId);
  if (!ctx) return;
  await downloadReceipt(ctx);
}

async function handleReceiptPrintPdf(store: TlbStoreApi, receiptId: string) {
  const ctx = receiptDownloadCtx(store, receiptId);
  if (!ctx) return;
  if (!(await printReceiptAsPdf(ctx))) {
    window.alert("Allow pop-ups to use Save as PDF (opens the print dialog).");
  }
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

type FinanceTab = "invoices" | "receipts" | "payments";

type FinanceFocus = {
  tab: FinanceTab;
  invoiceId: string | null;
  receiptId: string | null;
  paymentId: string | null;
  createInvoice?: boolean;
  createReceipt?: boolean;
  orderId?: string;
  supplyId?: string;
};

function resolveFinanceFocus(
  state: TlbStoreApi["state"],
  focusId: string | null | undefined,
): FinanceFocus | null {
  if (!focusId) return null;

  if (focusId.startsWith("create-invoice:")) {
    const supplyId = focusId.slice("create-invoice:".length);
    const supply = state.supplies.find((s) => s.id === supplyId);
    if (!supply) return { tab: "invoices", invoiceId: null, receiptId: null, paymentId: null, createInvoice: true };
    return {
      tab: "invoices",
      invoiceId: null,
      receiptId: null,
      paymentId: null,
      createInvoice: true,
      orderId: supply.orderId,
      supplyId: supply.id,
    };
  }

  if (focusId.startsWith("create-receipt:")) {
    const token = focusId.slice("create-receipt:".length);
    const supply = state.supplies.find((s) => s.id === token);
    if (supply) {
      return {
        tab: "receipts",
        invoiceId: null,
        receiptId: null,
        paymentId: null,
        createReceipt: true,
        orderId: supply.orderId,
        supplyId: supply.id,
      };
    }
    const order = state.orders.find((o) => o.id === token);
    if (order) {
      const latestSupply = notSoftDeleted(state.supplies).find((s) => s.orderId === order.id);
      return {
        tab: "receipts",
        invoiceId: null,
        receiptId: null,
        paymentId: null,
        createReceipt: true,
        orderId: order.id,
        ...(latestSupply?.id ? { supplyId: latestSupply.id } : {}),
      };
    }
    return { tab: "receipts", invoiceId: null, receiptId: null, paymentId: null, createReceipt: true };
  }

  if (state.invoices.some((i) => i.id === focusId)) {
    return { tab: "invoices", invoiceId: focusId, receiptId: null, paymentId: null };
  }
  if (state.receipts.some((r) => r.id === focusId)) {
    return { tab: "receipts", invoiceId: null, receiptId: focusId, paymentId: null };
  }
  if (state.payments.some((p) => p.id === focusId)) {
    return { tab: "payments", invoiceId: null, receiptId: null, paymentId: focusId };
  }

  // Bare supply id → generate VAT invoice from that supply (Sales Order shortcut)
  const supply = state.supplies.find((s) => s.id === focusId);
  if (supply) {
    return {
      tab: "invoices",
      invoiceId: null,
      receiptId: null,
      paymentId: null,
      createInvoice: true,
      orderId: supply.orderId,
      supplyId: supply.id,
    };
  }

  return null;
}

function supplyReceiptPreview(
  state: TlbStoreApi["state"],
  orderId: string,
  supplyId: string,
): { amount: number; lineCount: number } | null {
  const supply = state.supplies.find((s) => s.id === supplyId && s.orderId === orderId);
  if (!supply) return null;
  const lines = state.supplyLines.filter((sl) => sl.supplyId === supply.id);
  if (lines.length === 0) return null;
  const amount = Math.round(
    lines.reduce((sum, sl) => {
      const orderLine = state.orderLines.find((l) => l.id === sl.orderLineId);
      return sum + sl.quantity * (orderLine?.unitPrice ?? 0);
    }, 0) * 100,
  ) / 100;
  return { amount, lineCount: lines.length };
}

export function FinanceModule({
  store,
  onOpenOrder,
  focusId,
  onFocusConsumed,
  range,
  periodLabel,
  initialTab,
}: {
  store: TlbStoreApi;
  onOpenOrder: (orderId: string) => void;
  focusId?: string | null;
  onFocusConsumed?: () => void;
  range?: { from: string; to: string } | null;
  periodLabel?: string;
  /** Sidebar shortcut: Invoices / Receipts / Finance */
  initialTab?: FinanceTab;
}) {
  const { state } = store;
  const initialFocus = resolveFinanceFocus(state, focusId);
  const [tab, setTab] = useState<FinanceTab>(initialFocus?.tab ?? initialTab ?? "invoices");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(initialFocus?.invoiceId ?? null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(initialFocus?.receiptId ?? null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(initialFocus?.paymentId ?? null);
  const [creatingInvoice, setCreatingInvoice] = useState(Boolean(initialFocus?.createInvoice));
  const [creatingReceipt, setCreatingReceipt] = useState(Boolean(initialFocus?.createReceipt));
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [receiptSearch, setReceiptSearch] = useState("");
  const [paymentSearch, setPaymentSearch] = useState("");
  const [invoiceForm, setInvoiceForm] = useState({
    orderId: initialFocus?.orderId ?? state.orders[0]?.id ?? "",
    supplyId: initialFocus?.supplyId ?? "",
    vatRateId: state.vatRates.find((v) => v.active)?.id ?? "",
    updateTin: "",
    notes: "",
  });
  const [receiptForm, setReceiptForm] = useState({
    customerId: (() => {
      if (initialFocus?.orderId) {
        const order = state.orders.find((o) => o.id === initialFocus.orderId);
        if (order) return order.customerId;
      }
      return state.customers[0]?.id ?? "";
    })(),
    orderId: initialFocus?.orderId ?? "",
    supplyId: initialFocus?.supplyId ?? "",
    invoiceId: "",
    paymentMethod: "Bank Transfer" as PaymentMethod,
    amountPaid: (() => {
      if (initialFocus?.orderId && initialFocus?.supplyId) {
        return supplyReceiptPreview(state, initialFocus.orderId, initialFocus.supplyId)?.amount ?? 0;
      }
      return 0;
    })(),
    notes: "",
  });

  // Sync tab when navigating via sidebar Invoices / Receipts / Finance
  useEffect(() => {
    if (!initialTab) return;
    setTab(initialTab);
    setSelectedInvoiceId(null);
    setSelectedReceiptId(null);
    setSelectedPaymentId(null);
  }, [initialTab]);

  useEffect(() => {
    const next = resolveFinanceFocus(state, focusId);
    if (!next) return;
    setTab(next.tab);
    setSelectedInvoiceId(next.invoiceId);
    setSelectedReceiptId(next.receiptId);
    setSelectedPaymentId(next.paymentId);
    if (next.createInvoice) {
      setCreatingInvoice(true);
      setCreatingReceipt(false);
      setInvoiceForm((f) => ({
        ...f,
        orderId: next.orderId ?? f.orderId,
        supplyId: next.supplyId ?? "",
        vatRateId: state.vatRates.find((v) => v.active)?.id ?? f.vatRateId,
      }));
    }
    if (next.createReceipt) {
      setCreatingReceipt(true);
      setCreatingInvoice(false);
      const order = next.orderId ? state.orders.find((o) => o.id === next.orderId) : undefined;
      const preview =
        next.orderId && next.supplyId ? supplyReceiptPreview(state, next.orderId, next.supplyId) : null;
      setReceiptForm((f) => ({
        ...f,
        orderId: next.orderId ?? "",
        supplyId: next.supplyId ?? "",
        customerId: order?.customerId ?? (f.customerId || state.customers[0]?.id || ""),
        amountPaid: preview?.amount ?? f.amountPaid,
        invoiceId: "",
      }));
    }
    onFocusConsumed?.();
    // Apply deep-link focus once; parent clears focusId via onFocusConsumed.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot on focusId
  }, [focusId]);

  // Keep receipt customer in sync when order changes
  useEffect(() => {
    if (!receiptForm.orderId) return;
    const order = state.orders.find((o) => o.id === receiptForm.orderId);
    if (!order) return;
    setReceiptForm((f) => (f.customerId === order.customerId ? f : { ...f, customerId: order.customerId }));
  }, [receiptForm.orderId, state.orders]);

  const orderSupplies = notSoftDeleted(state.supplies).filter((s) => s.orderId === invoiceForm.orderId);
  const receiptOrderSupplies = notSoftDeleted(state.supplies).filter((s) => s.orderId === receiptForm.orderId);
  const invoiceOrder = state.orders.find((o) => o.id === invoiceForm.orderId);
  const invoiceCustomer = invoiceOrder
    ? state.customers.find((c) => c.id === invoiceOrder.customerId)
    : undefined;
  const receiptPreview =
    receiptForm.orderId && receiptForm.supplyId
      ? supplyReceiptPreview(state, receiptForm.orderId, receiptForm.supplyId)
      : null;

  const canBulkTrash = store.can("records.delete");

  const filteredInvoices = useMemo(() => {
    return notSoftDeleted(state.invoices).filter((inv) => {
      if (range && !isoInRange(inv.invoiceDate, range)) return false;
      const order = state.orders.find((o) => o.id === inv.orderId);
      const customer = state.customers.find((c) => c.id === inv.customerId);
      return matchesSearch(
        [inv.number, order?.number, customer?.name, customer?.code, inv.paymentStatus],
        invoiceSearch,
      );
    });
  }, [state.invoices, state.orders, state.customers, invoiceSearch, range]);

  const filteredReceipts = useMemo(() => {
    return notSoftDeleted(state.receipts).filter((r) => {
      if (range && !isoInRange(r.receiptDate, range)) return false;
      const customer = state.customers.find((c) => c.id === r.customerId);
      const order = state.orders.find((o) => o.id === r.orderId);
      return matchesSearch(
        [r.number, customer?.name, customer?.code, order?.number, r.paymentMethod, r.processedBy],
        receiptSearch,
      );
    });
  }, [state.receipts, state.customers, state.orders, receiptSearch, range]);

  const filteredPayments = useMemo(() => {
    return notSoftDeleted(state.payments).filter((p) => {
      if (range && !isoInRange(p.paymentDate, range)) return false;
      const customer = state.customers.find((c) => c.id === p.customerId);
      const invoice = state.invoices.find((i) => i.id === p.invoiceId);
      return matchesSearch([p.number, customer?.name, p.method, invoice?.number, p.recordedBy], paymentSearch);
    });
  }, [state.payments, state.customers, state.invoices, paymentSearch, range]);

  const invoiceIds = useMemo(() => filteredInvoices.map((i) => i.id), [filteredInvoices]);
  const receiptIds = useMemo(() => filteredReceipts.map((r) => r.id), [filteredReceipts]);
  const paymentIds = useMemo(() => filteredPayments.map((p) => p.id), [filteredPayments]);
  const invoiceSelection = useListSelection(canBulkTrash && tab === "invoices" ? invoiceIds : []);
  const receiptSelection = useListSelection(canBulkTrash && tab === "receipts" ? receiptIds : []);
  const paymentSelection = useListSelection(canBulkTrash && tab === "payments" ? paymentIds : []);

  const selectedInvoice = notSoftDeleted(state.invoices).find((i) => i.id === selectedInvoiceId) ?? null;
  const selectedReceipt = notSoftDeleted(state.receipts).find((r) => r.id === selectedReceiptId) ?? null;
  const selectedPayment = notSoftDeleted(state.payments).find((p) => p.id === selectedPaymentId) ?? null;

  const sectionEyebrow =
    initialTab === "invoices"
      ? "Control · Invoices"
      : initialTab === "receipts"
        ? "Control · Receipts"
        : "Control · Finance";
  const sectionTitle =
    initialTab === "invoices"
      ? "VAT invoices (TLB-INV)"
      : initialTab === "receipts"
        ? "Receipts (TLB-RCT)"
        : "Invoices, receipts & payments";

  if (tab === "invoices" && selectedInvoice) {
    const invoiceLines = state.invoiceLines.filter((l) => l.invoiceId === selectedInvoice.id);
    const order = state.orders.find((o) => o.id === selectedInvoice.orderId);
    const customer = state.customers.find((c) => c.id === selectedInvoice.customerId);
    const vat = state.vatRates.find((v) => v.id === selectedInvoice.vatRateId);
    return (
      <RecordDetailPage
        backLabel={initialTab === "invoices" ? "Invoices" : "Finance · Invoices"}
        onBack={() => setSelectedInvoiceId(null)}
        code={selectedInvoice.number}
        title={selectedInvoice.number}
        subtitle={customer?.name ?? "Invoice"}
        badges={<StatusBadge tone={statusTone(selectedInvoice.paymentStatus)}>{selectedInvoice.paymentStatus}</StatusBadge>}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => handleInvoiceDownload(store, selectedInvoice.id)}>
              <Download /> Download
            </Button>
            <Button type="button" variant="outline" onClick={() => handleInvoicePrintPdf(store, selectedInvoice.id)}>
              <Printer /> Save as PDF
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenOrder(selectedInvoice.orderId)}>
              Open order <ChevronRight />
            </Button>
            <MoveToTrashButton
              store={store}
              entityType="invoice"
              entityId={selectedInvoice.id}
              recordLabel={selectedInvoice.number}
              onTrashed={() => setSelectedInvoiceId(null)}
            />
          </>
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
              <dd>
                {customer?.name ?? "—"}
                {customer?.code ? <div className="tlb-muted-line">{customer.code}</div> : null}
              </dd>
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
              <dd>
                {order ? (
                  <button type="button" className="tlb-text-link" onClick={() => onOpenOrder(order.id)}>
                    {order.number}
                  </button>
                ) : (
                  "—"
                )}
              </dd>
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
    const order = state.orders.find((o) => o.id === selectedReceipt.orderId);
    const receiptLines = state.receiptLines.filter((l) => l.receiptId === selectedReceipt.id);
    return (
      <RecordDetailPage
        backLabel={initialTab === "receipts" ? "Receipts" : "Finance · Receipts"}
        onBack={() => setSelectedReceiptId(null)}
        code={selectedReceipt.number}
        title={selectedReceipt.number}
        subtitle={customer?.name ?? "Receipt"}
        badges={<StatusBadge tone="success">Paid</StatusBadge>}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => handleReceiptDownload(store, selectedReceipt.id)}>
              <Download /> Download
            </Button>
            <Button type="button" variant="outline" onClick={() => handleReceiptPrintPdf(store, selectedReceipt.id)}>
              <Printer /> Save as PDF
            </Button>
            {selectedReceipt.orderId ? (
              <Button type="button" variant="outline" onClick={() => onOpenOrder(selectedReceipt.orderId!)}>
                Open order <ChevronRight />
              </Button>
            ) : null}
            <MoveToTrashButton
              store={store}
              entityType="receipt"
              entityId={selectedReceipt.id}
              recordLabel={selectedReceipt.number}
              onTrashed={() => setSelectedReceiptId(null)}
            />
          </>
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
              <dd>
                {customer?.name ?? "—"}
                {customer?.code ? <div className="tlb-muted-line">{customer.code}</div> : null}
              </dd>
            </div>
            <div>
              <dt>Processed by</dt>
              <dd>{selectedReceipt.processedBy}</dd>
            </div>
            <div>
              <dt>Related order</dt>
              <dd>
                {order ? (
                  <button type="button" className="tlb-text-link" onClick={() => onOpenOrder(order.id)}>
                    {order.number}
                  </button>
                ) : (
                  "—"
                )}
              </dd>
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
        {receiptLines.length > 0 ? (
          <RecordDetailSection tone="lines" kicker="Lines" title="Receipt line items" span2>
            <div className="tlb-table-scroll tlb-orders-panel">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {receiptLines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td>{l.quantity}</td>
                      <td>{formatMoney(l.unitPrice)}</td>
                      <td>{formatMoney(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </RecordDetailSection>
        ) : null}
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
        actions={
          <MoveToTrashButton
            store={store}
            entityType="payment"
            entityId={selectedPayment.id}
            recordLabel={selectedPayment.number}
            onTrashed={() => setSelectedPaymentId(null)}
          />
        }
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
          {periodLabel ? <p className="tlb-muted-line">Document dates scoped to {periodLabel}</p> : null}
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
              {canBulkTrash ? (
                <BulkTrashToolbar
                  store={store}
                  entityType="invoice"
                  selectedIds={invoiceSelection.selectedIds}
                  onDone={invoiceSelection.clear}
                />
              ) : null}
              {store.can("invoice.create") ? (
                <Button type="button" onClick={() => setCreatingInvoice((v) => !v)}>
                  <Plus /> Generate VAT invoice
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
                    <strong>Generate from sales supply</strong>
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
                  Supply (partial or full)
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
                  VAT rate (Settings)
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
                  Customer TIN
                  <input
                    readOnly
                    value={invoiceCustomer?.tin || "— (none on customer profile)"}
                    aria-label="Customer TIN auto-filled from profile"
                  />
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
                  <Button type="submit">Generate VAT invoice</Button>
                </div>
              </form>
            </article>
          ) : null}

          <article className="tlb-panel tlb-orders-panel tlb-customers-list-panel">
            <div className="tlb-table-scroll">
              {notSoftDeleted(state.invoices).length === 0 ? (
                <EmptyState title="No invoices" detail="Create a VAT invoice from a posted supply." />
              ) : filteredInvoices.length === 0 ? (
                <EmptyState title="No invoices match your search." detail="Try another number, order, or customer." />
              ) : (
                <table className="tlb-customers-table">
                  <thead>
                    <tr>
                      {canBulkTrash ? (
                        <SelectAllHeader
                          allSelected={invoiceSelection.allVisibleSelected}
                          someSelected={invoiceSelection.someVisibleSelected}
                          onToggle={invoiceSelection.toggleAllVisible}
                        />
                      ) : null}
                      <th className="tlb-col-priority">Invoice</th>
                      <th className="tlb-col-priority">Customer</th>
                      <th className="tlb-col-priority">Order</th>
                      <th className="tlb-col-priority">Total</th>
                      <th className="tlb-col-priority">Date</th>
                      <th className="tlb-col-priority">Status</th>
                      <th>
                        <span className="sr-only">Actions</span>
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
                          {canBulkTrash ? (
                            <SelectRowCell
                              id={inv.id}
                              checked={invoiceSelection.isSelected(inv.id)}
                              onToggle={invoiceSelection.toggle}
                              label={`Select ${inv.number}`}
                            />
                          ) : null}
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
                            <div className="tlb-toolbar-actions" style={{ justifyContent: "flex-end", gap: 4 }}>
                              <button
                                type="button"
                                aria-label={`Download ${inv.number}`}
                                title="Download HTML"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleInvoiceDownload(store, inv.id);
                                }}
                              >
                                <Download />
                              </button>
                              <button
                                type="button"
                                aria-label={`Save ${inv.number} as PDF`}
                                title="Save as PDF"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleInvoicePrintPdf(store, inv.id);
                                }}
                              >
                                <Printer />
                              </button>
                              <button type="button" aria-label={`Open ${inv.number}`} onClick={() => setSelectedInvoiceId(inv.id)}>
                                <ChevronRight />
                              </button>
                            </div>
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
                  placeholder="Search receipt #, order, customer…"
                  aria-label="Search receipts"
                />
              </label>
              {canBulkTrash ? (
                <BulkTrashToolbar
                  store={store}
                  entityType="receipt"
                  selectedIds={receiptSelection.selectedIds}
                  onDone={receiptSelection.clear}
                />
              ) : null}
              {store.can("receipt.create") ? (
                <Button type="button" onClick={() => setCreatingReceipt((v) => !v)}>
                  <Plus /> Generate receipt
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
                  const ok =
                    receiptForm.orderId && receiptForm.supplyId
                      ? store.createReceiptFromSupply({
                          orderId: receiptForm.orderId,
                          supplyId: receiptForm.supplyId,
                          paymentMethod: receiptForm.paymentMethod,
                          amountPaid: Number(receiptForm.amountPaid),
                          ...(receiptForm.invoiceId ? { invoiceId: receiptForm.invoiceId } : {}),
                          ...(receiptForm.notes.trim() ? { notes: receiptForm.notes.trim() } : {}),
                        })
                      : store.createReceipt({
                          customerId: receiptForm.customerId,
                          paymentMethod: receiptForm.paymentMethod,
                          amountPaid: Number(receiptForm.amountPaid),
                          ...(receiptForm.orderId ? { orderId: receiptForm.orderId } : {}),
                          ...(receiptForm.invoiceId ? { invoiceId: receiptForm.invoiceId } : {}),
                          ...(receiptForm.notes.trim() ? { notes: receiptForm.notes.trim() } : {}),
                        });
                  if (ok) {
                    setReceiptForm((f) => ({ ...f, notes: "", amountPaid: 0, supplyId: "" }));
                    setCreatingReceipt(false);
                  }
                }}
              >
                <div className="tlb-panel-heading">
                  <div>
                    <span>Ordinary receipt</span>
                    <strong>TLB-RCT from sales supply</strong>
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
                  Related order
                  <select
                    value={receiptForm.orderId}
                    onChange={(e) => {
                      const orderId = e.target.value;
                      const order = state.orders.find((o) => o.id === orderId);
                      const firstSupply = notSoftDeleted(state.supplies).find((s) => s.orderId === orderId);
                      const preview =
                        orderId && firstSupply ? supplyReceiptPreview(state, orderId, firstSupply.id) : null;
                      setReceiptForm({
                        ...receiptForm,
                        orderId,
                        supplyId: firstSupply?.id ?? "",
                        customerId: order?.customerId ?? receiptForm.customerId,
                        amountPaid: preview?.amount ?? receiptForm.amountPaid,
                      });
                    }}
                  >
                    <option value="">— Manual amount (no supply)</option>
                    {state.orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.number}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Supply (qty × prices)
                  <select
                    value={receiptForm.supplyId}
                    disabled={!receiptForm.orderId}
                    onChange={(e) => {
                      const supplyId = e.target.value;
                      const preview =
                        receiptForm.orderId && supplyId
                          ? supplyReceiptPreview(state, receiptForm.orderId, supplyId)
                          : null;
                      setReceiptForm({
                        ...receiptForm,
                        supplyId,
                        amountPaid: preview?.amount ?? receiptForm.amountPaid,
                      });
                    }}
                  >
                    <option value="">Select supply</option>
                    {receiptOrderSupplies.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.number}
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
                    {notSoftDeleted(state.invoices)
                      .filter((i) => !receiptForm.orderId || i.orderId === receiptForm.orderId)
                      .map((i) => (
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
                  {receiptPreview ? (
                    <span className="tlb-muted-line">
                      Supply total {formatMoney(receiptPreview.amount)} · {receiptPreview.lineCount} line
                      {receiptPreview.lineCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </label>
                <label className="tlb-span-2">
                  Notes
                  <input
                    value={receiptForm.notes}
                    onChange={(e) => setReceiptForm({ ...receiptForm, notes: e.target.value })}
                  />
                </label>
                <div className="tlb-form-actions tlb-span-2">
                  <Button type="submit">Generate receipt</Button>
                </div>
              </form>
            </article>
          ) : null}

          <article className="tlb-panel tlb-orders-panel tlb-customers-list-panel">
            <div className="tlb-table-scroll">
              {notSoftDeleted(state.receipts).length === 0 ? (
                <EmptyState title="No receipts" detail="Create an ordinary receipt after supply or payment." />
              ) : filteredReceipts.length === 0 ? (
                <EmptyState title="No receipts match your search." detail="Try another receipt number or customer." />
              ) : (
                <table className="tlb-customers-table">
                  <thead>
                    <tr>
                      {canBulkTrash ? (
                        <SelectAllHeader
                          allSelected={receiptSelection.allVisibleSelected}
                          someSelected={receiptSelection.someVisibleSelected}
                          onToggle={receiptSelection.toggleAllVisible}
                        />
                      ) : null}
                      <th className="tlb-col-priority">Receipt #</th>
                      <th className="tlb-col-priority">Customer</th>
                      <th className="tlb-col-priority">Order</th>
                      <th className="tlb-col-priority">Date</th>
                      <th className="tlb-col-priority">Method</th>
                      <th className="tlb-col-priority">Paid</th>
                      <th>
                        <span className="sr-only">Actions</span>
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
                        {canBulkTrash ? (
                          <SelectRowCell
                            id={r.id}
                            checked={receiptSelection.isSelected(r.id)}
                            onToggle={receiptSelection.toggle}
                            label={`Select ${r.number}`}
                          />
                        ) : null}
                        <td className="tlb-col-priority">
                          <strong>{r.number}</strong>
                        </td>
                        <td className="tlb-col-priority">{state.customers.find((c) => c.id === r.customerId)?.name}</td>
                        <td className="tlb-col-priority">
                          {state.orders.find((o) => o.id === r.orderId)?.number ?? "—"}
                        </td>
                        <td className="tlb-col-priority">{new Date(r.receiptDate).toLocaleDateString()}</td>
                        <td className="tlb-col-priority">{r.paymentMethod}</td>
                        <td className="tlb-col-priority">{formatMoney(r.amountPaid)}</td>
                        <td>
                          <div className="tlb-toolbar-actions" style={{ justifyContent: "flex-end", gap: 4 }}>
                            <button
                              type="button"
                              aria-label={`Download ${r.number}`}
                              title="Download HTML"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReceiptDownload(store, r.id);
                              }}
                            >
                              <Download />
                            </button>
                            <button
                              type="button"
                              aria-label={`Save ${r.number} as PDF`}
                              title="Save as PDF"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReceiptPrintPdf(store, r.id);
                              }}
                            >
                              <Printer />
                            </button>
                            <button type="button" aria-label={`Open ${r.number}`} onClick={() => setSelectedReceiptId(r.id)}>
                              <ChevronRight />
                            </button>
                          </div>
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
              {canBulkTrash ? (
                <BulkTrashToolbar
                  store={store}
                  entityType="payment"
                  selectedIds={paymentSelection.selectedIds}
                  onDone={paymentSelection.clear}
                />
              ) : null}
            </div>
          </div>
          <article className="tlb-panel tlb-orders-panel tlb-customers-list-panel">
            <div className="tlb-table-scroll">
              {notSoftDeleted(state.payments).length === 0 ? (
                <EmptyState title="No payments" detail="Payments are audited when recorded against invoices/receipts." />
              ) : filteredPayments.length === 0 ? (
                <EmptyState title="No payments match your search." detail="Try another payment number or customer." />
              ) : (
                <table className="tlb-customers-table">
                  <thead>
                    <tr>
                      {canBulkTrash ? (
                        <SelectAllHeader
                          allSelected={paymentSelection.allVisibleSelected}
                          someSelected={paymentSelection.someVisibleSelected}
                          onToggle={paymentSelection.toggleAllVisible}
                        />
                      ) : null}
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
                        {canBulkTrash ? (
                          <SelectRowCell
                            id={p.id}
                            checked={paymentSelection.isSelected(p.id)}
                            onToggle={paymentSelection.toggle}
                            label={`Select ${p.number}`}
                          />
                        ) : null}
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
  range,
  periodLabel,
}: {
  store: TlbStoreApi;
  onOpenOrder: (orderId: string) => void;
  focusId?: string | null;
  onFocusConsumed?: () => void;
  range?: { from: string; to: string } | null;
  periodLabel?: string;
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

  const supplies = notSoftDeleted(state.supplies).filter((s) => s.orderId === form.orderId);
  const canBulkTrash = store.can("records.delete");
  const selected = notSoftDeleted(state.deliveries).find((d) => d.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    return notSoftDeleted(state.deliveries).filter((d) => {
      if (range && !isoInRange(d.deliveryDate, range)) return false;
      const order = state.orders.find((o) => o.id === d.orderId);
      const customer = state.customers.find((c) => c.id === d.customerId);
      const supply = state.supplies.find((s) => s.id === d.supplyId);
      return matchesSearch(
        [d.number, order?.number, customer?.name, supply?.number, d.status, d.method, d.driver],
        search,
      );
    });
  }, [state.deliveries, state.orders, state.customers, state.supplies, search, range]);

  const deliveryIds = useMemo(() => filtered.map((d) => d.id), [filtered]);
  const deliverySelection = useListSelection(canBulkTrash ? deliveryIds : []);
  const deliveryTrashBlock = selected ? trashBlockReason(state, "delivery", selected.id) : null;

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
          <>
            <Button type="button" variant="outline" onClick={() => onOpenOrder(selected.orderId)}>
              Open order <ChevronRight />
            </Button>
            <MoveToTrashButton
              store={store}
              entityType="delivery"
              entityId={selected.id}
              recordLabel={selected.number}
              disabled={Boolean(deliveryTrashBlock)}
              disabledReason={deliveryTrashBlock ?? undefined}
              onTrashed={() => setSelectedId(null)}
            />
          </>
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
          <p className="tlb-muted-line">
            Linked to supplies — order stays open while outstanding remains
            {periodLabel ? ` · Delivery dates scoped to ${periodLabel}` : ""}
          </p>
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
          {canBulkTrash ? (
            <BulkTrashToolbar
              store={store}
              entityType="delivery"
              selectedIds={deliverySelection.selectedIds}
              onDone={deliverySelection.clear}
            />
          ) : null}
          {canBulkTrash ? (
            <BulkTrashToolbar
              store={store}
              entityType="delivery"
              selectedIds={deliverySelection.selectedIds}
              onDone={deliverySelection.clear}
            />
          ) : null}
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
          {notSoftDeleted(state.deliveries).length === 0 ? (
            <EmptyState title="No deliveries" detail="Create a delivery from a posted supply." />
          ) : filtered.length === 0 ? (
            <EmptyState title="No deliveries match your search." detail="Try another number, order, or customer." />
          ) : (
            <table className="tlb-customers-table">
              <thead>
                <tr>
                  {canBulkTrash ? (
                    <SelectAllHeader
                      allSelected={deliverySelection.allVisibleSelected}
                      someSelected={deliverySelection.someVisibleSelected}
                      onToggle={deliverySelection.toggleAllVisible}
                    />
                  ) : null}
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
                    {canBulkTrash ? (
                      <SelectRowCell
                        id={d.id}
                        checked={deliverySelection.isSelected(d.id)}
                        onToggle={deliverySelection.toggle}
                        label={`Select ${d.number}`}
                      />
                    ) : null}
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
