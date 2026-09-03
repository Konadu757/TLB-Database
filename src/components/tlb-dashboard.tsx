import { useEffect, useMemo, useRef, useState } from "react";
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

import logoUrl from "@/assets/tlb-logo.png";
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

const moduleScreens: Record<string, { kicker: string; description: string; rows: { primary: string; secondary: string; status: string; tone: string }[] }> = {
  Customers: {
    kicker: "Business",
    description: "Customer accounts currently trading with TLB Enterprise.",
    rows: [
      { primary: "Korle Vista Medical Centre", secondary: "Accra · Net 30", status: "Active", tone: "success" },
      { primary: "Apex Analytical Labs", secondary: "Tema · Net 15", status: "Active", tone: "success" },
      { primary: "Northstar Pharma Ltd", secondary: "Kumasi · On hold", status: "Review", tone: "warning" },
    ],
  },
  Suppliers: {
    kicker: "Business",
    description: "Approved chemical and packaging suppliers.",
    rows: [
      { primary: "Ningbo Industrial Chem", secondary: "China · Sodium Hydroxide", status: "Preferred", tone: "success" },
      { primary: "Tema Drum Works", secondary: "Ghana · HDPE drums", status: "Active", tone: "info" },
    ],
  },
  Quotations: {
    kicker: "Business",
    description: "Open commercial quotations awaiting conversion.",
    rows: [
      { primary: "QT-260441", secondary: "Achimota Science Academy · Ethanol 96%", status: "Sent", tone: "info" },
      { primary: "QT-260438", secondary: "Korle Vista · Hydrogen Peroxide", status: "Draft", tone: "warning" },
    ],
  },
  "Sales Orders": {
    kicker: "Business",
    description: "Live sales orders from the operational sandbox.",
    rows: orders.map((order) => ({ primary: order.id, secondary: `${order.customer} · ${order.value}`, status: order.status, tone: order.tone })),
  },
  Products: {
    kicker: "Inventory",
    description: "Finished goods and raw chemicals in the product master.",
    rows: [
      { primary: "Hydrochloric Acid", secondary: "SKU CHEM-001 · 32%", status: "In stock", tone: "success" },
      { primary: "Ethanol 96%", secondary: "SKU CHEM-014 · drums", status: "Low", tone: "warning" },
    ],
  },
  Stock: {
    kicker: "Inventory",
    description: "Warehouse on-hand position for the selected period.",
    rows: [
      { primary: "Available", secondary: "72% of warehouse capacity", status: "72%", tone: "success" },
      { primary: "Reserved", secondary: "Allocated to sales orders", status: "14%", tone: "info" },
      { primary: "Under inspection", secondary: "Awaiting QC release", status: "8%", tone: "warning" },
      { primary: "Quarantined", secondary: "Held from dispatch", status: "6%", tone: "warning" },
    ],
  },
  Batches: {
    kicker: "Inventory",
    description: "Traceable production and import batches.",
    rows: [
      { primary: "HCL-26001", secondary: "Main Warehouse · 240 drums", status: "Released", tone: "success" },
      { primary: "ETH-26018", secondary: "Expires in 42 days", status: "Watch", tone: "warning" },
    ],
  },
  Warehouses: {
    kicker: "Inventory",
    description: "Storage locations used by operations.",
    rows: [
      { primary: "Main Warehouse", secondary: "Tema · bonded chemicals", status: "Open", tone: "success" },
      { primary: "Factory Store", secondary: "Production floor · WIP", status: "Open", tone: "info" },
    ],
  },
  "Stock Movements": {
    kicker: "Inventory",
    description: "Recent receipts, issues, and transfers.",
    rows: [
      { primary: "TR-26088", secondary: "Main Warehouse → Factory Store · 40 drums", status: "Posted", tone: "success" },
      { primary: "GR-26061", secondary: "IMP-26017 receipt · NaOH", status: "Draft", tone: "warning" },
    ],
  },
  Procurement: {
    kicker: "Operations",
    description: "Purchase orders awaiting receipt or approval.",
    rows: [
      { primary: "PO-26017", secondary: "Ningbo Industrial Chem · 1 container", status: "In transit", tone: "info" },
      { primary: "PO-26012", secondary: "Tema Drum Works · 200 drums", status: "Open", tone: "warning" },
    ],
  },
  "Import & Export": {
    kicker: "Operations",
    description: "Shipments currently moving through Tema.",
    rows: [
      { primary: "IMP-26017", secondary: "Ningbo → Tema · Sodium Hydroxide", status: "Clearing", tone: "warning" },
      { primary: "EXP-26004", secondary: "Tema → Abidjan · Ethanol", status: "Booked", tone: "info" },
    ],
  },
  Factory: {
    kicker: "Operations",
    description: "Production orders on the factory floor.",
    rows: [
      { primary: "PO-26042", secondary: "Hydrogen Peroxide · Batch HP-26009", status: "Mixing 46%", tone: "info" },
      { primary: "PO-26039", secondary: "HCl dilution · Batch HCL-26022", status: "Queued", tone: "warning" },
    ],
  },
  "Quality Control": {
    kicker: "Operations",
    description: "Batches waiting laboratory release.",
    rows: [
      { primary: "HP-26009", secondary: "Hydrogen Peroxide · assay pending", status: "Hold", tone: "warning" },
      { primary: "HCL-26001", secondary: "Released to sales", status: "Pass", tone: "success" },
    ],
  },
  Deliveries: {
    kicker: "Operations",
    description: "Dispatch queue for ready sales orders.",
    rows: [
      { primary: "SO-260904", secondary: "Korle Vista Medical Centre", status: "Ready", tone: "success" },
      { primary: "SO-260896", secondary: "Achimota Science Academy", status: "Picking", tone: "info" },
    ],
  },
  Finance: {
    kicker: "Control",
    description: "Receivables snapshot from the operational sandbox.",
    rows: [
      { primary: "Current", secondary: "GH₵ 368K within terms", status: "Healthy", tone: "success" },
      { primary: "60+ days", secondary: "GH₵ 61K overdue", status: "Escalate", tone: "warning" },
    ],
  },
  Reports: {
    kicker: "Control",
    description: "Management reports available in this sandbox.",
    rows: [
      { primary: "Monthly sales pack", secondary: "September 2026", status: "Ready", tone: "success" },
      { primary: "Expiry watchlist", secondary: "42-day horizon", status: "Updated", tone: "info" },
    ],
  },
  "Audit Log": {
    kicker: "Control",
    description: "Recent privileged actions in the demo environment.",
    rows: [
      { primary: "Kwame Asare", secondary: "Opened QC release HP-26009", status: "Today", tone: "info" },
      { primary: "System", secondary: "Nightly stock valuation posted", status: "Today", tone: "success" },
    ],
  },
  Settings: {
    kicker: "Control",
    description: "Workspace preferences for this demo environment.",
    rows: [
      { primary: "Company", secondary: "TLB Enterprise · Ghana", status: "Live", tone: "success" },
      { primary: "Environment", secondary: "Operational data sandbox", status: "Demo", tone: "info" },
    ],
  },
};

type Inspector = { title: string; kicker: string; lines: string[] };

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
  const [userOpen, setUserOpen] = useState(false);
  const [activeNav, setActiveNav] = useState("Dashboard");
  const [inspector, setInspector] = useState<Inspector | null>(null);

  const [isNavMobile, setIsNavMobile] = useState(false);
  const sidebarOpenRef = useRef(sidebarOpen);
  const desktopSidebarOpenRef = useRef(sidebarOpen);

  const searchDialogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const searchShortcutLabel = useMemo(() => {
    if (typeof navigator === "undefined") return "Ctrl K";
    const platform = navigator.platform ?? "";
    const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
    return isMac ? "⌘ K" : "Ctrl K";
  }, []);

  const searchPool = useMemo(
    () => [
      "Hydrochloric Acid · SKU CHEM-001",
      "Batch HCL-26001 · Main Warehouse",
      "Sales Order SO-260904",
      "Import Shipment IMP-26017",
    ],
    [],
  );

  const filteredSearchPool = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return searchPool;
    return searchPool.filter((result) => result.toLowerCase().includes(q));
  }, [searchPool, searchQuery]);

  const sidebarIsOpen = isNavMobile ? true : sidebarOpen;

  const openSearch = useMemo(() => {
    return () => {
      setSearchQuery("");
      setSearchOpen(true);
      setMobileOpen(false);
      setNotificationsOpen(false);
      setQuickOpen(false);
      setUserOpen(false);
    };
  }, []);

  const openInspector = (payload: Inspector) => {
    setInspector(payload);
    setSearchOpen(false);
    setNotificationsOpen(false);
    setQuickOpen(false);
    setUserOpen(false);
    setMobileOpen(false);
  };

  useEffect(() => {
    sidebarOpenRef.current = sidebarOpen;
  }, [sidebarOpen]);

  // Keep the sidebar labels visible on the mobile drawer, while preserving the user's
  // desktop collapsed preference for later.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const mql = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsNavMobile(mql.matches);

    sync();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", sync);
      return () => mql.removeEventListener("change", sync);
    }

    // Legacy Safari fallback.
    mql.addListener(sync);
    return () => mql.removeListener(sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isNavMobile) {
      desktopSidebarOpenRef.current = sidebarOpenRef.current;
      setSidebarOpen(true);
      setMobileOpen(false);
      return;
    }

    setMobileOpen(false);
    setSidebarOpen(desktopSidebarOpenRef.current);
  }, [isNavMobile]);

  useEffect(() => {
    const shouldLockScroll = searchOpen || mobileOpen || inspector != null;
    if (!shouldLockScroll) return;
    if (typeof document === "undefined") return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [searchOpen, mobileOpen, inspector]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key?.toLowerCase?.() ?? "";

      // Ctrl/Cmd + K opens global search.
      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault();
        openSearch();
        return;
      }

      // Escape closes any open overlay/popover.
      if (event.key === "Escape") {
        setSearchOpen(false);
        setNotificationsOpen(false);
        setQuickOpen(false);
        setUserOpen(false);
        setMobileOpen(false);
        setInspector(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  useEffect(() => {
    if (!searchOpen) {
      lastFocusedElementRef.current?.focus?.();
      return;
    }
    if (typeof document === "undefined" || typeof window === "undefined") return;

    lastFocusedElementRef.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [searchOpen]);

  const handleSearchDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setSearchOpen(false);
      return;
    }

    if (event.key !== "Tab") return;
    const dialog = searchDialogRef.current;
    if (!dialog) return;

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const notificationsWrapRef = useRef<HTMLDivElement | null>(null);
  const quickWrapRef = useRef<HTMLDivElement | null>(null);
  const userWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!notificationsOpen && !quickOpen && !userOpen) return;
    if (typeof document === "undefined") return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (notificationsOpen && notificationsWrapRef.current?.contains(target)) return;
      if (quickOpen && quickWrapRef.current?.contains(target)) return;
      if (userOpen && userWrapRef.current?.contains(target)) return;

      setNotificationsOpen(false);
      setQuickOpen(false);
      setUserOpen(false);
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [notificationsOpen, quickOpen, userOpen]);

  const maxSale = useMemo(() => Math.max(...sales), []);

  const sidebar = (
    <aside className={cn("tlb-sidebar", !sidebarIsOpen && "tlb-sidebar-collapsed")} aria-label="Primary navigation">
      <div className="tlb-brand">
        <img src={logoUrl} alt="TLB Enterprise" className="tlb-brand-logo" />
        <div className="tlb-brand-copy">
          <strong>TLB Enterprise</strong>
          <span>Operations Management</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="tlb-collapse"
          onClick={() => {
            if (isNavMobile) return;
            setSidebarOpen((value) => !value);
          }}
          aria-label={sidebarIsOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {sidebarIsOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
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
                    setInspector(null);
                    setNotificationsOpen(false);
                    setQuickOpen(false);
                    setUserOpen(false);
                  }}
                  title={!sidebarIsOpen ? item.label : undefined}
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
          <Button
            variant="ghost"
            size="icon"
            className="tlb-mobile-menu"
            onClick={() => {
              setMobileOpen(true);
              setNotificationsOpen(false);
              setQuickOpen(false);
              setSearchOpen(false);
            }}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <button
            type="button"
            className="tlb-global-search"
            onClick={openSearch}
            aria-haspopup="dialog"
            aria-expanded={searchOpen}
            aria-controls="tlb-search-dialog"
          >
            <Search aria-hidden="true" /><span>Search products, batches, orders, invoices…</span><kbd>{searchShortcutLabel}</kbd>
          </button>
          <div className="tlb-header-actions">
            <div className="tlb-popover-wrap" ref={notificationsWrapRef}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setNotificationsOpen((value) => {
                    const next = !value;
                    if (next) {
                      setQuickOpen(false);
                      setSearchOpen(false);
                      setUserOpen(false);
                    }
                    return next;
                  });
                }}
                aria-label="Open notifications"
                aria-expanded={notificationsOpen}
                className="relative"
              >
                <Bell /><span className="tlb-notification-dot" />
              </Button>
              {notificationsOpen && (
                <div className="tlb-popover tlb-notification-panel" role="region" aria-label="Notifications">
                  <div className="tlb-popover-heading"><strong>Notifications</strong><button type="button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}><X /></button></div>
                  {alerts.slice(0, 2).map((alert) => (
                    <button
                      type="button"
                      className="tlb-mini-alert"
                      key={alert.title}
                      onClick={() => openInspector({ title: alert.title, kicker: "Alert", lines: [alert.detail, "This alert is shown from the operational sandbox. No backend write is performed."] })}
                    >
                      <span className={`tlb-alert-dot tlb-alert-${alert.type}`} />
                      <div><strong>{alert.title}</strong><span>{alert.detail}</span></div>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="tlb-text-action"
                    onClick={() => {
                      setNotificationsOpen(false);
                      setActiveNav("Quality Control");
                    }}
                  >
                    View notification center <ChevronRight />
                  </button>
                </div>
              )}
            </div>
            <div className="tlb-popover-wrap" ref={userWrapRef}>
              <button
                type="button"
                className="tlb-user"
                aria-expanded={userOpen}
                aria-haspopup="menu"
                onClick={() => {
                  setUserOpen((value) => {
                    const next = !value;
                    if (next) {
                      setNotificationsOpen(false);
                      setQuickOpen(false);
                      setSearchOpen(false);
                    }
                    return next;
                  });
                }}
              >
                <div className="tlb-avatar">KA</div>
                <div className="tlb-user-copy"><strong>Kwame Asare</strong><span>Operations Manager</span></div>
                <ChevronDown />
              </button>
              {userOpen && (
                <div className="tlb-popover tlb-quick-menu tlb-user-menu" role="menu" aria-label="Account">
                  <button type="button" role="menuitem" onClick={() => openInspector({ title: "Kwame Asare", kicker: "Signed in", lines: ["Role: Operations Manager", "Workspace: TLB Enterprise demo environment", "Authentication is UI-only until backend sign-in is connected."] })}>Profile <ChevronRight /></button>
                  <button type="button" role="menuitem" onClick={() => { setUserOpen(false); setActiveNav("Settings"); }}>Settings <ChevronRight /></button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="tlb-content">
          <div className="tlb-breadcrumb"><span>TLB Enterprise</span><ChevronRight /><span>{activeNav === "Dashboard" ? "Executive Dashboard" : activeNav}</span></div>
          <div className="tlb-page-heading">
            <div>
              <p className="tlb-eyebrow">Wednesday, 02 September 2026 · {period} · {warehouse}</p>
              <h1>{activeNav === "Dashboard" ? "Good evening, Kwame" : activeNav}</h1>
              <p>
                {activeNav === "Dashboard"
                  ? "Here is today’s operational position across TLB Enterprise."
                  : (moduleScreens[activeNav]?.description ?? "Operational sandbox records for this module.")}
              </p>
            </div>
            <div className="tlb-heading-actions">
              <div className="tlb-popover-wrap" ref={quickWrapRef}>
                <Button
                  onClick={() => {
                    setQuickOpen((value) => {
                      const next = !value;
                      if (next) {
                        setNotificationsOpen(false);
                        setSearchOpen(false);
                        setUserOpen(false);
                      }
                      return next;
                    });
                  }}
                  aria-expanded={quickOpen}
                  aria-controls="tlb-quick-menu"
                >
                  <Plus /> Quick action <ChevronDown />
                </Button>
                {quickOpen && (
                  <div
                    id="tlb-quick-menu"
                    className="tlb-popover tlb-quick-menu"
                    role="menu"
                    aria-label="Quick actions"
                  >
                    {["Create sales order", "Receive goods", "Start stock transfer", "Create production order"].map(
                      (action) => (
                        <button
                          type="button"
                          role="menuitem"
                          key={action}
                          onClick={() => openInspector({
                            title: action,
                            kicker: "Quick action",
                            lines: [
                              `${action} is available in the operations sandbox.`,
                              `Period: ${period}`,
                              `Warehouse: ${warehouse}`,
                              "No backend posting is connected yet; this confirms the control works.",
                            ],
                          })}
                        >
                          {action}<ChevronRight />
                        </button>
                      ),
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <section className="tlb-filter-bar" aria-label="Dashboard filters">
            <div className="tlb-periods">
              {["Today", "This Week", "This Month", "This Quarter", "This Year"].map((item) => <button type="button" key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>)}
            </div>
            <label className="tlb-select"><Warehouse /><select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} aria-label="Warehouse"><option>All warehouses</option><option>Main Warehouse</option><option>Factory Store</option></select><ChevronDown /></label>
          </section>

          {activeNav !== "Dashboard" && moduleScreens[activeNav] ? (
            <article className="tlb-panel tlb-orders-panel">
              <div className="tlb-panel-heading">
                <div>
                  <span>{moduleScreens[activeNav].kicker}</span>
                  <strong>{activeNav}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => openInspector({
                    title: activeNav,
                    kicker: moduleScreens[activeNav].kicker,
                    lines: [moduleScreens[activeNav].description, `Showing sandbox records for ${period} · ${warehouse}.`],
                  })}
                >
                  Open record <ChevronRight />
                </button>
              </div>
              <div className="tlb-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Record</th>
                      <th>Detail</th>
                      <th>Status</th>
                      <th><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {moduleScreens[activeNav].rows.map((row) => (
                      <tr key={row.primary}>
                        <td><strong>{row.primary}</strong></td>
                        <td>{row.secondary}</td>
                        <td><StatusBadge tone={row.tone}>{row.status}</StatusBadge></td>
                        <td>
                          <button
                            type="button"
                            aria-label={`Open ${row.primary}`}
                            onClick={() => openInspector({ title: row.primary, kicker: activeNav, lines: [row.secondary, `Status: ${row.status}`, "Sandbox record. Backend persistence is not connected."] })}
                          >
                            <ChevronRight />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ) : (
            <>
          <section className="tlb-metrics" aria-label="Key performance indicators">
            {metrics.map((metric) => (
              <article className="tlb-metric" key={metric.label}>
                <div className="tlb-metric-label">
                  <span>{metric.label}</span>
                  <button
                    type="button"
                    aria-label={`Open ${metric.label}`}
                    onClick={() => openInspector({ title: metric.label, kicker: "KPI", lines: [`Value: ${metric.value}`, metric.note, `Filter: ${period} · ${warehouse}`] })}
                  >
                    <ChevronRight />
                  </button>
                </div>
                <strong>{metric.value}</strong>
                <p className={metric.trend === "up" ? "metric-positive" : metric.trend === "down" ? "metric-negative" : ""}>
                  {metric.trend === "up" && <ArrowUpRight />}
                  {metric.trend === "down" && <ArrowDownRight />}
                  {metric.note}
                </p>
              </article>
            ))}
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
              <div className="tlb-panel-heading"><div><span>Inventory overview</span><strong>2,486 stock items</strong></div><button type="button" onClick={() => setActiveNav("Stock")}>View stock <ChevronRight /></button></div>
              <div className="tlb-inventory-value"><div><span>Total stock value</span><strong>GH₵ 4,263,840</strong></div><PackageCheck /></div>
              <div className="tlb-stock-list">{stock.map((item) => <div key={item.label}><div><span>{item.label}</span><strong>{item.value}</strong></div><div className="tlb-progress"><span className={item.tone} style={{ width: item.width }} /></div></div>)}</div>
              <div className="tlb-stock-summary"><div><span>Low stock</span><strong className="text-danger">14</strong></div><div><span>Expiring soon</span><strong className="text-warning-foreground">23</strong></div><div><span>Out of stock</span><strong>4</strong></div></div>
            </article>

            <article className="tlb-panel tlb-orders-panel">
              <div className="tlb-panel-heading"><div><span>Recent orders</span><strong>Today’s commercial activity</strong></div><button type="button" onClick={() => setActiveNav("Sales Orders")}>View all <ChevronRight /></button></div>
              <div className="tlb-table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Value</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong>{order.id}</strong></td><td>{order.customer}</td><td>{order.value}</td><td><StatusBadge tone={order.tone}>{order.status}</StatusBadge></td><td><button type="button" aria-label={`Open ${order.id}`} onClick={() => openInspector({ title: order.id, kicker: "Sales order", lines: [`Customer: ${order.customer}`, `Value: ${order.value}`, `Status: ${order.status}`, "Sandbox order. Fulfilment is not posted to a backend."] })}><ChevronRight /></button></td></tr>)}</tbody></table></div>
            </article>

            <article className="tlb-panel tlb-alerts-panel">
              <div className="tlb-panel-heading"><div><span>Alerts requiring attention</span><strong>7 operational alerts</strong></div><button type="button" onClick={() => setActiveNav("Quality Control")}>View all <ChevronRight /></button></div>
              <div className="tlb-alert-list">{alerts.map((alert) => <button type="button" className="tlb-alert-row" key={alert.title} onClick={() => openInspector({ title: alert.title, kicker: "Operational alert", lines: [alert.detail, "Sandbox alert. Acknowledgement is not persisted."] })}><span className={`tlb-alert-icon tlb-alert-${alert.type}`}><AlertTriangle /></span><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><ChevronRight /></button>)}</div>
            </article>

            <article className="tlb-panel tlb-operations-panel">
              <div className="tlb-panel-heading"><div><span>Operational pulse</span><strong>Imports & production</strong></div><button type="button" onClick={() => setActiveNav("Import & Export")}>Open operations <ChevronRight /></button></div>
              <div className="tlb-operation-row"><span className="tlb-operation-icon"><Ship /></span><div><strong>IMP-26017 · Ningbo → Tema</strong><span>Sodium Hydroxide · 1 container</span></div><div className="tlb-operation-progress"><span><i style={{ width: "68%" }} /></span><small>At port · clearing</small></div></div>
              <div className="tlb-operation-row"><span className="tlb-operation-icon"><Factory /></span><div><strong>PO-26042 · Hydrogen Peroxide</strong><span>Batch HP-26009 · 1,200 L target</span></div><div className="tlb-operation-progress"><span><i style={{ width: "46%" }} /></span><small>Mixing · 46%</small></div></div>
            </article>

            <article className="tlb-panel tlb-receivables-panel">
              <div className="tlb-panel-heading"><div><span>Receivables</span><strong>GH₵ 682,420.00 outstanding</strong></div><button type="button" onClick={() => setActiveNav("Finance")}>View ledger <ChevronRight /></button></div>
              <div className="tlb-receivable-bars"><div style={{ width: "54%" }} className="current" /><div style={{ width: "20%" }} className="due" /><div style={{ width: "17%" }} className="overdue" /><div style={{ width: "9%" }} className="critical" /></div>
              <div className="tlb-receivable-legend"><span><i className="current" />Current <strong>GH₵ 368K</strong></span><span><i className="due" />1–30 days <strong>GH₵ 137K</strong></span><span><i className="overdue" />31–60 days <strong>GH₵ 116K</strong></span><span><i className="critical" />60+ days <strong>GH₵ 61K</strong></span></div>
            </article>
          </section>
            </>
          )}
        </main>
      </div>

      {searchOpen && (
        <div
          className="tlb-dialog-backdrop"
          role="presentation"
          onMouseDown={() => setSearchOpen(false)}
        >
          <div
            ref={searchDialogRef}
            id="tlb-search-dialog"
            className="tlb-search-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={handleSearchDialogKeyDown}
          >
            <div className="tlb-search-input">
              <Search aria-hidden="true" />
              <input
                ref={searchInputRef}
                autoFocus
                placeholder="Search TLB Enterprise…"
                aria-label="Search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && filteredSearchPool.length > 0) {
                    event.preventDefault();
                    const first = filteredSearchPool[0];
                    if (first) {
                      openInspector({ title: first, kicker: "Search", lines: ["Opened from global search.", "This is sandbox data until search is connected to the database."] });
                    }
                  }
                }}
              />
              <kbd>ESC</kbd>
            </div>
            <div className="tlb-search-results" role="list">
              <p>{filteredSearchPool.length ? "QUICK ACCESS" : "NO MATCHES"}</p>
              {filteredSearchPool.map((result) => (
                <button
                  type="button"
                  role="listitem"
                  key={result}
                  onClick={() => openInspector({ title: result, kicker: "Search", lines: ["Opened from global search.", "This is sandbox data until search is connected to the database."] })}
                >
                  <PackageSearch />
                  <span>{result}</span>
                  <ChevronRight />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {inspector && (
        <div
          className="tlb-dialog-backdrop"
          role="presentation"
          onMouseDown={() => setInspector(null)}
        >
          <div
            className="tlb-search-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tlb-inspector-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tlb-popover-heading">
              <div>
                <span className="tlb-eyebrow">{inspector.kicker}</span>
                <strong id="tlb-inspector-title">{inspector.title}</strong>
              </div>
              <button type="button" aria-label="Close" onClick={() => setInspector(null)}>
                <X />
              </button>
            </div>
            <div className="tlb-inspector-body">
              <ul className="tlb-inspector-list">
                {inspector.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}