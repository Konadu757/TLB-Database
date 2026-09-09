import type { AppRole, Permission } from "./types";

/** Role → capability matrix (mock-auth ready; swap currentRole for real auth claims later). */
export const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  Sales: [
    "customers.manage",
    "orders.create",
    "orders.confirm",
    "orders.cancel_line",
    "tin.update",
    "invoice.create",
    "receipt.create",
    "reports.view",
    "audit.view",
  ],
  Warehouse: [
    "supply.create",
    "stock.receive",
    "stock.reserve",
    "delivery.manage",
    "audit.view",
  ],
  Finance: [
    "invoice.create",
    "receipt.create",
    "payment.record",
    "tin.update",
    "reports.view",
    "audit.view",
  ],
  Manager: [
    "customers.manage",
    "orders.create",
    "orders.confirm",
    "orders.cancel_line",
    "supply.create",
    "stock.receive",
    "stock.reserve",
    "invoice.create",
    "receipt.create",
    "delivery.manage",
    "payment.record",
    "tin.update",
    "reports.view",
    "settings.manage",
    "audit.view",
  ],
  Admin: [
    "customers.manage",
    "orders.create",
    "orders.confirm",
    "orders.cancel_line",
    "supply.create",
    "stock.receive",
    "stock.reserve",
    "invoice.create",
    "receipt.create",
    "delivery.manage",
    "payment.record",
    "tin.update",
    "reports.view",
    "settings.manage",
    "audit.view",
  ],
};

export function hasPermission(role: AppRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export const ALL_ROLES: AppRole[] = ["Sales", "Warehouse", "Finance", "Manager", "Admin"];
