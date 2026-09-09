import { useCallback, useEffect, useMemo, useState } from "react";

import {
  RecordBrowser,
  type BrowserColumn,
} from "@/components/modules/record-browser";
import {
  MODULE_META,
  recordsForModule,
  type CatalogRecord,
} from "@/lib/domain/list-catalog";
import type { DateRange } from "@/lib/domain/period-range";
import { calcAvailable } from "@/lib/domain/calculations";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

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

function CatalogModule({
  module,
  range,
  periodLabel,
  listColumns,
}: {
  module: string;
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
  listColumns?: BrowserColumn<CatalogRecord>[];
}) {
  const meta = MODULE_META[module] ?? {
    kicker: "TLB",
    description: "",
    searchPlaceholder: "Search records…",
    emptyTitle: "No records",
    emptyDetail: "Nothing to show for this filter.",
  };

  const rows = useMemo(() => recordsForModule(module, range), [module, range]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const onSelect = useCallback((id: string) => setSelectedId(id), []);
  const onBack = useCallback(() => setSelectedId(null), []);

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

export function QuotationsModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return (
    <CatalogModule
      module="Quotations"
      range={props.range}
      periodLabel={props.periodLabel}
      listColumns={quotationColumns}
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

export function BatchesModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return (
    <CatalogModule module="Batches" range={props.range} periodLabel={props.periodLabel} listColumns={batchColumns} />
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

export function StockMovementsModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return (
    <CatalogModule
      module="Stock Movements"
      range={props.range}
      periodLabel={props.periodLabel}
      listColumns={movementColumns}
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

export function ProcurementModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return (
    <CatalogModule
      module="Procurement"
      range={props.range}
      periodLabel={props.periodLabel}
      listColumns={procurementColumns}
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

export function ImportExportModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return (
    <CatalogModule
      module="Import & Export"
      range={props.range}
      periodLabel={props.periodLabel}
      listColumns={shipmentColumns}
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

export function FactoryModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return (
    <CatalogModule module="Factory" range={props.range} periodLabel={props.periodLabel} listColumns={factoryColumns} />
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

export function QualityControlModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return (
    <CatalogModule
      module="Quality Control"
      range={props.range}
      periodLabel={props.periodLabel}
      listColumns={qcColumns}
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
    return state.products.map((p) => {
      const bals = state.stock.filter((s) => s.productId === p.id);
      const onHand = bals.reduce((n, b) => n + b.physicalQty, 0);
      const reserved = bals.reduce((n, b) => n + b.reservedQty, 0);
      const available = bals.reduce((n, b) => n + calcAvailable(b), 0);
      const warehouses = bals
        .map((b) => state.warehouses.find((w) => w.id === b.warehouseId)?.name)
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
  useEffect(() => {
    if (!focusId) return;
    setSelectedId(focusId);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot on focusId
  }, [focusId]);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);
  const onBack = useCallback(() => setSelectedId(null), []);

  const columns: BrowserColumn<ProductRow>[] = [
    { key: "sku", header: "SKU", className: "tlb-col-priority", render: (r) => <strong>{r.sku}</strong> },
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
    { key: "available", header: "Available", className: "tlb-col-priority", render: (r) => r.available },
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
      detailSummary={(r) => [
        { label: "On hand", value: r.onHand, tileClass: "tlb-customer-summary-tile--info" },
        { label: "Reserved", value: r.reserved, tileClass: "tlb-customer-summary-tile--gold" },
        {
          label: "Available",
          value: r.available,
          tileClass: r.available <= 0 ? "tlb-customer-summary-tile--danger" : "tlb-customer-summary-tile--success",
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
    return state.warehouses.map((w) => {
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
  useEffect(() => {
    if (!focusId) return;
    setSelectedId(focusId);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot on focusId
  }, [focusId]);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);
  const onBack = useCallback(() => setSelectedId(null), []);

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
        { key: "code", header: "Code", className: "tlb-col-priority", render: (r) => <strong>{r.code}</strong> },
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
      statusOf={(r) => ({ label: r.active ? "Open" : "Closed", tone: r.active ? "success" : "warning" })}
      detailTitle={(r) => r.name}
      detailSubtitle={(r) => r.location}
      detailCode={(r) => r.code}
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
                cells: [p?.name ?? "—", p?.sku ?? "—", b.physicalQty, b.reservedQty, calcAvailable(b)],
              };
            }),
          },
        ];
      }}
    />
  );
}
