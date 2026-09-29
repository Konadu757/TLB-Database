import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Bell,
  Boxes,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Gauge,
  Kanban,
  LayoutDashboard,
  ListTodo,
  Menu,
  MessageSquareText,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Receipt,
  Route,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Ship,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  Truck,
  UserRound,
  Users,
  Warehouse,
  X,
} from "lucide-react";

import logoUrl from "@/assets/tlb-logo.png";
import { DetailBackProvider, useDetailBack } from "@/components/modules/detail-back-context";
import { RecordBackLink } from "@/components/modules/record-browser";
import {
  CustomersModule,
  LiveSearchResults,
  openSearchHit,
  OutstandingDashboardWidget,
  OutstandingSuppliesModule,
  SalesOrdersModule,
  StockModule,
  SuppliersModule,
} from "@/components/modules/commerce-modules";
import type { AppNotification, SearchHit } from "@/lib/domain/types";
import { resolveAskTlbHitOpen } from "@/lib/domain/inventory";
import {
  AccountsPayableModule,
  AccountsReceivableModule,
  AdjustmentsModule,
  ApprovalsModule,
  AskTlbModule,
  GoodsInModule,
  GoodsOutModule,
  InventoryAlertsWidget,
  LiveBatchesModule,
  LiveStockMovementsModule,
  TraceProductModule,
  TransfersModule,
} from "@/components/modules/inventory-ops-modules";
import {
  LiveImportExportModule,
  NonPoPurchasesModule,
  ReturnsModule,
  StockAgeingModule,
} from "@/components/modules/deferred-ops-modules";
import {
  OpsDispatchModule,
  OpsDriversModule,
  OpsExceptionsModule,
  OpsLiveBoardModule,
  OpsMyActionsModule,
  OpsOutstandingModule,
  OpsRequestsModule,
  OpsWarehouseActionsModule,
} from "@/components/modules/ops-hub-modules";
import {
  FactoryModule,
  ProductsModule,
  ProcurementModule,
  QualityControlModule,
  QuotationsModule,
  WarehousesModule,
} from "@/components/modules/list-modules";
import {
  AuditModule,
  DeliveriesModule,
  FinanceModule,
  ReportsModule,
  SettingsModule,
} from "@/components/modules/p1-modules";
import { NotificationsModule } from "@/components/modules/notifications-module";
import { TrashModule } from "@/components/modules/trash-module";
import { DueAwarenessPanel } from "@/components/due-awareness-panel";
import { Button } from "@/components/ui/button";
import { buildDashboardSnapshot } from "@/lib/domain/dashboard-metrics";
import { listVisibleNotifications } from "@/lib/domain/notifications";
import {
  DASHBOARD_PERIODS,
  livePeriodAsOf,
  resolveSelectionRange,
  selectionLabel,
  type DashboardPeriod,
  type DashboardRangeSelection,
} from "@/lib/domain/period-range";
import { formatMoney } from "@/lib/store/tlb-store";
import { useTlbStore } from "@/lib/store/use-tlb-store";
import {
  canAccessNav,
  canManageAllNotifications,
  resolveRole,
  userInitials,
} from "@/lib/domain/permissions";
import { listTrashItems } from "@/lib/domain/trash";
import { cn } from "@/lib/utils";

function countBadgeLabel(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? "99+" : String(count);
}

function metricIconForLabel(label: string): typeof LayoutDashboard {
  const key = label.toLowerCase();
  if (key.includes("collect") || key.includes("sales")) return CircleDollarSign;
  if (key.includes("inventory")) return Boxes;
  if (key.includes("receivable")) return Receipt;
  if (key.includes("order")) return ShoppingCart;
  if (key.includes("import")) return Ship;
  if (key.includes("production")) return Factory;
  return Gauge;
}

type NavItem = { label: string; icon: typeof LayoutDashboard; badge?: string };
type NavGroup = { label?: string; items: NavItem[] };

const NAV_GROUPS_STORAGE_KEY = "tlb-sidebar-nav-groups";

function readStoredOpenNavGroups(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(NAV_GROUPS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeStoredOpenNavGroups(next: Record<string, boolean>) {
  try {
    sessionStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

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
      { label: "Goods In", icon: PackagePlus },
      { label: "Goods Out", icon: PackageMinus },
      { label: "Returns", icon: PackageCheck },
      { label: "Transfers", icon: ArrowLeftRight },
      { label: "Adjustments", icon: SlidersHorizontal },
      { label: "Stock Movements", icon: ArrowUpRight },
      { label: "Stock Ageing", icon: Gauge },
      { label: "Trace Product", icon: Route },
    ],
  },
  {
    label: "Communication Hub",
    items: [
      { label: "My Actions", icon: ListTodo },
      { label: "Requests", icon: ClipboardList },
      { label: "Warehouse Actions", icon: PackageCheck },
      { label: "Dispatch", icon: Truck },
      { label: "Drivers", icon: UserRound },
      { label: "Outstanding Requests", icon: AlertTriangle },
      { label: "Exceptions / Discrepancies", icon: ShieldAlert },
      { label: "Live Operations Board", icon: Kanban },
      { label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Procurement", icon: ClipboardCheck, badge: "5" },
      { label: "Non-PO Purchases", icon: ClipboardCheck },
      { label: "Import & Export", icon: Ship, badge: "3" },
      { label: "Factory", icon: Factory },
      { label: "Quality Control", icon: ShieldCheck, badge: "8" },
      { label: "Deliveries", icon: Truck },
    ],
  },
  {
    label: "Control",
    items: [
      { label: "Invoices", icon: FileSpreadsheet },
      { label: "Receipts", icon: Receipt },
      { label: "Finance", icon: CircleDollarSign },
      { label: "Accounts Receivable", icon: ArrowDownRight },
      { label: "Accounts Payable", icon: ArrowUpRight },
      { label: "Approvals", icon: ClipboardCheck },
      { label: "Ask TLB", icon: MessageSquareText },
      { label: "Reports", icon: Gauge },
      { label: "Audit Log", icon: ShieldCheck },
      { label: "Trash", icon: Trash2 },
      { label: "Settings", icon: Settings },
    ],
  },
];

type QuickActionItem = {
  label: string;
  hint: string;
  icon: typeof FileText;
};

const quickActionGroups: { label: string; items: QuickActionItem[] }[] = [
  {
    label: "Sales",
    items: [
      { label: "Create quotation", hint: "Quotations", icon: FileText },
      { label: "Create customer order", hint: "Sales orders", icon: ShoppingCart },
      { label: "Create invoice", hint: "Invoices", icon: FileSpreadsheet },
    ],
  },
  {
    label: "Stock",
    items: [
      { label: "Receive goods", hint: "Stock", icon: Boxes },
      { label: "View outstanding supplies", hint: "Outstanding supplies", icon: PackageCheck },
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
  "Goods In",
  "Goods Out",
  "Returns",
  "Transfers",
  "Procurement",
  "Non-PO Purchases",
  "Import & Export",
  "Factory",
  "Quality Control",
  "Finance",
  "Invoices",
  "Receipts",
  "Deliveries",
  "Requests",
  "Reports",
  "Stock Ageing",
]);

type Inspector = { title: string; kicker: string; lines: string[] };

function HeaderDetailBack() {
  const { detailBack } = useDetailBack();
  if (!detailBack) return null;
  return (
    <div className="tlb-header-back-slot">
      <RecordBackLink label={detailBack.label} onBack={detailBack.onBack} />
    </div>
  );
}

function StatusBadge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

const WAREHOUSE_FILTERS = ["All warehouses", "Main Warehouse", "Factory Store"] as const;
type WarehouseFilter = (typeof WAREHOUSE_FILTERS)[number];

export function TLBDashboard() {
  return (
    <DetailBackProvider>
      <TLBDashboardInner />
    </DetailBackProvider>
  );
}

function TLBDashboardInner() {
  const store = useTlbStore();
  const { detailBack, setDetailBack } = useDetailBack();
  const detailOpen = Boolean(detailBack);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [rangeSelection, setRangeSelection] = useState<DashboardRangeSelection>({
    mode: "preset",
    period: "This Month",
  });
  const [warehouse, setWarehouse] = useState<WarehouseFilter>("All warehouses");
  const [warehouseOpen, setWarehouseOpen] = useState(false);
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
  const [quoteCreateRequest, setQuoteCreateRequest] = useState(false);
  const [quoteFormOpen, setQuoteFormOpen] = useState(false);
  const clearQuoteCreateRequest = useCallback(() => setQuoteCreateRequest(false), []);

  const [isNavMobile, setIsNavMobile] = useState(false);
  const [openNavGroups, setOpenNavGroups] =
    useState<Record<string, boolean>>(readStoredOpenNavGroups);
  const sidebarOpenRef = useRef(sidebarOpen);
  const desktopSidebarOpenRef = useRef(sidebarOpen);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const searchHitsRef = useRef<SearchHit[]>([]);

  const FOCUSABLE_SEARCH_NAVS = useMemo(
    () =>
      new Set([
        "Finance",
        "Invoices",
        "Receipts",
        "Deliveries",
        "Products",
        "Warehouses",
        "Returns",
        "Non-PO Purchases",
        "Import & Export",
        "Batches",
        "Goods In",
        "Goods Out",
        "Transfers",
        "Adjustments",
        "Approvals",
        "Trace Product",
        "Requests",
        "Warehouse Actions",
        "Dispatch",
        "Drivers",
      ]),
    [],
  );

  const searchShortcutLabel = useMemo(() => {
    if (typeof navigator === "undefined") return "Ctrl K";
    const platform = navigator.platform ?? "";
    const isMac = /Mac|iPhone|iPad|iPod/i.test(platform);
    return isMac ? "⌘ K" : "Ctrl K";
  }, []);

  const outstandingBadge = store.outstanding.length;
  const trashBadge = listTrashItems(store.state).length;
  const role = resolveRole(store.state);
  const manageAllNotifications = canManageAllNotifications(store.state);
  const visibleNotifications = useMemo(() => {
    const session = {
      currentUserId: store.state.currentUserId,
      currentRole: store.state.currentRole,
      roleName: role?.name,
      systemKey: role?.systemKey,
      manageAll: manageAllNotifications,
    };
    return listVisibleNotifications(store.state.notifications, session);
  }, [
    store.state.notifications,
    store.state.currentUserId,
    store.state.currentRole,
    role?.name,
    role?.systemKey,
    manageAllNotifications,
  ]);
  const unreadNotifications = visibleNotifications.filter((n) => !n.readAt).length;

  const navGroupsLive = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.items
            .filter((item) => canAccessNav(store.state, item.label))
            .map((item) => {
              if (item.label === "Outstanding Supplies") {
                return {
                  ...item,
                  badge: outstandingBadge > 0 ? String(outstandingBadge) : undefined,
                };
              }
              if (item.label === "Sales Orders") {
                const count = store.state.orders.filter(
                  (o) => !o.deletedAt && o.status !== "Delivered" && o.status !== "Cancelled",
                ).length;
                return { ...item, badge: count > 0 ? String(count) : undefined };
              }
              if (item.label === "Notifications") {
                return { ...item, badge: countBadgeLabel(unreadNotifications) };
              }
              if (item.label === "Trash") {
                return { ...item, badge: countBadgeLabel(trashBadge) };
              }
              return item;
            }),
        }))
        .filter((group) => group.items.length > 0),
    [outstandingBadge, trashBadge, unreadNotifications, store.state],
  );

  useEffect(() => {
    if (!canAccessNav(store.state, activeNav)) {
      setActiveNav("Dashboard");
    }
  }, [store.state.currentRoleId, store.state.currentUserId, activeNav, store.state]);

  // Keep the group that owns the active page expanded (and persist that choice).
  useEffect(() => {
    const activeGroup = navGroupsLive.find(
      (group) => group.label && group.items.some((item) => item.label === activeNav),
    );
    if (!activeGroup?.label) return;
    setOpenNavGroups((prev) => {
      if (prev[activeGroup.label!] === true) return prev;
      const next = { ...prev, [activeGroup.label!]: true };
      writeStoredOpenNavGroups(next);
      return next;
    });
  }, [activeNav, navGroupsLive]);

  const openLiveModule = (
    nav: string,
    orderId?: string | null,
    productId?: string | null,
    customerId?: string | null,
    supplierId?: string | null,
    focusEntityId?: string | null,
  ) => {
    setDetailBack(null);
    setActiveNav(nav);
    setSelectedOrderId(orderId ?? null);
    setSelectedCustomerId(nav === "Customers" ? (customerId ?? null) : null);
    setSelectedSupplierId(nav === "Suppliers" ? (supplierId ?? null) : null);
    setOutstandingProductFilter(nav === "Outstanding Supplies" ? (productId ?? null) : null);
    setModuleFocusId(FOCUSABLE_SEARCH_NAVS.has(nav) ? (focusEntityId ?? null) : null);
    setOrderReturnNav(null);
    setMobileOpen(false);
    setInspector(null);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchActiveIndex(0);
    searchHitsRef.current = [];
    setNotificationsOpen(false);
    setQuickOpen(false);
    setUserOpen(false);
    setWarehouseOpen(false);
  };

  const openOrderDetail = (orderId: string, returnNav?: string) => {
    openLiveModule("Sales Orders", orderId);
    setOrderReturnNav(returnNav ?? null);
  };

  const openFromSearchHit = (hit: SearchHit) => {
    openSearchHit(hit, {
      onOpenOrder: (id) => openOrderDetail(id),
      onOpenNav: (nav, entityId) => {
        if (nav === "Customers") openLiveModule("Customers", null, null, entityId ?? null);
        else if (nav === "Suppliers")
          openLiveModule("Suppliers", null, null, null, entityId ?? null);
        else if (FOCUSABLE_SEARCH_NAVS.has(nav)) {
          openLiveModule(nav, null, null, null, null, entityId ?? null);
        } else openLiveModule(nav);
      },
    });
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
    activeNav === "Goods In" ||
    activeNav === "Goods Out" ||
    activeNav === "Returns" ||
    activeNav === "Transfers" ||
    activeNav === "Adjustments" ||
    activeNav === "Stock Movements" ||
    activeNav === "Stock Ageing" ||
    activeNav === "Trace Product" ||
    activeNav === "Procurement" ||
    activeNav === "Non-PO Purchases" ||
    activeNav === "Import & Export" ||
    activeNav === "Factory" ||
    activeNav === "Quality Control" ||
    activeNav === "Deliveries" ||
    activeNav === "My Actions" ||
    activeNav === "Requests" ||
    activeNav === "Warehouse Actions" ||
    activeNav === "Dispatch" ||
    activeNav === "Drivers" ||
    activeNav === "Outstanding Requests" ||
    activeNav === "Exceptions / Discrepancies" ||
    activeNav === "Live Operations Board" ||
    activeNav === "Notifications" ||
    activeNav === "Finance" ||
    activeNav === "Invoices" ||
    activeNav === "Receipts" ||
    activeNav === "Accounts Receivable" ||
    activeNav === "Accounts Payable" ||
    activeNav === "Approvals" ||
    activeNav === "Ask TLB" ||
    activeNav === "Reports" ||
    activeNav === "Audit Log" ||
    activeNav === "Trash" ||
    activeNav === "Settings";

  const showPeriodBar = PERIOD_SCOPED_NAV.has(activeNav);
  const overlayOpen = quickOpen || quoteFormOpen;
  const listRange = useMemo(
    () => resolveSelectionRange(rangeSelection, livePeriodAsOf()),
    [rangeSelection],
  );
  const listPeriodLabel = selectionLabel(rangeSelection);

  const unreadBadgeLabel =
    unreadNotifications > 99 ? "99+" : unreadNotifications > 0 ? String(unreadNotifications) : "";

  const openNotificationRelated = useCallback(
    (n: AppNotification) => {
      store.readNotification(n.id);
      setNotificationsOpen(false);
      if (n.opsRequestId) {
        openLiveModule("Requests", null, null, null, null, n.opsRequestId);
        return;
      }
      if (n.orderId) {
        openOrderDetail(n.orderId);
        return;
      }
      if (n.productId) {
        openLiveModule("Outstanding Supplies", null, n.productId);
        return;
      }
      openLiveModule("Notifications");
    },
    // openLiveModule / openOrderDetail are stable enough for this session scope
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store],
  );

  const sidebarIsOpen = isNavMobile ? true : sidebarOpen;

  const isNavGroupExpanded = useCallback(
    (group: NavGroup) => {
      if (!group.label) return true;
      // Icon rail: keep every item reachable without opening a dropdown.
      if (!sidebarIsOpen) return true;
      if (group.label in openNavGroups) return openNavGroups[group.label] === true;
      return group.items.some((item) => item.label === activeNav);
    },
    [activeNav, openNavGroups, sidebarIsOpen],
  );

  const toggleNavGroup = useCallback((label: string, currentlyExpanded: boolean) => {
    setOpenNavGroups((prev) => {
      const next = { ...prev, [label]: !currentlyExpanded };
      writeStoredOpenNavGroups(next);
      return next;
    });
  }, []);

  const focusHeaderSearch = () => {
    setSearchOpen(true);
    setMobileOpen(false);
    setNotificationsOpen(false);
    setQuickOpen(false);
    setUserOpen(false);
    setWarehouseOpen(false);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const closeHeaderSearch = (options?: { clear?: boolean; blur?: boolean }) => {
    setSearchOpen(false);
    if (options?.clear !== false) {
      setSearchQuery("");
      setSearchActiveIndex(0);
      searchHitsRef.current = [];
    }
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
        setWarehouseOpen(false);
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
  const warehouseWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!notificationsOpen && !quickOpen && !userOpen && !searchOpen && !warehouseOpen) return;
    if (typeof document === "undefined") return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (searchOpen && searchWrapRef.current?.contains(target)) return;
      if (notificationsOpen && notificationsWrapRef.current?.contains(target)) return;
      if (quickOpen && quickWrapRef.current?.contains(target)) return;
      if (userOpen && userWrapRef.current?.contains(target)) return;
      if (warehouseOpen && warehouseWrapRef.current?.contains(target)) return;

      if (searchOpen) closeHeaderSearch({ blur: false });
      setNotificationsOpen(false);
      setQuickOpen(false);
      setUserOpen(false);
      setWarehouseOpen(false);
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [notificationsOpen, quickOpen, userOpen, searchOpen, warehouseOpen]);

  useEffect(() => {
    if (!warehouseOpen) return;
    warehouseWrapRef.current
      ?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')
      ?.focus();
  }, [warehouseOpen, warehouse]);

  const dash = useMemo(
    () => buildDashboardSnapshot(store.state, rangeSelection, warehouse, livePeriodAsOf()),
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
    <aside
      className={cn("tlb-sidebar", !sidebarIsOpen && "tlb-sidebar-collapsed")}
      aria-label="Primary navigation"
    >
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
        {navGroupsLive.map((group, groupIndex) => {
          const expanded = isNavGroupExpanded(group);
          const groupId = group.label
            ? `tlb-nav-group-${group.label.toLowerCase().replace(/\s+/g, "-")}`
            : undefined;
          return (
            <div
              className={cn("tlb-nav-group", group.label && expanded && "tlb-nav-group-expanded")}
              key={group.label ?? groupIndex}
            >
              {group.label && (
                <button
                  type="button"
                  className="tlb-nav-group-toggle"
                  aria-expanded={expanded}
                  aria-controls={groupId}
                  onClick={() => toggleNavGroup(group.label!, expanded)}
                >
                  <span className="tlb-nav-label">{group.label}</span>
                  <ChevronDown className="tlb-nav-group-chevron" aria-hidden="true" />
                </button>
              )}
              <div
                id={groupId}
                className={cn("tlb-nav-group-items", !expanded && "tlb-nav-group-items-collapsed")}
                hidden={!expanded}
              >
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
            </div>
          );
        })}
      </nav>
    </aside>
  );

  return (
    <div className="tlb-app-shell">
      <div className="tlb-desktop-sidebar">{sidebar}</div>
      {mobileOpen && (
        <div
          className="tlb-mobile-overlay"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className={cn("tlb-mobile-sidebar", mobileOpen && "tlb-mobile-sidebar-open")}>
        {sidebar}
      </div>

      <div className={cn("tlb-main", detailOpen && "tlb-main--detail-open")}>
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
          <HeaderDetailBack />
          {showPeriodBar && !detailOpen && (
            <p
              className="tlb-header-context"
              title={`Wednesday, 09 September 2026 · ${periodCaption} · ${warehouse}`}
            >
              Wednesday, 09 September 2026 · {periodCaption} · {warehouse}
            </p>
          )}
          <div className="tlb-header-actions">
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
                  aria-activedescendant={
                    searchOpen && searchQuery.trim() && searchHitsRef.current.length > 0
                      ? `tlb-search-option-${searchActiveIndex}`
                      : undefined
                  }
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSearchActiveIndex(0);
                    setSearchOpen(true);
                  }}
                  onFocus={() => {
                    setSearchOpen(true);
                    setNotificationsOpen(false);
                    setQuickOpen(false);
                    setUserOpen(false);
                    setWarehouseOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      if (searchQuery) {
                        setSearchQuery("");
                        setSearchActiveIndex(0);
                        searchHitsRef.current = [];
                        setSearchOpen(true);
                      } else {
                        closeHeaderSearch();
                      }
                      return;
                    }
                    const hits = searchHitsRef.current;
                    if (event.key === "ArrowDown") {
                      if (!searchQuery.trim()) return;
                      event.preventDefault();
                      setSearchOpen(true);
                      setSearchActiveIndex((prev) =>
                        hits.length ? Math.min(prev + 1, hits.length - 1) : 0,
                      );
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      if (!searchQuery.trim()) return;
                      event.preventDefault();
                      setSearchOpen(true);
                      setSearchActiveIndex((prev) => Math.max(prev - 1, 0));
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const q = searchQuery.trim().toLowerCase();
                      if (hits.length > 0) {
                        openFromSearchHit(hits[Math.min(searchActiveIndex, hits.length - 1)]!);
                        return;
                      }
                      if (!q) return;
                      if (q.includes("outstanding")) {
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
                    activeIndex={searchActiveIndex}
                    onActiveIndexChange={setSearchActiveIndex}
                    onResultsChange={(hits) => {
                      searchHitsRef.current = hits;
                    }}
                    onOpenOrder={(id) => openOrderDetail(id)}
                    onOpenNav={(nav, entityId) => {
                      if (nav === "Customers")
                        openLiveModule("Customers", null, null, entityId ?? null);
                      else if (nav === "Suppliers")
                        openLiveModule("Suppliers", null, null, null, entityId ?? null);
                      else if (FOCUSABLE_SEARCH_NAVS.has(nav)) {
                        openLiveModule(nav, null, null, null, null, entityId ?? null);
                      } else openLiveModule(nav);
                    }}
                  />
                </div>
              )}
            </div>
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
                    const visibleIds = visibleNotifications
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
                <div
                  className="tlb-popover tlb-notification-panel"
                  role="region"
                  aria-label="Notifications"
                >
                  <div className="tlb-popover-heading">
                    <strong>Notifications</strong>
                    <button
                      type="button"
                      aria-label="Close notifications"
                      onClick={() => setNotificationsOpen(false)}
                    >
                      <X />
                    </button>
                  </div>
                  {visibleNotifications.slice(0, 6).map((n) => (
                    <button
                      type="button"
                      className={`tlb-mini-alert${n.readAt ? "" : " tlb-mini-alert-unread"}`}
                      key={n.id}
                      onClick={() => openNotificationRelated(n)}
                    >
                      <span
                        className={`tlb-alert-dot tlb-alert-${n.type.includes("overdue") || n.type.includes("extended") ? "danger" : n.type.includes("approaching") || n.type.includes("partial") ? "warning" : "info"}`}
                      />
                      <div>
                        <strong>{n.title}</strong>
                        <span>{n.body}</span>
                      </div>
                    </button>
                  ))}
                  {visibleNotifications.length === 0 ? (
                    <p
                      className="tlb-muted"
                      style={{ margin: "0.5rem 0.75rem", fontSize: "0.8125rem" }}
                    >
                      No notifications yet.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="tlb-text-action"
                    onClick={() => {
                      setNotificationsOpen(false);
                      openLiveModule("Notifications");
                    }}
                  >
                    View all notifications <ChevronRight />
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
                <div className="tlb-user-copy">
                  <strong>{store.state.currentUser}</strong>
                  <span>{store.state.currentRole}</span>
                </div>
                <ChevronDown />
              </button>
              {userOpen && (
                <div
                  className="tlb-popover tlb-quick-menu tlb-user-menu"
                  role="menu"
                  aria-label="Account"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      openInspector({
                        title: store.state.currentUser,
                        kicker: "Signed in",
                        lines: [
                          `Role: ${store.state.currentRole}`,
                          "Workspace: TLB Enterprise",
                          "Owner manages users & roles under Settings.",
                        ],
                      })
                    }
                  >
                    <UserRound aria-hidden="true" />
                    Profile
                    <ChevronRight aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={activeNav === "Settings" ? "is-selected" : undefined}
                    onClick={() => {
                      setUserOpen(false);
                      setActiveNav("Settings");
                    }}
                  >
                    <Settings aria-hidden="true" />
                    Settings
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main
          className={cn(
            "tlb-content",
            detailOpen && "tlb-content--detail-open",
            overlayOpen && "tlb-content--overlay-open",
          )}
        >
          {!detailOpen && (
            <div className={cn("tlb-page-heading", quickOpen && "tlb-page-heading--overlay-open")}>
              <div>
                <h1 className={cn(activeNav === "Dashboard" && "tlb-dashboard-title")}>
                  {activeNav === "Dashboard" ? "Dashboard" : activeNav}
                </h1>
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
                      className="tlb-popover tlb-quick-menu tlb-quick-actions"
                      role="menu"
                      aria-label="Quick actions"
                    >
                      {quickActionGroups.map((group) => (
                        <div className="tlb-quick-actions-group" key={group.label}>
                          <p className="tlb-quick-actions-label">{group.label}</p>
                          {group.items.map((action) => {
                            const Icon = action.icon;
                            return (
                              <button
                                type="button"
                                role="menuitem"
                                key={action.label}
                                onClick={() => {
                                  setQuickOpen(false);
                                  if (action.label === "Create quotation") {
                                    setQuoteCreateRequest(true);
                                    openLiveModule("Quotations");
                                  } else if (action.label === "Create customer order")
                                    openLiveModule("Sales Orders");
                                  else if (action.label === "Receive goods") openLiveModule("Stock");
                                  else if (action.label === "View outstanding supplies")
                                    openLiveModule("Outstanding Supplies");
                                  else if (action.label === "Create invoice")
                                    openLiveModule("Invoices");
                                }}
                              >
                                <span className="tlb-quick-actions-icon" aria-hidden="true">
                                  <Icon />
                                </span>
                                <span className="tlb-quick-actions-copy">
                                  <strong>{action.label}</strong>
                                  <span>{action.hint}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {showPeriodBar && !detailOpen && (
            <section className="tlb-filter-bar" aria-label="Period filters">
              <div className="tlb-periods">
                {DASHBOARD_PERIODS.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={
                      rangeSelection.mode === "preset" && rangeSelection.period === item
                        ? "active"
                        : ""
                    }
                    onClick={() => selectPreset(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div
                className="tlb-select tlb-warehouse-select"
                ref={warehouseWrapRef}
                data-open={warehouseOpen ? "true" : "false"}
              >
                <button
                  type="button"
                  className="tlb-warehouse-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={warehouseOpen}
                  aria-controls="tlb-warehouse-menu"
                  aria-label="Warehouse"
                  onClick={() => {
                    setWarehouseOpen((open) => !open);
                    setNotificationsOpen(false);
                    setQuickOpen(false);
                    setUserOpen(false);
                    if (searchOpen) closeHeaderSearch({ blur: false });
                  }}
                >
                  <Warehouse aria-hidden="true" />
                  <span>{warehouse}</span>
                  <ChevronDown className="tlb-warehouse-chevron" aria-hidden="true" />
                </button>
                {warehouseOpen && (
                  <div
                    id="tlb-warehouse-menu"
                    className="tlb-warehouse-menu"
                    role="listbox"
                    aria-label="Warehouse"
                    onKeyDown={(event) => {
                      const index = WAREHOUSE_FILTERS.indexOf(warehouse);
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setWarehouse(
                          WAREHOUSE_FILTERS[Math.min(index + 1, WAREHOUSE_FILTERS.length - 1)]!,
                        );
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setWarehouse(WAREHOUSE_FILTERS[Math.max(index - 1, 0)]!);
                      } else if (event.key === "Home") {
                        event.preventDefault();
                        setWarehouse(WAREHOUSE_FILTERS[0]);
                      } else if (event.key === "End") {
                        event.preventDefault();
                        setWarehouse(WAREHOUSE_FILTERS[WAREHOUSE_FILTERS.length - 1]!);
                      } else if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setWarehouseOpen(false);
                      }
                    }}
                  >
                    {WAREHOUSE_FILTERS.map((option) => (
                      <button
                        type="button"
                        role="option"
                        key={option}
                        aria-selected={warehouse === option}
                        className={warehouse === option ? "is-selected" : undefined}
                        onClick={() => {
                          setWarehouse(option);
                          setWarehouseOpen(false);
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
              <QuotationsModule
                range={listRange}
                periodLabel={listPeriodLabel}
                store={store}
                startCreating={quoteCreateRequest}
                onStartCreatingConsumed={clearQuoteCreateRequest}
                onCreatingChange={setQuoteFormOpen}
              />
            ) : activeNav === "Sales Orders" ? (
              <SalesOrdersModule
                store={store}
                selectedOrderId={selectedOrderId}
                onSelectOrder={handleSelectOrder}
                range={listRange}
                periodLabel={listPeriodLabel}
                onNavigateRelated={(nav, id) => {
                  if (nav === "Sales Orders") openLiveModule("Sales Orders", id ?? selectedOrderId);
                  else if (
                    nav === "Finance" ||
                    nav === "Invoices" ||
                    nav === "Receipts" ||
                    nav === "Deliveries" ||
                    nav === "Customers"
                  ) {
                    if (nav === "Customers") openLiveModule("Customers", null, null, id ?? null);
                    else openLiveModule(nav, null, null, null, null, id ?? null);
                  } else openLiveModule(nav);
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
                onViewOutstanding={(productId) =>
                  openLiveModule("Outstanding Supplies", null, productId)
                }
              />
            ) : activeNav === "Batches" ? (
              <LiveBatchesModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
              />
            ) : activeNav === "Warehouses" ? (
              <WarehousesModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
              />
            ) : activeNav === "Goods In" ? (
              <GoodsInModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
              />
            ) : activeNav === "Goods Out" ? (
              <GoodsOutModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
              />
            ) : activeNav === "Returns" ? (
              <ReturnsModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
              />
            ) : activeNav === "Transfers" ? (
              <TransfersModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
              />
            ) : activeNav === "Adjustments" ? (
              <AdjustmentsModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
              />
            ) : activeNav === "Stock Movements" ? (
              <LiveStockMovementsModule
                range={listRange}
                periodLabel={listPeriodLabel}
                store={store}
              />
            ) : activeNav === "Stock Ageing" ? (
              <StockAgeingModule store={store} />
            ) : activeNav === "Trace Product" ? (
              <TraceProductModule
                store={store}
                initialProductId={moduleFocusId}
                onNavigate={(nav, id) => openLiveModule(nav, id ?? null)}
              />
            ) : activeNav === "Procurement" ? (
              <ProcurementModule range={listRange} periodLabel={listPeriodLabel} store={store} />
            ) : activeNav === "Non-PO Purchases" ? (
              <NonPoPurchasesModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
                onOpenGrn={(id) => openLiveModule("Goods In", id)}
              />
            ) : activeNav === "Import & Export" ? (
              <LiveImportExportModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
                onOpenGrn={(id) => openLiveModule("Goods In", id)}
              />
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
            ) : activeNav === "My Actions" ? (
              <OpsMyActionsModule
                store={store}
                onOpenRequest={(id) => openLiveModule("Requests", null, null, null, null, id)}
                onNavigateAction={(nav, id) => {
                  if (nav === "Approvals") openLiveModule("Approvals");
                  else if (nav === "Warehouse Actions")
                    openLiveModule("Warehouse Actions", null, null, null, null, id);
                  else if (nav === "Drivers") openLiveModule("Drivers", null, null, null, null, id);
                  else if (nav === "Exceptions / Discrepancies")
                    openLiveModule("Exceptions / Discrepancies");
                  else openLiveModule("Requests", null, null, null, null, id);
                }}
              />
            ) : activeNav === "Requests" ? (
              <OpsRequestsModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
                range={listRange}
                periodLabel={listPeriodLabel}
              />
            ) : activeNav === "Warehouse Actions" ? (
              <OpsWarehouseActionsModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
                onOpenRequest={(id) => openLiveModule("Requests", null, null, null, null, id)}
              />
            ) : activeNav === "Dispatch" ? (
              <OpsDispatchModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
                onOpenRequest={(id) => openLiveModule("Requests", null, null, null, null, id)}
              />
            ) : activeNav === "Drivers" ? (
              <OpsDriversModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
                onOpenRequest={(id) => openLiveModule("Requests", null, null, null, null, id)}
              />
            ) : activeNav === "Outstanding Requests" ? (
              <OpsOutstandingModule
                store={store}
                onOpenRequest={(id) => openLiveModule("Requests", null, null, null, null, id)}
              />
            ) : activeNav === "Exceptions / Discrepancies" ? (
              <OpsExceptionsModule
                store={store}
                onOpenRequest={(id) => openLiveModule("Requests", null, null, null, null, id)}
              />
            ) : activeNav === "Live Operations Board" ? (
              <OpsLiveBoardModule
                store={store}
                onOpenRequest={(id) => openLiveModule("Requests", null, null, null, null, id)}
              />
            ) : activeNav === "Notifications" ? (
              <NotificationsModule store={store} onOpenRelated={openNotificationRelated} />
            ) : activeNav === "Finance" || activeNav === "Invoices" || activeNav === "Receipts" ? (
              <FinanceModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
                onOpenOrder={(id) =>
                  openOrderDetail(
                    id,
                    activeNav === "Invoices" || activeNav === "Receipts" ? activeNav : "Finance",
                  )
                }
                range={listRange}
                periodLabel={listPeriodLabel}
                initialTab={
                  activeNav === "Invoices"
                    ? "invoices"
                    : activeNav === "Receipts"
                      ? "receipts"
                      : undefined
                }
              />
            ) : activeNav === "Accounts Receivable" ? (
              <AccountsReceivableModule store={store} />
            ) : activeNav === "Accounts Payable" ? (
              <AccountsPayableModule store={store} />
            ) : activeNav === "Approvals" ? (
              <ApprovalsModule
                store={store}
                focusId={moduleFocusId}
                onFocusConsumed={() => setModuleFocusId(null)}
              />
            ) : activeNav === "Ask TLB" ? (
              <AskTlbModule
                store={store}
                onNavigate={(nav, entityId) => {
                  const target = resolveAskTlbHitOpen({ nav, entityId });
                  openLiveModule(
                    target.nav,
                    target.orderId ?? null,
                    target.productId ?? null,
                    target.customerId ?? null,
                    target.supplierId ?? null,
                    target.focusEntityId ?? null,
                  );
                }}
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
              <section
                className="tlb-overview-section"
                aria-labelledby="tlb-business-overview-heading"
              >
                <h2 id="tlb-business-overview-heading" className="tlb-section-title">
                  Business overview
                </h2>
                <div className="tlb-overview-grid">
                  <div className="tlb-overview-primary" role="list">
                    {dash.metrics.slice(0, 2).map((metric, index) => {
                      const MetricIcon = metricIconForLabel(metric.label);
                      return (
                        <button
                          type="button"
                          className={cn(
                            "tlb-metric tlb-metric--primary",
                            index === 0 && "tlb-metric--hero",
                          )}
                          key={metric.label}
                          role="listitem"
                          aria-label={`${metric.label}: ${metric.value}`}
                          onClick={() => {
                            if (index === 1) {
                              setActiveNav("Stock");
                              return;
                            }
                            openInspector({
                              title: metric.label,
                              kicker: "KPI",
                              lines: [
                                `Value: ${metric.value}`,
                                metric.note,
                                dash.salesBasisLabel,
                                `Filter: ${periodCaption} · ${warehouse}`,
                                `Range: ${dash.periodLabel}`,
                              ],
                            });
                          }}
                        >
                          <div className="tlb-metric-label">
                            <span className="tlb-metric-title">{metric.label}</span>
                            <span className="tlb-metric-icon" aria-hidden="true">
                              <MetricIcon />
                            </span>
                          </div>
                          <strong className="tlb-metric-value">{metric.value}</strong>
                          {index === 1 ? (
                            <>
                              <div className="tlb-metric-progress" aria-hidden="true">
                                <span
                                  style={{
                                    width: `${Math.max(
                                      4,
                                      Math.min(
                                        100,
                                        dash.stockItemCount > 0
                                          ? ((dash.stockItemCount - dash.outOfStock) /
                                              Math.max(dash.stockItemCount, 1)) *
                                              100
                                          : 0,
                                      ),
                                    )}%`,
                                  }}
                                />
                              </div>
                              <p className="tlb-metric-link">
                                Stock board <ChevronRight />
                              </p>
                            </>
                          ) : (
                            <p
                              className={
                                metric.trend === "up"
                                  ? "metric-positive"
                                  : metric.trend === "down"
                                    ? "metric-negative"
                                    : ""
                              }
                            >
                              {metric.trend === "up" && <ArrowUpRight />}
                              {metric.trend === "down" && <ArrowDownRight />}
                              {metric.note}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="tlb-overview-kpis" role="list">
                    {dash.metrics.slice(2, 5).map((metric) => {
                      const MetricIcon = metricIconForLabel(metric.label);
                      return (
                        <button
                          type="button"
                          className="tlb-metric tlb-metric--compact"
                          key={metric.label}
                          role="listitem"
                          aria-label={`${metric.label}: ${metric.value}`}
                          onClick={() =>
                            openInspector({
                              title: metric.label,
                              kicker: "KPI",
                              lines: [
                                `Value: ${metric.value}`,
                                metric.note,
                                dash.salesBasisLabel,
                                `Filter: ${periodCaption} · ${warehouse}`,
                                `Range: ${dash.periodLabel}`,
                              ],
                            })
                          }
                        >
                          <div className="tlb-metric-label">
                            <span className="tlb-metric-title">{metric.label}</span>
                            <span className="tlb-metric-icon" aria-hidden="true">
                              <MetricIcon />
                            </span>
                          </div>
                          <strong className="tlb-metric-value">{metric.value}</strong>
                          <p
                            className={
                              metric.trend === "up"
                                ? "metric-positive"
                                : metric.trend === "down"
                                  ? "metric-negative"
                                  : ""
                            }
                          >
                            {metric.trend === "up" && <ArrowUpRight />}
                            {metric.trend === "down" && <ArrowDownRight />}
                            {metric.note}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                  <aside className="tlb-overview-aside" aria-label="Outstanding supplies">
                    <OutstandingDashboardWidget
                      store={store}
                      dateFilter={dash.range}
                      onOpen={() => openLiveModule("Outstanding Supplies")}
                    />
                  </aside>
                </div>
              </section>

              <DueAwarenessPanel
                state={store.state}
                outstanding={store.outstanding}
                onOpenNotifications={() => openLiveModule("Notifications")}
              />

              <section className="tlb-overview-section" aria-labelledby="tlb-ops-overview-heading">
                <h2 id="tlb-ops-overview-heading" className="tlb-section-title">
                  Operations snapshot
                </h2>
                <div className="tlb-dashboard-grid">
                  <article className="tlb-panel tlb-sales-panel">
                    <div className="tlb-panel-heading">
                      <div>
                        <span>Collected sales</span>
                        <strong>{dash.salesTotalLabel}</strong>
                      </div>
                      <StatusBadge tone={dash.salesDeltaTone}>{dash.salesDeltaLabel}</StatusBadge>
                    </div>
                    <div
                      className="tlb-chart"
                      aria-label={`Collected sales trend for ${periodCaption}`}
                    >
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
                              className={cn(
                                "tlb-bar",
                                index === dash.chart.length - 1 && "tlb-bar-current",
                              )}
                              style={{ height: `${(point.value / maxSale) * 100}%` }}
                            />
                            <span>{point.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="tlb-chart-footer">
                      <span>
                        <i className="tlb-legend-primary" />
                        Collections (payments + receipts)
                      </span>
                      <span>{dash.periodLabel}</span>
                    </div>
                  </article>

                  <article className="tlb-panel">
                    <div className="tlb-panel-heading">
                      <div>
                        <span>Inventory overview</span>
                        <strong>{dash.stockItemCount.toLocaleString()} stock units</strong>
                      </div>
                      <button type="button" onClick={() => setActiveNav("Stock")}>
                        View stock <ChevronRight />
                      </button>
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
                      <div>
                        <span>Low stock</span>
                        <strong className="text-danger">{dash.lowStock}</strong>
                      </div>
                      <div>
                        <span>Warehouses</span>
                        <strong className="text-warning-foreground">
                          {store.state.warehouses.length}
                        </strong>
                      </div>
                      <div>
                        <span>Out of stock</span>
                        <strong>{dash.outOfStock}</strong>
                      </div>
                    </div>
                  </article>

                  <article className="tlb-panel tlb-orders-panel">
                    <div className="tlb-panel-heading">
                      <div>
                        <span>Recent orders</span>
                        <strong>{periodCaption} commercial activity</strong>
                      </div>
                      <button type="button" onClick={() => openLiveModule("Sales Orders")}>
                        View all <ChevronRight />
                      </button>
                    </div>
                    <div className="tlb-table-scroll">
                      {dash.recentOrders.length === 0 ? (
                        <p className="tlb-muted-line" style={{ padding: "1rem" }}>
                          No orders in this period.
                        </p>
                      ) : (
                        <table>
                          <thead>
                            <tr>
                              <th>Order</th>
                              <th>Customer</th>
                              <th>Value</th>
                              <th>Status</th>
                              <th>
                                <span className="sr-only">Open</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {dash.recentOrders.map((order) => (
                              <tr key={order.id}>
                                <td>
                                  <strong>{order.number}</strong>
                                </td>
                                <td>{order.customer}</td>
                                <td>{order.value}</td>
                                <td>
                                  <StatusBadge tone={order.tone}>{order.status}</StatusBadge>
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    aria-label={`Open ${order.number}`}
                                    onClick={() =>
                                      openInspector({
                                        title: order.number,
                                        kicker: "Sales order",
                                        lines: [
                                          `Customer: ${order.customer}`,
                                          `Value: ${order.value}`,
                                          `Status: ${order.status}`,
                                          `Order date: ${order.orderDate}`,
                                          `Filter: ${periodCaption}`,
                                        ],
                                      })
                                    }
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

                  <InventoryAlertsWidget store={store} onOpenNav={(nav) => openLiveModule(nav)} />

                  <article className="tlb-panel tlb-alerts-panel">
                    <div className="tlb-panel-heading">
                      <div>
                        <span>Alerts requiring attention</span>
                        <strong>
                          {dash.alerts.length} alert{dash.alerts.length === 1 ? "" : "s"} in period
                        </strong>
                      </div>
                      <button type="button" onClick={() => setActiveNav("Quality Control")}>
                        View all <ChevronRight />
                      </button>
                    </div>
                    <div className="tlb-alert-list">
                      {dash.alerts.length === 0 ? (
                        <p className="tlb-muted-line" style={{ padding: "1rem" }}>
                          No alerts dated in this period.
                        </p>
                      ) : (
                        dash.alerts.map((alert) => (
                          <button
                            type="button"
                            className="tlb-alert-row"
                            key={alert.title}
                            onClick={() =>
                              openInspector({
                                title: alert.title,
                                kicker: "Operational alert",
                                lines: [
                                  alert.detail,
                                  `Date: ${alert.date}`,
                                  "Sandbox alert. Acknowledgement is not persisted.",
                                ],
                              })
                            }
                          >
                            <span className={`tlb-alert-icon tlb-alert-${alert.type}`}>
                              <AlertTriangle />
                            </span>
                            <span>
                              <strong>{alert.title}</strong>
                              <small>{alert.detail}</small>
                            </span>
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
                      <button type="button" onClick={() => setActiveNav("Import & Export")}>
                        Open operations <ChevronRight />
                      </button>
                    </div>
                    {dash.opsRows.length === 0 ? (
                      <p className="tlb-muted-line" style={{ padding: "1rem" }}>
                        No import/production events in this period.
                      </p>
                    ) : (
                      dash.opsRows.map((row) => (
                        <div className="tlb-operation-row" key={row.title}>
                          <span className="tlb-operation-icon">
                            {row.kind === "import" ? <Ship /> : <Factory />}
                          </span>
                          <div>
                            <strong>{row.title}</strong>
                            <span>{row.detail}</span>
                          </div>
                          <div className="tlb-operation-progress">
                            <span>
                              <i style={{ width: `${row.progress}%` }} />
                            </span>
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
                      <button type="button" onClick={() => setActiveNav("Finance")}>
                        View ledger <ChevronRight />
                      </button>
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
                </div>
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
