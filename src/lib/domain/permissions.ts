import type {
  Permission,
  RoleDefinition,
  SystemRoleKey,
  TlbState,
} from "./types";

/** All capabilities available in the permission matrix. */
export const ALL_PERMISSIONS: Permission[] = [
  "dashboard.view",
  "customers.manage",
  "suppliers.manage",
  "quotations.view",
  "orders.create",
  "orders.confirm",
  "orders.cancel_line",
  "supply.create",
  "stock.view",
  "stock.receive",
  "stock.reserve",
  "invoice.create",
  "receipt.create",
  "delivery.manage",
  "payment.record",
  "finance.view",
  "reports.view",
  "settings.manage",
  "audit.view",
  "tin.update",
  "users.manage",
];

export const PERMISSION_LABELS: Record<Permission, { module: string; label: string }> = {
  "dashboard.view": { module: "Dashboard", label: "View dashboard" },
  "customers.manage": { module: "Customers", label: "Manage customers" },
  "suppliers.manage": { module: "Suppliers", label: "Manage suppliers" },
  "quotations.view": { module: "Quotations", label: "View quotations" },
  "orders.create": { module: "Sales Orders", label: "Create orders" },
  "orders.confirm": { module: "Sales Orders", label: "Confirm orders" },
  "orders.cancel_line": { module: "Sales Orders", label: "Cancel order lines" },
  "supply.create": { module: "Outstanding Supplies", label: "Create supplies" },
  "stock.view": { module: "Stock", label: "View stock & inventory" },
  "stock.receive": { module: "Stock", label: "Receive stock" },
  "stock.reserve": { module: "Stock", label: "Reserve stock" },
  "invoice.create": { module: "Finance", label: "Create invoices" },
  "receipt.create": { module: "Finance", label: "Create receipts" },
  "payment.record": { module: "Finance", label: "Record payments" },
  "finance.view": { module: "Finance", label: "View finance" },
  "delivery.manage": { module: "Deliveries", label: "Manage deliveries" },
  "reports.view": { module: "Reports", label: "View reports" },
  "audit.view": { module: "Audit", label: "View audit log" },
  "settings.manage": { module: "Settings", label: "Manage company settings" },
  "tin.update": { module: "Settings", label: "Update TIN fields" },
  "users.manage": { module: "Users & Roles", label: "Manage users and roles" },
};

/** Default permission sets for seeded system roles. */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleKey, Permission[]> = {
  Owner: [...ALL_PERMISSIONS],
  Admin: [...ALL_PERMISSIONS],
  Manager: [
    "dashboard.view",
    "customers.manage",
    "suppliers.manage",
    "quotations.view",
    "orders.create",
    "orders.confirm",
    "orders.cancel_line",
    "supply.create",
    "stock.view",
    "stock.receive",
    "stock.reserve",
    "invoice.create",
    "receipt.create",
    "delivery.manage",
    "payment.record",
    "finance.view",
    "tin.update",
    "reports.view",
    "settings.manage",
    "audit.view",
  ],
  Sales: [
    "dashboard.view",
    "customers.manage",
    "suppliers.manage",
    "quotations.view",
    "orders.create",
    "orders.confirm",
    "orders.cancel_line",
    "tin.update",
    "invoice.create",
    "receipt.create",
    "finance.view",
    "reports.view",
    "audit.view",
  ],
  Warehouse: [
    "dashboard.view",
    "supply.create",
    "stock.view",
    "stock.receive",
    "stock.reserve",
    "delivery.manage",
    "audit.view",
  ],
  Finance: [
    "dashboard.view",
    "invoice.create",
    "receipt.create",
    "payment.record",
    "finance.view",
    "tin.update",
    "reports.view",
    "audit.view",
  ],
};

/** @deprecated Use SYSTEM_ROLE_PERMISSIONS — kept for callers expecting ROLE_PERMISSIONS. */
export const ROLE_PERMISSIONS = SYSTEM_ROLE_PERMISSIONS;

export const SYSTEM_ROLE_IDS: Record<SystemRoleKey, string> = {
  Owner: "role-owner",
  Admin: "role-admin",
  Manager: "role-manager",
  Sales: "role-sales",
  Warehouse: "role-warehouse",
  Finance: "role-finance",
};

export const OWNER_USER_ID = "user-owner";

export function createSystemRoles(): RoleDefinition[] {
  const descriptions: Record<SystemRoleKey, string> = {
    Owner: "Full access — create roles, assign users, and manage the workspace.",
    Admin: "Full operational access including users and roles.",
    Manager: "Cross-module operations without user/role administration.",
    Sales: "Customers, quotations, orders, and commercial documents.",
    Warehouse: "Stock, supplies, and deliveries.",
    Finance: "Invoices, receipts, payments, and financial reports.",
  };
  return (Object.keys(SYSTEM_ROLE_PERMISSIONS) as SystemRoleKey[]).map((key) => ({
    id: SYSTEM_ROLE_IDS[key],
    name: key,
    description: descriptions[key],
    permissions: [...SYSTEM_ROLE_PERMISSIONS[key]],
    active: true,
    systemKey: key,
  }));
}

/** Nav label → permissions that grant visibility (any match). */
export const NAV_PERMISSIONS: Record<string, Permission[]> = {
  Dashboard: ["dashboard.view"],
  Customers: ["customers.manage"],
  Suppliers: ["suppliers.manage"],
  Quotations: ["quotations.view"],
  "Sales Orders": ["orders.create", "orders.confirm", "orders.cancel_line", "supply.create"],
  "Outstanding Supplies": ["supply.create", "stock.reserve", "orders.create"],
  Products: ["stock.view", "stock.receive", "stock.reserve"],
  Stock: ["stock.view", "stock.receive", "stock.reserve"],
  Batches: ["stock.view", "stock.receive"],
  Warehouses: ["stock.view", "stock.receive"],
  "Stock Movements": ["stock.view", "stock.receive", "stock.reserve"],
  Procurement: ["suppliers.manage", "stock.receive"],
  "Import & Export": ["suppliers.manage", "stock.receive"],
  Factory: ["stock.view", "stock.receive"],
  "Quality Control": ["stock.view"],
  Deliveries: ["delivery.manage"],
  Finance: ["finance.view", "invoice.create", "receipt.create", "payment.record"],
  Reports: ["reports.view"],
  "Audit Log": ["audit.view"],
  Settings: ["settings.manage", "users.manage"],
};

export function resolveRole(state: Pick<TlbState, "roles" | "currentRoleId" | "currentRole">): RoleDefinition | undefined {
  return (
    state.roles.find((r) => r.id === state.currentRoleId) ??
    state.roles.find((r) => r.name === state.currentRole || r.systemKey === state.currentRole)
  );
}

export function roleHasPermission(role: RoleDefinition | undefined, permission: Permission): boolean {
  if (!role || !role.active) return false;
  return role.permissions.includes(permission);
}

/**
 * Primary permission check against the session role catalog.
 * Accepts full state (preferred) or a legacy system role key for tests.
 */
export function hasPermission(
  stateOrSystemKey: Pick<TlbState, "roles" | "currentRoleId" | "currentRole"> | SystemRoleKey,
  permission: Permission,
): boolean {
  if (typeof stateOrSystemKey === "string") {
    return SYSTEM_ROLE_PERMISSIONS[stateOrSystemKey]?.includes(permission) ?? false;
  }
  return roleHasPermission(resolveRole(stateOrSystemKey), permission);
}

export function canAccessNav(
  state: Pick<TlbState, "roles" | "currentRoleId" | "currentRole">,
  navLabel: string,
): boolean {
  const required = NAV_PERMISSIONS[navLabel];
  if (!required || required.length === 0) return true;
  return required.some((p) => hasPermission(state, p));
}

/** Active roles available for assignment (includes system + custom). */
export function listAssignableRoles(roles: RoleDefinition[]): RoleDefinition[] {
  return roles.filter((r) => r.active);
}

/** @deprecated Prefer listAssignableRoles(state.roles) — fixed system keys only. */
export const ALL_ROLES: SystemRoleKey[] = ["Owner", "Sales", "Warehouse", "Finance", "Manager", "Admin"];

export function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean)[0] ?? name;
}
