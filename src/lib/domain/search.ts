import type { SearchHit, TlbState } from "./types";

/** Typed global search across customers, documents, products, warehouses, dates. */
export function globalSearch(state: TlbState, query: string, limit = 20): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];

  const push = (hit: SearchHit) => {
    if (hits.length >= limit) return;
    hits.push(hit);
  };

  for (const c of state.customers) {
    const blob = `${c.name} ${c.code} ${c.tin ?? ""} ${c.contactName} ${c.address}`.toLowerCase();
    if (blob.includes(q)) {
      push({
        kind: "Customer",
        id: c.id,
        label: `${c.code} — Customer`,
        subtitle: c.name,
        nav: "Customers",
      });
    }
  }

  for (const s of state.suppliers ?? []) {
    const blob = `${s.name} ${s.code} ${s.tin ?? ""} ${s.contactName} ${s.phone} ${s.email} ${s.category} ${s.address}`.toLowerCase();
    if (blob.includes(q)) {
      push({
        kind: "Supplier",
        id: s.id,
        label: `${s.code} — Supplier`,
        subtitle: s.name,
        nav: "Suppliers",
      });
    }
  }

  for (const o of state.orders) {
    const cust = state.customers.find((c) => c.id === o.customerId);
    const blob = `${o.number} ${o.customerPoNumber ?? ""} ${cust?.name ?? ""} ${o.orderDate} ${o.requiredDate ?? ""}`.toLowerCase();
    if (blob.includes(q) || o.number.toLowerCase().includes(q)) {
      push({
        kind: "Order",
        id: o.id,
        label: `${o.number} — Order`,
        subtitle: `${cust?.name ?? "—"} · ${o.status}`,
        nav: "Sales Orders",
        orderId: o.id,
      });
    }
  }

  for (const inv of state.invoices) {
    const blob = `${inv.number} ${inv.customerTin ?? ""} ${inv.customerPoNumber ?? ""} ${inv.invoiceDate}`.toLowerCase();
    if (blob.includes(q)) {
      push({
        kind: "Invoice",
        id: inv.id,
        label: `${inv.number} — Invoice`,
        subtitle: inv.paymentStatus,
        nav: "Finance",
        ...(inv.orderId ? { orderId: inv.orderId } : {}),
      });
    }
  }

  for (const r of state.receipts) {
    if (`${r.number} ${r.receiptDate}`.toLowerCase().includes(q)) {
      push({
        kind: "Receipt",
        id: r.id,
        label: `${r.number} — Receipt`,
        subtitle: `Paid ${r.amountPaid}`,
        nav: "Finance",
        ...(r.orderId ? { orderId: r.orderId } : {}),
      });
    }
  }

  for (const d of state.deliveries) {
    if (`${d.number} ${d.deliveryDate} ${d.driver ?? ""} ${d.vehicle ?? ""} ${d.address}`.toLowerCase().includes(q)) {
      push({
        kind: "Delivery",
        id: d.id,
        label: `${d.number} — Delivery`,
        subtitle: d.status,
        nav: "Deliveries",
        orderId: d.orderId,
      });
    }
  }

  for (const s of state.supplies) {
    if (s.number.toLowerCase().includes(q)) {
      push({
        kind: "Supply",
        id: s.id,
        label: `${s.number} — Supply`,
        nav: "Sales Orders",
        orderId: s.orderId,
      });
    }
  }

  for (const p of state.products) {
    if (`${p.name} ${p.sku}`.toLowerCase().includes(q)) {
      push({
        kind: "Product",
        id: p.id,
        label: `${p.sku} — Product`,
        subtitle: p.name,
        nav: "Products",
      });
    }
  }

  for (const w of state.warehouses) {
    if (`${w.name} ${w.code} ${w.location}`.toLowerCase().includes(q)) {
      push({
        kind: "Warehouse",
        id: w.id,
        label: `${w.code} — Warehouse`,
        subtitle: w.name,
        nav: "Warehouses",
      });
    }
  }

  for (const pay of state.payments) {
    if (`${pay.number} ${pay.reference ?? ""}`.toLowerCase().includes(q)) {
      push({
        kind: "Payment",
        id: pay.id,
        label: `${pay.number} — Payment`,
        nav: "Finance",
        ...(pay.orderId ? { orderId: pay.orderId } : {}),
      });
    }
  }

  return hits;
}
