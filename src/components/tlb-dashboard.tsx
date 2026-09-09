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
  Trash2,
  Truck,
  Users,
  Warehouse,
  X,
} from "lucide-react";

import logoUrl from "@/assets/tlb-logo.png";
import {
  CustomersModule,
  LiveSearchResults,
  OutstandingDashboardWidget,
  OutstandingSuppliesModule,
  SalesOrdersModule,
  StockModule,
  SuppliersModule,
} from "@/components/modules/commerce-modules";
import {
  BatchesModule,
  FactoryModule,
  ImportExportModule,
  ProductsModule,
  ProcurementModule,
  QualityControlModule,
  QuotationsModule,
  StockMovementsModule,
  WarehousesModule,
} from "@/components/modules/list-modules";
import {
  AuditModule,
  DeliveriesModule,
  FinanceModule,
  ReportsModule,
  SettingsModule,
} from "@/components/modules/p1-modules";
import { TrashModule } from "@/components/modules/trash-module";
import { Button } from "@/components/ui/button";
import { buildDashboardSnapshot } from "@/lib/domain/dashboard-metrics";
import {
  DASHBOARD_PERIODS,
  DEMO_AS_OF,
  resolveSelectionRange,
  selectionLabel,
  type DashboardPeriod,
  type DashboardRangeSelection,
} from "@/lib/domain/period-range";
import { formatMoney } from "@/lib/store/tlb-store";
import { useTlbStore } from "@/lib/store/use-tlb-store";
import { canAccessNav, firstName, userInitials } from "@/lib/domain/permissions";
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
      { label: "Sales Orders", icon: ShoppingCart },
      { label: "Outstanding Supplies", icon: PackageCheck },
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
      { label: "Trash", icon: Trash2 },
      { label: "Settings", icon: Settings },
    ],
  },
];

const PERIOD_SCOPED_NAV = new Set([
  "Dashboard",
  "Suppliers",
  "Quotations",
  "Sales Orders",
  "Outstanding Supplies",
  "Batches",
  "Stock Movements",
  "Procurement",
  "Import & Export",
  "Factory",
  "Quality Control",
  "Finance",
  "Deliveries",
  "Reports",
]);

const MODULE_BLURBS: Record<string, string> = {
  Customers: "Customer accounts with credit, terms, TIN, and transaction history.",
  Suppliers: "Approved suppliers with period-scoped purchase orders, receipts, and spend.",
  Quotations: "Commercial quotations — click a row for full detail; period filters quote dates.",
  "Sales Orders": "Customer purchase orders with partial supply and fulfilment history.",
  "Outstanding Supplies": "Open ordered quantities that still need supply — never silently cleared.",
  Products: "Finished goods and raw chemicals in the product master.",
  Stock: "Physical, reserved, and available stock with outstanding demand links.",
  Batches: "Traceable production and import batches filtered by event date.",
  Warehouses: "Storage locations with live stock balances from the product master.",
  "Stock Movements": "Receipts, issues, and transfers scoped to the selected period.",
  Procurement: "Purchase orders awaiting receipt or approval — filtered by order date.",
  "Import & Export": "Shipments moving through Tema — filtered by shipment date.",
  Factory: "Production orders on the factory floor — filtered by run date.",
  "Quality Control": "Laboratory holds and releases — filtered by QC event date.",
  Deliveries: "Deliveries linked to supplies — order stays open while outstanding remains.",
  Finance: "VAT invoices, ordinary receipts (TLB-RCT), and payments.",
  Reports: "Outstanding, partial supply, fulfilment performance, and customer outstanding.",
  "Audit Log": "Append-only audit trail for supplies, invoices, receipts, deliveries, and payments.",
  Trash: "Soft-deleted records — restore or permanently delete with confirmation.",
  Settings: "Company letterhead, configurable VAT rates, roles, and reminder thresholds.",
};

type Inspector = { title: string; kicker: string; lines: string[] };

function StatusBadge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

export function TLBDashboard() {
  const store = useTlbStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [rangeSelection, setRangeSelection] = useState<DashboardRangeSelection>({
    mode: "preset",
    period: "This Month",
  });
  const [customFrom, setCustomFrom] = useState("2026-08-01");
  const [customTo, setCustomTo] = useState("2026-08-31");
  const [warehouse, setWarehouse] = useState("All warehouses");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [activeNav, setActiveNav] = useState("Dashboard");
  const [inspector, setInspector] = useState<Inspector | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [outstandingProductFilter, setOutstandingProductFilter] = useState<string | null>(null);
  const [moduleFocusId, setModuleFocusId] = useState<string | null>(null);
  const [orderReturnNav, setOrderReturnNav] = useState<string | null>(null);

  const [isNavMobile, setIsNavMobile] = useState(false);
  const sidebarOpenRef = useRef(sidebarOpen);
  const desktopSidebarOpenRef = useRef(sidebarOpen);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const searchShortcutLabel = useMemo(() => {
    if (typeof navigator === "undefined") return "Ctrl K";
    const platform = navigator.platform ?? "";
    const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
    return isMac ? "⌘ K" : "Ctrl K";
  }, []);

  const outstandingBadge = store.outstanding.length;

  const navGroupsLive = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.items
            .filter((item) => canAccessNav(store.state, item.label))
            .map((item) =>
              item.label === "Outstanding Supplies"
                ? { ...item, badge: outstandingBadge > 0 ? String(outstandingBadge) : undefined }
                : item.label === "Sales Orders"
                  ? {
                      ...item,
                      badge: (() => {
                        const count = store.state.orders.filter(
                          (o) =>
                            !o.deletedAt &&
                            o.status !== "Delivered" &&
                            o.status !== "Cancelled",
                        ).length;
                        return count > 0 ? String(count) : undefined;
                      })(),
                    }
                  : item,
            ),
        }))
        .filter((group) => group.items.length > 0),
    [outstandingBadge, store.state],
  );

  useEffect(() => {
    if (!canAccessNav(store.state, activeNav)) {
      setActiveNav("Dashboard");
    }
  }, [store.state.currentRoleId, store.state.currentUserId, activeNav, store.state]);

  const openLiveModule = (
    nav: string,
    orderId?: string | null,
    productId?: string | null,
    customerId?: string | null,
    supplierId?: string | null,
    focusEntityId?: string | null,
  ) => {
    setActiveNav(nav);
    setSelectedOrderId(orderId ?? null);
    setSelectedCustomerId(nav === "Customers" ? customerId ?? null : null);
    setSelectedSupplierId(nav === "Suppliers" ? supplierId ?? null : null);
    setOutstandingProductFilter(nav === "Outstanding Supplies" ? productId ?? null : null);
    setModuleFocusId(
      nav === "Finance" || nav === "Deliveries" || nav === "Products" || nav === "Warehouses"
        ? focusEntityId ?? null
        : null,
    );
    setOrderReturnNav(null);
    setMobileOpen(false);
    setInspector(null);
    setSearchOpen(false);
    setSearchQuery("");
    setNotificationsOpen(false);
    setQuickOpen(false);
    setUserOpen(false);
  };

  const openOrderDetail = (orderId: string, returnNav?: string) => {
    openLiveModule("Sales Orders", orderId);
    setOrderReturnNav(returnNav ?? null);
  };

  const handleSelectOrder = (id: string | null) => {
    if (id == null) {
      const ret = orderReturnNav;
      setOrderReturnNav(null);
      setSelectedOrderId(null);
      if (ret) setActiveNav(ret);
      return;
    }
    setSelectedOrderId(id);
  };

  const liveModuleNav =
    activeNav === "Customers" ||
    activeNav === "Suppliers" ||
    activeNav === "Quotations" ||
    activeNav === "Sales Orders" ||
    activeNav === "Outstanding Supplies" ||
    activeNav === "Products" ||
    activeNav === "Stock" ||
    activeNav === "Batches" ||
    activeNav === "Warehouses" ||
    activeNav === "Stock Movements" ||
    activeNav === "Procurement" ||
    activeNav === "Import & Export" ||
    activeNav === "Factory" ||
    activeNav === "Quality Control" ||
    activeNav === "Deliveries" ||
    activeNav === "Finance" ||
    activeNav === "Reports" ||
    activeNav === "Audit Log" ||
    activeNav === "Trash" ||
    activeNav === "Settings";

  const showPeriodBar = PERIOD_SCOPED_NAV.has(activeNav);
  const listRange = useMemo(
    () => resolveSelectionRange(rangeSelection, DEMO_AS_OF),
    [rangeSelection],
  );
  const listPeriodLabel = selectionLabel(rangeSelection);

  const unreadNotifications = store.state.notifications.filter((n) => !n.readAt).length;
  const unreadBadgeLabel =
    unreadNotifications > 99 ? "99+" : unreadNotifications > 0 ? String(unreadNotifications) : "";

  const sidebarIsOpen = isNavMobile ? true : sidebarOpen;

  const focusHeaderSearch = () => {
    setSearchOpen(true);
    setMobileOpen(false);
    setNotificationsOpen(false);
    setQuickOpen(false);
    setUserOpen(false);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const closeHeaderSearch = (options?: { clear?: boolean; blur?: boolean }) => {
    setSearchOpen(false);
    if (options?.clear !== false) setSearchQuery("");
    if (options?.blur !== false) searchInputRef.current?.blur();
  };

  const openInspector = (payload: Inspector) => {
    setInspector(payload);
    closeHeaderSearch();
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
    const shouldLockScroll = mobileOpen || inspector != null;
    if (!shouldLockScroll) return;
    if (typeof document === "undefined") return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen, inspector]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key?.toLowerCase?.() ?? "";

      // Ctrl/Cmd + K focuses the header search input (no secondary UI).
      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault();
        focusHeaderSearch();
        return;
      }

      // Escape closes any open overlay/popover.
      if (event.key === "Escape") {
        if (searchOpen || document.activeElement === searchInputRef.current) {
          closeHeaderSearch();
        }
        setNotificationsOpen(false);
        setQuickOpen(false);
        setUserOpen(false);
        setMobileOpen(false);
        setInspector(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  const notificationsWrapRef = useRef<HTMLDivElement | null>(null);
  const quickWrapRef = useRef<HTMLDivElement | null>(null);
  const userWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!notificationsOpen && !quickOpen && !userOpen && !searchOpen) return;
    if (typeof document === "undefined") return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (searchOpen && searchWrapRef.current?.contains(target)) return;
      if (notificationsOpen && notificationsWrapRef.current?.contains(target)) return;
      if (quickOpen && quickWrapRef.current?.contains(target)) return;
      if (userOpen && userWrapRef.current?.contains(target)) return;

      if (searchOpen) closeHeaderSearch({ blur: false });
      setNotificationsOpen(false);
      setQuickOpen(false);
      setUserOpen(false);
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [notificationsOpen, quickOpen, userOpen, searchOpen]);

  const dash = useMemo(
    () => buildDashboardSnapshot(store.state, rangeSelection, warehouse, DEMO_AS_OF),
    [store.state, rangeSelection, warehouse],
  );
  const maxSale = Math.max(dash.chartAxisMax, 1);
  const recvTotal = Math.max(dash.receivablesTotal, 1);
  const periodCaption =
    rangeSelection.mode === "preset"
      ? rangeSelection.period
      : rangeSelection.mode === "previousMonth"
        ? "Previous Month"
        : "Custom range";

  const selectPreset = (period: DashboardPeriod) => {
    setRangeSelection({ mode: "preset", period });
  };

  const sidebar = (
    <aside className={cn("tlb-sidebar", !sidebarIsOpen && "tlb-sidebar-collapsed")} aria-label="Primary navigation">
      <div className="tlb-brand">
        <span className="tlb-brand-mark">
          <img src={logoUrl} alt="TLB Enterprise" className="tlb-brand-logo" />
        </span>
        <div className="tlb-brand-copy">
          <strong>TLB Enterprise</strong>
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
        {navGroupsLive.map((group, groupIndex) => (
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
                    // Sidebar always returns to the module list (clears nested detail selection).
                    openLiveModule(item.label);
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
          <div className="tlb-popover-wrap tlb-global-search-wrap" ref={searchWrapRef}>
            <label className={cn("tlb-global-search", searchOpen && "tlb-global-search-active")}>
              <Search aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="search"
                placeholder="Search products, batches, orders, invoices…"
                aria-label="Search products, batches, orders, invoices"
                aria-expanded={searchOpen}
                aria-controls="tlb-search-results"
                aria-haspopup="listbox"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => {
                  setSearchOpen(true);
                  setNotificationsOpen(false);
                  setQuickOpen(false);
                  setUserOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeHeaderSearch();
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const phaseOrder = store.state.orders.find((o) => o.id === "ord-phase30");
                    if (searchQuery.toLowerCase().includes("ord") && phaseOrder) {
                      openLiveModule("Sales Orders", phaseOrder.id);
                      return;
                    }
                    if (searchQuery.toLowerCase().includes("outstanding")) {
                      openLiveModule("Outstanding Supplies");
                      return;
                    }
                    openLiveModule("Sales Orders");
                  }
                }}
              />
              <kbd>{searchShortcutLabel}</kbd>
            </label>
            {searchOpen && (
              <div
                id="tlb-search-results"
                className="tlb-popover tlb-search-dropdown tlb-search-results"
                role="listbox"
                aria-label="Search results"
              >
                <LiveSearchResults
                  store={store}
                  query={searchQuery}
                  onOpenOrder={(id) => openOrderDetail(id)}
                  onOpenNav={(nav, entityId) => {
                    if (nav === "Customers") openLiveModule("Customers", null, null, entityId ?? null);
                    else if (nav === "Suppliers") openLiveModule("Suppliers", null, null, null, entityId ?? null);
                    else if (nav === "Finance" || nav === "Deliveries" || nav === "Products" || nav === "Warehouses") {
                      openLiveModule(nav, null, null, null, null, entityId ?? null);
                    } else openLiveModule(nav);
                  }}
                />
              </div>
            )}
          </div>
          <div className="tlb-header-actions">
            <div className="tlb-popover-wrap" ref={notificationsWrapRef}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  const opening = !notificationsOpen;
                  setNotificationsOpen(opening);
                  if (opening) {
                    setQuickOpen(false);
                    setSearchOpen(false);
                    setUserOpen(false);
                    // Unread decreases when items are shown in the open panel (first 6).
                    // Clicking a row also marks that item read (persisted via readAt).
                    const visibleIds = store.state.notifications
                      .slice(0, 6)
                      .filter((n) => !n.readAt)
                      .map((n) => n.id);
                    if (visibleIds.length > 0) store.readNotifications(visibleIds);
                  }
                }}
                aria-label={
                  unreadNotifications > 0
                    ? `Open notifications, ${unreadNotifications} unread`
                    : "Open notifications"
                }
                aria-expanded={notificationsOpen}
                className="relative"
              >
                <Bell />
                {unreadBadgeLabel ? (
                  <span className="tlb-notification-badge" aria-hidden="true">
                    {unreadBadgeLabel}
                  </span>
                ) : null}
              </Button>
              {notificationsOpen && (
                <div className="tlb-popover tlb-notification-panel" role="region" aria-label="Notifications">
                  <div className="tlb-popover-heading"><strong>Notifications</strong><button type="button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}><X /></button></div>
                  {store.state.notifications.slice(0, 6).map((n) => (
                    <button
                      type="button"
                      className={`tlb-mini-alert${n.readAt ? "" : " tlb-mini-alert-unread"}`}
                      key={n.id}
                      onClick={() => {
                        store.readNotification(n.id);
                        setNotificationsOpen(false);
                        if (n.orderId) openOrderDetail(n.orderId);
                        else openLiveModule("Outstanding Supplies");
                      }}
                    >
                      <span className={`tlb-alert-dot tlb-alert-${n.type.includes("overdue") || n.type.includes("extended") ? "danger" : n.type.includes("approaching") || n.type.includes("partial") ? "warning" : "info"}`} />
                      <div>
                        <strong>{n.title}</strong>
                        <span>{n.body}</span>
                      </div>
                    </button>
                  ))}
                  {store.state.notifications.length === 0 &&
                    store.outstanding.slice(0, 2).map((row) => (
                      <button
                        type="button"
                        className="tlb-mini-alert"
                        key={row.lineId}
                        onClick={() => {
                          setNotificationsOpen(false);
                          openLiveModule("Outstanding Supplies");
                        }}
                      >
                        <span className={`tlb-alert-dot tlb-alert-${row.ageingBand === "Overdue" ? "danger" : row.ageingBand === "Attention" ? "warning" : "info"}`} />
                        <div>
                          <strong>{row.orderNumber} · {row.productSku}</strong>
                          <span>{row.outstandingQty} outstanding · {row.ageDays}d · {row.ageingBand}</span>
                        </div>
                      </button>
                    ))}
                  <button
                    type="button"
                    className="tlb-text-action"
                    onClick={() => {
                      store.refreshNotifications();
                      setNotificationsOpen(false);
                      openLiveModule("Outstanding Supplies");
                    }}
                  >
                    Refresh & view outstanding <ChevronRight />
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
                <div className="tlb-avatar">{userInitials(store.state.currentUser)}</div>
                <div className="tlb-user-copy"><strong>{store.state.currentUser}</strong><span>{store.state.currentRole}</span></div>
                <ChevronDown />
              </button>
              {userOpen && (
                <div className="tlb-popover tlb-quick-menu tlb-user-menu" role="menu" aria-label="Account">
                  <button type="button" role="menuitem" onClick={() => openInspector({ title: store.state.currentUser, kicker: "Signed in", lines: [`Role: ${store.state.currentRole}`, "Workspace: TLB Enterprise", "Owner manages users & roles under Settings."] })}>Profile <ChevronRight /></button>
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
              <p className="tlb-eyebrow">Wednesday, 09 September 2026 · {periodCaption} · {warehouse}</p>
              <h1>{activeNav === "Dashboard" ? `Good evening, ${firstName(store.state.currentUser)}` : activeNav}</h1>
              <p>
                {activeNav === "Dashboard"
                  ? "Operational position for the selected period — sales KPIs use collections (payments & receipts dated in range), defaulting to this month."
                  : (MODULE_BLURBS[activeNav] ?? "Operational records for this module.")}
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
                    {["Create customer order", "Receive goods", "View outstanding supplies", "Create invoice", "Reset Phase 30 demo"].map(
                      (action) => (
                        <button
                          type="button"
                          role="menuitem"
                          key={action}
                          onClick={() => {
                            setQuickOpen(false);
                            if (action === "Create customer order") openLiveModule("Sales Orders");
                            else if (action === "Receive goods") openLiveModule("Stock");
                            else if (action === "View outstanding supplies") openLiveModule("Outstanding Supplies");
                            else if (action === "Create invoice") openLiveModule("Finance");
                            else store.resetDemo();
                          }}
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

          {showPeriodBar && (
            <section className="tlb-filter-bar" aria-label="Period filters">
              <div className="tlb-periods">
                {DASHBOARD_PERIODS.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={rangeSelection.mode === "preset" && rangeSelection.period === item ? "active" : ""}
                    onClick={() => selectPreset(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <label className="tlb-select"><Warehouse /><select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} aria-label="Warehouse"><option>All warehouses</option><option>Main Warehouse</option><option>Factory Store</option></select><ChevronDown /></label>
            </section>
          )}

          {activeNav === "Dashboard" && (
            <section className="tlb-history-lookup" aria-label="Sales history lookup">
              <div className="tlb-history-copy">
                <span className="tlb-eyebrow">Collected sales history</span>
                <strong>Review previous month or any custom dates</strong>
              </div>
              <div className="tlb-history-controls">
                <button
                  type="button"
                  className={rangeSelection.mode === "previousMonth" ? "active" : ""}
                  onClick={() => setRangeSelection({ mode: "previousMonth" })}
                >
                  Previous month
                </button>
                <label>
                  From
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    aria-label="Custom from date"
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    aria-label="Custom to date"
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    if (!customFrom || !customTo) return;
                    setRangeSelection({ mode: "custom", from: customFrom, to: customTo });
                  }}
                >
                  Apply custom range
                </Button>
                {(rangeSelection.mode === "previousMonth" || rangeSelection.mode === "custom") && (
                  <button type="button" className="tlb-text-action" onClick={() => selectPreset("This Month")}>
                    Back to this month
                  </button>
                )}
              </div>
              <p className="tlb-history-result">
                Showing <strong>{dash.salesTotalLabel}</strong> collected · {dash.collectionCount} receipt/payment
                {dash.collectionCount === 1 ? "" : "s"} · {dash.periodLabel}
              </p>
            </section>
          )}

          {liveModuleNav ? (
            activeNav === "Customers" ? (
              <CustomersModule
                store={store}
                selectedCustomerId={selectedCustomerId}
                onSelectCustomer={setSelectedCustomerId}
                onOpenOrder={(id) => openOrderDetail(id, "Customers")}
              />
            ) : activeNav === "Suppliers" ? (
              <SuppliersModule
                store={store}
                rangeSelection={rangeSelection}
                selectedSupplierId={selectedSupplierId}
                onSelectSupplier={setSelectedSupplierId}
              />
            ) : activeNav === "Quotations" ? (
              <QuotationsModule range={listRange} periodLabel={listPeriodLabel} store={store} />
            ) : activeNav === "Sales Orders" ? (
              <SalesOrdersModule
                store={store}
                selectedOrderId={selectedOrderId}
                onSelectOrder={handleSelectOrder}
                range={listRange}
                periodLabel={listPeriodLabel}
                onNavigateRelated={(nav, id) => {
                  if (nav === "Sales Orders") openLiveModule("Sales Orders", id ?? selectedOrderId);
                  else openLiveModule(nav);
                }}
              />
            ) : activeNav === "Outstanding Supplies" ? (
              <OutstandingSuppliesModule
                store={store}
                productFilterId={outstandingProductFilter}
                onOpenOrder={(id) => openOrderDetail(id, "Outstanding Supplies")}
                range={listRange}
                periodLabel={listPeriodLabel}
              />
            ) : activeNav === "Products" ? (
              <ProductsModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
              />
            ) : activeNav === "Stock" ? (
              <StockModule
                store={store}
                onViewOutstanding={(productId) => openLiveModule("Outstanding Supplies", null, productId)}
              />
            ) : activeNav === "Batches" ? (
              <BatchesModule range={listRange} periodLabel={listPeriodLabel} store={store} />
            ) : activeNav === "Warehouses" ? (
              <WarehousesModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
              />
            ) : activeNav === "Stock Movements" ? (
              <StockMovementsModule range={listRange} periodLabel={listPeriodLabel} store={store} />
            ) : activeNav === "Procurement" ? (
              <ProcurementModule range={listRange} periodLabel={listPeriodLabel} store={store} />
            ) : activeNav === "Import & Export" ? (
              <ImportExportModule range={listRange} periodLabel={listPeriodLabel} store={store} />
            ) : activeNav === "Factory" ? (
              <FactoryModule range={listRange} periodLabel={listPeriodLabel} store={store} />
            ) : activeNav === "Quality Control" ? (
              <QualityControlModule range={listRange} periodLabel={listPeriodLabel} store={store} />
            ) : activeNav === "Deliveries" ? (
              <DeliveriesModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
                onOpenOrder={(id) => openOrderDetail(id, "Deliveries")}
                range={listRange}
                periodLabel={listPeriodLabel}
              />
            ) : activeNav === "Finance" ? (
              <FinanceModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
                onOpenOrder={(id) => openOrderDetail(id, "Finance")}
                range={listRange}
                periodLabel={listPeriodLabel}
              />
            ) : activeNav === "Reports" ? (
              <ReportsModule store={store} range={listRange} periodLabel={listPeriodLabel} />
            ) : activeNav === "Audit Log" ? (
              <AuditModule store={store} />
            ) : activeNav === "Trash" ? (
              <TrashModule store={store} />
            ) : activeNav === "Settings" ? (
              <SettingsModule store={store} />
            ) : null
          ) : (
            <>
          <section className="tlb-metrics" aria-label="Key performance indicators">
            {dash.metrics.map((metric) => (
              <article className="tlb-metric" key={metric.label}>
                <div className="tlb-metric-label">
                  <span>{metric.label}</span>
                  <button
                    type="button"
                    aria-label={`Open ${metric.label}`}
                    onClick={() => openInspector({ title: metric.label, kicker: "KPI", lines: [`Value: ${metric.value}`, metric.note, dash.salesBasisLabel, `Filter: ${periodCaption} · ${warehouse}`, `Range: ${dash.periodLabel}`] })}
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
              <div className="tlb-panel-heading">
                <div>
                  <span>Collected sales</span>
                  <strong>{dash.salesTotalLabel}</strong>
                </div>
                <StatusBadge tone={dash.salesDeltaTone}>{dash.salesDeltaLabel}</StatusBadge>
              </div>
              <div className="tlb-chart" aria-label={`Collected sales trend for ${periodCaption}`}>
                <div className="tlb-chart-axis">
                  <span>{Math.round(maxSale / 1000)}K</span>
                  <span>{Math.round((maxSale * 0.66) / 1000)}K</span>
                  <span>{Math.round((maxSale * 0.33) / 1000)}K</span>
                  <span>0</span>
                </div>
                <div className="tlb-bars">
                  {dash.chart.map((point, index) => (
                    <div className="tlb-bar-column" key={`${point.label}-${index}`}>
                      <div
                        className={cn("tlb-bar", index === dash.chart.length - 1 && "tlb-bar-current")}
                        style={{ height: `${(point.value / maxSale) * 100}%` }}
                      />
                      <span>{point.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="tlb-chart-footer">
                <span><i className="tlb-legend-primary" />Collections (payments + receipts)</span>
                <span>{dash.periodLabel}</span>
              </div>
            </article>

            <article className="tlb-panel">
              <div className="tlb-panel-heading">
                <div>
                  <span>Inventory overview</span>
                  <strong>{dash.stockItemCount.toLocaleString()} stock units</strong>
                </div>
                <button type="button" onClick={() => setActiveNav("Stock")}>View stock <ChevronRight /></button>
              </div>
              <div className="tlb-inventory-value">
                <div>
                  <span>Total stock value</span>
                  <strong>{dash.inventoryValueLabel}</strong>
                </div>
                <PackageCheck />
              </div>
              <div className="tlb-stock-list">
                {dash.stockSlices.map((item) => (
                  <div key={item.label}>
                    <div>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                    <div className="tlb-progress">
                      <span className={item.tone} style={{ width: item.width }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="tlb-stock-summary">
                <div><span>Low stock</span><strong className="text-danger">{dash.lowStock}</strong></div>
                <div><span>Warehouses</span><strong className="text-warning-foreground">{store.state.warehouses.length}</strong></div>
                <div><span>Out of stock</span><strong>{dash.outOfStock}</strong></div>
              </div>
            </article>

            <article className="tlb-panel tlb-orders-panel">
              <div className="tlb-panel-heading">
                <div>
                  <span>Recent orders</span>
                  <strong>{periodCaption} commercial activity</strong>
                </div>
                <button type="button" onClick={() => openLiveModule("Sales Orders")}>View all <ChevronRight /></button>
              </div>
              <div className="tlb-table-scroll">
                {dash.recentOrders.length === 0 ? (
                  <p className="tlb-muted-line" style={{ padding: "1rem" }}>No orders in this period.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Customer</th>
                        <th>Value</th>
                        <th>Status</th>
                        <th><span className="sr-only">Open</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dash.recentOrders.map((order) => (
                        <tr key={order.id}>
                          <td><strong>{order.number}</strong></td>
                          <td>{order.customer}</td>
                          <td>{order.value}</td>
                          <td><StatusBadge tone={order.tone}>{order.status}</StatusBadge></td>
                          <td>
                            <button
                              type="button"
                              aria-label={`Open ${order.number}`}
                              onClick={() => openInspector({
                                title: order.number,
                                kicker: "Sales order",
                                lines: [`Customer: ${order.customer}`, `Value: ${order.value}`, `Status: ${order.status}`, `Order date: ${order.orderDate}`, `Filter: ${periodCaption}`],
                              })}
                            >
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

            <OutstandingDashboardWidget
              store={store}
              dateFilter={dash.range}
              onOpen={() => openLiveModule("Outstanding Supplies")}
            />

            <article className="tlb-panel tlb-alerts-panel">
              <div className="tlb-panel-heading">
                <div>
                  <span>Alerts requiring attention</span>
                  <strong>{dash.alerts.length} alert{dash.alerts.length === 1 ? "" : "s"} in period</strong>
                </div>
                <button type="button" onClick={() => setActiveNav("Quality Control")}>View all <ChevronRight /></button>
              </div>
              <div className="tlb-alert-list">
                {dash.alerts.length === 0 ? (
                  <p className="tlb-muted-line" style={{ padding: "1rem" }}>No alerts dated in this period.</p>
                ) : (
                  dash.alerts.map((alert) => (
                    <button
                      type="button"
                      className="tlb-alert-row"
                      key={alert.title}
                      onClick={() => openInspector({
                        title: alert.title,
                        kicker: "Operational alert",
                        lines: [alert.detail, `Date: ${alert.date}`, "Sandbox alert. Acknowledgement is not persisted."],
                      })}
                    >
                      <span className={`tlb-alert-icon tlb-alert-${alert.type}`}><AlertTriangle /></span>
                      <span><strong>{alert.title}</strong><small>{alert.detail}</small></span>
                      <ChevronRight />
                    </button>
                  ))
                )}
              </div>
            </article>

            <article className="tlb-panel tlb-operations-panel">
              <div className="tlb-panel-heading">
                <div>
                  <span>Operational pulse</span>
                  <strong>Imports & production · {periodCaption}</strong>
                </div>
                <button type="button" onClick={() => setActiveNav("Import & Export")}>Open operations <ChevronRight /></button>
              </div>
              {dash.opsRows.length === 0 ? (
                <p className="tlb-muted-line" style={{ padding: "1rem" }}>No import/production events in this period.</p>
              ) : (
                dash.opsRows.map((row) => (
                  <div className="tlb-operation-row" key={row.title}>
                    <span className="tlb-operation-icon">{row.kind === "import" ? <Ship /> : <Factory />}</span>
                    <div>
                      <strong>{row.title}</strong>
                      <span>{row.detail}</span>
                    </div>
                    <div className="tlb-operation-progress">
                      <span><i style={{ width: `${row.progress}%` }} /></span>
                      <small>{row.caption}</small>
                    </div>
                  </div>
                ))
              )}
            </article>

            <article className="tlb-panel tlb-receivables-panel">
              <div className="tlb-panel-heading">
                <div>
                  <span>Receivables</span>
                  <strong>{dash.receivablesLabel} outstanding</strong>
                </div>
                <button type="button" onClick={() => setActiveNav("Finance")}>View ledger <ChevronRight /></button>
              </div>
              <div className="tlb-receivable-bars">
                {dash.receivableBuckets.map((bucket) => (
                  <div
                    key={bucket.className}
                    style={{ width: `${Math.max(2, (bucket.amount / recvTotal) * 100)}%` }}
                    className={bucket.className}
                  />
                ))}
              </div>
              <div className="tlb-receivable-legend">
                {dash.receivableBuckets.map((bucket) => (
                  <span key={bucket.className}>
                    <i className={bucket.className} />
                    {bucket.label} <strong>{formatMoney(bucket.amount)}</strong>
                  </span>
                ))}
              </div>
            </article>
          </section>
            </>
          )}
        </main>
      </div>

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