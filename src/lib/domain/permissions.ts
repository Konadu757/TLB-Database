import type { Permission, RoleDefinition, SystemRoleKey, TlbState } from "./types";

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
  "stock.issue",
  "stock.transfer",
  "stock.adjust",
  "stock.approve",
  "approvals.manage",
  "bi.view",
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
  "trash.view",
  "records.delete",
  "trash.purge",
  "records.edit",
  "ops.request",
  "ops.approve",
  "ops.warehouse",
  "ops.dispatch",
  "ops.drive",
  "ops.receive",
  "ops.communicate",
  "ops.view",
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
  "stock.receive": { module: "Stock", label: "Receive stock / GRN" },
  "stock.reserve": { module: "Stock", label: "Reserve stock" },
  "stock.issue": { module: "Stock", label: "Issue / goods out" },
  "stock.transfer": { module: "Stock", label: "Warehouse transfers" },
  "stock.adjust": { module: "Stock", label: "Adjustments & counts" },
  "stock.approve": { module: "Stock", label: "Approve stock variances" },
  "approvals.manage": { module: "Approvals", label: "Manage approvals" },
  "bi.view": { module: "Ask TLB", label: "Business intelligence presets" },
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
  "trash.view": { module: "Trash", label: "View trash" },
  "records.delete": { module: "Trash", label: "Move records to trash" },
  "trash.purge": { module: "Trash", label: "Permanently delete from trash" },
  "records.edit": { module: "Records", label: "Edit master & document records" },
  "ops.request": { module: "Communication Hub", label: "Create / submit requests" },
  "ops.approve": { module: "Communication Hub", label: "Approve ops requests" },
  "ops.warehouse": { module: "Communication Hub", label: "Warehouse review / release" },
  "ops.dispatch": { module: "Communication Hub", label: "Dispatch & assign drivers" },
  "ops.drive": { module: "Communication Hub", label: "Driver job actions" },
  "ops.receive": { module: "Communication Hub", label: "Confirm delivery receipt" },
  "ops.communicate": { module: "Communication Hub", label: "Request communication" },
  "ops.view": { module: "Communication Hub", label: "View communication hub" },
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
    "stock.issue",
    "stock.transfer",
    "stock.adjust",
    "stock.approve",
    "approvals.manage",
    "bi.view",
    "invoice.create",
    "receipt.create",
    "delivery.manage",
    "payment.record",
    "finance.view",
    "tin.update",
    "reports.view",
    "settings.manage",
    "audit.view",
    "records.edit",
    "ops.request",
    "ops.approve",
    "ops.warehouse",
    "ops.dispatch",
    "ops.receive",
    "ops.communicate",
    "ops.view",
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
    "bi.view",
    "reports.view",
    "audit.view",
    "records.edit",
    "ops.request",
    "ops.communicate",
    "ops.view",
    "ops.receive",
  ],
  Warehouse: [
    "dashboard.view",
    "supply.create",
    "stock.view",
    "stock.receive",
    "stock.reserve",
    "stock.issue",
    "stock.transfer",
    "stock.adjust",
    "delivery.manage",
    "bi.view",
    "audit.view",
    "records.edit",
    "ops.warehouse",
    "ops.dispatch",
    "ops.communicate",
    "ops.view",
  ],
  Finance: [
    "dashboard.view",
    "invoice.create",
    "receipt.create",
    "payment.record",
    "finance.view",
    "tin.update",
    "approvals.manage",
    "bi.view",
    "reports.view",
    "audit.view",
    "records.edit",
    "ops.approve",
    "ops.view",
  ],
  Driver: ["dashboard.view", "ops.drive", "ops.communicate", "ops.view", "delivery.manage"],
  Requester: [
    "dashboard.view",
    "ops.request",
    "ops.communicate",
    "ops.view",
    "ops.receive",
    "bi.view",
  ],
  Receiver: ["dashboard.view", "ops.receive", "ops.communicate", "ops.view", "delivery.manage"],
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
  Driver: "role-driver",
  Requester: "role-requester",
  Receiver: "role-receiver",
};

/** tlb.roles.code for each seeded system role. */
export const SYSTEM_ROLE_DB_CODE: Record<SystemRoleKey, string> = {
  Owner: "OWNER",
  Admin: "ADMIN",
  Manager: "MANAGER",
  Sales: "SALES",
  Warehouse: "WAREHOUSE",
  Finance: "FINANCE",
  Driver: "DRIVER",
  Requester: "REQUESTER",
  Receiver: "RECEIVER",
};

export function systemRoleKeyForDbCode(code: string): SystemRoleKey | undefined {
  const normalized = code.trim().toUpperCase();
  return (Object.keys(SYSTEM_ROLE_DB_CODE) as SystemRoleKey[]).find(
    (key) => SYSTEM_ROLE_DB_CODE[key] === normalized,
  );
}

/** Map a local system role id to tlb.roles.code. Custom roles return null. */
export function dbRoleCodeForRoleId(roleId: string): string | null {
  const key = (Object.keys(SYSTEM_ROLE_IDS) as SystemRoleKey[]).find(
    (k) => SYSTEM_ROLE_IDS[k] === roleId,
  );
  return key ? SYSTEM_ROLE_DB_CODE[key] : null;
}

export const OWNER_USER_ID = "user-owner";

/** Canonical portal Owner display name shown in the header / profile. */
export const OWNER_DISPLAY_NAME = "TLB Owner";

/**
 * Live portal Owner Auth identity (Supabase Auth UUID + email).
 * Bind/heal must always map this Auth session to Owner staff + OWNER role,
 * never a leftover Finance (or other invitee) name/role.
 */
export const PORTAL_OWNER_AUTH_USER_ID = "aa9ba161-56b9-49fc-9ca5-c46070fa3d87";
export const PORTAL_OWNER_AUTH_EMAIL = "mccaesartechsolutions@gmail.com";

export function isPortalOwnerAuth(input: {
  authUserId?: string;
  email?: string;
}): boolean {
  const id = input.authUserId?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  if (id && id === PORTAL_OWNER_AUTH_USER_ID) return true;
  if (email && email === PORTAL_OWNER_AUTH_EMAIL) return true;
  return false;
}

export function createSystemRoles(): RoleDefinition[] {
  const descriptions: Record<SystemRoleKey, string> = {
    Owner: "Full access — create roles, assign users, and manage the workspace.",
    Admin: "Full operational access including users and roles.",
    Manager: "Cross-module operations without user/role administration.",
    Sales: "Customers, quotations, orders, and commercial documents.",
    Warehouse: "Stock, supplies, and deliveries.",
    Finance: "Invoices, receipts, payments, and financial reports.",
    Driver: "Driver jobs — collect, transit, and delivery confirmation.",
    Requester: "Create and track operational requests.",
    Receiver: "Confirm delivery receipts and report discrepancies.",
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
  "Goods In": ["stock.receive", "stock.view"],
  "Goods Out": ["stock.issue", "stock.view"],
  Transfers: ["stock.transfer", "stock.view"],
  Adjustments: ["stock.adjust", "stock.view"],
  "Trace Product": ["stock.view", "bi.view"],
  Returns: ["stock.receive", "stock.issue", "stock.view"],
  "Non-PO Purchases": ["stock.receive", "approvals.manage", "suppliers.manage"],
  "Stock Ageing": ["stock.view", "reports.view", "bi.view"],
  "Ask TLB": ["bi.view", "reports.view", "dashboard.view"],
  Approvals: ["approvals.manage", "stock.approve"],
  "Accounts Receivable": ["finance.view"],
  "Accounts Payable": ["finance.view", "suppliers.manage"],
  Procurement: ["suppliers.manage", "stock.receive"],
  "Import & Export": ["suppliers.manage", "stock.receive", "stock.issue"],
  Factory: ["stock.view", "stock.receive"],
  "Quality Control": ["stock.view"],
  Deliveries: ["delivery.manage"],
  Requests: ["ops.request", "ops.view"],
  "Warehouse Actions": ["ops.warehouse", "stock.issue"],
  Dispatch: ["ops.dispatch", "delivery.manage", "ops.warehouse"],
  Drivers: ["ops.drive", "ops.dispatch", "delivery.manage"],
  "Outstanding Requests": ["ops.view", "ops.request", "ops.warehouse"],
  "Exceptions / Discrepancies": ["ops.view", "ops.receive", "ops.warehouse", "ops.approve"],
  "My Actions": [
    "ops.view",
    "ops.request",
    "ops.approve",
    "ops.warehouse",
    "ops.drive",
    "ops.receive",
  ],
  "Live Operations Board": ["ops.view", "ops.dispatch", "ops.warehouse"],
  Notifications: ["dashboard.view", "ops.view", "ops.communicate"],
  Finance: ["finance.view", "invoice.create", "receipt.create", "payment.record"],
  Invoices: ["finance.view", "invoice.create", "receipt.create", "payment.record"],
  Receipts: ["finance.view", "invoice.create", "receipt.create", "payment.record"],
  Reports: ["reports.view"],
  "Audit Log": ["audit.view"],
  Trash: ["trash.view"],
  Settings: ["settings.manage", "users.manage"],
};

export function resolveRole(
  state: Pick<TlbState, "roles" | "currentRoleId" | "currentRole">,
): RoleDefinition | undefined {
  return (
    state.roles.find((r) => r.id === state.currentRoleId) ??
    state.roles.find((r) => r.name === state.currentRole || r.systemKey === state.currentRole)
  );
}

/**
 * Effective capabilities for a role. System roles always use the predefined
 * catalog — stored `role.permissions` overrides are ignored.
 */
export function effectivePermissions(role: RoleDefinition | undefined): Permission[] {
  if (!role || !role.active) return [];
  if (role.systemKey) {
    return [...(SYSTEM_ROLE_PERMISSIONS[role.systemKey] ?? [])];
  }
  return [...role.permissions];
}

export function roleHasPermission(
  role: RoleDefinition | undefined,
  permission: Permission,
): boolean {
  if (!role || !role.active) return false;
  return effectivePermissions(role).includes(permission);
}

/**
 * Primary permission check against the session role catalog.
 * Accepts full state (preferred) or a legacy system role key for tests.
 * System roles always resolve against SYSTEM_ROLE_PERMISSIONS.
 */
const OWNER_ONLY_TRASH_PERMISSIONS = new Set<Permission>(["records.delete", "trash.purge"]);

export function hasPermission(
  stateOrSystemKey: Pick<TlbState, "roles" | "currentRoleId" | "currentRole"> | SystemRoleKey,
  permission: Permission,
): boolean {
  if (OWNER_ONLY_TRASH_PERMISSIONS.has(permission)) {
    if (typeof stateOrSystemKey === "string") return stateOrSystemKey === "Owner";
    return resolveRole(stateOrSystemKey)?.systemKey === "Owner";
  }
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

/** Owner/Admin (or users.manage) can see and delete all notifications. */
export function canManageAllNotifications(
  state: Pick<TlbState, "roles" | "currentRoleId" | "currentRole">,
): boolean {
  const role = resolveRole(state);
  if (role?.systemKey === "Owner" || role?.systemKey === "Admin") return true;
  if (state.currentRole === "Owner" || state.currentRole === "Admin") return true;
  return hasPermission(state, "users.manage");
}

/** Predefined roles the Owner can assign to a person. Sign-in stays the authenticated Owner. */
export const ALL_ROLES: SystemRoleKey[] = Object.keys(SYSTEM_ROLE_PERMISSIONS) as SystemRoleKey[];

export function isAssignableSystemRole(role: RoleDefinition | undefined): role is RoleDefinition {
  if (!role?.active || role.deletedAt || !role.systemKey) return false;
  return Object.prototype.hasOwnProperty.call(SYSTEM_ROLE_PERMISSIONS, role.systemKey);
}

/** Active predefined roles, in catalog order. Soft-deleted roles stay out of the menu. */
export function listAssignableRoles(roles: RoleDefinition[]): RoleDefinition[] {
  const order = ALL_ROLES;
  return roles
    .filter(isAssignableSystemRole)
    .sort(
      (a, b) =>
        order.indexOf(a.systemKey as SystemRoleKey) - order.indexOf(b.systemKey as SystemRoleKey),
    );
}

export function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean)[0] ?? name;
}
