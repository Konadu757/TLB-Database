import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, Search, X } from "lucide-react";

import {
  BulkTrashToolbar,
  SelectAllHeader,
  SelectRowCell,
  useListSelection,
} from "@/components/modules/list-bulk-trash";
import {
  RecordDetailPage,
  RecordDetailSection,
  StatusBadge,
  EmptyState,
  DetailBackChrome,
} from "@/components/modules/record-browser";
import { MoveToTrashButton } from "@/components/modules/move-to-trash-button";
import { Button } from "@/components/ui/button";
import { statusTone } from "@/lib/domain/calculations";
import { isSoftDeleted, notSoftDeleted } from "@/lib/domain/trash";
import type { PaymentTerms, Supplier, SupplierCategory } from "@/lib/domain/types";
import {
  type DashboardRangeSelection,
  DEMO_AS_OF,
  isoInRange,
  resolveSelectionRange,
  selectionLabel,
} from "@/lib/domain/period-range";
import { formatMoney } from "@/lib/store/tlb-store";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

const TERMS: PaymentTerms[] = ["COD", "Net 7", "Net 15", "Net 30", "Net 45", "Net 60"];

const SUPPLIER_CATEGORIES: SupplierCategory[] = [
  "Chemical",
  "Packaging",
  "Equipment",
  "Logistics",
  "Other",
];

const OUTSTANDING_PO_STATUSES = new Set([
  "Draft",
  "Open",
  "Ordered",
  "In transit",
  "Partially received",
]);

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

const emptySupplierForm = () => ({
  name: "",
  category: "Chemical" as SupplierCategory,
  contactName: "",
  phone: "",
  email: "",
  address: "",
  tin: "",
  paymentTerms: "Net 30" as PaymentTerms,
  notes: "",
  active: true,
  preferred: false,
});

function SupplierFormFields({
  form,
  setForm,
}: {
  form: ReturnType<typeof emptySupplierForm>;
  setForm: React.Dispatch<React.SetStateAction<ReturnType<typeof emptySupplierForm>>>;
}) {
  return (
    <>
      <label>
        Name
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label>
        Category / type
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value as SupplierCategory })}
        >
          {SUPPLIER_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        Contact
        <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
      </label>
      <label>
        Phone
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </label>
      <label>
        Email
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>
      <label>
        TIN (optional)
        <input value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })} />
      </label>
      <label className="tlb-span-2">
        Address
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </label>
      <label>
        Payment terms
        <select
          value={form.paymentTerms}
          onChange={(e) => setForm({ ...form, paymentTerms: e.target.value as PaymentTerms })}
        >
          {TERMS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="tlb-span-2">
        Notes
        <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>
      <label className="tlb-check">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
        Active
      </label>
      <label className="tlb-check">
        <input
          type="checkbox"
          checked={form.preferred}
          onChange={(e) => setForm({ ...form, preferred: e.target.checked })}
        />
        Preferred supplier
      </label>
    </>
  );
}

export function SuppliersModule({
  store,
  rangeSelection,
  selectedSupplierId,
  onSelectSupplier,
}: {
  store: TlbStoreApi;
  rangeSelection: DashboardRangeSelection;
  selectedSupplierId?: string | null;
  onSelectSupplier: (id: string | null) => void;
}) {
  const { state } = store;
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptySupplierForm);

  const range = useMemo(
    () => resolveSelectionRange(rangeSelection, DEMO_AS_OF),
    [rangeSelection],
  );
  const periodLabel = selectionLabel(rangeSelection);

  const periodStatsBySupplier = useMemo(() => {
    const map = new Map<
      string,
      { pos: number; poValue: number; receipts: number; payments: number; spend: number; outstanding: number }
    >();
    for (const s of state.suppliers) {
      map.set(s.id, { pos: 0, poValue: 0, receipts: 0, payments: 0, spend: 0, outstanding: 0 });
    }
    for (const po of state.supplierPurchaseOrders) {
      const cur = map.get(po.supplierId);
      if (!cur) continue;
      if (OUTSTANDING_PO_STATUSES.has(po.status)) cur.outstanding += 1;
      if (isoInRange(po.orderDate, range)) {
        cur.pos += 1;
        cur.poValue += po.total;
      }
    }
    for (const r of state.supplierReceipts) {
      const cur = map.get(r.supplierId);
      if (!cur) continue;
      if (isoInRange(r.receivedAt, range)) cur.receipts += 1;
    }
    for (const p of state.supplierPayments) {
      const cur = map.get(p.supplierId);
      if (!cur) continue;
      if (isoInRange(p.paymentDate, range)) {
        cur.payments += 1;
        cur.spend += p.amount;
      }
    }
    return map;
  }, [state.suppliers, state.supplierPurchaseOrders, state.supplierReceipts, state.supplierPayments, range]);

  const modulePeriodSummary = useMemo(() => {
    let pos = 0;
    let poValue = 0;
    let receipts = 0;
    let spend = 0;
    for (const stats of periodStatsBySupplier.values()) {
      pos += stats.pos;
      poValue += stats.poValue;
      receipts += stats.receipts;
      spend += stats.spend;
    }
    return { pos, poValue, receipts, spend };
  }, [periodStatsBySupplier]);

  const activeSuppliers = useMemo(() => notSoftDeleted(state.suppliers), [state.suppliers]);

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeSuppliers;
    return activeSuppliers.filter((s) => {
      const hay = [
        s.code,
        s.name,
        s.contactName,
        s.phone,
        s.email,
        s.tin ?? "",
        s.category,
        s.address,
        s.paymentTerms,
        s.notes ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [activeSuppliers, search]);

  const canBulkTrash = store.can("records.delete");
  const filteredIds = useMemo(() => filteredSuppliers.map((s) => s.id), [filteredSuppliers]);
  const selection = useListSelection(canBulkTrash ? filteredIds : []);

  if (selectedSupplierId) {
    return (
      <SupplierDetailModule
        store={store}
        supplierId={selectedSupplierId}
        rangeSelection={rangeSelection}
        onBack={() => onSelectSupplier(null)}
      />
    );
  }

  const hasSearch = search.trim().length > 0;

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Business</span>
          <strong>Suppliers</strong>
          <p className="tlb-muted-line">Activity scoped to {periodLabel}</p>
        </div>
        <div className="tlb-toolbar-actions">
          <label className="tlb-module-search">
            <Search aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code, contact, phone, email, category…"
              aria-label="Search suppliers"
            />
          </label>
          {canBulkTrash ? (
            <BulkTrashToolbar
              store={store}
              entityType="supplier"
              selectedIds={selection.selectedIds}
              onDone={selection.clear}
            />
          ) : null}
          <Button
            type="button"
            onClick={() => {
              setForm(emptySupplierForm());
              setCreating(true);
            }}
          >
            <Plus /> New supplier
          </Button>
        </div>
      </div>

      <div className="tlb-customer-summary" aria-label={`Supplier activity for ${periodLabel}`}>
        <div className="tlb-customer-summary-tile--info">
          <span>POs · {periodLabel}</span>
          <strong>{modulePeriodSummary.pos}</strong>
        </div>
        <div className="tlb-customer-summary-tile--gold">
          <span>PO value</span>
          <strong>{formatMoney(modulePeriodSummary.poValue)}</strong>
        </div>
        <div>
          <span>Stock receipts</span>
          <strong>{modulePeriodSummary.receipts}</strong>
        </div>
        <div className="tlb-customer-summary-tile--success">
          <span>Spend paid</span>
          <strong>{formatMoney(modulePeriodSummary.spend)}</strong>
        </div>
      </div>

      {creating ? (
        <article className="tlb-panel tlb-form-panel tlb-record-detail-section tlb-record-detail-section--profile">
          <form
            className="tlb-form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const ok = store.saveSupplier({
                name: form.name,
                category: form.category,
                contactName: form.contactName,
                phone: form.phone,
                email: form.email,
                address: form.address,
                paymentTerms: form.paymentTerms,
                active: form.active,
                preferred: form.preferred,
                ...(form.tin.trim() ? { tin: form.tin.trim() } : {}),
                ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
              });
              if (ok) {
                setCreating(false);
                setForm(emptySupplierForm());
              }
            }}
          >
            <div className="tlb-panel-heading">
              <div>
                <span>Supplier record</span>
                <strong>New supplier</strong>
              </div>
              <button type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
            <SupplierFormFields form={form} setForm={setForm} />
            <div className="tlb-form-actions tlb-span-2">
              <Button type="submit">Save supplier</Button>
            </div>
          </form>
        </article>
      ) : null}

      <article className="tlb-panel tlb-orders-panel tlb-customers-panel tlb-customers-list-panel">
        <div className="tlb-table-scroll">
          {activeSuppliers.length === 0 ? (
            <EmptyState title="No suppliers" detail="Create a supplier account to track procurement." />
          ) : filteredSuppliers.length === 0 ? (
            <EmptyState
              title="No suppliers match your search."
              detail="Try another name, code, contact, phone, email, or category."
            />
          ) : (
            <table className="tlb-customers-table">
              <thead>
                <tr>
                  {canBulkTrash ? (
                    <SelectAllHeader
                      allSelected={selection.allVisibleSelected}
                      someSelected={selection.someVisibleSelected}
                      onToggle={selection.toggleAllVisible}
                    />
                  ) : null}
                  <th className="tlb-col-priority">Code</th>
                  <th className="tlb-col-priority">Supplier</th>
                  <th className="tlb-col-contact">Phone / email</th>
                  <th className="tlb-col-priority">Category</th>
                  <th className="tlb-col-priority">Terms</th>
                  <th className="tlb-col-open">Period</th>
                  <th className="tlb-col-priority">Status</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map((s) => {
                  const stats = periodStatsBySupplier.get(s.id);
                  return (
                    <tr
                      key={s.id}
                      className={`tlb-row-clickable${selection.isSelected(s.id) ? " tlb-row-selected" : ""}`}
                      tabIndex={0}
                      onClick={() => onSelectSupplier(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectSupplier(s.id);
                        }
                      }}
                    >
                      {canBulkTrash ? (
                        <SelectRowCell
                          id={s.id}
                          checked={selection.isSelected(s.id)}
                          onToggle={selection.toggle}
                          label={`Select ${s.name}`}
                        />
                      ) : null}
                      <td className="tlb-col-priority">
                        <strong>{s.code}</strong>
                      </td>
                      <td className="tlb-col-priority">
                        {s.name}
                        <div className="tlb-muted-line">{s.contactName || "—"}</div>
                      </td>
                      <td className="tlb-col-contact">
                        {s.phone || "—"}
                        <div className="tlb-muted-line">{s.email || "—"}</div>
                      </td>
                      <td className="tlb-col-priority">{s.category}</td>
                      <td className="tlb-col-priority">{s.paymentTerms}</td>
                      <td className="tlb-col-open">
                        {stats && (stats.pos > 0 || stats.spend > 0 || stats.receipts > 0) ? (
                          <StatusBadge tone="info">
                            {stats.pos} PO · {formatMoney(stats.spend)}
                          </StatusBadge>
                        ) : (
                          <span className="tlb-muted-line">None in period</span>
                        )}
                      </td>
                      <td className="tlb-col-priority">
                        {s.preferred ? (
                          <StatusBadge tone="success">Preferred</StatusBadge>
                        ) : (
                          <StatusBadge tone={s.active ? "success" : "warning"}>
                            {s.active ? "Active" : "Inactive"}
                          </StatusBadge>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          aria-label={`View ${s.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectSupplier(s.id);
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
          )}
        </div>
        {hasSearch && filteredSuppliers.length > 0 ? (
          <div className="tlb-list-meta">
            Showing {filteredSuppliers.length} of {activeSuppliers.length} suppliers
            {selection.count > 0 ? ` · ${selection.count} selected` : ""}
          </div>
        ) : selection.count > 0 ? (
          <div className="tlb-list-meta">{selection.count} selected</div>
        ) : null}
      </article>
    </div>
  );
}

function SupplierDetailModule({
  store,
  supplierId,
  rangeSelection,
  onBack,
}: {
  store: TlbStoreApi;
  supplierId: string;
  rangeSelection: DashboardRangeSelection;
  onBack: () => void;
}) {
  const { state } = store;
  const selected = state.suppliers.find((s) => s.id === supplierId && !isSoftDeleted(s)) ?? null;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptySupplierForm);

  const range = useMemo(
    () => resolveSelectionRange(rangeSelection, DEMO_AS_OF),
    [rangeSelection],
  );
  const periodLabel = selectionLabel(rangeSelection);

  useEffect(() => {
    setEditing(false);
  }, [supplierId]);

  const startEdit = (supplier: Supplier) => {
    setEditing(true);
    setForm({
      name: supplier.name,
      category: supplier.category,
      contactName: supplier.contactName,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address,
      tin: supplier.tin ?? "",
      paymentTerms: supplier.paymentTerms,
      notes: supplier.notes ?? "",
      active: supplier.active,
      preferred: Boolean(supplier.preferred),
    });
  };

  const supplierHistory = useMemo(() => {
    if (!selected) {
      return {
        purchaseOrders: [] as typeof state.supplierPurchaseOrders,
        outstandingPos: [] as typeof state.supplierPurchaseOrders,
        receipts: [] as typeof state.supplierReceipts,
        payments: [] as typeof state.supplierPayments,
      };
    }
    const purchaseOrders = state.supplierPurchaseOrders.filter(
      (po) => po.supplierId === selected.id && isoInRange(po.orderDate, range),
    );
    const outstandingPos = state.supplierPurchaseOrders.filter(
      (po) => po.supplierId === selected.id && OUTSTANDING_PO_STATUSES.has(po.status),
    );
    const receipts = state.supplierReceipts.filter(
      (r) => r.supplierId === selected.id && isoInRange(r.receivedAt, range),
    );
    const payments = state.supplierPayments.filter(
      (p) => p.supplierId === selected.id && isoInRange(p.paymentDate, range),
    );
    return { purchaseOrders, outstandingPos, receipts, payments };
  }, [selected, state.supplierPurchaseOrders, state.supplierReceipts, state.supplierPayments, range]);

  const transactionSummary = useMemo(() => {
    const poValue = supplierHistory.purchaseOrders.reduce((sum, po) => sum + po.total, 0);
    const paymentsTotal = supplierHistory.payments.reduce((sum, p) => sum + p.amount, 0);
    return {
      pos: supplierHistory.purchaseOrders.length,
      poValue,
      outstanding: supplierHistory.outstandingPos.length,
      receipts: supplierHistory.receipts.length,
      payments: supplierHistory.payments.length,
      paymentsTotal,
    };
  }, [supplierHistory]);

  const recentActivity = useMemo(() => {
    type ActivityItem = { at: string; kind: string; detail: string };
    const items: ActivityItem[] = [];
    for (const po of supplierHistory.purchaseOrders) {
      items.push({
        at: po.updatedAt || po.createdAt || po.orderDate,
        kind: "PO",
        detail: `${po.number} · ${po.status} · ${formatMoney(po.total)}`,
      });
    }
    for (const r of supplierHistory.receipts) {
      const po = state.supplierPurchaseOrders.find((p) => p.id === r.purchaseOrderId);
      items.push({
        at: r.receivedAt,
        kind: "Receipt",
        detail: `${r.number}${po ? ` · ${po.number}` : ""}`,
      });
    }
    for (const p of supplierHistory.payments) {
      items.push({
        at: p.paymentDate,
        kind: "Payment",
        detail: `${p.number} · ${formatMoney(p.amount)}`,
      });
    }
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  }, [supplierHistory, state.supplierPurchaseOrders]);

  const productName = (id?: string) =>
    id ? state.products.find((p) => p.id === id)?.name ?? id : "—";
  const warehouseName = (id?: string) =>
    id ? state.warehouses.find((w) => w.id === id)?.name ?? id : "—";

  if (!selected) {
    return (
      <div className="tlb-module">
        <EmptyState title="Supplier not found" detail="The selected supplier account is no longer available." />
        <DetailBackChrome label="Suppliers" onBack={onBack} />
      </div>
    );
  }

  if (editing) {
    return (
      <div className="tlb-module tlb-record-detail-page">
        <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
        <DetailBackChrome label="Cancel edit" onBack={() => setEditing(false)} />
        <header className="tlb-record-detail-header">
          <div className="tlb-record-detail-header-row">
            <div className="tlb-record-detail-identity">
              <span className="tlb-record-detail-code">{selected.code}</span>
              <strong>Edit supplier</strong>
              <p className="tlb-muted-line">{selected.name}</p>
            </div>
          </div>
        </header>
        <article className="tlb-panel tlb-form-panel tlb-record-detail-section tlb-record-detail-section--profile">
          <form
            className="tlb-form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const ok = store.saveSupplier({
                id: selected.id,
                name: form.name,
                category: form.category,
                contactName: form.contactName,
                phone: form.phone,
                email: form.email,
                address: form.address,
                paymentTerms: form.paymentTerms,
                active: form.active,
                preferred: form.preferred,
                ...(form.tin.trim() ? { tin: form.tin.trim() } : {}),
                ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
              });
              if (ok) setEditing(false);
            }}
          >
            <div className="tlb-panel-heading">
              <div>
                <span>{selected.code}</span>
                <strong>Edit supplier</strong>
              </div>
            </div>
            <SupplierFormFields form={form} setForm={setForm} />
            <div className="tlb-form-actions tlb-span-2">
              <Button type="submit">Save supplier</Button>
            </div>
          </form>
        </article>
      </div>
    );
  }

  return (
    <RecordDetailPage
      backLabel="Suppliers"
      onBack={onBack}
      code={selected.code}
      title={selected.name}
      subtitle={selected.category}
      badges={
        <>
          <StatusBadge tone={selected.active ? "success" : "warning"}>
            {selected.active ? "Active" : "Inactive"}
          </StatusBadge>
          {selected.preferred ? <StatusBadge tone="success">Preferred</StatusBadge> : null}
        </>
      }
      actions={
        <>
          <Button type="button" variant="outline" onClick={() => startEdit(selected)}>
            Edit supplier
          </Button>
          <MoveToTrashButton
            store={store}
            entityType="supplier"
            entityId={selected.id}
            recordLabel={`${selected.code} · ${selected.name}`}
            onTrashed={onBack}
          />
        </>
      }
      flash={<Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />}
    >
      <RecordDetailSection tone="summary" kicker={`Period · ${periodLabel}`} title="Transaction summary" span2>
        <div className="tlb-customer-summary" aria-label="Supplier period summary">
          <div className="tlb-customer-summary-tile--info">
            <span>Purchase orders</span>
            <strong>
              {transactionSummary.pos}
              <small>{formatMoney(transactionSummary.poValue)}</small>
            </strong>
          </div>
          <div
            className={
              transactionSummary.outstanding > 0
                ? "tlb-customer-summary-tile--warning"
                : "tlb-customer-summary-tile--muted"
            }
          >
            <span>Outstanding POs</span>
            <strong>{transactionSummary.outstanding}</strong>
          </div>
          <div className="tlb-customer-summary-tile--gold">
            <span>Stock receipts</span>
            <strong>{transactionSummary.receipts}</strong>
          </div>
          <div className="tlb-customer-summary-tile--success">
            <span>Payments</span>
            <strong>
              {transactionSummary.payments}
              <small>{formatMoney(transactionSummary.paymentsTotal)}</small>
            </strong>
          </div>
        </div>
      </RecordDetailSection>

      <RecordDetailSection tone="profile" kicker="Profile" title="Supplier details" span2>
        <dl className="tlb-kv">
          <div>
            <dt>Company / name</dt>
            <dd>{selected.name}</dd>
          </div>
          <div>
            <dt>Code</dt>
            <dd>{selected.code}</dd>
          </div>
          <div>
            <dt>Category / type</dt>
            <dd>{selected.category}</dd>
          </div>
          <div>
            <dt>Contact person</dt>
            <dd>{selected.contactName || "—"}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{selected.phone || "—"}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{selected.email || "—"}</dd>
          </div>
          <div className="tlb-span-2">
            <dt>Address</dt>
            <dd>{selected.address || "—"}</dd>
          </div>
          <div>
            <dt>TIN</dt>
            <dd>{selected.tin || "—"}</dd>
          </div>
          <div>
            <dt>Payment terms</dt>
            <dd>{selected.paymentTerms}</dd>
          </div>
          <div>
            <dt>Record dates</dt>
            <dd>
              Created {new Date(selected.createdAt).toLocaleDateString()}
              <div className="tlb-muted-line">Updated {new Date(selected.updatedAt).toLocaleDateString()}</div>
            </dd>
          </div>
          <div className="tlb-span-2">
            <dt>Notes</dt>
            <dd>{selected.notes || "—"}</dd>
          </div>
        </dl>
      </RecordDetailSection>

      <RecordDetailSection tone="activity" kicker={`Activity · ${periodLabel}`} title="Recent activity">
        {recentActivity.length === 0 ? (
          <EmptyState
            title="No activity in this period."
            detail="Purchase orders, stock receipts, and payments dated in the selected range appear here."
          />
        ) : (
          <ul className="tlb-activity-list">
            {recentActivity.map((item) => (
              <li key={`${item.kind}-${item.detail}-${item.at}`}>
                <span>{item.kind}</span>
                <strong>{item.detail}</strong>
                <small>{new Date(item.at).toLocaleString()}</small>
              </li>
            ))}
          </ul>
        )}
      </RecordDetailSection>

      <RecordDetailSection tone="orders" kicker={`POs · ${periodLabel}`} title="Purchase orders" span2>
        {supplierHistory.purchaseOrders.length === 0 ? (
          <EmptyState
            title="No purchase orders in this period."
            detail="Supplier POs dated in the selected range will appear here."
          />
        ) : (
          <div className="tlb-table-scroll tlb-orders-panel">
            <table>
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Value</th>
                  <th>Expected</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {supplierHistory.purchaseOrders.map((po) => (
                  <tr key={po.id}>
                    <td>
                      <strong>{po.number}</strong>
                      <div className="tlb-muted-line">{new Date(po.orderDate).toLocaleDateString()}</div>
                    </td>
                    <td>{formatMoney(po.total)}</td>
                    <td>{po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : "—"}</td>
                    <td>
                      <StatusBadge tone={statusTone(po.status)}>{po.status}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RecordDetailSection>

      <RecordDetailSection tone="outstanding" kicker="Open" title="Outstanding purchase orders" span2>
        {supplierHistory.outstandingPos.length === 0 ? (
          <EmptyState
            title="No outstanding POs."
            detail="Open, in-transit, or partially received purchase orders appear here regardless of period."
          />
        ) : (
          <div className="tlb-table-scroll tlb-orders-panel">
            <table>
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {supplierHistory.outstandingPos.map((po) => (
                  <tr key={po.id}>
                    <td>
                      <strong>{po.number}</strong>
                    </td>
                    <td>{formatMoney(po.total)}</td>
                    <td>
                      <StatusBadge tone={statusTone(po.status)}>{po.status}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RecordDetailSection>

      <RecordDetailSection tone="stock" kicker={`Receipts · ${periodLabel}`} title="Stock receipts" span2>
        {supplierHistory.receipts.length === 0 ? (
          <EmptyState
            title="No stock receipts in this period."
            detail="Goods receipts from this supplier dated in range will list here."
          />
        ) : (
          <div className="tlb-table-scroll tlb-orders-panel">
            <table>
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Warehouse</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {supplierHistory.receipts.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.number}</strong>
                    </td>
                    <td>{productName(r.productId)}</td>
                    <td>{r.quantity ?? "—"}</td>
                    <td>{warehouseName(r.warehouseId)}</td>
                    <td>{new Date(r.receivedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RecordDetailSection>

      <RecordDetailSection tone="payments" kicker={`Payments · ${periodLabel}`} title="Payments" span2>
        {supplierHistory.payments.length === 0 ? (
          <EmptyState
            title="No payments in this period."
            detail="Payments to this supplier dated in the selected range appear here."
          />
        ) : (
          <div className="tlb-table-scroll tlb-orders-panel">
            <table>
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Method</th>
                  <th>Amount</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {supplierHistory.payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.number}</strong>
                    </td>
                    <td>{p.method}</td>
                    <td>{formatMoney(p.amount)}</td>
                    <td>{new Date(p.paymentDate).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RecordDetailSection>
    </RecordDetailPage>
  );
}
