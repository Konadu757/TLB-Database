import type { SearchHit, TlbState } from "./types";
import { isSoftDeleted } from "./trash";

/** Weighted field used for ranked matching. Higher weight wins ties. */
export type SearchField = {
  value: string;
  /** Relative importance — code/number/SKU > name > secondary. */
  weight: number;
};

/** Precomputed searchable document (memoize per store snapshot). */
export type SearchDocument = {
  kind: string;
  id: string;
  label: string;
  subtitle?: string;
  nav: string;
  orderId?: string;
  fields: SearchField[];
};

type RankedHit = SearchHit & { score: number };

const SCORE_EXACT = 1000;
const SCORE_PREFIX = 700;
const SCORE_TOKEN_PREFIX = 450;
const SCORE_CONTAINS = 200;

function norm(value: string | number | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function field(value: string | number | null | undefined, weight: number): SearchField | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  return { value: v, weight };
}

function fields(...parts: Array<SearchField | null | undefined>): SearchField[] {
  return parts.filter((p): p is SearchField => Boolean(p));
}

function nameMap(items: Array<{ id: string; name?: string; code?: string; sku?: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    map.set(item.id, item.name ?? item.code ?? item.sku ?? item.id);
  }
  return map;
}

/** Build a flat searchable index from the current domain snapshot. */
export function buildSearchIndex(state: TlbState): SearchDocument[] {
  const docs: SearchDocument[] = [];
  const customerNames = nameMap(state.customers);
  const supplierNames = nameMap(state.suppliers);
  const productNames = nameMap(state.products);
  const productSkus = new Map(state.products.map((p) => [p.id, p.sku] as const));
  const warehouseNames = nameMap(state.warehouses);
  const roleNames = new Map(state.roles.map((r) => [r.id, r.name] as const));

  const push = (doc: SearchDocument) => {
    docs.push(doc);
  };

  for (const c of state.customers) {
    if (isSoftDeleted(c)) continue;
    push({
      kind: "Customer",
      id: c.id,
      label: `${c.code} — Customer`,
      subtitle: c.name,
      nav: "Customers",
      fields: fields(
        field(c.code, 10),
        field(c.name, 9),
        field(c.tin, 9),
        field(c.contactName, 7),
        field(c.phone, 6),
        field(c.email, 6),
        field(c.category, 4),
        field(c.address, 3),
        field(c.notes, 2),
      ),
    });
  }

  for (const s of state.suppliers ?? []) {
    if (isSoftDeleted(s)) continue;
    push({
      kind: "Supplier",
      id: s.id,
      label: `${s.code} — Supplier`,
      subtitle: s.name,
      nav: "Suppliers",
      fields: fields(
        field(s.code, 10),
        field(s.name, 9),
        field(s.tin, 9),
        field(s.contactName, 7),
        field(s.phone, 6),
        field(s.email, 6),
        field(s.category, 4),
        field(s.address, 3),
        field(s.notes, 2),
      ),
    });
  }

  for (const p of state.products) {
    if (isSoftDeleted(p)) continue;
    push({
      kind: "Product",
      id: p.id,
      label: `${p.sku} — Product`,
      subtitle: p.name,
      nav: "Products",
      fields: fields(
        field(p.sku, 10),
        field(p.name, 9),
        field(p.category, 5),
        field(p.unit, 3),
      ),
    });
  }

  for (const w of state.warehouses) {
    if (isSoftDeleted(w)) continue;
    push({
      kind: "Warehouse",
      id: w.id,
      label: `${w.code} — Warehouse`,
      subtitle: w.name,
      nav: "Warehouses",
      fields: fields(field(w.code, 10), field(w.name, 9), field(w.location, 6)),
    });
  }

  for (const o of state.orders) {
    if (isSoftDeleted(o)) continue;
    const cust = customerNames.get(o.customerId) ?? "";
    push({
      kind: "Order",
      id: o.id,
      label: `${o.number} — Order`,
      subtitle: `${cust || "—"} · ${o.status}`,
      nav: "Sales Orders",
      orderId: o.id,
      fields: fields(
        field(o.number, 10),
        field(o.customerPoNumber, 10),
        field(cust, 7),
        field(o.status, 4),
        field(o.orderDate, 3),
        field(o.requiredDate, 3),
        field(o.orderSource, 3),
        field(o.notes, 2),
        field(o.createdBy, 2),
      ),
    });
  }

  for (const inv of state.invoices) {
    if (isSoftDeleted(inv)) continue;
    const cust = customerNames.get(inv.customerId) ?? "";
    push({
      kind: "Invoice",
      id: inv.id,
      label: `${inv.number} — Invoice`,
      subtitle: `${cust || inv.paymentStatus} · ${inv.paymentStatus}`,
      nav: "Invoices",
      ...(inv.orderId ? { orderId: inv.orderId } : {}),
      fields: fields(
        field(inv.number, 10),
        field(inv.customerTin, 9),
        field(inv.customerPoNumber, 9),
        field(cust, 7),
        field(inv.paymentStatus, 4),
        field(inv.invoiceDate, 3),
        field(inv.preparedBy, 5),
        field(inv.notes, 2),
      ),
    });
  }

  for (const r of state.receipts) {
    if (isSoftDeleted(r)) continue;
    const cust = customerNames.get(r.customerId) ?? "";
    push({
      kind: "Receipt",
      id: r.id,
      label: `${r.number} — Receipt`,
      subtitle: `${cust || "Paid"} · ${r.amountPaid}`,
      nav: "Receipts",
      ...(r.orderId ? { orderId: r.orderId } : {}),
      fields: fields(
        field(r.number, 10),
        field(cust, 7),
        field(r.paymentMethod, 4),
        field(r.receiptDate, 3),
        field(r.processedBy, 5),
        field(r.notes, 2),
      ),
    });
  }

  for (const pay of state.payments) {
    if (isSoftDeleted(pay)) continue;
    const cust = customerNames.get(pay.customerId) ?? "";
    push({
      kind: "Payment",
      id: pay.id,
      label: `${pay.number} — Payment`,
      subtitle: `${cust || pay.method} · ${pay.amount}`,
      nav: "Finance",
      ...(pay.orderId ? { orderId: pay.orderId } : {}),
      fields: fields(
        field(pay.number, 10),
        field(pay.reference, 9),
        field(cust, 7),
        field(pay.method, 4),
        field(pay.recordedBy, 5),
        field(pay.notes, 2),
      ),
    });
  }

  for (const d of state.deliveries) {
    if (isSoftDeleted(d)) continue;
    const cust = customerNames.get(d.customerId) ?? "";
    push({
      kind: "Delivery",
      id: d.id,
      label: `${d.number} — Delivery`,
      subtitle: `${cust || d.status} · ${d.status}`,
      nav: "Deliveries",
      orderId: d.orderId,
      fields: fields(
        field(d.number, 10),
        field(cust, 7),
        field(d.driver, 7),
        field(d.vehicle, 6),
        field(d.receiverName, 6),
        field(d.receiverContact, 5),
        field(d.address, 4),
        field(d.status, 4),
        field(d.method, 3),
        field(d.createdBy, 3),
        field(d.confirmedBy, 3),
      ),
    });
  }

  for (const r of state.opsRequests ?? []) {
    if (r.deletedAt) continue;
    push({
      kind: "Ops Request",
      id: r.id,
      label: `${r.number} — Ops Request`,
      subtitle: `${r.title} · ${r.status}`,
      nav: "Requests",
      fields: fields(
        field(r.number, 10),
        field(r.title, 8),
        field(r.driverName, 8),
        field(r.vehicle, 7),
        field(r.destination, 6),
        field(r.status, 5),
        field(r.priority, 5),
        field(r.type, 4),
        field(r.requestedBy, 4),
        field(r.stockIssueNumber, 6),
      ),
    });
  }

  for (const drv of state.opsDrivers ?? []) {
    if (!drv.active || drv.deletedAt) continue;
    push({
      kind: "Driver",
      id: drv.id,
      label: `${drv.code} — Driver`,
      subtitle: `${drv.name}${drv.vehicle ? ` · ${drv.vehicle}` : ""}`,
      nav: "Drivers",
      fields: fields(
        field(drv.code, 10),
        field(drv.name, 9),
        field(drv.phone, 7),
        field(drv.vehicle, 8),
      ),
    });
  }

  for (const s of state.supplies) {
    if (isSoftDeleted(s)) continue;
    push({
      kind: "Supply",
      id: s.id,
      label: `${s.number} — Supply`,
      subtitle: s.suppliedAt?.slice?.(0, 10) ?? s.suppliedAt,
      nav: "Sales Orders",
      orderId: s.orderId,
      fields: fields(field(s.number, 10), field(s.suppliedAt, 3), field(s.suppliedBy, 5), field(s.notes, 2)),
    });
  }

  for (const q of state.quotations ?? []) {
    push({
      kind: "Quotation",
      id: q.id,
      label: `${q.number} — Quotation`,
      subtitle: `${q.customerName} · ${q.status}`,
      nav: "Quotations",
      fields: fields(
        field(q.number, 10),
        field(q.customerName, 8),
        field(q.contact, 6),
        field(q.itemLabel, 7),
        field(q.status, 4),
        field(q.preparedBy, 5),
        field(q.notes, 2),
      ),
    });
  }

  for (const b of state.batches ?? []) {
    const product = productNames.get(b.productId) ?? "";
    const sku = productSkus.get(b.productId) ?? "";
    push({
      kind: "Batch",
      id: b.id,
      label: `${b.code} — Batch`,
      subtitle: `${sku || product} · ${b.status}`,
      nav: "Batches",
      fields: fields(
        field(b.code, 10),
        field(sku, 8),
        field(product, 7),
        field(b.status, 4),
        field(b.notes, 2),
        field(b.expiresAt, 3),
      ),
    });
  }

  for (const g of state.goodsReceipts ?? []) {
    if (isSoftDeleted(g)) continue;    const supplier = supplierNames.get(g.supplierId) ?? "";
    push({
      kind: "GRN",
      id: g.id,
      label: `${g.number} — GRN`,
      subtitle: `${supplier || "Goods In"} · ${g.status}`,
      nav: "Goods In",
      fields: fields(
        field(g.number, 10),
        field(supplier, 7),
        field(g.status, 4),
        field(g.receivedBy, 6),
        field(g.checkedBy, 5),
        field(g.approvedBy, 5),
        field(g.documentRefs, 5),
        field(g.notes, 2),
      ),
    });
  }

  for (const t of state.transfers ?? []) {
    const from = warehouseNames.get(t.fromWarehouseId) ?? "";
    const to = warehouseNames.get(t.toWarehouseId) ?? "";
    push({
      kind: "Transfer",
      id: t.id,
      label: `${t.number} — Transfer`,
      subtitle: `${from} → ${to} · ${t.status}`,
      nav: "Transfers",
      fields: fields(
        field(t.number, 10),
        field(from, 6),
        field(to, 6),
        field(t.status, 4),
        field(t.requestedBy, 5),
        field(t.receivedBy, 5),
        field(t.notes, 2),
      ),
    });
  }

  for (const issue of state.stockIssues ?? []) {
    const wh = warehouseNames.get(issue.warehouseId) ?? "";
    push({
      kind: "Goods Out",
      id: issue.id,
      label: `${issue.number} — Goods Out`,
      subtitle: `${issue.reason} · ${wh}`,
      nav: "Goods Out",
      ...(issue.orderId ? { orderId: issue.orderId } : {}),
      fields: fields(
        field(issue.number, 10),
        field(issue.reason, 6),
        field(wh, 5),
        field(issue.issuedBy, 6),
        field(issue.notes, 2),
      ),
    });
  }

  for (const adj of state.adjustments ?? []) {
    push({
      kind: "Adjustment",
      id: adj.id,
      label: `${adj.number} — Adjustment`,
      subtitle: adj.status,
      nav: "Adjustments",
      fields: fields(
        field(adj.number, 10),
        field(adj.status, 4),
        field(adj.kind, 4),
        field(adj.createdBy, 5),
        field(adj.notes, 2),
      ),
    });
  }

  for (const m of state.stockMovements ?? []) {
    const product = productNames.get(m.productId) ?? "";
    const sku = productSkus.get(m.productId) ?? "";
    push({
      kind: "Movement",
      id: m.id,
      label: `${m.number} — Stock Movement`,
      subtitle: `${sku || product} · ${m.type}`,
      nav: "Stock Movements",
      fields: fields(
        field(m.number, 10),
        field(sku, 8),
        field(product, 6),
        field(m.type, 5),
        field(m.refNumber, 7),
        field(m.actor, 5),
        field(m.reason, 3),
        field(m.notes, 2),
      ),
    });
  }

  for (const po of state.supplierPurchaseOrders ?? []) {
    const supplier = supplierNames.get(po.supplierId) ?? "";
    push({
      kind: "Supplier PO",
      id: po.id,
      label: `${po.number} — Supplier PO`,
      subtitle: `${supplier || "—"} · ${po.status}`,
      nav: "Procurement",
      fields: fields(
        field(po.number, 10),
        field(supplier, 7),
        field(po.status, 4),
        field(po.notes, 2),
      ),
    });
  }

  for (const sr of state.supplierReceipts ?? []) {
    const supplier = supplierNames.get(sr.supplierId) ?? "";
    push({
      kind: "Supplier Receipt",
      id: sr.id,
      label: `${sr.number} — Supplier Receipt`,
      subtitle: supplier || sr.receivedAt?.slice?.(0, 10),
      nav: "Procurement",
      fields: fields(field(sr.number, 10), field(supplier, 7), field(sr.notes, 2)),
    });
  }

  for (const sp of state.supplierPayments ?? []) {
    const supplier = supplierNames.get(sp.supplierId) ?? "";
    push({
      kind: "Supplier Payment",
      id: sp.id,
      label: `${sp.number} — Supplier Payment`,
      subtitle: `${supplier || sp.method} · ${sp.amount}`,
      nav: "Accounts Payable",
      fields: fields(
        field(sp.number, 10),
        field(supplier, 7),
        field(sp.method, 4),
        field(sp.notes, 2),
      ),
    });
  }

  for (const n of state.nonPoPurchases ?? []) {
    if (isSoftDeleted(n)) continue;
    const supplier = supplierNames.get(n.supplierId) ?? "";
    push({
      kind: "Non-PO Purchase",
      id: n.id,
      label: `${n.number} — Non-PO Purchase`,
      subtitle: `${supplier || "—"} · ${n.status}`,
      nav: "Non-PO Purchases",
      fields: fields(
        field(n.number, 10),
        field(supplier, 7),
        field(n.status, 4),
        field(n.requestedBy, 5),
        field(n.notes, 2),
      ),
    });
  }

  for (const ship of state.importShipments ?? []) {
    if (isSoftDeleted(ship)) continue;
    const supplier = supplierNames.get(ship.supplierId) ?? "";
    push({
      kind: "Import",
      id: ship.id,
      label: `${ship.number} — Import Shipment`,
      subtitle: `${supplier || ship.originCountry} · ${ship.status}`,
      nav: "Import & Export",
      fields: fields(
        field(ship.number, 10),
        field(supplier, 7),
        field(ship.originCountry, 6),
        field(ship.containerRef, 8),
        field(ship.shippingLine, 5),
        field(ship.status, 4),
        field(ship.createdBy, 5),
        field(ship.notes, 2),
        field(ship.customsDocs, 3),
      ),
    });
  }

  for (const ship of state.exportShipments ?? []) {
    if (isSoftDeleted(ship)) continue;
    const cust = customerNames.get(ship.customerId) ?? "";
    push({
      kind: "Export",
      id: ship.id,
      label: `${ship.number} — Export Shipment`,
      subtitle: `${cust || ship.destinationCountry} · ${ship.status}`,
      nav: "Import & Export",
      fields: fields(
        field(ship.number, 10),
        field(cust, 7),
        field(ship.destinationCountry, 6),
        field(ship.carrier, 5),
        field(ship.docsRef, 7),
        field(ship.staffName, 8),
        field(ship.status, 4),
        field(ship.notes, 2),
      ),
    });
  }

  for (const ret of state.customerReturns ?? []) {
    if (isSoftDeleted(ret)) continue;
    const cust = customerNames.get(ret.customerId) ?? "";
    push({
      kind: "Customer Return",
      id: ret.id,
      label: `${ret.number} — Customer Return`,
      subtitle: `${cust || "—"} · ${ret.status}`,
      nav: "Returns",
      fields: fields(
        field(ret.number, 10),
        field(cust, 7),
        field(ret.status, 4),
        field(ret.receivedBy, 5),
        field(ret.reason, 5),
        field(ret.notes, 2),
      ),
    });
  }

  for (const ret of state.supplierReturns ?? []) {
    if (isSoftDeleted(ret)) continue;
    const supplier = supplierNames.get(ret.supplierId) ?? "";
    push({
      kind: "Supplier Return",
      id: ret.id,
      label: `${ret.number} — Supplier Return`,
      subtitle: `${supplier || "—"} · ${ret.status}`,
      nav: "Returns",
      fields: fields(
        field(ret.number, 10),
        field(supplier, 7),
        field(ret.status, 4),
        field(ret.notes, 2),
      ),
    });
  }

  for (const u of state.users ?? []) {
    if (!u.active) continue;
    const role = roleNames.get(u.roleId) ?? "";
    push({
      kind: "Staff",
      id: u.id,
      label: `${u.name} — Staff`,
      subtitle: `${role || u.email}`,
      nav: "Settings",
      fields: fields(field(u.name, 10), field(u.email, 8), field(role, 5)),
    });
  }

  if (state.company?.legalName || state.company?.tin) {
    push({
      kind: "Company",
      id: "company-profile",
      label: `${state.company.tradingName || state.company.legalName} — Company`,
      subtitle: state.company.tin ? `TIN ${state.company.tin}` : state.company.address,
      nav: "Settings",
      fields: fields(
        field(state.company.legalName, 8),
        field(state.company.tradingName, 8),
        field(state.company.tin, 10),
        field(state.company.phone, 5),
        field(state.company.email, 5),
        field(state.company.address, 3),
      ),
    });
  }

  return docs;
}

function bestFieldScore(query: string, docFields: SearchField[]): number {
  let best = 0;
  for (const f of docFields) {
    const value = norm(f.value);
    if (!value) continue;

    let base = 0;
    if (value === query) base = SCORE_EXACT;
    else if (value.startsWith(query)) base = SCORE_PREFIX;
    else {
      const tokens = value.split(/[^a-z0-9]+/).filter(Boolean);
      if (tokens.some((t) => t.startsWith(query))) base = SCORE_TOKEN_PREFIX;
      else if (value.includes(query)) base = SCORE_CONTAINS;
    }

    if (base <= 0) continue;
    const score = base * f.weight;
    if (score > best) best = score;
  }
  return best;
}

/** Ranked search over a memoized index. */
export function searchDocuments(docs: SearchDocument[], query: string, limit = 20): SearchHit[] {
  const q = norm(query);
  if (!q) return [];

  const ranked: RankedHit[] = [];
  for (const doc of docs) {
    const score = bestFieldScore(q, doc.fields);
    if (score <= 0) continue;
    ranked.push({
      kind: doc.kind,
      id: doc.id,
      label: doc.label,
      ...(doc.subtitle ? { subtitle: doc.subtitle } : {}),
      nav: doc.nav,
      ...(doc.orderId ? { orderId: doc.orderId } : {}),
      score,
    });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.label.localeCompare(b.label);
  });

  return ranked.slice(0, limit).map(({ score: _score, ...hit }) => hit);
}

/** Typed global search across customers, documents, products, warehouses, staff, shipments. */
export function globalSearch(state: TlbState, query: string, limit = 20): SearchHit[] {
  return searchDocuments(buildSearchIndex(state), query, limit);
}
