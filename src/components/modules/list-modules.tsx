import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { MoveToTrashButton } from "@/components/modules/move-to-trash-button";
import {
  RecordBrowser,
  RecordDetailPage,
  type BrowserColumn,
} from "@/components/modules/record-browser";
import { Button } from "@/components/ui/button";
import { MODULE_META, recordsForModule, type CatalogRecord } from "@/lib/domain/list-catalog";
import type { DateRange } from "@/lib/domain/period-range";
import { calcAvailable } from "@/lib/domain/calculations";
import { catalogDeletionSet, catalogPurgedSet, notSoftDeleted } from "@/lib/domain/trash";
import type { Quotation } from "@/lib/domain/types";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

type CatalogModuleProps = {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
  store?: TlbStoreApi;
  startCreating?: boolean | undefined;
  onStartCreatingConsumed?: (() => void) | undefined;
  onCreatingChange?: ((open: boolean) => void) | undefined;
};

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso.slice(0, 10);
  }
}

function money(n: number): string {
  return `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`;
}

function Flash({
  error,
  notice,
  onClear,
}: {
  error: string | null;
  notice: string | null;
  onClear: () => void;
}) {
  if (!error && !notice) return null;
  return (
    <div className={`tlb-flash ${error ? "tlb-flash--error" : "tlb-flash--notice"}`} role="status">
      <span>{error ?? notice}</span>
      <button type="button" onClick={onClear}>
        Dismiss
      </button>
    </div>
  );
}

function CatalogModule({
  module,
  range,
  periodLabel,
  listColumns,
  store,
  toolbarExtra,
  listExtra,
  userQuotations,
  selectedId: controlledSelectedId,
  onSelect: controlledOnSelect,
  onBack: controlledOnBack,
  detailActions: customDetailActions,
}: {
  module: string;
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
  listColumns?: BrowserColumn<CatalogRecord>[];
  store?: TlbStoreApi;
  toolbarExtra?: ReactNode;
  listExtra?: ReactNode;
  userQuotations?: readonly Quotation[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onBack?: () => void;
  detailActions?: (row: CatalogRecord) => ReactNode;
}) {
  const meta = MODULE_META[module] ?? {
    kicker: "TLB",
    description: "",
    searchPlaceholder: "Search records…",
    emptyTitle: "No records",
    emptyDetail: "Nothing to show for this filter.",
  };

  const hideIds = useMemo(() => {
    if (!store) return undefined;
    return new Set([...catalogDeletionSet(store.state), ...catalogPurgedSet(store.state)]);
  }, [store]);

  const rows = useMemo(
    () =>
      recordsForModule(module, range, {
        ...(hideIds ? { hideIds } : {}),
        ...(userQuotations ? { userQuotations } : {}),
      }),
    // Depend on range bounds so period chip changes always refilter lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- range object identity is unstable
    [module, range?.from, range?.to, hideIds, userQuotations],
  );
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId = controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId;
  const onSelect = useCallback(
    (id: string) => {
      if (controlledOnSelect) controlledOnSelect(id);
      else setInternalSelectedId(id);
    },
    [controlledOnSelect],
  );
  const onBack = useCallback(() => {
    if (controlledOnBack) controlledOnBack();
    else setInternalSelectedId(null);
  }, [controlledOnBack]);

  const columns: BrowserColumn<CatalogRecord>[] = listColumns ?? [
    {
      key: "primary",
      header: "Reference",
      className: "tlb-col-priority",
      render: (row) => <strong>{row.primary}</strong>,
    },
    {
      key: "secondary",
      header: "Summary",
      className: "tlb-col-priority",
      render: (row) => row.secondary,
    },
    {
      key: "date",
      header: "Date",
      className: "tlb-col-priority",
      render: (row) => row.date.slice(0, 10),
    },
  ];

  return (
    <RecordBrowser
      kicker={meta.kicker}
      title={module}
      searchPlaceholder={meta.searchPlaceholder}
      searchAriaLabel={`Search ${module}`}
      emptyTitle={meta.emptyTitle}
      emptyDetail={meta.emptyDetail}
      noMatchDetail="Try another reference, name, status, or clear search."
      rows={rows}
      columns={columns}
      getSearchValues={(row) => [row.searchText, row.primary, row.secondary, row.status]}
      selectedId={selectedId}
      onSelect={onSelect}
      onBack={onBack}
      backLabel={module}
      statusOf={(row) => ({ label: row.status, tone: row.tone })}
      detailTitle={(row) => row.primary}
      detailSubtitle={(row) => row.secondary}
      detailCode={(row) => row.primary}
      {...(periodLabel ? { periodLabel } : {})}
      {...(toolbarExtra !== undefined ? { toolbarExtra } : {})}
      {...(listExtra !== undefined ? { listExtra } : {})}
      {...(store
        ? {
            trash: { store, entityType: "catalog" as const },
            detailActions: (row: CatalogRecord) =>
              customDetailActions ? (
                customDetailActions(row)
              ) : (
                <MoveToTrashButton
                  store={store}
                  entityType="catalog"
                  entityId={row.id}
                  recordLabel={`${module} ${row.primary}`}
                  onTrashed={onBack}
                />
              ),
          }
        : {})}
      detailSummary={(row) =>
        (row.summary ?? []).map((s) => ({
          label: s.label,
          value: s.value,
          ...(s.note ? { note: s.note } : {}),
        }))
      }
      detailFields={(row) =>
        row.fields.map((f) => ({
          label: f.label,
          value: f.value,
          ...(f.label === "Notes" ? { span: 2 as const } : {}),
        }))
      }
      historyGroups={(row) => [
        {
          title: "Line items",
          empty: "No line items on this record.",
          tone: "lines" as const,
          headers: ["Item", "Qty", "Amount", "Note"],
          rows: (row.lines ?? []).map((line) => ({
            id: line.id,
            cells: [
              <strong key="l">{line.label}</strong>,
              line.qty ?? "—",
              line.amount != null ? money(line.amount) : "—",
              line.note ?? "—",
            ],
          })),
        },
        {
          title: "Activity",
          empty: "No activity yet.",
          tone: "activity" as const,
          headers: ["When", "Event", "Detail"],
          rows: (row.history ?? []).map((h) => ({
            id: h.id,
            cells: [formatWhen(h.at), <strong key="e">{h.label}</strong>, h.detail],
          })),
        },
      ]}
    />
  );
}

const quotationColumns: BrowserColumn<CatalogRecord>[] = [
  {
    key: "primary",
    header: "Quote #",
    className: "tlb-col-priority",
    render: (row) => <strong>{row.primary}</strong>,
  },
  {
    key: "customer",
    header: "Customer / item",
    className: "tlb-col-priority",
    render: (row) => row.secondary,
  },
  {
    key: "total",
    header: "Total",
    className: "tlb-col-priority",
    render: (row) => row.summary?.find((s) => s.label === "Total")?.value ?? "—",
  },
  {
    key: "date",
    header: "Date",
    className: "tlb-col-priority",
    render: (row) => row.date.slice(0, 10),
  },
];

export function QuotationsModule(props: CatalogModuleProps) {
  const store = props.store;
  const startCreating = props.startCreating;
  const onStartCreatingConsumed = props.onStartCreatingConsumed;
  const onCreatingChange = props.onCreatingChange;

  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [contact, setContact] = useState("");
  const [itemLabel, setItemLabel] = useState("");
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");
  const [paymentTerms, setPaymentTerms] = useState("Net 30");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"Draft" | "Sent">("Draft");
  const [previewNumber, setPreviewNumber] = useState<string | null>(null);
  const canEdit = Boolean(store && (store.can("quotations.view") || store.can("records.edit")));
  const editingQuote =
    editing && selectedId && store ? store.state.quotations.find((q) => q.id === selectedId) : null;

  const openCreate = useCallback(() => {
    setCreating(true);
    onCreatingChange?.(true);
    if (store) {
      const next = (store.state.counters.quotation ?? 0) + 1;
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      setPreviewNumber(`TLB-QTE-${yy}${mm}-${String(next).padStart(5, "0")}`);
      const first = notSoftDeleted(store.state.customers).find((c) => c.active);
      if (first) {
        setCustomerId(first.id);
        setCustomerName(first.name);
        setContact([first.contactName, first.email].filter(Boolean).join(" · "));
        setPaymentTerms(first.paymentTerms || "Net 30");
      } else {
        setCustomerId("");
        setCustomerName("");
        setContact("");
      }
    }
  }, [onCreatingChange, store]);

  const closeCreate = useCallback(() => {
    setCreating(false);
    onCreatingChange?.(false);
  }, [onCreatingChange]);

  useEffect(() => {
    if (!startCreating) return;
    openCreate();
    onStartCreatingConsumed?.();
  }, [startCreating, openCreate, onStartCreatingConsumed]);

  useEffect(() => {
    return () => onCreatingChange?.(false);
  }, [onCreatingChange]);

  const customers = store ? notSoftDeleted(store.state.customers).filter((c) => c.active) : [];

  if (editingQuote && store) {
    return (
      <RecordDetailPage
        backLabel="Quotations"
        onBack={() => setEditing(false)}
        code={editingQuote.number}
        title={editingQuote.number}
        subtitle="Edit quotation"
        flash={<Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />}
      >
        <article className="tlb-panel tlb-form-panel tlb-span-2">
          <form
            className="tlb-form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const ok = store.updateQuotation(editingQuote.id, {
                customerName,
                itemLabel,
                qty: Number(qty),
                unitPrice: Number(unitPrice),
                paymentTerms,
                status,
                ...(customerId ? { customerId } : {}),
                ...(contact.trim() ? { contact: contact.trim() } : {}),
                ...(notes.trim() ? { notes: notes.trim() } : {}),
              });
              if (ok) setEditing(false);
            }}
          >
            <div className="tlb-panel-heading">
              <div>
                <span>{editingQuote.number}</span>
                <strong>Edit quotation</strong>
              </div>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
            <label>
              Customer
              <select
                value={customerId}
                onChange={(e) => {
                  const id = e.target.value;
                  setCustomerId(id);
                  const c = customers.find((row) => row.id === id);
                  if (c) {
                    setCustomerName(c.name);
                    setContact([c.contactName, c.email].filter(Boolean).join(" · "));
                    setPaymentTerms(c.paymentTerms || "Net 30");
                  }
                }}
              >
                <option value="">Custom / walk-in</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Customer name
              <input
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </label>
            <label>
              Contact
              <input value={contact} onChange={(e) => setContact(e.target.value)} />
            </label>
            <label>
              Payment terms
              <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "Draft" | "Sent")}
              >
                <option value="Draft">Draft</option>
                <option value="Sent">Sent</option>
              </select>
            </label>
            <label className="tlb-span-2">
              Item / description
              <input required value={itemLabel} onChange={(e) => setItemLabel(e.target.value)} />
            </label>
            <label>
              Qty
              <input
                required
                type="number"
                min={0.01}
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </label>
            <label>
              Unit price (GHS)
              <input
                required
                type="number"
                min={0}
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </label>
            <label className="tlb-span-2">
              Notes
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="tlb-form-actions tlb-span-2">
              <Button type="submit">Save quotation</Button>
            </div>
          </form>
        </article>
      </RecordDetailPage>
    );
  }

  return (
    <CatalogModule
      module="Quotations"
      selectedId={selectedId}
      onSelect={setSelectedId}
      onBack={() => {
        setSelectedId(null);
        setEditing(false);
      }}
      detailActions={
        store
          ? (row) => {
              const live = store.state.quotations.find((q) => q.id === row.id);
              return (
                <>
                  {live && canEdit ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCustomerId(live.customerId ?? "");
                        setCustomerName(live.customerName);
                        setContact(live.contact ?? "");
                        setItemLabel(live.itemLabel);
                        setQty(String(live.qty));
                        setUnitPrice(String(live.unitPrice));
                        setPaymentTerms(live.paymentTerms);
                        setNotes(live.notes ?? "");
                        setStatus(live.status);
                        setEditing(true);
                      }}
                    >
                      Edit quotation
                    </Button>
                  ) : null}
                  <MoveToTrashButton
                    store={store}
                    entityType="quotation"
                    entityId={row.id}
                    recordLabel={`Quotations ${row.primary}`}
                    onTrashed={() => {
                      setSelectedId(null);
                      setEditing(false);
                    }}
                  />
                </>
              );
            }
          : undefined
      }
      listColumns={quotationColumns}
      {...(props.range !== undefined ? { range: props.range } : {})}
      {...(props.periodLabel !== undefined ? { periodLabel: props.periodLabel } : {})}
      {...(store ? { store } : {})}
      {...(store ? { userQuotations: notSoftDeleted(store.state.quotations) } : {})}
      toolbarExtra={
        store ? (
          <Button type="button" onClick={() => (creating ? closeCreate() : openCreate())}>
            <Plus /> {creating ? "Close form" : "New quotation"}
          </Button>
        ) : null
      }
      listExtra={
        creating && store ? (
          <article className="tlb-panel tlb-form-panel tlb-record-detail-section tlb-record-detail-section--profile">
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const ok = store.createQuotation({
                  customerName,
                  itemLabel,
                  qty: Number(qty),
                  unitPrice: Number(unitPrice),
                  paymentTerms,
                  ...(customerId ? { customerId } : {}),
                  ...(contact.trim() ? { contact: contact.trim() } : {}),
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                });
                if (ok) {
                  setItemLabel("");
                  setQty("1");
                  setUnitPrice("0");
                  setNotes("");
                  closeCreate();
                }
              }}
            >
              <div className="tlb-panel-heading">
                <div>
                  <span>Commercial quotation</span>
                  <strong>New quotation{previewNumber ? ` · ${previewNumber}` : ""}</strong>
                </div>
                <button type="button" onClick={closeCreate}>
                  Cancel
                </button>
              </div>
              <label>
                Customer
                <select
                  value={customerId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setCustomerId(id);
                    const c = customers.find((row) => row.id === id);
                    if (c) {
                      setCustomerName(c.name);
                      setContact([c.contactName, c.email].filter(Boolean).join(" · "));
                      setPaymentTerms(c.paymentTerms || "Net 30");
                    } else {
                      setCustomerName("");
                    }
                  }}
                >
                  <option value="">Custom / walk-in</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Customer name
                <input
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer or company"
                />
              </label>
              <label>
                Contact
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Name · email"
                />
              </label>
              <label>
                Payment terms
                <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
              </label>
              <label className="tlb-span-2">
                Item / description
                <input
                  required
                  value={itemLabel}
                  onChange={(e) => setItemLabel(e.target.value)}
                  placeholder="Product or package being quoted"
                />
              </label>
              <label>
                Qty
                <input
                  required
                  type="number"
                  min={0.01}
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </label>
              <label>
                Unit price (GHS)
                <input
                  required
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                />
              </label>
              <label className="tlb-span-2">
                Notes
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </label>
              <div className="tlb-form-actions tlb-span-2">
                <Button type="submit">Save quotation</Button>
              </div>
            </form>
          </article>
        ) : null
      }
    />
  );
}

const batchColumns: BrowserColumn<CatalogRecord>[] = [
  {
    key: "primary",
    header: "Batch",
    className: "tlb-col-priority",
    render: (row) => <strong>{row.primary}</strong>,
  },
  {
    key: "secondary",
    header: "Location / note",
    className: "tlb-col-priority",
    render: (row) => row.secondary,
  },
  {
    key: "date",
    header: "Date",
    className: "tlb-col-priority",
    render: (row) => row.date.slice(0, 10),
  },
];

export function BatchesModule(props: CatalogModuleProps) {
  return (
    <CatalogModule
      module="Batches"
      listColumns={batchColumns}
      {...(props.range !== undefined ? { range: props.range } : {})}
      {...(props.periodLabel !== undefined ? { periodLabel: props.periodLabel } : {})}
      {...(props.store ? { store: props.store } : {})}
    />
  );
}

const movementColumns: BrowserColumn<CatalogRecord>[] = [
  {
    key: "primary",
    header: "Movement #",
    className: "tlb-col-priority",
    render: (row) => <strong>{row.primary}</strong>,
  },
  {
    key: "secondary",
    header: "Detail",
    className: "tlb-col-priority",
    render: (row) => row.secondary,
  },
  {
    key: "date",
    header: "Date",
    className: "tlb-col-priority",
    render: (row) => row.date.slice(0, 10),
  },
];

export function StockMovementsModule(props: CatalogModuleProps) {
  return (
    <CatalogModule
      module="Stock Movements"
      listColumns={movementColumns}
      {...(props.range !== undefined ? { range: props.range } : {})}
      {...(props.periodLabel !== undefined ? { periodLabel: props.periodLabel } : {})}
      {...(props.store ? { store: props.store } : {})}
    />
  );
}

const procurementColumns: BrowserColumn<CatalogRecord>[] = [
  {
    key: "primary",
    header: "PO #",
    className: "tlb-col-priority",
    render: (row) => <strong>{row.primary}</strong>,
  },
  {
    key: "secondary",
    header: "Supplier",
    className: "tlb-col-priority",
    render: (row) => row.secondary,
  },
  {
    key: "value",
    header: "Value",
    className: "tlb-col-priority",
    render: (row) => row.summary?.find((s) => s.label === "Value")?.value ?? "—",
  },
  {
    key: "date",
    header: "Date",
    className: "tlb-col-priority",
    render: (row) => row.date.slice(0, 10),
  },
];

export function ProcurementModule(props: CatalogModuleProps) {
  return (
    <CatalogModule
      module="Procurement"
      listColumns={procurementColumns}
      {...(props.range !== undefined ? { range: props.range } : {})}
      {...(props.periodLabel !== undefined ? { periodLabel: props.periodLabel } : {})}
      {...(props.store ? { store: props.store } : {})}
    />
  );
}

const shipmentColumns: BrowserColumn<CatalogRecord>[] = [
  {
    key: "primary",
    header: "Shipment #",
    className: "tlb-col-priority",
    render: (row) => <strong>{row.primary}</strong>,
  },
  {
    key: "secondary",
    header: "Lane / commodity",
    className: "tlb-col-priority",
    render: (row) => row.secondary,
  },
  {
    key: "date",
    header: "Date",
    className: "tlb-col-priority",
    render: (row) => row.date.slice(0, 10),
  },
];

export function ImportExportModule(props: CatalogModuleProps) {
  return (
    <CatalogModule
      module="Import & Export"
      listColumns={shipmentColumns}
      {...(props.range !== undefined ? { range: props.range } : {})}
      {...(props.periodLabel !== undefined ? { periodLabel: props.periodLabel } : {})}
      {...(props.store ? { store: props.store } : {})}
    />
  );
}

const factoryColumns: BrowserColumn<CatalogRecord>[] = [
  {
    key: "primary",
    header: "Production #",
    className: "tlb-col-priority",
    render: (row) => <strong>{row.primary}</strong>,
  },
  {
    key: "secondary",
    header: "Product / batch",
    className: "tlb-col-priority",
    render: (row) => row.secondary,
  },
  {
    key: "date",
    header: "Date",
    className: "tlb-col-priority",
    render: (row) => row.date.slice(0, 10),
  },
];

export function FactoryModule(props: CatalogModuleProps) {
  return (
    <CatalogModule
      module="Factory"
      listColumns={factoryColumns}
      {...(props.range !== undefined ? { range: props.range } : {})}
      {...(props.periodLabel !== undefined ? { periodLabel: props.periodLabel } : {})}
      {...(props.store ? { store: props.store } : {})}
    />
  );
}

const qcColumns: BrowserColumn<CatalogRecord>[] = [
  {
    key: "primary",
    header: "Batch",
    className: "tlb-col-priority",
    render: (row) => <strong>{row.primary}</strong>,
  },
  {
    key: "secondary",
    header: "Product / note",
    className: "tlb-col-priority",
    render: (row) => row.secondary,
  },
  {
    key: "date",
    header: "Date",
    className: "tlb-col-priority",
    render: (row) => row.date.slice(0, 10),
  },
];

export function QualityControlModule(props: CatalogModuleProps) {
  return (
    <CatalogModule
      module="Quality Control"
      listColumns={qcColumns}
      {...(props.range !== undefined ? { range: props.range } : {})}
      {...(props.periodLabel !== undefined ? { periodLabel: props.periodLabel } : {})}
      {...(props.store ? { store: props.store } : {})}
    />
  );
}

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string;
  active: boolean;
  onHand: number;
  reserved: number;
  available: number;
  warehouses: string;
};

export function ProductsModule({
  store,
  focusId,
  onFocusConsumed,
}: {
  store: TlbStoreApi;
  focusId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const { state } = store;
  const rows = useMemo<ProductRow[]>(() => {
    return notSoftDeleted(state.products).map((p) => {
      const bals = state.stock.filter((s) => s.productId === p.id);
      const onHand = bals.reduce((n, b) => n + b.physicalQty, 0);
      const reserved = bals.reduce((n, b) => n + b.reservedQty, 0);
      const available = bals.reduce((n, b) => n + calcAvailable(b), 0);
      const warehouses = bals
        .map((b) => notSoftDeleted(state.warehouses).find((w) => w.id === b.warehouseId)?.name)
        .filter(Boolean)
        .join(", ");
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        category: p.category,
        active: p.active,
        onHand,
        reserved,
        available,
        warehouses: warehouses || "—",
      };
    });
  }, [state.products, state.stock, state.warehouses]);

  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ sku: "", name: "", unit: "", category: "", active: true });
  const canEdit = store.can("records.edit") || store.can("stock.view");
  useEffect(() => {
    if (!focusId) return;
    setSelectedId(focusId);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot on focusId
  }, [focusId]);
  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    setEditing(false);
  }, []);
  const onBack = useCallback(() => {
    setSelectedId(null);
    setEditing(false);
  }, []);

  const selectedProduct = selectedId ? state.products.find((p) => p.id === selectedId) : null;
  if (selectedProduct && editing) {
    return (
      <RecordDetailPage
        backLabel="Products"
        onBack={() => setEditing(false)}
        code={selectedProduct.sku}
        title={selectedProduct.name}
        subtitle="Edit product"
        flash={<Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />}
      >
        <article className="tlb-panel tlb-form-panel tlb-span-2">
          <form
            className="tlb-form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const ok = store.saveProduct({
                id: selectedProduct.id,
                sku: form.sku,
                name: form.name,
                unit: form.unit,
                category: form.category,
                active: form.active,
              });
              if (ok) setEditing(false);
            }}
          >
            <div className="tlb-panel-heading">
              <div>
                <span>{selectedProduct.sku}</span>
                <strong>Edit product</strong>
              </div>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
            <label>
              SKU
              <input
                required
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              />
            </label>
            <label>
              Name
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label>
              Unit
              <input
                required
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              />
            </label>
            <label>
              Category
              <input
                required
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              />
            </label>
            <label>
              Active
              <select
                value={form.active ? "yes" : "no"}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === "yes" }))}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <div className="tlb-form-actions tlb-span-2">
              <Button type="submit">Save product</Button>
            </div>
          </form>
        </article>
      </RecordDetailPage>
    );
  }

  const columns: BrowserColumn<ProductRow>[] = [
    {
      key: "sku",
      header: "SKU",
      className: "tlb-col-priority",
      render: (r) => <strong>{r.sku}</strong>,
    },
    {
      key: "name",
      header: "Product",
      className: "tlb-col-priority",
      render: (r) => (
        <>
          {r.name}
          <div className="tlb-muted-line">{r.category}</div>
        </>
      ),
    },
    { key: "onHand", header: "On hand", className: "tlb-col-priority", render: (r) => r.onHand },
    {
      key: "available",
      header: "Available",
      className: "tlb-col-priority",
      render: (r) => r.available,
    },
  ];

  return (
    <RecordBrowser
      kicker="Inventory"
      title="Products"
      searchPlaceholder="Search SKU, name, category, unit…"
      searchAriaLabel="Search products"
      emptyTitle="No products"
      emptyDetail="Product master is empty."
      noMatchDetail="Try another SKU, name, or category."
      rows={rows}
      columns={columns}
      getSearchValues={(r) => [r.sku, r.name, r.category, r.unit, r.warehouses]}
      selectedId={selectedId}
      onSelect={onSelect}
      onBack={onBack}
      backLabel="Products"
      statusOf={(r) =>
        r.active
          ? r.available <= 0
            ? { label: "Out of stock", tone: "danger" }
            : r.available < 20
              ? { label: "Low", tone: "warning" }
              : { label: "In stock", tone: "success" }
          : { label: "Inactive", tone: "warning" }
      }
      detailTitle={(r) => r.name}
      detailSubtitle={(r) => `${r.sku} · ${r.unit}`}
      detailCode={(r) => r.sku}
      trash={{ store, entityType: "product" }}
      detailActions={(r) => (
        <>
          {canEdit ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const p = state.products.find((x) => x.id === r.id);
                if (!p) return;
                setForm({
                  sku: p.sku,
                  name: p.name,
                  unit: p.unit,
                  category: p.category,
                  active: p.active,
                });
                setEditing(true);
              }}
            >
              Edit product
            </Button>
          ) : null}
          <MoveToTrashButton
            store={store}
            entityType="product"
            entityId={r.id}
            recordLabel={`${r.sku} · ${r.name}`}
            onTrashed={onBack}
          />
        </>
      )}
      detailSummary={(r) => [
        { label: "On hand", value: r.onHand, tileClass: "tlb-customer-summary-tile--info" },
        { label: "Reserved", value: r.reserved, tileClass: "tlb-customer-summary-tile--gold" },
        {
          label: "Available",
          value: r.available,
          tileClass:
            r.available <= 0
              ? "tlb-customer-summary-tile--danger"
              : "tlb-customer-summary-tile--success",
        },
        { label: "Category", value: r.category },
      ]}
      detailFields={(r) => [
        { label: "SKU", value: r.sku },
        { label: "Unit", value: r.unit },
        { label: "Category", value: r.category },
        { label: "Active", value: r.active ? "Yes" : "No" },
        { label: "Warehouses", value: r.warehouses, span: 2 },
      ]}
      historyGroups={(r) => {
        const bals = state.stock.filter((s) => s.productId === r.id);
        return [
          {
            title: "Stock by warehouse",
            empty: "No stock balances for this product.",
            tone: "stock" as const,
            headers: ["Warehouse", "Physical", "Reserved", "Available"],
            rows: bals.map((b) => {
              const wh = state.warehouses.find((w) => w.id === b.warehouseId);
              return {
                id: b.id,
                cells: [wh?.name ?? b.warehouseId, b.physicalQty, b.reservedQty, calcAvailable(b)],
              };
            }),
          },
        ];
      }}
    />
  );
}

type WarehouseRow = {
  id: string;
  code: string;
  name: string;
  location: string;
  active: boolean;
  skuCount: number;
  units: number;
  valueHint: string;
};

export function WarehousesModule({
  store,
  focusId,
  onFocusConsumed,
}: {
  store: TlbStoreApi;
  focusId?: string | null;
  onFocusConsumed?: () => void;
}) {
  const { state } = store;
  const rows = useMemo<WarehouseRow[]>(() => {
    return notSoftDeleted(state.warehouses).map((w) => {
      const bals = state.stock.filter((s) => s.warehouseId === w.id);
      const units = bals.reduce((n, b) => n + b.physicalQty, 0);
      return {
        id: w.id,
        code: w.code,
        name: w.name,
        location: w.location,
        active: w.active,
        skuCount: bals.length,
        units,
        valueHint: `${bals.length} SKU · ${units} units`,
      };
    });
  }, [state.warehouses, state.stock]);

  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", location: "", active: true });
  const canEdit = store.can("records.edit") || store.can("stock.view");
  useEffect(() => {
    if (!focusId) return;
    setSelectedId(focusId);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot on focusId
  }, [focusId]);
  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    setEditing(false);
  }, []);
  const onBack = useCallback(() => {
    setSelectedId(null);
    setEditing(false);
  }, []);

  const selectedWh = selectedId ? state.warehouses.find((w) => w.id === selectedId) : null;
  if (selectedWh && editing) {
    return (
      <RecordDetailPage
        backLabel="Warehouses"
        onBack={() => setEditing(false)}
        code={selectedWh.code}
        title={selectedWh.name}
        subtitle="Edit warehouse"
        flash={<Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />}
      >
        <article className="tlb-panel tlb-form-panel tlb-span-2">
          <form
            className="tlb-form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const ok = store.saveWarehouse({
                id: selectedWh.id,
                code: form.code,
                name: form.name,
                location: form.location,
                active: form.active,
              });
              if (ok) setEditing(false);
            }}
          >
            <div className="tlb-panel-heading">
              <div>
                <span>{selectedWh.code}</span>
                <strong>Edit warehouse</strong>
              </div>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
            <label>
              Code
              <input
                required
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              />
            </label>
            <label>
              Name
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="tlb-span-2">
              Location
              <input
                required
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
            </label>
            <label>
              Active
              <select
                value={form.active ? "yes" : "no"}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === "yes" }))}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <div className="tlb-form-actions tlb-span-2">
              <Button type="submit">Save warehouse</Button>
            </div>
          </form>
        </article>
      </RecordDetailPage>
    );
  }

  return (
    <RecordBrowser
      kicker="Inventory"
      title="Warehouses"
      searchPlaceholder="Search code, name, location…"
      searchAriaLabel="Search warehouses"
      emptyTitle="No warehouses"
      emptyDetail="Add a warehouse location to begin stocking."
      noMatchDetail="Try another code, name, or location."
      rows={rows}
      columns={[
        {
          key: "code",
          header: "Code",
          className: "tlb-col-priority",
          render: (r) => <strong>{r.code}</strong>,
        },
        {
          key: "name",
          header: "Warehouse",
          className: "tlb-col-priority",
          render: (r) => (
            <>
              {r.name}
              <div className="tlb-muted-line">{r.location}</div>
            </>
          ),
        },
        { key: "skus", header: "SKUs", className: "tlb-col-priority", render: (r) => r.skuCount },
        { key: "units", header: "Units", className: "tlb-col-priority", render: (r) => r.units },
      ]}
      getSearchValues={(r) => [r.code, r.name, r.location]}
      selectedId={selectedId}
      onSelect={onSelect}
      onBack={onBack}
      backLabel="Warehouses"
      statusOf={(r) => ({
        label: r.active ? "Open" : "Closed",
        tone: r.active ? "success" : "warning",
      })}
      detailTitle={(r) => r.name}
      detailSubtitle={(r) => r.location}
      detailCode={(r) => r.code}
      trash={{ store, entityType: "warehouse" }}
      detailActions={(r) => (
        <>
          {canEdit ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const w = state.warehouses.find((x) => x.id === r.id);
                if (!w) return;
                setForm({ code: w.code, name: w.name, location: w.location, active: w.active });
                setEditing(true);
              }}
            >
              Edit warehouse
            </Button>
          ) : null}
          <MoveToTrashButton
            store={store}
            entityType="warehouse"
            entityId={r.id}
            recordLabel={`${r.code} · ${r.name}`}
            onTrashed={onBack}
          />
        </>
      )}
      detailSummary={(r) => [
        { label: "SKUs", value: r.skuCount, tileClass: "tlb-customer-summary-tile--info" },
        { label: "Units", value: r.units, tileClass: "tlb-customer-summary-tile--gold" },
        { label: "Code", value: r.code },
        { label: "Status", value: r.active ? "Open" : "Closed" },
      ]}
      detailFields={(r) => [
        { label: "Code", value: r.code },
        { label: "Location", value: r.location },
        { label: "Active", value: r.active ? "Yes" : "No" },
        { label: "Stock summary", value: r.valueHint, span: 2 },
      ]}
      historyGroups={(r) => {
        const bals = state.stock.filter((s) => s.warehouseId === r.id);
        return [
          {
            title: "Stock on hand",
            empty: "No stock in this warehouse.",
            tone: "stock" as const,
            headers: ["Product", "SKU", "Physical", "Reserved", "Available"],
            rows: bals.map((b) => {
              const p = state.products.find((x) => x.id === b.productId);
              return {
                id: b.id,
                cells: [
                  p?.name ?? "—",
                  p?.sku ?? "—",
                  b.physicalQty,
                  b.reservedQty,
                  calcAvailable(b),
                ],
              };
            }),
          },
        ];
      }}
    />
  );
}
