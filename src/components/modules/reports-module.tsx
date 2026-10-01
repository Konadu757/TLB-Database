import { useMemo, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  deepReportRows,
  fulfilmentPerformanceReport,
  toCsv,
  type DeepReportTab,
} from "@/lib/domain/reports";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="tlb-empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
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

export function ReportsModule({
  store,
  range,
}: {
  store: TlbStoreApi;
  range?: { from: string; to: string } | null;
  periodLabel?: string;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tab, setTab] = useState<DeepReportTab>("outstanding");
  const filter = useMemo(() => {
    if (from || to) {
      const f: { from?: string; to?: string } = {};
      if (from) f.from = from;
      if (to) f.to = to;
      return f;
    }
    if (range) return { from: range.from, to: range.to };
    return {};
  }, [from, to, range]);

  if (!store.can("reports.view")) {
    return (
      <div className="tlb-module">
        <EmptyState
          title="Reports restricted"
          detail={`Role ${store.state.currentRole} cannot view reports.`}
        />
      </div>
    );
  }

  const rows = deepReportRows(store.state, tab, filter);
  const performance = fulfilmentPerformanceReport(store.state, filter);
  const tabs: Array<[DeepReportTab, string]> = [
    ["outstanding", "Outstanding"],
    ["partial", "Partial supply"],
    ["performance", "Fulfilment"],
    ["customer", "Customer outstanding"],
    ["inventory", "Inventory valuation"],
    ["grn_issue", "GRN / Issue"],
    ["movements", "Movements"],
    ["ageing", "Stock ageing"],
    ["alerts", "Low / expiry / damaged"],
    ["pos", "Purchase orders"],
    ["non_po", "Non-PO"],
    ["orders", "Customer orders"],
    ["transfers", "Transfers"],
    ["arap", "AR / AP"],
    ["credit", "Credit utilisation"],
    ["returns", "Returns"],
    ["shipments", "Imports / exports"],
    ["profit_product", "Product profitability"],
    ["profit_customer", "Customer profitability"],
    ["velocity", "Fast / slow / dead"],
    ["supplier_perf", "Supplier performance"],
    ["customer_perf", "Customer performance"],
    ["audit", "Audit activity"],
  ];

  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Control</span>
          <strong>Deep reports</strong>
          <p className="tlb-muted-line">
            Filters + CSV export across inventory, commerce, finance, and ops
          </p>
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
          <Button
            type="button"
            variant="outline"
            onClick={() => downloadCsv(`${tab}-report.csv`, toCsv(rows))}
            disabled={rows.length === 0}
          >
            <Download /> Export CSV
          </Button>
        </div>
      </div>
      {tab === "performance" ? (
        <div
          className="tlb-kpi-strip"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <article className="tlb-panel" style={{ padding: 12 }}>
            <span className="tlb-eyebrow">Fully supplied</span>
            <strong>{performance.summary.fullySupplied}</strong>
          </article>
          <article className="tlb-panel" style={{ padding: 12 }}>
            <span className="tlb-eyebrow">Partial</span>
            <strong>{performance.summary.partiallySupplied}</strong>
          </article>
          <article className="tlb-panel" style={{ padding: 12 }}>
            <span className="tlb-eyebrow">Avg fulfilment days</span>
            <strong>{performance.summary.avgFulfilmentDays}</strong>
          </article>
        </div>
      ) : null}
      <section className="tlb-filter-bar tlb-module-filters">
        <div className="tlb-periods" style={{ flexWrap: "wrap" }}>
          {tabs.map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      <article className="tlb-panel tlb-orders-panel">
        {rows.length === 0 ? (
          <EmptyState
            title="No matching records were found."
            detail="Adjust filters or pick another report pack."
          />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  {Object.keys(rows[0]!).map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${tab}-${idx}`}>
                    {Object.keys(rows[0]!).map((k) => (
                      <td key={k}>{String(r[k] ?? "")}</td>
                    ))}
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
