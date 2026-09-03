import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Boxes,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Factory,
  FileText,
  FlaskConical,
  Gauge,
  HandCoins,
  LayoutDashboard,
  Menu,
  PackageCheck,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Ship,
  ShoppingCart,
  Truck,
  Users,
  Warehouse,
  X,
} from "lucide-react";

import logoAsset from "@/assets/tlb-logo.png.asset.json";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = { label: string; icon: typeof LayoutDashboard; badge?: string };
type NavGroup = { label?: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  { items: [{ label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Business",
    items: [
      { label: "Customers", icon: Users },
      { label: "Suppliers", icon: Building2 },
      { label: "Quotations", icon: FileText },
      { label: "Sales Orders", icon: ShoppingCart, badge: "12" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Products", icon: FlaskConical },
      { label: "Stock", icon: Boxes },
      { label: "Batches", icon: PackageSearch },
      { label: "Warehouses", icon: Warehouse },
      { label: "Stock Movements", icon: ArrowUpRight },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Procurement", icon: ClipboardCheck, badge: "5" },
      { label: "Import & Export", icon: Ship, badge: "3" },
      { label: "Factory", icon: Factory },
      { label: "Quality Control", icon: ShieldCheck, badge: "8" },
      { label: "Deliveries", icon: Truck },
    ],
  },
  {
    label: "Control",
    items: [
      { label: "Finance", icon: CircleDollarSign },
      { label: "Reports", icon: Gauge },
      { label: "Audit Log", icon: ShieldCheck },
      { label: "Settings", icon: Settings },
    ],
  },
];

const metrics = [
  { label: "Monthly sales", value: "GH₵ 1.84M", note: "+12.4% vs Aug", trend: "up" },
  { label: "Inventory value", value: "GH₵ 4.26M", note: "Across 2 warehouses", trend: "neutral" },
  { label: "Receivables", value: "GH₵ 682.4K", note: "GH₵ 118.2K overdue", trend: "down" },
  { label: "Active orders", value: "38", note: "12 awaiting dispatch", trend: "up" },
  { label: "Active imports", value: "7", note: "3 arriving this month", trend: "neutral" },
  { label: "Production in progress", value: "6", note: "4 batches on schedule", trend: "neutral" },
];

const sales = [42, 58, 51, 67, 63, 82, 76, 94, 88, 108, 101, 122];
const stock = [
  { label: "Available", value: "72%", width: "72%", tone: "bg-primary" },
  { label: "Reserved", value: "14%", width: "14%", tone: "bg-info" },
  { label: "Under inspection", value: "8%", width: "8%", tone: "bg-warning" },
  { label: "Quarantined", value: "6%", width: "6%", tone: "bg-danger" },
];
const orders = [
  { id: "SO-260904", customer: "Korle Vista Medical Centre", value: "GH₵ 48,650.00", status: "Ready", tone: "success" },
  { id: "SO-260903", customer: "Apex Analytical Labs", value: "GH₵ 32,480.00", status: "Processing", tone: "info" },
  { id: "SO-260899", customer: "Northstar Pharma Ltd", value: "GH₵ 76,120.00", status: "Pending approval", tone: "warning" },
  { id: "SO-260896", customer: "Achimota Science Academy", value: "GH₵ 18,940.00", status: "Picking", tone: "info" },
];
const alerts = [
  { title: "Sodium Hydroxide below reorder level", detail: "Main Warehouse · 180 kg remaining", type: "danger" },
  { title: "Batch ETH-26018 expires in 42 days", detail: "Ethanol 96% · 24 drums", type: "warning" },
  { title: "QC release required", detail: "Production batch HP-26009", type: "info" },
];

function StatusBadge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

export function TLBDashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [period, setPeriod] = useState("This Month");
  const [warehouse, setWarehouse] = useState("All warehouses");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [activeNav, setActiveNav] = useState("Dashboard");

  const maxSale = useMemo(() => Math.max(...sales), []);

  const sidebar = (
    <aside className={cn("tlb-sidebar", !sidebarOpen && "tlb-sidebar-collapsed")} aria-label="Primary navigation">
      <div className="tlb-brand">
        <img src={logoAsset.url} alt="TLB Enterprise" className="tlb-brand-logo" />
        <div className="tlb-brand-copy">
          <strong>TLB Enterprise</strong>
          <span>Operations Management</span>
        </div>
        <Button variant="ghost" size="icon" className="tlb-collapse" onClick={() => setSidebarOpen((value) => !value)} aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}>
          {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
      </div>
      <nav className="tlb-nav">
        {navGroups.map((group, groupIndex) => (
          <div className="tlb-nav-group" key={group.label ?? groupIndex}>
            {group.label && <p className="tlb-nav-label">{group.label}</p>}
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = item.label === activeNav;
              return (
                <button
                  type="button"
                  key={item.label}
                  className={cn("tlb-nav-item", active && "tlb-nav-active")}
                  onClick={() => {
                    setActiveNav(item.label);
                    setMobileOpen(false);
                  }}
                  title={!sidebarOpen ? item.label : undefined}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.badge && <span className="tlb-nav-badge">{item.badge}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="tlb-sidebar-footer">
        <span className="tlb-environment-dot" />
        <div><strong>Demo environment</strong><span>Operational data sandbox</span></div>
      </div>
    </aside>
  );

  return (
    <div className="tlb-app-shell">
      <div className="tlb-desktop-sidebar">{sidebar}</div>
      {mobileOpen && <div className="tlb-mobile-overlay" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
      <div className={cn("tlb-mobile-sidebar", mobileOpen && "tlb-mobile-sidebar-open")}>{sidebar}</div>

      <div className="tlb-main">
        <header className="tlb-header">
          <Button variant="ghost" size="icon" className="tlb-mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></Button>
          <button type="button" className="tlb-global-search" onClick={() => setSearchOpen(true)}>
            <Search aria-hidden="true" /><span>Search products, batches, orders, invoices…</span><kbd>⌘ K</kbd>
          </button>
          <div className="tlb-header-actions">
            <div className="tlb-popover-wrap">
              <Button variant="ghost" size="icon" onClick={() => setNotificationsOpen((value) => !value)} aria-label="Open notifications" className="relative">
                <Bell /><span className="tlb-notification-dot" />
              </Button>
              {notificationsOpen && (
                <div className="tlb-popover tlb-notification-panel">
                  <div className="tlb-popover-heading"><strong>Notifications</strong><button type="button" onClick={() => setNotificationsOpen(false)}><X /></button></div>
                  {alerts.slice(0, 2).map((alert) => <div className="tlb-mini-alert" key={alert.title}><span className={`tlb-alert-dot tlb-alert-${alert.type}`} /><div><strong>{alert.title}</strong><span>{alert.detail}</span></div></div>)}
                  <button type="button" className="tlb-text-action">View notification center <ChevronRight /></button>
                </div>
              )}
            </div>
            <div className="tlb-user">
              <div className="tlb-avatar">KA</div><div className="tlb-user-copy"><strong>Kwame Asare</strong><span>Operations Manager</span></div><ChevronDown />
            </div>
          </div>
        </header>

        <main className="tlb-content">
          <div className="tlb-breadcrumb"><span>TLB Enterprise</span><ChevronRight /><span>Executive Dashboard</span></div>
          <div className="tlb-page-heading">
            <div><p className="tlb-eyebrow">Wednesday, 02 September 2026</p><h1>Good evening, Kwame</h1><p>Here is today’s operational position across TLB Enterprise.</p></div>
            <div className="tlb-heading-actions">
              <div className="tlb-popover-wrap">
                <Button onClick={() => setQuickOpen((value) => !value)}><Plus /> Quick action <ChevronDown /></Button>
                {quickOpen && <div className="tlb-popover tlb-quick-menu">{["Create sales order", "Receive goods", "Start stock transfer", "Create production order"].map((action) => <button type="button" key={action} onClick={() => setQuickOpen(false)}>{action}<ChevronRight /></button>)}</div>}
              </div>
            </div>
          </div>

          <section className="tlb-filter-bar" aria-label="Dashboard filters">
            <div className="tlb-periods">
              {["Today", "This Week", "This Month", "This Quarter", "This Year"].map((item) => <button type="button" key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}
            </div>
            <label className="tlb-select"><Warehouse /><select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} aria-label="Warehouse"><option>All warehouses</option><option>Main Warehouse</option><option>Factory Store</option></select><ChevronDown /></label>
          </section>

          <section className="tlb-metrics" aria-label="Key performance indicators">
            {metrics.map((metric) => <article className="tlb-metric" key={metric.label}><div className="tlb-metric-label"><span>{metric.label}</span><button type="button" aria-label={`Open ${metric.label}`}><ChevronRight /></button></div><strong>{metric.value}</strong><p className={metric.trend === "up" ? "metric-positive" : metric.trend === "down" ? "metric-negative" : ""}>{metric.trend === "up" && <ArrowUpRight />}{metric.trend === "down" && <ArrowDownRight />}{metric.note}</p></article>)}
          </section>

          <section className="tlb-dashboard-grid">
            <article className="tlb-panel tlb-sales-panel">
              <div className="tlb-panel-heading"><div><span>Sales performance</span><strong>GH₵ 1,842,680.00</strong></div><StatusBadge tone="success">+12.4%</StatusBadge></div>
              <div className="tlb-chart" aria-label="Monthly sales trend from October to September">
                <div className="tlb-chart-axis"><span>120K</span><span>80K</span><span>40K</span><span>0</span></div>
                <div className="tlb-bars">{sales.map((value, index) => <div className="tlb-bar-column" key={index}><div className={cn("tlb-bar", index === sales.length - 1 && "tlb-bar-current")} style={{ height: `${(value / maxSale) * 100}%` }} /><span>{["Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep"][index]}</span></div>)}</div>
              </div>
              <div className="tlb-chart-footer"><span><i className="tlb-legend-primary" />Sales revenue</span><span>Target: GH₵ 1.75M</span></div>
            </article>

            <article className="tlb-panel">
              <div className="tlb-panel-heading"><div><span>Inventory overview</span><strong>2,486 stock items</strong></div><button type="button">View stock <ChevronRight /></button></div>
              <div className="tlb-inventory-value"><div><span>Total stock value</span><strong>GH₵ 4,263,840</strong></div><PackageCheck /></div>
              <div className="tlb-stock-list">{stock.map((item) => <div key={item.label}><div><span>{item.label}</span><strong>{item.value}</strong></div><div className="tlb-progress"><span className={item.tone} style={{ width: item.width }} /></div></div>)}</div>
              <div className="tlb-stock-summary"><div><span>Low stock</span><strong className="text-danger">14</strong></div><div><span>Expiring soon</span><strong className="text-warning-foreground">23</strong></div><div><span>Out of stock</span><strong>4</strong></div></div>
            </article>

            <article className="tlb-panel tlb-orders-panel">
              <div className="tlb-panel-heading"><div><span>Recent orders</span><strong>Today’s commercial activity</strong></div><button type="button">View all <ChevronRight /></button></div>
              <div className="tlb-table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Value</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.id}</strong></td><td>{order.customer}</td><td>{order.value}</td><td><StatusBadge tone={order.tone}>{order.status}</StatusBadge></td><td><button type="button" aria-label={`Open ${order.id}`}><ChevronRight /></button></td></tr>)}</tbody></table></div>
            </article>

            <article className="tlb-panel tlb-alerts-panel">
              <div className="tlb-panel-heading"><div><span>Alerts requiring attention</span><strong>7 operational alerts</strong></div><button type="button">View all <ChevronRight /></button></div>
              <div className="tlb-alert-list">{alerts.map((alert) => <button type="button" className="tlb-alert-row" key={alert.title}><span className={`tlb-alert-icon tlb-alert-${alert.type}`}><AlertTriangle /></span><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><ChevronRight /></button>)}</div>
            </article>

            <article className="tlb-panel tlb-operations-panel">
              <div className="tlb-panel-heading"><div><span>Operational pulse</span><strong>Imports & production</strong></div><button type="button">Open operations <ChevronRight /></button></div>
              <div className="tlb-operation-row"><span className="tlb-operation-icon"><Ship /></span><div><strong>IMP-26017 · Ningbo → Tema</strong><span>Sodium Hydroxide · 1 container</span></div><div className="tlb-operation-progress"><span><i style={{ width: "68%" }} /></span><small>At port · clearing</small></div></div>
              <div className="tlb-operation-row"><span className="tlb-operation-icon"><Factory /></span><div><strong>PO-26042 · Hydrogen Peroxide</strong><span>Batch HP-26009 · 1,200 L target</span></div><div className="tlb-operation-progress"><span><i style={{ width: "46%" }} /></span><small>Mixing · 46%</small></div></div>
            </article>

            <article className="tlb-panel tlb-receivables-panel">
              <div className="tlb-panel-heading"><div><span>Receivables</span><strong>GH₵ 682,420.00 outstanding</strong></div><button type="button">View ledger <ChevronRight /></button></div>
              <div className="tlb-receivable-bars"><div style={{ width: "54%" }} className="current" /><div style={{ width: "20%" }} className="due" /><div style={{ width: "17%" }} className="overdue" /><div style={{ width: "9%" }} className="critical" /></div>
              <div className="tlb-receivable-legend"><span><i className="current" />Current <strong>GH₵ 368K</strong></span><span><i className="due" />1–30 days <strong>GH₵ 137K</strong></span><span><i className="overdue" />31–60 days <strong>GH₵ 116K</strong></span><span><i className="critical" />60+ days <strong>GH₵ 61K</strong></span></div>
            </article>
          </section>
        </main>
      </div>

      {searchOpen && <div className="tlb-dialog-backdrop" role="presentation" onMouseDown={() => setSearchOpen(false)}><div className="tlb-search-dialog" role="dialog" aria-modal="true" aria-label="Global search" onMouseDown={(event) => event.stopPropagation()}><div className="tlb-search-input"><Search /><input autoFocus placeholder="Search TLB Enterprise…" /><kbd>ESC</kbd></div><div className="tlb-search-results"><p>QUICK ACCESS</p>{["Hydrochloric Acid · SKU CHEM-001", "Batch HCL-26001 · Main Warehouse", "Sales Order SO-260904", "Import Shipment IMP-26017"].map((result) => <button type="button" key={result} onClick={() => setSearchOpen(false)}><PackageSearch /><span>{result}</span><ChevronRight /></button>)}</div></div></div>}
    </div>
  );
}