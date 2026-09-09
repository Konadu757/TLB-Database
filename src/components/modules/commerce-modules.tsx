import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, PackageSearch, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { calcAvailable, calcOutstanding, statusTone } from "@/lib/domain/calculations";
import type {
  Customer,
  CustomerCategory,
  CustomerPurchaseOrder,
  PaymentTerms,
} from "@/lib/domain/types";
import { getRelatedRecords } from "@/lib/domain/notifications";
import { globalSearch } from "@/lib/domain/search";
import {
  countOutstandingOrdersForProduct,
  formatMoney,
  orderFulfilment,
  orderValue,
} from "@/lib/store/tlb-store";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

function creditEligibility(customer: Customer): { label: string; tone: string } {
  if (!customer.active) return { label: "Inactive — no credit", tone: "warning" };
  if (customer.paymentTerms === "COD" || customer.creditLimit <= 0) {
    return { label: "Not credit eligible", tone: "warning" };
  }
  return { label: "Credit eligible", tone: "success" };
}

function StatusBadge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="tlb-empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function Flash({ error, notice, onClear }: { error: string | null; notice: string | null; onClear: () => void }) {
  if (!error && !notice) return null;
  return (
    <div className={`tlb-flash ${error ? "tlb-flash-error" : "tlb-flash-ok"}`} role="status">
      <span>{error ?? notice}</span>
      <button type="button" aria-label="Dismiss" onClick={onClear}>
        <X />
      </button>
    </div>
  );
}

const CATEGORIES: CustomerCategory[] = [
  "Hospital",
  "Laboratory",
  "Distributor",
  "Industrial",
  "Educational",
  "Other",
];
const TERMS: PaymentTerms[] = ["COD", "Net 7", "Net 15", "Net 30", "Net 45", "Net 60"];

type NavSetter = (label: string) => void;

export function CustomersModule({
  store,
  onOpenOrder,
  selectedCustomerId,
}: {
  store: TlbStoreApi;
  onOpenOrder: (orderId: string) => void;
  selectedCustomerId?: string | null;
}) {
  const { state } = store;
  const detailRef = useRef<HTMLElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    selectedCustomerId ?? state.customers[0]?.id ?? null,
  );
  const [editing, setEditing] = useState(false);
  const selected = state.customers.find((c) => c.id === selectedId) ?? null;

  const [form, setForm] = useState({
    name: "",
    category: "Laboratory" as CustomerCategory,
    contactName: "",
    phone: "",
    email: "",
    address: "",
    tin: "",
    creditLimit: 100000,
    paymentTerms: "Net 30" as PaymentTerms,
    notes: "",
    active: true,
  });

  useEffect(() => {
    if (selectedCustomerId) {
      setSelectedId(selectedCustomerId);
      setEditing(false);
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    if (selectedId && !state.customers.some((c) => c.id === selectedId)) {
      setSelectedId(state.customers[0]?.id ?? null);
    }
  }, [state.customers, selectedId]);

  const selectCustomer = (id: string) => {
    setSelectedId(id);
    setEditing(false);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const startCreate = () => {
    setEditing(true);
    setSelectedId(null);
    setForm({
      name: "",
      category: "Laboratory",
      contactName: "",
      phone: "",
      email: "",
      address: "",
      tin: "",
      creditLimit: 100000,
      paymentTerms: "Net 30",
      notes: "",
      active: true,
    });
  };

  const startEdit = (customer: Customer) => {
    setSelectedId(customer.id);
    setEditing(true);
    setForm({
      name: customer.name,
      category: customer.category,
      contactName: customer.contactName,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      tin: customer.tin ?? "",
      creditLimit: customer.creditLimit,
      paymentTerms: customer.paymentTerms,
      notes: customer.notes ?? "",
      active: customer.active,
    });
  };

  const customerHistory = useMemo(() => {
    if (!selected) {
      return {
        orders: [] as Array<{ order: CustomerPurchaseOrder; value: number; fulfilment: number }>,
        supplies: [] as Array<{ id: string; number: string; orderNumber: string; suppliedAt: string; notes?: string }>,
        outstanding: [] as typeof store.outstanding,
        invoices: [] as typeof state.invoices,
        receipts: [] as typeof state.receipts,
        deliveries: [] as typeof state.deliveries,
        payments: [] as typeof state.payments,
      };
    }

    const orders = state.orders
      .filter((o) => o.customerId === selected.id)
      .map((o) => ({
        order: o,
        value: orderValue(state, o.id),
        fulfilment: orderFulfilment(state, o.id),
      }));
    const orderById = new Map(state.orders.map((o) => [o.id, o]));
    const orderIds = new Set(orders.map((o) => o.order.id));
    const supplies = state.supplies
      .filter((s) => orderIds.has(s.orderId))
      .map((s) => ({
        id: s.id,
        number: s.number,
        orderNumber: orderById.get(s.orderId)?.number ?? s.orderId,
        suppliedAt: s.suppliedAt,
        ...(s.notes ? { notes: s.notes } : {}),
      }));
    const outstanding = store.outstanding.filter((r) => r.customerId === selected.id);
    const invoices = (state.invoices ?? []).filter((i) => i.customerId === selected.id);
    const receipts = (state.receipts ?? []).filter((r) => r.customerId === selected.id);
    const deliveries = (state.deliveries ?? []).filter((d) => d.customerId === selected.id);
    const payments = (state.payments ?? []).filter((p) => p.customerId === selected.id);

    return { orders, supplies, outstanding, invoices, receipts, deliveries, payments };
  }, [selected, state, store.outstanding]);

  const credit = selected ? creditEligibility(selected) : null;

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Business</span>
          <strong>Customers</strong>
        </div>
        <Button type="button" onClick={startCreate}>
          <Plus /> New customer
        </Button>
      </div>

      <div className="tlb-split">
        <article className="tlb-panel tlb-orders-panel">
          <div className="tlb-table-scroll">
            {state.customers.length === 0 ? (
              <EmptyState title="No customers" detail="Create a customer account to begin trading." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Customer</th>
                    <th>Category</th>
                    <th>Terms</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.customers.map((c) => (
                    <tr
                      key={c.id}
                      className={`tlb-row-clickable${selectedId === c.id && !editing ? " tlb-row-active" : ""}`}
                      tabIndex={0}
                      aria-selected={selectedId === c.id && !editing}
                      onClick={() => selectCustomer(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectCustomer(c.id);
                        }
                      }}
                    >
                      <td>
                        <strong>{c.code}</strong>
                      </td>
                      <td>
                        {c.name}
                        <div className="tlb-muted-line">{c.contactName || "—"}</div>
                      </td>
                      <td>{c.category}</td>
                      <td>{c.paymentTerms}</td>
                      <td>
                        <StatusBadge tone={c.active ? "success" : "warning"}>{c.active ? "Active" : "Inactive"}</StatusBadge>
                      </td>
                      <td>
                        <button
                          type="button"
                          aria-label={`View ${c.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            selectCustomer(c.id);
                          }}
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

        <article className="tlb-panel tlb-detail-panel" ref={detailRef} key={selectedId ?? "new"}>
          {editing ? (
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                const ok = store.saveCustomer({
                  ...(selectedId ? { id: selectedId } : {}),
                  name: form.name,
                  category: form.category,
                  contactName: form.contactName,
                  phone: form.phone,
                  email: form.email,
                  address: form.address,
                  creditLimit: form.creditLimit,
                  paymentTerms: form.paymentTerms,
                  active: form.active,
                  ...(form.tin.trim() ? { tin: form.tin.trim() } : {}),
                  ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
                });
                if (ok) setEditing(false);
              }}
            >
              <div className="tlb-panel-heading">
                <div>
                  <span>Customer record</span>
                  <strong>{selectedId ? "Edit customer" : "New customer"}</strong>
                </div>
                <button type="button" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
              <label>
                Name
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Category
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CustomerCategory })}>
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Contact
                <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
              </label>
              <label>
                Phone
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
              <label>
                Email
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
              <label>
                TIN (optional)
                <input value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })} />
              </label>
              <label className="tlb-span-2">
                Address
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </label>
              <label>
                Credit limit
                <input
                  type="number"
                  min={0}
                  value={form.creditLimit}
                  onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) })}
                />
              </label>
              <label>
                Payment terms
                <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value as PaymentTerms })}>
                  {TERMS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="tlb-span-2">
                Notes
                <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>
              <label className="tlb-check">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Active
              </label>
              <div className="tlb-form-actions tlb-span-2">
                <Button type="submit">Save customer</Button>
              </div>
            </form>
          ) : selected ? (
            <>
              <div className="tlb-panel-heading">
                <div>
                  <span>{selected.code}</span>
                  <strong>{selected.name}</strong>
                </div>
                <button type="button" onClick={() => startEdit(selected)}>
                  Edit <ChevronRight />
                </button>
              </div>
              <dl className="tlb-kv">
                <div><dt>Company / name</dt><dd>{selected.name}</dd></div>
                <div><dt>Category</dt><dd>{selected.category}</dd></div>
                <div><dt>Contact person</dt><dd>{selected.contactName || "—"}</dd></div>
                <div><dt>Phone</dt><dd>{selected.phone || "—"}</dd></div>
                <div><dt>Email</dt><dd>{selected.email || "—"}</dd></div>
                <div><dt>Address</dt><dd>{selected.address || "—"}</dd></div>
                <div><dt>TIN</dt><dd>{selected.tin || "—"}</dd></div>
                <div>
                  <dt>Credit status</dt>
                  <dd>{credit ? <StatusBadge tone={credit.tone}>{credit.label}</StatusBadge> : "—"}</dd>
                </div>
                <div><dt>Credit limit</dt><dd>{formatMoney(selected.creditLimit)}</dd></div>
                <div><dt>Payment terms</dt><dd>{selected.paymentTerms}</dd></div>
                <div>
                  <dt>Account status</dt>
                  <dd>
                    <StatusBadge tone={selected.active ? "success" : "warning"}>
                      {selected.active ? "Active" : "Inactive"}
                    </StatusBadge>
                  </dd>
                </div>
                <div className="tlb-span-2"><dt>Notes</dt><dd>{selected.notes || "—"}</dd></div>
              </dl>

              <div className="tlb-subheading">Orders / purchase orders</div>
              {customerHistory.orders.length === 0 ? (
                <EmptyState title="No orders for this customer yet." detail="Customer purchase orders will appear here." />
              ) : (
                <div className="tlb-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Customer PO</th>
                        <th>Value</th>
                        <th>Fulfilment</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {customerHistory.orders.map(({ order, value, fulfilment }) => (
                        <tr key={order.id}>
                          <td><strong>{order.number}</strong></td>
                          <td>{order.customerPoNumber || "—"}</td>
                          <td>{formatMoney(value)}</td>
                          <td>{fulfilment}%</td>
                          <td><StatusBadge tone={statusTone(order.status)}>{order.status}</StatusBadge></td>
                          <td>
                            <button type="button" onClick={() => onOpenOrder(order.id)} aria-label={`Open ${order.number}`}>
                              <ChevronRight />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="tlb-subheading">Partial supplies</div>
              {customerHistory.supplies.length === 0 ? (
                <EmptyState title="No supplies for this customer yet." detail="Posted partial or full supplies against orders will list here." />
              ) : (
                <div className="tlb-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Supply</th>
                        <th>Order</th>
                        <th>Posted</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerHistory.supplies.map((s) => (
                        <tr key={s.id}>
                          <td><strong>{s.number}</strong></td>
                          <td>{s.orderNumber}</td>
                          <td>{new Date(s.suppliedAt).toLocaleString()}</td>
                          <td>{s.notes || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="tlb-subheading">Outstanding items</div>
              {customerHistory.outstanding.length === 0 ? (
                <EmptyState title="No outstanding items for this customer." detail="Open ordered quantities that still need supply appear here." />
              ) : (
                <div className="tlb-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Product</th>
                        <th>Outstanding</th>
                        <th>Age</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {customerHistory.outstanding.map((row) => (
                        <tr key={row.lineId}>
                          <td><strong>{row.orderNumber}</strong></td>
                          <td>{row.productName}</td>
                          <td>{row.outstandingQty}</td>
                          <td>
                            <StatusBadge tone={statusTone(row.ageingBand)}>{row.ageingBand} · {row.ageDays}d</StatusBadge>
                          </td>
                          <td>
                            <button type="button" onClick={() => onOpenOrder(row.orderId)} aria-label={`Open ${row.orderNumber}`}>
                              <ChevronRight />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="tlb-subheading">Invoices</div>
              {customerHistory.invoices.length === 0 ? (
                <EmptyState title="No invoices for this customer yet." detail="Invoices created from supplies will appear here." />
              ) : (
                <div className="tlb-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Total</th>
                        <th>Paid</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerHistory.invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td><strong>{inv.number}</strong></td>
                          <td>{formatMoney(inv.total)}</td>
                          <td>{formatMoney(inv.amountPaid)}</td>
                          <td><StatusBadge tone={statusTone(inv.paymentStatus)}>{inv.paymentStatus}</StatusBadge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="tlb-subheading">Receipts</div>
              {customerHistory.receipts.length === 0 ? (
                <EmptyState title="No receipts for this customer yet." detail="Payment receipts will appear here." />
              ) : (
                <div className="tlb-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Receipt</th>
                        <th>Method</th>
                        <th>Amount</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerHistory.receipts.map((r) => (
                        <tr key={r.id}>
                          <td><strong>{r.number}</strong></td>
                          <td>{r.paymentMethod}</td>
                          <td>{formatMoney(r.amountPaid)}</td>
                          <td>{new Date(r.receiptDate).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="tlb-subheading">Deliveries</div>
              {customerHistory.deliveries.length === 0 ? (
                <EmptyState title="No deliveries for this customer yet." detail="Dispatch records linked to this customer will appear here." />
              ) : (
                <div className="tlb-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Delivery</th>
                        <th>Method</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerHistory.deliveries.map((d) => (
                        <tr key={d.id}>
                          <td><strong>{d.number}</strong></td>
                          <td>{d.method}</td>
                          <td><StatusBadge tone={statusTone(d.status)}>{d.status}</StatusBadge></td>
                          <td>{new Date(d.deliveryDate).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="tlb-subheading">Payments</div>
              {customerHistory.payments.length === 0 ? (
                <EmptyState title="No payments for this customer yet." detail="Recorded payments will appear here." />
              ) : (
                <div className="tlb-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Payment</th>
                        <th>Method</th>
                        <th>Amount</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerHistory.payments.map((p) => (
                        <tr key={p.id}>
                          <td><strong>{p.number}</strong></td>
                          <td>{p.method}</td>
                          <td>{formatMoney(p.amount)}</td>
                          <td>{new Date(p.paymentDate).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <EmptyState title="Select a customer" detail="Choose a row or create a new customer account." />
          )}
        </article>
      </div>
    </div>
  );
}

export function SalesOrdersModule({
  store,
  selectedOrderId,
  onSelectOrder,
  onNavigateRelated,
}: {
  store: TlbStoreApi;
  selectedOrderId: string | null;
  onSelectOrder: (id: string | null) => void;
  onNavigateRelated?: (nav: string, id?: string) => void;
}) {
  const { state } = store;
  const [creating, setCreating] = useState(false);
  const [customerId, setCustomerId] = useState(state.customers[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [customerPoNumber, setCustomerPoNumber] = useState("");
  const [draftLines, setDraftLines] = useState([
    { productId: state.products[0]?.id ?? "", warehouseId: state.warehouses[0]?.id ?? "", orderedQty: 1, unitPrice: 1000 },
  ]);

  if (selectedOrderId) {
    return (
      <OrderDetailModule
        store={store}
        orderId={selectedOrderId}
        onBack={() => onSelectOrder(null)}
        {...(onNavigateRelated ? { onNavigateRelated } : {})}
      />
    );
  }

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Business · Customer purchase orders</span>
          <strong>Sales Orders</strong>
        </div>
        <div className="tlb-toolbar-actions">
          <Button type="button" variant="outline" onClick={store.resetDemo}>
            Reset Phase 30 demo
          </Button>
          <Button type="button" onClick={() => setCreating((v) => !v)}>
            <Plus /> New order
          </Button>
        </div>
      </div>

      {creating && (
        <article className="tlb-panel tlb-form-panel">
          <div className="tlb-panel-heading">
            <div>
              <span>Customer purchase order</span>
              <strong>Create order</strong>
            </div>
            <button type="button" onClick={() => setCreating(false)}>Close</button>
          </div>
          <form
            className="tlb-form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const ok = store.createOrder({
                customerId,
                lines: draftLines.map((l) => ({
                  ...l,
                  orderedQty: Number(l.orderedQty),
                  unitPrice: Number(l.unitPrice),
                })),
                ...(notes.trim() ? { notes: notes.trim() } : {}),
                ...(customerPoNumber.trim() ? { customerPoNumber: customerPoNumber.trim() } : {}),
              });
              if (ok) {
                setCreating(false);
                setNotes("");
                setCustomerPoNumber("");
              }
            }}
          >
            <label>
              Customer
              <select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                {state.customers.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label>
              Customer PO #
              <input value={customerPoNumber} onChange={(e) => setCustomerPoNumber(e.target.value)} placeholder="Optional" />
            </label>
            <label className="tlb-span-2">
              Notes
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="tlb-span-2 tlb-subheading">Line items</div>
            {draftLines.map((line, index) => (
              <div className="tlb-line-editor tlb-span-2" key={index}>
                <label>
                  Product
                  <select
                    value={line.productId}
                    onChange={(e) => {
                      const next = [...draftLines];
                      next[index] = { ...line, productId: e.target.value };
                      setDraftLines(next);
                    }}
                  >
                    {state.products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                    ))}
                  </select>
                </label>
                <label>
                  Warehouse
                  <select
                    value={line.warehouseId}
                    onChange={(e) => {
                      const next = [...draftLines];
                      next[index] = { ...line, warehouseId: e.target.value };
                      setDraftLines(next);
                    }}
                  >
                    {state.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Qty
                  <input
                    type="number"
                    min={1}
                    value={line.orderedQty}
                    onChange={(e) => {
                      const next = [...draftLines];
                      next[index] = { ...line, orderedQty: Number(e.target.value) };
                      setDraftLines(next);
                    }}
                  />
                </label>
                <label>
                  Unit price
                  <input
                    type="number"
                    min={0}
                    value={line.unitPrice}
                    onChange={(e) => {
                      const next = [...draftLines];
                      next[index] = { ...line, unitPrice: Number(e.target.value) };
                      setDraftLines(next);
                    }}
                  />
                </label>
              </div>
            ))}
            <div className="tlb-form-actions tlb-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setDraftLines([
                    ...draftLines,
                    {
                      productId: state.products[0]?.id ?? "",
                      warehouseId: state.warehouses[0]?.id ?? "",
                      orderedQty: 1,
                      unitPrice: 1000,
                    },
                  ])
                }
              >
                Add line
              </Button>
              <Button type="submit">Create draft order</Button>
            </div>
          </form>
        </article>
      )}

      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-table-scroll">
          {state.orders.length === 0 ? (
            <EmptyState title="No customer orders" detail="Create a customer purchase order to start fulfilment." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Value</th>
                  <th>Fulfilment</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.orders.map((order) => {
                  const customer = state.customers.find((c) => c.id === order.customerId);
                  return (
                    <tr key={order.id}>
                      <td><strong>{order.number}</strong></td>
                      <td>{customer?.name ?? "—"}</td>
                      <td>{formatMoney(orderValue(state, order.id))}</td>
                      <td>{orderFulfilment(state, order.id)}%</td>
                      <td><StatusBadge tone={statusTone(order.status)}>{order.status}</StatusBadge></td>
                      <td>
                        <button type="button" aria-label={`Open ${order.number}`} onClick={() => onSelectOrder(order.id)}>
                          <ChevronRight />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </article>
    </div>
  );
}

function OrderDetailModule({
  store,
  orderId,
  onBack,
  onNavigateRelated,
}: {
  store: TlbStoreApi;
  orderId: string;
  onBack: () => void;
  onNavigateRelated?: (nav: string, id?: string) => void;
}) {
  const { state } = store;
  const order = state.orders.find((o) => o.id === orderId);
  const [supplyQty, setSupplyQty] = useState<Record<string, number>>({});
  const [cancelReason, setCancelReason] = useState<Record<string, string>>({});
  const [supplyNotes, setSupplyNotes] = useState("");
  const related = useMemo(() => getRelatedRecords(state, orderId), [state, orderId]);

  if (!order) {
    return (
      <div className="tlb-module">
        <EmptyState title="Order not found" detail="The selected customer order is no longer available." />
        <Button type="button" onClick={onBack}>Back to orders</Button>
      </div>
    );
  }

  const customer = state.customers.find((c) => c.id === order.customerId);
  const lines = state.orderLines.filter((l) => l.orderId === order.id);
  const supplies = state.supplies.filter((s) => s.orderId === order.id);
  const audit = state.audit.filter(
    (a) =>
      a.entityId === order.id ||
      lines.some((l) => l.id === a.entityId) ||
      supplies.some((s) => s.id === a.entityId),
  );
  const fulfilment = orderFulfilment(state, order.id);

  const canSupply =
    order.status !== "Draft" &&
    order.status !== "Pending" &&
    order.status !== "Cancelled" &&
    order.status !== "Delivered" &&
    order.status !== "Fully Supplied";

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <button type="button" className="tlb-text-link" onClick={onBack}>
            ← Sales Orders
          </button>
          <strong>{order.number}</strong>
          <p className="tlb-muted-line">Customer purchase order · {customer?.name}</p>
        </div>
        <div className="tlb-toolbar-actions">
          {(order.status === "Draft" || order.status === "Pending") && (
            <Button type="button" onClick={() => store.confirmOrder(order.id)}>Confirm order</Button>
          )}
          {order.status === "Fully Supplied" && (
            <Button type="button" onClick={() => store.deliver(order.id)}>Mark delivered</Button>
          )}
          <StatusBadge tone={statusTone(order.status)}>{order.status}</StatusBadge>
        </div>
      </div>

      <section className="tlb-detail-sections">
        <article className="tlb-panel">
          <div className="tlb-panel-heading">
            <div><span>Header</span><strong>Order summary</strong></div>
          </div>
          <dl className="tlb-kv">
            <div><dt>Customer</dt><dd>{customer?.name}</dd></div>
            <div><dt>TIN</dt><dd>{customer?.tin || "—"}</dd></div>
            <div><dt>Customer PO #</dt><dd>{order.customerPoNumber || "—"}</dd></div>
            <div><dt>Order date</dt><dd>{new Date(order.orderDate).toLocaleString()}</dd></div>
            <div><dt>Required</dt><dd>{order.requiredDate ?? "—"}</dd></div>
            <div><dt>Value</dt><dd>{formatMoney(orderValue(state, order.id))}</dd></div>
            <div><dt>Created by</dt><dd>{order.createdBy}</dd></div>
            <div className="tlb-span-2"><dt>Notes</dt><dd>{order.notes || "—"}</dd></div>
          </dl>
        </article>

        <article className="tlb-panel">
          <div className="tlb-panel-heading">
            <div><span>Fulfilment overview</span><strong>{fulfilment}% supplied</strong></div>
          </div>
          <div className="tlb-progress tlb-progress-lg">
            <span className="bg-primary" style={{ width: `${fulfilment}%` }} />
          </div>
          <p className="tlb-muted-line" style={{ padding: "12px 17px" }}>
            Outstanding never drops silently — cancelled quantities require a reason and remain in audit history.
          </p>
        </article>

        <article className="tlb-panel tlb-orders-panel tlb-span-2">
          <div className="tlb-panel-heading">
            <div><span>Line items</span><strong>Ordered / supplied / outstanding</strong></div>
          </div>
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Warehouse</th>
                  <th>Ordered</th>
                  <th>Supplied</th>
                  <th>Cancelled</th>
                  <th>Outstanding</th>
                  <th>Reserved</th>
                  <th>Available</th>
                  <th>Status</th>
                  <th>Supply now</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const product = state.products.find((p) => p.id === line.productId);
                  const warehouse = state.warehouses.find((w) => w.id === line.warehouseId);
                  const bal = state.stock.find((s) => s.productId === line.productId && s.warehouseId === line.warehouseId);
                  const outstanding = calcOutstanding(line);
                  const available = bal ? calcAvailable(bal) : 0;
                  const usable = available + Math.min(line.reservedQty, outstanding);
                  return (
                    <tr key={line.id}>
                      <td>
                        <strong>{product?.name}</strong>
                        <div className="tlb-muted-line">{product?.sku}</div>
                      </td>
                      <td>{warehouse?.name}</td>
                      <td>{line.orderedQty}</td>
                      <td>{line.suppliedQty}</td>
                      <td>{line.cancelledQty}</td>
                      <td><strong>{outstanding}</strong></td>
                      <td>{line.reservedQty}</td>
                      <td>{available}</td>
                      <td><StatusBadge tone={statusTone(line.lineStatus)}>{line.lineStatus}</StatusBadge></td>
                      <td>
                        {canSupply && outstanding > 0 ? (
                          <input
                            className="tlb-qty-input"
                            type="number"
                            min={0}
                            max={Math.min(outstanding, usable)}
                            value={supplyQty[line.id] ?? Math.min(outstanding, usable)}
                            onChange={(e) => setSupplyQty({ ...supplyQty, [line.id]: Number(e.target.value) })}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canSupply && (
            <div className="tlb-inline-actions">
              <input
                placeholder="Supply notes (optional)"
                value={supplyNotes}
                onChange={(e) => setSupplyNotes(e.target.value)}
              />
              <Button
                type="button"
                onClick={() => {
                  const payload = lines
                    .map((line) => {
                      const outstanding = calcOutstanding(line);
                      if (outstanding <= 0) return null;
                      const bal = state.stock.find((s) => s.productId === line.productId && s.warehouseId === line.warehouseId);
                      const available = bal ? calcAvailable(bal) : 0;
                      const usable = available + Math.min(line.reservedQty, outstanding);
                      const qty = supplyQty[line.id] ?? Math.min(outstanding, usable);
                      if (!qty || qty <= 0) return null;
                      return { orderLineId: line.id, quantity: qty };
                    })
                    .filter(Boolean) as Array<{ orderLineId: string; quantity: number }>;
                  store.supply(order.id, payload, supplyNotes.trim() || undefined);
                }}
              >
                Post supply
              </Button>
            </div>
          )}

          <div className="tlb-subheading" style={{ padding: "0 17px" }}>Cancel outstanding (with reason)</div>
          <div className="tlb-cancel-grid">
            {lines.filter((l) => calcOutstanding(l) > 0).map((line) => {
              const product = state.products.find((p) => p.id === line.productId);
              return (
                <div key={line.id} className="tlb-cancel-row">
                  <span>{product?.name} · outstanding {calcOutstanding(line)}</span>
                  <input
                    placeholder="Reason required"
                    value={cancelReason[line.id] ?? ""}
                    onChange={(e) => setCancelReason({ ...cancelReason, [line.id]: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => store.cancelLine(line.id, cancelReason[line.id] ?? "")}
                  >
                    Cancel outstanding
                  </Button>
                </div>
              );
            })}
          </div>
        </article>

        <article className="tlb-panel tlb-orders-panel">
          <div className="tlb-panel-heading">
            <div><span>Supply history</span><strong>Immutable fulfilment records</strong></div>
          </div>
          {supplies.length === 0 ? (
            <EmptyState title="No supplies yet" detail="Partial and full supplies will remain listed here permanently." />
          ) : (
            <div className="tlb-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Supply #</th>
                    <th>When</th>
                    <th>By</th>
                    <th>Lines</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {supplies.map((supply) => {
                    const slines = state.supplyLines.filter((sl) => sl.supplyId === supply.id);
                    return (
                      <tr key={supply.id}>
                        <td><strong>{supply.number}</strong></td>
                        <td>{new Date(supply.suppliedAt).toLocaleString()}</td>
                        <td>{supply.suppliedBy}</td>
                        <td>
                          {slines.map((sl) => {
                            const product = state.products.find((p) => p.id === sl.productId);
                            return (
                              <div key={sl.id}>{product?.sku}: {sl.quantity}</div>
                            );
                          })}
                        </td>
                        <td>{supply.notes || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="tlb-panel">
          <div className="tlb-panel-heading">
            <div><span>Related records</span><strong>Document chain</strong></div>
          </div>
          <p className="tlb-muted-line" style={{ padding: "0 17px 8px" }}>
            Customer → Order → Supplies → Invoice / Receipt → Delivery → Complete
          </p>
          <ul className="tlb-inspector-list">
            {related.map((r) => {
              const nav =
                r.kind === "customer"
                  ? "Customers"
                  : r.kind === "invoice" || r.kind === "receipt" || r.kind === "payment"
                    ? "Finance"
                    : r.kind === "delivery"
                      ? "Deliveries"
                      : r.kind === "supply" || r.kind === "order" || r.kind === "reservation"
                        ? "Sales Orders"
                        : "Sales Orders";
              return (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    type="button"
                    className="tlb-text-link"
                    onClick={() => {
                      if (r.kind === "order" || r.kind === "supply" || r.kind === "reservation") {
                        onNavigateRelated?.(nav, order.id);
                      } else {
                        onNavigateRelated?.(nav, r.id);
                      }
                    }}
                  >
                    {r.number} — {r.label}
                    {r.status ? ` · ${r.status}` : ""}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="tlb-inline-actions" style={{ padding: 12, flexWrap: "wrap" }}>
            {store.can("invoice.create") && supplies[0] && (
              <Button type="button" variant="outline" onClick={() => onNavigateRelated?.("Finance", supplies[0]?.id)}>
                Create invoice
              </Button>
            )}
            {store.can("receipt.create") && (
              <Button type="button" variant="outline" onClick={() => onNavigateRelated?.("Finance")}>
                Create receipt
              </Button>
            )}
            {store.can("delivery.manage") && supplies[0] && (
              <Button type="button" variant="outline" onClick={() => onNavigateRelated?.("Deliveries", supplies[0]?.id)}>
                Create delivery
              </Button>
            )}
          </div>
        </article>

        <article className="tlb-panel tlb-orders-panel tlb-span-2">
          <div className="tlb-panel-heading">
            <div><span>Audit</span><strong>Major events for this order</strong></div>
          </div>
          {audit.length === 0 ? (
            <EmptyState title="No audit events" detail="Actions on this order will be recorded here." />
          ) : (
            <div className="tlb-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td>{new Date(a.at).toLocaleString()}</td>
                      <td>{a.actor}</td>
                      <td>{a.action}</td>
                      <td>{a.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}

export function OutstandingSuppliesModule({
  store,
  onOpenOrder,
  productFilterId,
}: {
  store: TlbStoreApi;
  onOpenOrder: (orderId: string) => void;
  productFilterId?: string | null;
}) {
  const [band, setBand] = useState<"All" | "Normal" | "Attention" | "Overdue">("All");
  const [sort, setSort] = useState<"age" | "qty" | "customer">("age");
  const [warehouseId, setWarehouseId] = useState("all");
  const [productId, setProductId] = useState(productFilterId ?? "all");

  useEffect(() => {
    if (productFilterId) setProductId(productFilterId);
  }, [productFilterId]);

  const rows = store.outstanding.filter((r) => {
    if (band !== "All" && r.ageingBand !== band) return false;
    if (warehouseId !== "all" && r.warehouseId !== warehouseId) return false;
    if (productId !== "all" && r.productId !== productId) return false;
    return true;
  });

  const sorted = [...rows].sort((a, b) => {
    if (sort === "qty") return b.outstandingQty - a.outstandingQty;
    if (sort === "customer") return a.customerName.localeCompare(b.customerName);
    return b.ageDays - a.ageDays;
  });

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Business</span>
          <strong>Outstanding Supplies</strong>
          <p className="tlb-muted-line">
            Ageing: 0–{store.state.ageing.normalMaxDays} Normal · {store.state.ageing.normalMaxDays + 1}–{store.state.ageing.attentionMaxDays} Attention · {store.state.ageing.attentionMaxDays + 1}+ Overdue
          </p>
        </div>
        <div className="tlb-inline-actions">
          <label className="tlb-select">
            Normal max days
            <input
              className="tlb-qty-input"
              type="number"
              min={0}
              value={store.state.ageing.normalMaxDays}
              onChange={(e) => store.setAgeing(Number(e.target.value), store.state.ageing.attentionMaxDays)}
              aria-label="Normal ageing max days"
            />
          </label>
          <label className="tlb-select">
            Attention max days
            <input
              className="tlb-qty-input"
              type="number"
              min={0}
              value={store.state.ageing.attentionMaxDays}
              onChange={(e) => store.setAgeing(store.state.ageing.normalMaxDays, Number(e.target.value))}
              aria-label="Attention ageing max days"
            />
          </label>
        </div>
      </div>

      <section className="tlb-filter-bar tlb-module-filters" aria-label="Outstanding filters">
        <div className="tlb-periods">
          {(["All", "Normal", "Attention", "Overdue"] as const).map((item) => (
            <button type="button" key={item} className={band === item ? "active" : ""} onClick={() => setBand(item)}>
              {item}
            </button>
          ))}
        </div>
        <label className="tlb-select">
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Warehouse filter">
            <option value="all">All warehouses</option>
            {store.state.warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>
        <label className="tlb-select">
          <select value={productId} onChange={(e) => setProductId(e.target.value)} aria-label="Product filter">
            <option value="all">All products</option>
            {store.state.products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="tlb-select">
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
            <option value="age">Sort by age</option>
            <option value="qty">Sort by outstanding qty</option>
            <option value="customer">Sort by customer</option>
          </select>
        </label>
      </section>

      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-table-scroll">
          {sorted.length === 0 ? (
            <EmptyState title="No outstanding lines" detail="All confirmed order quantities are fully supplied or cancelled." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Product</th>
                  <th>Warehouse</th>
                  <th>Outstanding</th>
                  <th>Available</th>
                  <th>Age</th>
                  <th>Band</th>
                  <th>Order status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.lineId}>
                    <td><strong>{row.orderNumber}</strong></td>
                    <td>{row.customerName}</td>
                    <td>{row.productName}<div className="tlb-muted-line">{row.productSku}</div></td>
                    <td>{row.warehouseName}</td>
                    <td><strong>{row.outstandingQty}</strong></td>
                    <td>{row.availableQty}</td>
                    <td>{row.ageDays}d</td>
                    <td><StatusBadge tone={statusTone(row.ageingBand)}>{row.ageingBand}</StatusBadge></td>
                    <td><StatusBadge tone={statusTone(row.orderStatus)}>{row.orderStatus}</StatusBadge></td>
                    <td>
                      <button type="button" aria-label={`Open ${row.orderNumber}`} onClick={() => onOpenOrder(row.orderId)}>
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
    </div>
  );
}

export function StockModule({
  store,
  onViewOutstanding,
}: {
  store: TlbStoreApi;
  onViewOutstanding: (productId?: string) => void;
}) {
  const { state } = store;
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Inventory</span>
          <strong>Stock</strong>
          <p className="tlb-muted-line">Available = physical − reserved</p>
        </div>
      </div>
      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Warehouse</th>
                <th>Physical</th>
                <th>Reserved</th>
                <th>Available</th>
                <th>Outstanding demand</th>
                <th>Receive</th>
              </tr>
            </thead>
            <tbody>
              {state.stock.map((bal) => {
                const product = state.products.find((p) => p.id === bal.productId);
                const warehouse = state.warehouses.find((w) => w.id === bal.warehouseId);
                const requiredBy = countOutstandingOrdersForProduct(state, bal.productId);
                const key = bal.id;
                return (
                  <tr key={bal.id}>
                    <td><strong>{product?.name}</strong><div className="tlb-muted-line">{product?.sku}</div></td>
                    <td>{warehouse?.name}</td>
                    <td>{bal.physicalQty}</td>
                    <td>{bal.reservedQty}</td>
                    <td><strong>{calcAvailable(bal)}</strong></td>
                    <td>
                      {requiredBy > 0 ? (
                        <button type="button" className="tlb-text-link" onClick={() => onViewOutstanding(bal.productId)}>
                          Required by {requiredBy} outstanding order{requiredBy === 1 ? "" : "s"}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <div className="tlb-inline-actions compact">
                        <input
                          className="tlb-qty-input"
                          type="number"
                          min={1}
                          value={receiveQty[key] ?? 2}
                          onChange={(e) => setReceiveQty({ ...receiveQty, [key]: Number(e.target.value) })}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => store.receive(bal.productId, bal.warehouseId, receiveQty[key] ?? 2)}
                        >
                          Receive
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export function OutstandingDashboardWidget({
  store,
  onOpen,
  dateFilter,
}: {
  store: TlbStoreApi;
  onOpen: () => void;
  dateFilter?: { from?: string; to?: string };
}) {
  const filtered = dateFilter
    ? store.outstanding.filter((r) => {
        const d = r.orderDate.slice(0, 10);
        if (dateFilter.from && d < dateFilter.from) return false;
        if (dateFilter.to && d > dateFilter.to) return false;
        return true;
      })
    : store.outstanding;
  const rows = filtered.slice(0, 5);
  const overdue = filtered.filter((r) => r.ageingBand === "Overdue").length;
  return (
    <article className="tlb-panel tlb-orders-panel">
      <div className="tlb-panel-heading">
        <div>
          <span>Outstanding customer supplies</span>
          <strong>{filtered.length} open line{filtered.length === 1 ? "" : "s"}</strong>
        </div>
        <button type="button" onClick={onOpen}>
          View all <ChevronRight />
        </button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="Caught up"
          detail={dateFilter ? "No outstanding lines in this period." : "No outstanding customer supply lines."}
        />
      ) : (
        <div className="tlb-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Age</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.lineId}>
                  <td><strong>{row.orderNumber}</strong></td>
                  <td>{row.productSku}</td>
                  <td>{row.outstandingQty}</td>
                  <td><StatusBadge tone={statusTone(row.ageingBand)}>{row.ageDays}d · {row.ageingBand}</StatusBadge></td>
                  <td>
                    <button type="button" onClick={onOpen} aria-label="Open outstanding supplies">
                      <ChevronRight />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {overdue > 0 && (
        <p className="tlb-muted-line" style={{ padding: "10px 15px" }}>
          {overdue} overdue line{overdue === 1 ? "" : "s"} need attention.
        </p>
      )}
    </article>
  );
}

export function LiveSearchResults({
  store,
  query,
  onOpenOrder,
  onOpenNav,
}: {
  store: TlbStoreApi;
  query: string;
  onOpenOrder: (id: string) => void;
  onOpenNav: (nav: string) => void;
}) {
  const q = query.trim();
  const hits = useMemo(() => globalSearch(store.state, q, 16), [q, store.state]);

  if (!q) {
    return (
      <>
        <p>QUICK ACCESS</p>
        {["Chemical A · CHEM-A", "TLB-ORD Phase 30 order", "Outstanding Supplies", "Invoices"].map((label) => (
          <button
            type="button"
            role="listitem"
            key={label}
            onClick={() => {
              if (label.includes("Outstanding")) onOpenNav("Outstanding Supplies");
              else if (label.includes("Invoice")) onOpenNav("Finance");
              else if (label.includes("ORD")) {
                const order = store.state.orders.find((o) => o.id === "ord-phase30");
                if (order) onOpenOrder(order.id);
                else onOpenNav("Sales Orders");
              } else onOpenNav("Stock");
            }}
          >
            <PackageSearch />
            <span>{label}</span>
            <ChevronRight />
          </button>
        ))}
      </>
    );
  }

  return (
    <>
      <p>{hits.length ? "RESULTS" : "NO MATCHES"}</p>
      {hits.map((hit) => (
        <button
          type="button"
          role="listitem"
          key={`${hit.kind}-${hit.id}`}
          onClick={() => {
            if (hit.orderId) onOpenOrder(hit.orderId);
            else onOpenNav(hit.nav);
          }}
        >
          <PackageSearch />
          <span>
            {hit.label}
            {hit.subtitle ? ` · ${hit.subtitle}` : ""}
          </span>
          <ChevronRight />
        </button>
      ))}
    </>
  );
}

export type { CustomerPurchaseOrder, NavSetter };
