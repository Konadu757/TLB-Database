import { ageingBand, calcAvailable, calcOutstanding, daysBetween, stockKey, buildStockMap } from "./calculations";
import type {
  AppNotification,
  OutstandingRow,
  RelatedRecord,
  TlbState,
} from "./types";

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/** Build related document chain for an order (clickable nav sources). */
export function getRelatedRecords(state: TlbState, orderId: string): RelatedRecord[] {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return [];
  const out: RelatedRecord[] = [];
  const customer = state.customers.find((c) => c.id === order.customerId);
  if (customer) {
    out.push({
      kind: "customer",
      id: customer.id,
      number: customer.code,
      label: customer.name,
    });
  }
  out.push({
    kind: "order",
    id: order.id,
    number: order.number,
    label: order.customerPoNumber ? `PO ${order.customerPoNumber}` : "Customer order",
    status: order.status,
  });
  for (const s of state.supplies.filter((x) => x.orderId === orderId)) {
    out.push({ kind: "supply", id: s.id, number: s.number, label: "Fulfilment / supply" });
  }
  for (const r of state.reservations.filter((x) => {
    const line = state.orderLines.find((l) => l.id === x.orderLineId);
    return line?.orderId === orderId && !x.releasedAt;
  })) {
    out.push({
      kind: "reservation",
      id: r.id,
      number: `RSV-${r.id.slice(-6)}`,
      label: `Reserved ${r.quantity}`,
      status: r.expiresAt ? `Expires ${r.expiresAt.slice(0, 10)}` : "Active",
    });
  }
  for (const inv of state.invoices.filter((x) => x.orderId === orderId)) {
    out.push({
      kind: "invoice",
      id: inv.id,
      number: inv.number,
      label: "VAT invoice",
      status: inv.paymentStatus,
    });
  }
  for (const rct of state.receipts.filter((x) => x.orderId === orderId)) {
    out.push({ kind: "receipt", id: rct.id, number: rct.number, label: "Ordinary receipt" });
  }
  for (const d of state.deliveries.filter((x) => x.orderId === orderId)) {
    out.push({
      kind: "delivery",
      id: d.id,
      number: d.number,
      label: "Delivery",
      status: d.status,
    });
  }
  for (const p of state.payments.filter((x) => x.orderId === orderId)) {
    out.push({ kind: "payment", id: p.id, number: p.number, label: "Payment" });
  }
  return out;
}

/**
 * Refresh operational notifications. Dedupes by dedupeKey — does not spam duplicates.
 * Returns next notifications array (caller merges into state).
 */
export function buildNotifications(
  state: TlbState,
  asOf = new Date().toISOString(),
  outstanding: OutstandingRow[],
): AppNotification[] {
  const existing = new Map(state.notifications.map((n) => [n.dedupeKey, n]));
  const next: AppNotification[] = [...state.notifications];

  const ensure = (partial: {
    type: AppNotification["type"];
    title: string;
    body: string;
    dedupeKey: string;
    orderId?: string;
    productId?: string;
    createdAt?: string;
  }) => {
    const prior = existing.get(partial.dedupeKey);
    if (prior) return;
    const n: AppNotification = {
      id: uid("ntf"),
      createdAt: partial.createdAt ?? asOf,
      type: partial.type,
      title: partial.title,
      body: partial.body,
      dedupeKey: partial.dedupeKey,
      ...(partial.orderId ? { orderId: partial.orderId } : {}),
      ...(partial.productId ? { productId: partial.productId } : {}),
    };
    existing.set(n.dedupeKey, n);
    next.unshift(n);
  };

  for (const order of state.orders) {
    if (order.status === "Partially Supplied") {
      ensure({
        type: "partially_supplied",
        title: `${order.number} partially supplied`,
        body: "Outstanding quantities remain — open the order to continue fulfilment.",
        orderId: order.id,
        dedupeKey: `partial:${order.id}`,
      });
    }

    if (order.requiredDate && !["Delivered", "Cancelled", "Fully Supplied", "Draft"].includes(order.status)) {
      const today = asOf.slice(0, 10);
      const required = order.requiredDate;
      if (today === required) {
        ensure({
          type: "expected_date_reached",
          title: `${order.number} expected date reached`,
          body: `Required date ${required} is today.`,
          orderId: order.id,
          dedupeKey: `expected_reached:${order.id}:${required}`,
        });
      } else if (today < required) {
        const daysTo = daysBetween(asOf, `${required}T23:59:59.000Z`);
        if (daysTo > 0 && daysTo <= state.ageing.expectedApproachingDays) {
          ensure({
            type: "expected_date_approaching",
            title: `${order.number} expected date approaching`,
            body: `Required ${required} · ${daysTo} day(s) left.`,
            orderId: order.id,
            dedupeKey: `expected_near:${order.id}:${required}`,
          });
        }
      } else {
        const daysPast = daysBetween(`${required}T00:00:00.000Z`, asOf);
        ensure({
          type: "overdue",
          title: `${order.number} past expected date`,
          body: `Required ${required} · ${daysPast} day(s) overdue.`,
          orderId: order.id,
          dedupeKey: `expected_overdue:${order.id}:${required}`,
        });
      }
    }

    const age = daysBetween(order.confirmedAt ?? order.orderDate, asOf);
    if (
      age >= state.ageing.extendedUnfulfilledDays &&
      ["Awaiting Stock", "Partially Supplied", "Ready for Supply", "Confirmed"].includes(order.status)
    ) {
      ensure({
        type: "extended_unfulfilled",
        title: `${order.number} extended unfulfilled`,
        body: `Open for ${age} days without full supply.`,
        orderId: order.id,
        dedupeKey: `extended:${order.id}`,
      });
    }
  }

  const stockMap = buildStockMap(state.stock);
  const byProduct = new Map<string, OutstandingRow[]>();
  for (const row of outstanding) {
    const list = byProduct.get(row.productId) ?? [];
    list.push(row);
    byProduct.set(row.productId, list);
  }
  for (const [productId, rows] of byProduct) {
    const product = state.products.find((p) => p.id === productId);
    const anyCovered = rows.some((r) => {
      const bal = stockMap.get(stockKey(r.productId, r.warehouseId));
      const available = bal ? calcAvailable(bal) : 0;
      return available > 0 && r.outstandingQty > 0;
    });
    if (anyCovered) {
      ensure({
        type: "stock_available",
        title: `Stock available for outstanding ${product?.sku ?? productId}`,
        body: `${rows.length} outstanding line(s) can progress.`,
        productId,
        dedupeKey: `stock_avail:${productId}`,
        ...(rows[0]?.orderId ? { orderId: rows[0].orderId } : {}),
      });
    }
  }

  for (const row of outstanding) {
    if (row.ageingBand === "Overdue") {
      ensure({
        type: "overdue",
        title: `${row.orderNumber} overdue outstanding`,
        body: `${row.productSku} · ${row.outstandingQty} · ${row.ageDays}d`,
        orderId: row.orderId,
        productId: row.productId,
        dedupeKey: `line_overdue:${row.lineId}`,
      });
    }
  }

  // Cap
  if (next.length > 200) next.length = 200;
  return next;
}

export function markNotificationRead(state: TlbState, id: string): AppNotification[] {
  return state.notifications.map((n) =>
    n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n,
  );
}

export { calcOutstanding, ageingBand };
