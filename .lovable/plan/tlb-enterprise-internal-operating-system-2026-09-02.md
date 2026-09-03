# TLB Enterprise Internal Operating System

## Goal

Build a secure, desktop-first enterprise operations platform that becomes TLB Enterprise’s operational source of truth across inventory, warehousing, imports, procurement, production, quality control, sales, finance, documents, and reporting.

The first implementation milestone will establish the branded application foundation, authentication boundaries, navigation shell, configurable access model, settings structure, and an executive dashboard using clearly identified demonstration data.

## A. System Architecture

```text
Responsive React interface (TanStack Start)
  ├─ Public authentication screens
  ├─ Protected application shell
  ├─ Module routes and reusable TLB components
  └─ Query cache, forms, validation, accessible feedback
                         │
Authenticated server functions and public integration APIs
  ├─ Authorization and warehouse-scope enforcement
  ├─ Workflow/application services
  ├─ Atomic inventory and financial transactions
  ├─ Document generation and storage
  └─ Audit and notification events
                         │
Lovable Cloud
  ├─ Relational PostgreSQL database
  ├─ Authentication and secure sessions
  ├─ Row-level access policies
  ├─ File storage
  └─ Background/server-side functions
```

- TanStack Start remains the fixed full-stack framework; route loaders/query caching will support scalable reads, while protected mutations run server-side.
- Domain logic is separated into inventory, procurement/imports, production/QC, sales/finance, identity/access, documents, and reporting services.
- Inventory is ledger-driven: balances are derived or atomically maintained from immutable stock movements, never edited directly.
- Business statuses, approvals, categories, units, and notification rules are configuration data rather than hard-coded procedures.
- External e-commerce integration is deferred, but future endpoints will use versioned, validated contracts and authenticated public API routes.

## B. Database Entity Model

### Organization and access
- `companies`, `branches`, `departments`, `profiles`
- `roles`, `permissions`, `user_roles`, `role_permissions`
- `user_warehouse_access`, `audit_logs`, `settings`

### Product and inventory
- `product_categories`, `product_types`, `products`, `chemical_details`, `units_of_measure`
- `warehouses`, `warehouse_locations`, `batches`
- `inventory_balances` as a read-optimized projection
- `stock_movements` as the authoritative ledger
- `stock_transfers`, `stock_transfer_items`, `stock_counts`, `stock_count_items`, `stock_adjustments`

### Procurement and imports
- `suppliers`, `supplier_contacts`, `supplier_products`
- `purchase_requests`, `purchase_request_items`, `purchase_orders`, `purchase_order_items`
- `goods_receipts`, `goods_receipt_items`
- `import_shipments`, `containers`, `import_costs`, `shipment_documents`, `landed_cost_allocations`

### Customers, sales, and finance
- `customers`, `customer_contacts`, `customer_addresses`
- `quotations`, `quotation_items`, `sales_orders`, `sales_order_items`
- `stock_reservations`, `pick_lists`, `pick_list_items`, `deliveries`, `delivery_items`
- `invoices`, `invoice_items`, `payments`, `payment_allocations`, `credit_notes`, `expenses`

### Factory and quality
- `production_plans`, `production_orders`, `bills_of_materials`, `bom_items`
- `material_requests`, `material_issues`, `production_consumption`, `production_batches`
- `quality_inspections`, `quality_parameters`, `quality_results`
- `equipment`, `maintenance_records`

### Supporting operations
- `export_orders`, `export_shipments`, `documents`, `notifications`

## C. Relationship Summary

- A product belongs to configurable category/type records and may have one chemical-details record.
- A batch traces to either a supplier receipt or production batch, then to warehouse movements, reservations, deliveries, and customers.
- Warehouse locations form `warehouse → zone → rack → shelf → bin`; user access can cover one, several, or all warehouses.
- Purchase requests create approved purchase orders; goods receipts and accepted inspection outcomes create stock movements.
- Import shipments connect suppliers, purchase orders, containers, documents, costs, and landed-cost allocations.
- A BOM defines required inputs; production orders issue source batches, record actual consumption/waste, create output batches, and require QC release before available stock.
- Sales orders reserve stock by batch, then drive picking, delivery, invoicing, payment allocation, and balance reporting.
- Documents attach polymorphically to business records; every sensitive mutation appends an audit record.

## D. Route and Page Map

```text
/auth                         Sign in, recovery
/                             Executive dashboard
/business/customers           List and customer workspace
/business/suppliers           List and supplier workspace
/business/quotations          List, create, detail
/business/sales-orders        List, create, detail
/inventory/products           List, create, product workspace
/inventory/stock              Stock by product/batch/location
/inventory/batches            Batch traceability workspace
/inventory/warehouses         Warehouse and location workspaces
/inventory/movements          Stock ledger
/inventory/transfers          Transfer workflow
/inventory/counts             Stock counts and adjustments
/inventory/expiry             Expiry management
/procurement/requests         Purchase request workflow
/procurement/orders           Purchase order workflow
/procurement/goods-receipts   Receiving and inspection
/imports/shipments            Imports, containers, clearing, landed cost
/exports/orders               Export orders and shipments
/factory                      Factory dashboard
/factory/plans                Plans and production orders
/factory/formulations         BOM/formulation workspace
/factory/materials            Requests, issues, consumption
/factory/quality-control      QC queue and inspection workspace
/factory/equipment            Equipment and maintenance
/sales/deliveries             Picking and delivery
/sales/invoices               Invoices, payments, returns, credit notes
/finance                      Revenue, expenses, receivables, payables
/documents                    Searchable document library
/reports                      Report catalog and exports
/notifications                Notification center
/administration/users         Staff and user access
/administration/roles         Roles and permission matrix
/administration/audit-log     Immutable activity history
/settings                     Configurable business rules and master data
```

## E. Sidebar Structure

- Dashboard
- Business: Customers, Suppliers, Quotations, Sales Orders
- Inventory: Products, Stock, Batches, Warehouses, Locations, Movements, Transfers, Adjustments, Expiry
- Procurement: Requests, Purchase Orders, Goods Receipts, Purchase History
- Import & Export: Imports, Shipments, Containers, Customs & Clearing, Export Orders, Documents
- Factory: Dashboard, Plans, Orders, Raw Materials, Formulations, Work in Progress, Finished Goods, QC, Equipment, Maintenance
- Sales: Quotations, Orders, Deliveries, Invoices, Payments, Returns, Credit Notes
- Finance: Revenue, Expenses, Receivables, Payables, Balances, Profitability
- Documents, Reports, Staff & Users, Audit Log, Settings

The shell will include a collapsible grouped sidebar, command-style global search, breadcrumbs, page title, role-aware quick actions, notifications, and user profile controls. Mobile uses an off-canvas navigation while preserving critical actions.

## F. Roles and Permission Model

- Seed editable roles: Super Administrator, CEO/Director, Operations Manager, Warehouse Manager/Officer, Production Manager/Officer, QC Officer, Sales Manager/Officer, Procurement Officer, Finance Officer, Maintenance Officer, Auditor, Viewer.
- Store roles separately from user profiles. Permissions are action-level records such as `inventory.view`, `stock_transfer.approve`, `purchase_order.approve`, `qc_batch.release`, and `financial_reports.view`.
- Enforce permissions server-side and through row-level database policies; hidden controls are only a UX reflection of authorization.
- Apply optional warehouse scope through `user_warehouse_access`.
- Super Administrator manages configuration and access; Auditor receives read-only operational and audit access; Viewer receives explicitly granted read-only modules.
- Sensitive fields such as costs, margins, customer balances, and supplier balances receive distinct permissions.

## G. TLB Design Token System

- Official brand anchors: TLB Purple `#523784`, TLB Gold `#F9CD5B`; implementation values will be centralized as semantic OKLCH tokens.
- Visual ratio: approximately 80% neutral surfaces, 15% purple emphasis, 5% controlled gold accents.
- Purple: primary actions, active navigation, key chart series, focus hierarchy.
- Gold: selective executive emphasis, premium dividers/highlights, never a generic warning color.
- Semantic status families remain consistent: green success/passed, amber warning/pending, red danger/failed/overdue, blue information/in-progress, gray draft/inactive.
- Dense corporate layout with restrained 6–8px radii, subtle borders/shadows, tabular numerals, clear table headers, strong keyboard focus, and no decorative gradients/glass effects.
- Typography will use a mature, highly legible sans-serif system unless the missing brand guide specifies an exact family.
- All page styling consumes semantic tokens; raw brand colors will not be scattered through components.

## H. Logo Implementation

- Use the uploaded transparent `Tlb_Transparent_Logo-02.png` without redrawing, recoloring, distortion, rotation, or effects.
- Store it through the project asset pipeline and use it in the expanded sidebar and authentication surface.
- Create a proportionally padded 64×64 favicon derived from the same uploaded mark and replace the default favicon.
- Maintain clear space, use `object-contain`, and preserve its original aspect ratio at every breakpoint.

## I–M. Core Workflows

### Warehouse
Goods receipt / production receipt → inspection state → batch/location assignment → available or quarantined stock → reservation/issue/transfer → receiving confirmation → auditable movement ledger. Transfers follow Draft → Requested → Approved → Dispatched → In Transit → Received → Completed and never credit destination stock early.

### Procurement and imports
Purchase Request → Approval → Purchase Order → Supplier Confirmation → Shipment → Goods Receipt → Inspection → Inventory. Imported orders additionally track vessel/container/port/clearing and allocate freight, insurance, customs, duties, clearing, port, transport, and other costs into landed unit cost.

### Factory and production
Production Plan → Production Order → material availability check → Material Request → Warehouse Approval → batch-specific Material Issue → Production → Actual Consumption and Waste → QC → Finished Goods Batch → Warehouse Receipt. Planned versus actual variance and shortages remain visible.

### Sales
Quotation → Sales Order → Credit/Stock Check → Batch Reservation → Pick List → Dispatch → Delivery → Invoice → Payment or Balance. Batch traceability remains navigable from customer delivery back to source supplier/production.

### Customer and payment
Customer workspace combines contacts, addresses, quotations, orders, deliveries, invoices, payments, outstanding balance, credit exposure, notes, documents, and related activity. Payments allocate explicitly to invoices; partial and outstanding states are preserved.

## N. Development Roadmap

1. **Foundation:** Cloud backend, design tokens, logo/favicon, authentication, protected shell, responsive navigation, user/role/permission/settings foundations, audit infrastructure, and executive dashboard shell.
2. **Inventory:** Products, chemical details, categories, warehouses/locations, batches, transaction ledger, transfers, stock counts, expiry.
3. **Supply:** Suppliers, procurement, goods receiving, imports, containers, landed cost.
4. **Commercial:** Customers/CRM, quotations, sales orders, reservations, picking, deliveries, invoices, payments.
5. **Manufacturing:** Factory, BOMs, production, material issues/consumption, finished goods, QC.
6. **Extended operations:** Exports, equipment, maintenance, document management.
7. **Intelligence:** Finance, reports, notifications, executive analytics, exports.
8. **Integration:** Secure synchronization with the existing public commerce platform.

Each phase will include responsive UI, authorization, validation, realistic demo fixtures, audit coverage, loading/error/empty states, and focused workflow tests.

## O. Assumptions and Configurability

- The uploaded PNG is the approved highest-quality logo currently available.
- The separate DOCX brand guide was not included in the uploads; exact supporting colors, font family, minimum logo size, and spacing rules will be configurable/refined if that document is supplied.
- Ghana cedi is the primary display currency; multi-currency procurement/import records remain supported.
- Dates display as `DD MMM YYYY`; quantities retain their unit; financial values use two decimal places.
- Demo data is visibly labeled and isolated from production data.
- Approval thresholds, QC release rules, credit limits, FEFO enforcement, tax rules, numbering formats, and warehouse restrictions are configurable rather than assumed.
- Desktop is primary, but all critical workflows remain accessible on tablet/mobile.

## Phase 1 Acceptance Criteria

- `/` no longer shows the template placeholder and instead renders a branded, responsive executive workspace.
- Official logo appears proportionally in the shell and as the favicon.
- Global search, grouped navigation, collapse/mobile behavior, date/warehouse filters, notifications, profile menu, quick actions, and dashboard drill-down controls function in the prototype.
- The dashboard shows realistic TLB demo metrics, sales trend, operational status, recent orders, imports/production, stock alerts, and receivables without rainbow styling or oversized cards.
- Authentication and protected data are powered by Lovable Cloud; roles are stored separately and enforced server-side.
- Every content route has specific metadata; the app passes build, lint, responsive visual checks, keyboard checks, and browser smoke tests.