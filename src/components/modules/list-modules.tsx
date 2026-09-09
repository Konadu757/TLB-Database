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

function CatalogModule({
  module,
  range,
  periodLabel,
}: {
  module: string;
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  const meta = MODULE_META[module] ?? {
    kicker: "TLB",
    description: "",
    searchPlaceholder: "Search records…",
    emptyTitle: "No records",
    emptyDetail: "Nothing to show for this filter.",
  };

  const rows = useMemo(() => recordsForModule(module, range), [module, range]);
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);

  useEffect(() => {
    if (!rows.some((r) => r.id === selectedId)) {
      setSelectedId(rows[0]?.id ?? null);
    }
  }, [rows, selectedId]);

  const onSelect = useCallback((id: string) => setSelectedId(id), []);

  const columns: BrowserColumn<CatalogRecord>[] = [
    {
      key: "primary",
      header: "Record",
      render: (row) => <strong>{row.primary}</strong>,
    },
    {
      key: "secondary",
      header: "Detail",
      render: (row) => row.secondary,
    },
    {
      key: "date",
      header: "Date",
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
      statusOf={(row) => ({ label: row.status, tone: row.tone })}
      detailTitle={(row) => row.primary}
      detailSubtitle={(row) => row.secondary}
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
          headers: ["Item", "Qty", "Amount", "Note"],
          rows: (row.lines ?? []).map((line) => ({
            id: line.id,
            cells: [
              <strong key="l">{line.label}</strong>,
              line.qty ?? "—",
              line.amount != null
                ? `GHS ${line.amount.toLocaleString("en-GH", { minimumFractionDigits: 2 })}`
                : "—",
              line.note ?? "—",
            ],
          })),
        },
        {
          title: "Activity",
          empty: "No activity yet.",
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

export function QuotationsModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return <CatalogModule module="Quotations" range={props.range} periodLabel={props.periodLabel} />;
}

export function BatchesModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return <CatalogModule module="Batches" range={props.range} periodLabel={props.periodLabel} />;
}

export function StockMovementsModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return <CatalogModule module="Stock Movements" range={props.range} periodLabel={props.periodLabel} />;
}

export function ProcurementModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return <CatalogModule module="Procurement" range={props.range} periodLabel={props.periodLabel} />;
}

export function ImportExportModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return <CatalogModule module="Import & Export" range={props.range} periodLabel={props.periodLabel} />;
}

export function FactoryModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return <CatalogModule module="Factory" range={props.range} periodLabel={props.periodLabel} />;
}

export function QualityControlModule(props: {
  range?: DateRange | null | undefined;
  periodLabel?: string | undefined;
}) {
  return <CatalogModule module="Quality Control" range={props.range} periodLabel={props.periodLabel} />;
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

export function ProductsModule({ store }: { store: TlbStoreApi }) {
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

  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);

  const columns: BrowserColumn<ProductRow>[] = [
    { key: "sku", header: "SKU", render: (r) => <strong>{r.sku}</strong> },
    {
      key: "name",
      header: "Product",
      render: (r) => (
        <>
          {r.name}
          <div className="tlb-muted-line">{r.category}</div>
        </>
      ),
    },
    { key: "onHand", header: "On hand", render: (r) => r.onHand },
    { key: "available", header: "Available", render: (r) => r.available },
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
      detailSummary={(r) => [
        { label: "On hand", value: r.onHand },
        { label: "Reserved", value: r.reserved },
        { label: "Available", value: r.available },
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

export function WarehousesModule({ store }: { store: TlbStoreApi }) {
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

  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);

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
        { key: "code", header: "Code", render: (r) => <strong>{r.code}</strong> },
        {
          key: "name",
          header: "Warehouse",
          render: (r) => (
            <>
              {r.name}
              <div className="tlb-muted-line">{r.location}</div>
            </>
          ),
        },
        { key: "skus", header: "SKUs", render: (r) => r.skuCount },
        { key: "units", header: "Units", render: (r) => r.units },
      ]}
      getSearchValues={(r) => [r.code, r.name, r.location]}
      selectedId={selectedId}
      onSelect={onSelect}
      statusOf={(r) => ({ label: r.active ? "Open" : "Closed", tone: r.active ? "success" : "warning" })}
      detailTitle={(r) => r.name}
      detailSubtitle={(r) => r.location}
      detailSummary={(r) => [
        { label: "SKUs", value: r.skuCount },
        { label: "Units", value: r.units },
        { label: "Code", value: r.code },
        { label: "Status", value: r.active ? "Open" : "Closed" },
      ]}
      detailFields={(r) => [
        { label: "Code", value: r.code },
        { label: "Location", value: r.location },
        { label: "Active", value: r.active ? "Yes" : "No" },
        { label: "Stock summary", value: r.valueHint },
      ]}
      historyGroups={(r) => {
        const bals = state.stock.filter((s) => s.warehouseId === r.id);
        return [
          {
            title: "Stock on hand",
            empty: "No stock in this warehouse.",
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
