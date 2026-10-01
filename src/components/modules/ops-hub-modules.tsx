/**
 * Communication Hub UI — Request → Approval → Warehouse → Dispatch → Driver → Delivery.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";

import {
  BulkTrashToolbar,
  SelectAllHeader,
  SelectRowCell,
  useListSelection,
} from "@/components/modules/list-bulk-trash";
import { MoveToTrashButton } from "@/components/modules/move-to-trash-button";
import {
  DetailBackChrome,
  EmptyState,
  RecordDetailPage,
  RecordDetailSection,
  StatusBadge,
  filterByPeriodDate,
  matchesSearch,
} from "@/components/modules/record-browser";
import { Button } from "@/components/ui/button";
import { statusTone } from "@/lib/domain/calculations";
import {
  buildMyOpsActions,
  listOutstandingOpsRows,
  opsDiscrepancyMissing,
  opsKanbanColumns,
  opsOutstandingShortage,
  opsStatusTone,
  warehouseAvailabilityForProduct,
} from "@/lib/domain/ops-hub";
import type { DateRange } from "@/lib/domain/period-range";
import { isSoftDeleted } from "@/lib/domain/trash";
import type {
  OpsDriverJobStatus,
  OpsMessageChip,
  OpsReceiptOutcome,
  OpsRequest,
  OpsRequestPriority,
  TlbState,
  OpsRequestType,
  OpsWarehouseAvailability,
} from "@/lib/domain/types";
import { findDriverBlockingAssignment, listDriverTodayJobs } from "@/lib/store/ops-hub-store";
import { trashBlockReason } from "@/lib/store/tlb-store";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

function Flash({
  error,
  notice,
  onClear,
}: {
  error: string | null;
  notice: string | null;
  onClear: () => void;
}) {
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

const OPS_TYPES: OpsRequestType[] = [
  "Factory Draw",
  "Internal Use",
  "Customer Supply",
  "Sample",
  "Emergency Top-up",
  "Transfer Prep",
  "Other",
];
const OPS_PRIORITIES: OpsRequestPriority[] = ["Low", "Normal", "High", "Critical"];
const MESSAGE_CHIPS: OpsMessageChip[] = [
  "Need clarification",
  "Ready to collect",
  "Delay expected",
  "Stock confirmed",
  "Urgent",
  "Partial OK",
  "Problem reported",
];
const AVAIL_STATUSES: OpsWarehouseAvailability[] = [
  "Available",
  "Partial",
  "Out of Stock",
  "Clarification",
];
const RECEIPT_OUTCOMES: OpsReceiptOutcome[] = [
  "Full",
  "Partial",
  "Damaged",
  "Wrong",
  "Missing",
  "Rejected",
];

type ModuleProps = {
  store: TlbStoreApi;
  focusId?: string | null;
  onFocusConsumed?: () => void;
  onOpenRequest?: (id: string) => void;
  range?: DateRange | null;
  periodLabel?: string;
};

type DraftLine = { productId: string; quantity: number; notes?: string };

function productLabel(store: TlbStoreApi, productId: string) {
  const p = store.state.products.find((x) => x.id === productId);
  return p ? `${p.sku} · ${p.name}` : productId;
}

function liveOpsRequests(store: TlbStoreApi) {
  return (store.state.opsRequests ?? []).filter((r) => !r.deletedAt);
}

function linesFor(store: TlbStoreApi, requestId: string) {
  return (store.state.opsRequestLines ?? []).filter((l) => l.requestId === requestId);
}

function nextDriverAction(status: OpsDriverJobStatus | undefined): {
  label: string;
  to: OpsDriverJobStatus;
} | null {
  switch (status) {
    case undefined:
    case "Assigned":
      return { label: "En route WH", to: "En Route Warehouse" };
    case "En Route Warehouse":
      return { label: "Arrived", to: "Arrived Warehouse" };
    case "Arrived Warehouse":
      return { label: "Collect", to: "Collected" };
    case "Collected":
      return { label: "Depart", to: "Departed" };
    case "Departed":
      return { label: "Arrive dest", to: "Arrived Destination" };
    case "Arrived Destination":
      return { label: "Confirm delivery", to: "Delivered" };
    default:
      return null;
  }
}

function ModuleSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="tlb-module-search">
      <Search aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </label>
  );
}

/* ─── Shared request detail ─── */

export function OpsRequestDetail({
  store,
  request,
  onBack,
  backLabel = "Requests",
}: {
  store: TlbStoreApi;
  request: OpsRequest;
  onBack: () => void;
  backLabel?: string;
}) {
  const { state } = store;
  const lines = linesFor(store, request.id);
  const messages = (state.opsMessages ?? []).filter(
    (m) => m.requestId === request.id && !m.deletedAt,
  );
  const activity = (state.opsActivity ?? []).filter((a) => a.requestId === request.id);
  const custody = (state.opsCustody ?? []).filter((c) => c.requestId === request.id);
  const discrepancies = (state.opsDiscrepancies ?? []).filter(
    (d) => d.requestId === request.id && !d.deletedAt,
  );
  const requestTrashBlock = trashBlockReason(state, "ops_request", request.id);

  const [approvalNote, setApprovalNote] = useState("");
  const [lineApprovals, setLineApprovals] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.approvedQty || l.requestedQty - l.cancelledQty])),
  );
  const [prepQtys, setPrepQtys] = useState<Record<string, number>>({});
  const [receiptLines, setReceiptLines] = useState<
    Record<
      string,
      {
        receivedQty: number;
        missingQty: number;
        damagedQty: number;
        wrongQty: number;
        rejectedQty: number;
      }
    >
  >(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.id,
        {
          receivedQty: l.receivedQty || l.issuedQty,
          missingQty: l.missingQty,
          damagedQty: l.damagedQty,
          wrongQty: l.wrongQty,
          rejectedQty: l.rejectedQty,
        },
      ]),
    ),
  );
  const [receiptOutcome, setReceiptOutcome] = useState<OpsReceiptOutcome>(
    request.receiptOutcome ?? "Full",
  );
  const [receivedBy, setReceivedBy] = useState(request.receivedBy ?? state.currentUser);
  const [receiptNotes, setReceiptNotes] = useState(request.receiptNotes ?? "");
  const [driverId, setDriverId] = useState(
    request.driverId ?? state.opsDrivers.find((d) => d.active && !d.deletedAt)?.id ?? "",
  );
  const [vehicle, setVehicle] = useState(request.vehicle ?? "");
  const [chatBody, setChatBody] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftForm, setDraftForm] = useState({
    title: request.title,
    destination: request.destination,
    priority: request.priority,
    priorityReason: request.priorityReason ?? "",
    notes: request.notes ?? "",
    neededBy: request.neededBy ?? "",
  });
  const [reviewNotes, setReviewNotes] = useState<
    Record<string, { availability: OpsWarehouseAvailability; note: string; wh: string }>
  >(() =>
    Object.fromEntries(
      lines.map((l) => [
        l.id,
        {
          availability: l.availability ?? "Available",
          note: l.availabilityNote ?? "",
          wh: l.fulfilWarehouseId ?? l.warehouseId,
        },
      ]),
    ),
  );

  useEffect(() => {
    setLineApprovals(
      Object.fromEntries(
        lines.map((l) => [l.id, l.approvedQty || l.requestedQty - l.cancelledQty]),
      ),
    );
    setPrepQtys(Object.fromEntries(lines.map((l) => [l.id, l.preparedQty || l.approvedQty])));
    setReceiptLines(
      Object.fromEntries(
        lines.map((l) => [
          l.id,
          {
            receivedQty: l.receivedQty || l.issuedQty,
            missingQty: l.missingQty,
            damagedQty: l.damagedQty,
            wrongQty: l.wrongQty,
            rejectedQty: l.rejectedQty,
          },
        ]),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when request/lines change identity
  }, [request.id, request.status, request.updatedAt]);

  const canApprove = store.can("ops.approve") || store.can("approvals.manage");
  const canWarehouse = store.can("ops.warehouse") || store.can("stock.issue");
  const canDispatch = store.can("ops.dispatch") || store.can("ops.warehouse");
  const canReceive = store.can("ops.receive") || store.can("ops.request");
  const canChat = store.can("ops.communicate") || store.can("ops.view");

  const showApproval =
    canApprove &&
    ["Pending Approval", "Partially Approved", "Acknowledged", "Submitted"].includes(
      request.status,
    );
  const showWarehouse =
    canWarehouse &&
    [
      "Approved",
      "Partially Approved",
      "Warehouse Review",
      "Preparing",
      "Ready for Collection",
    ].includes(request.status);
  const showReceipt =
    canReceive &&
    (["In Transit", "Collected", "Issued", "Partially Delivered"].includes(request.status) ||
      request.driverStatus === "Arrived Destination");

  return (
    <RecordDetailPage
      backLabel={backLabel}
      onBack={onBack}
      code={request.number}
      title={request.title}
      subtitle={`${request.type} · ${request.destination}`}
      badges={
        <>
          <StatusBadge tone={opsStatusTone(request.status)}>{request.status}</StatusBadge>
          <StatusBadge tone={opsStatusTone(request.priority)}>{request.priority}</StatusBadge>
          {request.driverStatus ? (
            <StatusBadge tone={opsStatusTone(request.driverStatus)}>
              {request.driverStatus}
            </StatusBadge>
          ) : null}
        </>
      }
      flash={<Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />}
      actions={
        <div className="tlb-inline-actions">
          {request.status === "Draft" && (store.can("ops.request") || store.can("ops.view")) ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraftForm({
                  title: request.title,
                  destination: request.destination,
                  priority: request.priority,
                  priorityReason: request.priorityReason ?? "",
                  notes: request.notes ?? "",
                  neededBy: request.neededBy ?? "",
                });
                setEditingDraft(true);
              }}
            >
              Edit draft
            </Button>
          ) : null}
          {request.status === "Draft" ? (
            <Button type="button" onClick={() => store.submitOpsRequest(request.id)}>
              Submit
            </Button>
          ) : null}
          {(request.status === "Submitted" || request.status === "Pending Approval") &&
          !request.acknowledgedAt &&
          canApprove ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => store.acknowledgeOpsRequest(request.id)}
            >
              Acknowledge
            </Button>
          ) : null}
          {!["Cancelled", "Rejected", "Closed", "Delivered"].includes(request.status) ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const reason = cancelReason.trim() || window.prompt("Cancel reason") || "";
                if (reason) store.cancelOpsRequest(request.id, reason);
              }}
            >
              Cancel
            </Button>
          ) : null}
          <MoveToTrashButton
            store={store}
            entityType="ops_request"
            entityId={request.id}
            recordLabel={request.number}
            disabled={Boolean(requestTrashBlock)}
            disabledReason={requestTrashBlock ?? undefined}
            onTrashed={onBack}
          />
        </div>
      }
    >
      {editingDraft && request.status === "Draft" ? (
        <article className="tlb-panel tlb-form-panel tlb-span-2">
          <form
            className="tlb-form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const ok = store.updateOpsDraft(request.id, {
                title: draftForm.title,
                destination: draftForm.destination,
                priority: draftForm.priority,
                priorityReason: draftForm.priorityReason || undefined,
                notes: draftForm.notes || undefined,
                neededBy: draftForm.neededBy || undefined,
              });
              if (ok) setEditingDraft(false);
            }}
          >
            <div className="tlb-panel-heading">
              <div>
                <span>{request.number}</span>
                <strong>Edit draft request</strong>
              </div>
              <button type="button" onClick={() => setEditingDraft(false)}>
                Cancel
              </button>
            </div>
            <label className="tlb-span-2">
              Title
              <input
                required
                value={draftForm.title}
                onChange={(e) => setDraftForm((f) => ({ ...f, title: e.target.value }))}
              />
            </label>
            <label className="tlb-span-2">
              Destination
              <input
                required
                value={draftForm.destination}
                onChange={(e) => setDraftForm((f) => ({ ...f, destination: e.target.value }))}
              />
            </label>
            <label>
              Priority
              <select
                value={draftForm.priority}
                onChange={(e) =>
                  setDraftForm((f) => ({
                    ...f,
                    priority: e.target.value as typeof draftForm.priority,
                  }))
                }
              >
                <option value="Low">Low</option>
                <option value="Normal">Normal</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </label>
            <label>
              Needed by
              <input
                type="date"
                value={draftForm.neededBy.slice(0, 10)}
                onChange={(e) => setDraftForm((f) => ({ ...f, neededBy: e.target.value }))}
              />
            </label>
            <label className="tlb-span-2">
              Priority reason
              <input
                value={draftForm.priorityReason}
                onChange={(e) => setDraftForm((f) => ({ ...f, priorityReason: e.target.value }))}
                placeholder="Required for Critical"
              />
            </label>
            <label className="tlb-span-2">
              Notes
              <input
                value={draftForm.notes}
                onChange={(e) => setDraftForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
            <div className="tlb-form-actions tlb-span-2">
              <Button type="submit">Save draft</Button>
            </div>
          </form>
        </article>
      ) : null}
      <RecordDetailSection tone="summary" kicker="Overview" title="Request summary" span2>
        <div className="tlb-customer-summary">
          <div className="tlb-customer-summary-tile--info">
            <span>Requested by</span>
            <strong>{request.requestedBy}</strong>
          </div>
          <div className="tlb-customer-summary-tile--gold">
            <span>Needed by</span>
            <strong>{request.neededBy?.slice(0, 10) ?? "—"}</strong>
          </div>
          <div>
            <span>Lines</span>
            <strong>{lines.length}</strong>
          </div>
          <div className="tlb-customer-summary-tile--success">
            <span>Response</span>
            <strong>
              {request.responseMinutes != null ? `${request.responseMinutes} min` : "—"}
            </strong>
          </div>
        </div>
        <dl className="tlb-kv" style={{ marginTop: 12 }}>
          <div>
            <dt>Requested</dt>
            <dd>{new Date(request.requestedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Priority reason</dt>
            <dd>{request.priorityReason || "—"}</dd>
          </div>
          <div className="tlb-span-2">
            <dt>Notes</dt>
            <dd>{request.notes || "—"}</dd>
          </div>
          {request.stockIssueNumber ? (
            <div>
              <dt>Stock issue</dt>
              <dd>{request.stockIssueNumber}</dd>
            </div>
          ) : null}
          {request.driverName ? (
            <div>
              <dt>Driver</dt>
              <dd>
                {request.driverName}
                {request.vehicle ? ` · ${request.vehicle}` : ""}
              </dd>
            </div>
          ) : null}
        </dl>
      </RecordDetailSection>

      <RecordDetailSection tone="lines" kicker="Lines" title="Requested quantities" span2>
        <div className="tlb-table-scroll tlb-orders-panel">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Requested</th>
                <th>Approved</th>
                <th>Prepared</th>
                <th>Issued</th>
                <th>Received</th>
                <th>Shortage</th>
                <th>Missing</th>
                <th>Availability</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const shortage = opsOutstandingShortage(line);
                const missing = opsDiscrepancyMissing(line);
                return (
                  <tr key={line.id}>
                    <td>
                      <strong>{productLabel(store, line.productId)}</strong>
                      {line.notes ? <div className="tlb-muted-line">{line.notes}</div> : null}
                    </td>
                    <td>{line.requestedQty}</td>
                    <td>{line.approvedQty}</td>
                    <td>{line.preparedQty}</td>
                    <td>{line.issuedQty}</td>
                    <td>{line.receivedQty}</td>
                    <td>
                      {shortage > 0 ? <StatusBadge tone="warning">{shortage}</StatusBadge> : 0}
                    </td>
                    <td>{missing > 0 ? <StatusBadge tone="danger">{missing}</StatusBadge> : 0}</td>
                    <td>
                      {line.availability ? (
                        <StatusBadge tone={statusTone(line.availability)}>
                          {line.availability}
                        </StatusBadge>
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
      </RecordDetailSection>

      <RecordDetailSection
        tone="stock"
        kicker="Stock intelligence"
        title="Warehouse availability"
        span2
      >
        <div className="tlb-table-scroll tlb-orders-panel">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Needed</th>
                <th>Warehouse</th>
                <th>Available</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.flatMap((line) => {
                const needed =
                  Math.max(0, line.requestedQty - line.cancelledQty - line.approvedQty) ||
                  line.requestedQty;
                const rows = warehouseAvailabilityForProduct(state, line.productId, needed);
                if (!rows.length) {
                  return [
                    <tr key={`${line.id}-empty`}>
                      <td>{productLabel(store, line.productId)}</td>
                      <td>{needed}</td>
                      <td colSpan={3}>No active warehouses</td>
                    </tr>,
                  ];
                }
                return rows.map((row) => (
                  <tr key={`${line.id}-${row.warehouseId}`}>
                    <td>{productLabel(store, line.productId)}</td>
                    <td>{needed}</td>
                    <td>{row.warehouseName}</td>
                    <td>{row.available}</td>
                    <td>
                      <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
        {showWarehouse ? (
          <div className="tlb-inline-actions" style={{ padding: 12 }}>
            <Button type="button" variant="outline" onClick={() => store.autoReviewOps(request.id)}>
              Auto-review availability
            </Button>
          </div>
        ) : null}
      </RecordDetailSection>

      {showApproval ? (
        <RecordDetailSection tone="outstanding" kicker="Approval" title="Decide approval" span2>
          <div className="tlb-table-scroll tlb-orders-panel">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Requested</th>
                  <th>Approve qty</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td>{productLabel(store, line.productId)}</td>
                    <td>{line.requestedQty - line.cancelledQty}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={line.requestedQty - line.cancelledQty}
                        value={lineApprovals[line.id] ?? 0}
                        onChange={(e) =>
                          setLineApprovals((prev) => ({
                            ...prev,
                            [line.id]: Number(e.target.value),
                          }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tlb-form-grid" style={{ padding: 12 }}>
            <label>
              Note
              <input value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)} />
            </label>
          </div>
          <div className="tlb-inline-actions" style={{ padding: 12 }}>
            <Button
              type="button"
              onClick={() =>
                store.decideOpsApproval(request.id, "Approved", {
                  note: approvalNote || undefined,
                })
              }
            >
              Approve all
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                store.decideOpsApproval(request.id, "Partial", {
                  note: approvalNote || undefined,
                  lineApprovals: lines.map((l) => ({
                    lineId: l.id,
                    approvedQty: lineApprovals[l.id] ?? 0,
                  })),
                })
              }
            >
              Partial approve
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                store.decideOpsApproval(request.id, "Rejected", {
                  note: approvalNote || "Rejected",
                })
              }
            >
              Reject
            </Button>
          </div>
        </RecordDetailSection>
      ) : null}

      {showWarehouse ? (
        <RecordDetailSection
          tone="supplies"
          kicker="Warehouse"
          title="Review · prepare · release"
          span2
        >
          <div className="tlb-table-scroll tlb-orders-panel">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Approved</th>
                  <th>Fulfil WH</th>
                  <th>Availability</th>
                  <th>Note</th>
                  <th>Prepare qty</th>
                </tr>
              </thead>
              <tbody>
                {lines
                  .filter((l) => l.approvedQty > 0)
                  .map((line) => {
                    const rev = reviewNotes[line.id] ?? {
                      availability: "Available" as OpsWarehouseAvailability,
                      note: "",
                      wh: line.warehouseId,
                    };
                    return (
                      <tr key={line.id}>
                        <td>{productLabel(store, line.productId)}</td>
                        <td>{line.approvedQty}</td>
                        <td>
                          <select
                            value={rev.wh}
                            onChange={(e) =>
                              setReviewNotes((p) => ({
                                ...p,
                                [line.id]: { ...rev, wh: e.target.value },
                              }))
                            }
                          >
                            {state.warehouses
                              .filter((w) => w.active && !w.deletedAt)
                              .map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.name}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={rev.availability}
                            onChange={(e) =>
                              setReviewNotes((p) => ({
                                ...p,
                                [line.id]: {
                                  ...rev,
                                  availability: e.target.value as OpsWarehouseAvailability,
                                },
                              }))
                            }
                          >
                            {AVAIL_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            value={rev.note}
                            onChange={(e) =>
                              setReviewNotes((p) => ({
                                ...p,
                                [line.id]: { ...rev, note: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            max={line.approvedQty}
                            value={prepQtys[line.id] ?? (line.preparedQty || line.approvedQty)}
                            onChange={(e) =>
                              setPrepQtys((p) => ({ ...p, [line.id]: Number(e.target.value) }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="tlb-inline-actions" style={{ padding: 12 }}>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                store.reviewOpsWarehouse(request.id, {
                  lines: lines
                    .filter((l) => l.approvedQty > 0)
                    .map((l) => {
                      const rev = reviewNotes[l.id];
                      return {
                        lineId: l.id,
                        fulfilWarehouseId: rev?.wh,
                        availability: rev?.availability ?? "Available",
                        availabilityNote: rev?.note || undefined,
                        clarificationNote:
                          rev?.availability === "Clarification"
                            ? rev.note || "Needs clarification"
                            : undefined,
                      };
                    }),
                })
              }
            >
              Save warehouse review
            </Button>
            <Button
              type="button"
              onClick={() =>
                store.prepareOps(request.id, {
                  lines: lines
                    .filter((l) => l.approvedQty > 0)
                    .map((l) => ({
                      lineId: l.id,
                      preparedQty: prepQtys[l.id] ?? (l.preparedQty || l.approvedQty),
                    })),
                })
              }
            >
              Save preparation
            </Button>
            <Button type="button" variant="outline" onClick={() => store.markOpsReady(request.id)}>
              Ready for collection
            </Button>
            <Button
              type="button"
              onClick={() =>
                store.releaseOpsGoods(
                  request.id,
                  driverId ? { driverId, vehicle: vehicle || undefined } : undefined,
                )
              }
            >
              Release goods
            </Button>
            {(request.status === "Issued" || request.status === "Ready for Collection") &&
            !request.warehouseCollectConfirmed ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => store.confirmOpsWarehouseCollect(request.id)}
              >
                Confirm WH collection
              </Button>
            ) : null}
          </div>
        </RecordDetailSection>
      ) : null}

      {canDispatch || request.driverId ? (
        <RecordDetailSection tone="deliveries" kicker="Dispatch" title="Driver assignment" span2>
          <div className="tlb-form-grid" style={{ padding: 12 }}>
            <label>
              Driver
              <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">— Select —</option>
                {(state.opsDrivers ?? [])
                  .filter((d) => d.active && !d.deletedAt)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} · {d.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Vehicle
              <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
            </label>
          </div>
          {canDispatch ? (
            <div className="tlb-inline-actions" style={{ padding: 12 }}>
              <Button
                type="button"
                disabled={!driverId}
                onClick={() => store.assignOpsDriver(request.id, driverId, vehicle || undefined)}
              >
                Assign driver
              </Button>
            </div>
          ) : null}
        </RecordDetailSection>
      ) : null}

      {showReceipt ? (
        <RecordDetailSection
          tone="receipts"
          kicker="Receipt"
          title="Three-way delivery check"
          span2
        >
          <p className="tlb-muted-line" style={{ padding: "0 12px" }}>
            Compare issued vs received. Missing here is a delivery discrepancy — not warehouse
            shortage outstanding.
          </p>
          <div className="tlb-table-scroll tlb-orders-panel">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Issued</th>
                  <th>Received</th>
                  <th>Missing</th>
                  <th>Damaged</th>
                  <th>Wrong</th>
                  <th>Rejected</th>
                </tr>
              </thead>
              <tbody>
                {lines
                  .filter((l) => l.issuedQty > 0)
                  .map((line) => {
                    const row = receiptLines[line.id] ?? {
                      receivedQty: line.issuedQty,
                      missingQty: 0,
                      damagedQty: 0,
                      wrongQty: 0,
                      rejectedQty: 0,
                    };
                    return (
                      <tr key={line.id}>
                        <td>{productLabel(store, line.productId)}</td>
                        <td>{line.issuedQty}</td>
                        {(
                          [
                            "receivedQty",
                            "missingQty",
                            "damagedQty",
                            "wrongQty",
                            "rejectedQty",
                          ] as const
                        ).map((field) => (
                          <td key={field}>
                            <input
                              type="number"
                              min={0}
                              max={line.issuedQty}
                              value={row[field]}
                              onChange={(e) =>
                                setReceiptLines((p) => ({
                                  ...p,
                                  [line.id]: { ...row, [field]: Number(e.target.value) },
                                }))
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="tlb-form-grid" style={{ padding: 12 }}>
            <label>
              Outcome
              <select
                value={receiptOutcome}
                onChange={(e) => setReceiptOutcome(e.target.value as OpsReceiptOutcome)}
              >
                {RECEIPT_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Received by
              <input value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />
            </label>
            <label>
              Notes
              <input value={receiptNotes} onChange={(e) => setReceiptNotes(e.target.value)} />
            </label>
          </div>
          <div className="tlb-inline-actions" style={{ padding: 12 }}>
            <Button
              type="button"
              onClick={() =>
                store.confirmOpsDelivery(request.id, {
                  outcome: receiptOutcome,
                  receivedBy: receivedBy.trim() || state.currentUser,
                  notes: receiptNotes || undefined,
                  lines: lines
                    .filter((l) => l.issuedQty > 0)
                    .map((l) => {
                      const row = receiptLines[l.id];
                      return {
                        lineId: l.id,
                        receivedQty: row?.receivedQty ?? l.issuedQty,
                        missingQty: row?.missingQty,
                        damagedQty: row?.damagedQty,
                        wrongQty: row?.wrongQty,
                        rejectedQty: row?.rejectedQty,
                      };
                    }),
                })
              }
            >
              Confirm delivery receipt
            </Button>
          </div>
        </RecordDetailSection>
      ) : null}

      <RecordDetailSection
        tone="outstanding"
        kicker="Outstanding"
        title="Warehouse shortage vs delivery missing"
        span2
      >
        <div className="tlb-table-scroll tlb-orders-panel">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Shortage outstanding</th>
                <th>Delivery missing</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>{productLabel(store, line.productId)}</td>
                  <td>{opsOutstandingShortage(line)}</td>
                  <td>{opsDiscrepancyMissing(line)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {discrepancies.length > 0 ? (
          <ul className="tlb-muted-line" style={{ padding: 12, margin: 0, listStyle: "none" }}>
            {discrepancies.map((d) => (
              <li
                key={d.id}
                style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
              >
                <span>
                  {d.kind} × {d.quantity} · {productLabel(store, d.productId)}
                  {d.resolvedAt ? " (resolved)" : ""}
                </span>
                <MoveToTrashButton
                  store={store}
                  entityType="ops_discrepancy"
                  entityId={d.id}
                  recordLabel={`${d.kind} · ${request.number}`}
                  variant="outline"
                />
              </li>
            ))}
          </ul>
        ) : null}
      </RecordDetailSection>

      {canChat ? (
        <RecordDetailSection tone="activity" kicker="Communication" title="Request chat" span2>
          <div
            className="tlb-chip-row"
            style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 12px 8px" }}
          >
            {MESSAGE_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="tlb-chip"
                onClick={() => store.postOpsMessage(request.id, chip, chip)}
              >
                {chip}
              </button>
            ))}
          </div>
          <div className="tlb-form-grid" style={{ padding: 12 }}>
            <label className="tlb-span-2">
              Message
              <input
                value={chatBody}
                onChange={(e) => setChatBody(e.target.value)}
                placeholder="Type a note on this request…"
              />
            </label>
          </div>
          <div className="tlb-inline-actions" style={{ padding: "0 12px 12px" }}>
            <Button
              type="button"
              disabled={!chatBody.trim()}
              onClick={() => {
                if (!chatBody.trim()) return;
                store.postOpsMessage(request.id, chatBody.trim());
                setChatBody("");
              }}
            >
              Post message
            </Button>
          </div>
          <div className="tlb-table-scroll tlb-orders-panel">
            {messages.length === 0 ? (
              <EmptyState title="No messages" detail="Use chips or post a note on this request." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Message</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...messages]
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((m) => (
                      <tr key={m.id}>
                        <td>{new Date(m.at).toLocaleString()}</td>
                        <td>{m.actor}</td>
                        <td>
                          {m.chip ? <StatusBadge tone="info">{m.chip}</StatusBadge> : null} {m.body}
                        </td>
                        <td>
                          <MoveToTrashButton
                            store={store}
                            entityType="ops_message"
                            entityId={m.id}
                            recordLabel={`Message · ${request.number}`}
                            variant="outline"
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </RecordDetailSection>
      ) : null}

      <RecordDetailSection tone="history" kicker="Activity" title="Timeline" span2>
        {activity.length === 0 ? (
          <EmptyState title="No activity yet" detail="Actions on this request will appear here." />
        ) : (
          <div className="tlb-table-scroll tlb-orders-panel">
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
                {activity.map((a) => (
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
      </RecordDetailSection>

      <RecordDetailSection tone="deliveries" kicker="Custody" title="Custody chain" span2>
        {custody.length === 0 ? (
          <EmptyState
            title="No custody events"
            detail="Release and delivery hand-offs will log here."
          />
        ) : (
          <div className="tlb-table-scroll tlb-orders-panel">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {custody.map((c) => (
                  <tr key={c.id}>
                    <td>{new Date(c.at).toLocaleString()}</td>
                    <td>{c.fromHolder}</td>
                    <td>
                      {c.toHolder}
                      {c.holderName ? ` · ${c.holderName}` : ""}
                    </td>
                    <td>{c.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RecordDetailSection>

      {!["Cancelled", "Rejected", "Closed", "Delivered"].includes(request.status) ? (
        <div className="tlb-form-grid" style={{ padding: 4 }}>
          <label>
            Cancel reason (optional quick field)
            <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </label>
        </div>
      ) : null}
    </RecordDetailPage>
  );
}

/* ─── 1. Requests ─── */

export function OpsRequestsModule({
  store,
  focusId,
  onFocusConsumed,
  range,
}: ModuleProps) {
  const [detailId, setDetailId] = useState<string | null>(focusId ?? null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<OpsRequestType>("Internal Use");
  const [priority, setPriority] = useState<OpsRequestPriority>("Normal");
  const [priorityReason, setPriorityReason] = useState("");
  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [warehouseId, setWarehouseId] = useState(
    store.state.warehouses.find((w) => w.active && !w.deletedAt)?.id ?? "",
  );
  const [draftLines, setDraftLines] = useState<DraftLine[]>([
    { productId: store.state.products.find((p) => p.active)?.id ?? "", quantity: 1 },
  ]);

  useEffect(() => {
    if (!focusId) return;
    setDetailId(focusId);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot focus
  }, [focusId]);

  const opsRequests = store.state.opsRequests;
  const rows = useMemo(() => {
    return (opsRequests ?? []).filter(
      (r) =>
        !r.deletedAt &&
        filterByPeriodDate(r.requestedAt, range) &&
        matchesSearch(
          [
            r.number,
            r.title,
            r.type,
            r.status,
            r.priority,
            r.destination,
            r.requestedBy,
            r.driverName,
          ],
          search,
        ),
    );
  }, [opsRequests, search, range]);

  const detail = liveOpsRequests(store).find((r) => r.id === detailId) ?? null;
  if (detail) {
    return (
      <OpsRequestDetail
        store={store}
        request={detail}
        onBack={() => setDetailId(null)}
        backLabel="Requests"
      />
    );
  }

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Communication Hub</span>
          <strong>Requests</strong>
          <p className="tlb-muted-line">Create and track ops requests end-to-end</p>
        </div>
        <div className="tlb-toolbar-actions">
          <ModuleSearch
            value={search}
            onChange={setSearch}
            placeholder="Search request #, title, status…"
          />
          {(store.can("ops.request") || store.can("ops.view")) && (
            <Button type="button" onClick={() => setOpen((v) => !v)}>
              {open ? "Close form" : "New request"}
            </Button>
          )}
        </div>
      </div>

      {open ? (
        <article className="tlb-panel" style={{ padding: 16, display: "grid", gap: 12 }}>
          <div className="tlb-form-grid">
            <label>
              Type
              <select value={type} onChange={(e) => setType(e.target.value as OpsRequestType)}>
                {OPS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as OpsRequestPriority)}
              >
                {OPS_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            {priority === "Critical" ? (
              <label className="tlb-span-2">
                Critical reason (required)
                <input
                  value={priorityReason}
                  onChange={(e) => setPriorityReason(e.target.value)}
                  placeholder="Why is this critical?"
                />
              </label>
            ) : null}
            <label className="tlb-span-2">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Short request title"
              />
            </label>
            <label>
              Destination
              <input value={destination} onChange={(e) => setDestination(e.target.value)} />
            </label>
            <label>
              Needed by
              <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
            </label>
            <label>
              Default warehouse
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                {store.state.warehouses
                  .filter((w) => w.active && !w.deletedAt)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Notes
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>

          <div className="tlb-table-scroll tlb-orders-panel">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draftLines.map((line, idx) => (
                  <tr key={idx}>
                    <td>
                      <select
                        value={line.productId}
                        onChange={(e) =>
                          setDraftLines((rows) =>
                            rows.map((r, i) =>
                              i === idx ? { ...r, productId: e.target.value } : r,
                            ),
                          )
                        }
                      >
                        {store.state.products
                          .filter((p) => p.active)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku} · {p.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) =>
                          setDraftLines((rows) =>
                            rows.map((r, i) =>
                              i === idx ? { ...r, quantity: Number(e.target.value) } : r,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      {draftLines.length > 1 ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setDraftLines((rows) => rows.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tlb-inline-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setDraftLines((rows) => [
                  ...rows,
                  { productId: store.state.products.find((p) => p.active)?.id ?? "", quantity: 1 },
                ])
              }
            >
              Add line
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const ok = store.createOpsRequest({
                  type,
                  priority,
                  priorityReason: priority === "Critical" ? priorityReason : undefined,
                  title: title || `${type} request`,
                  destination: destination || "TBD",
                  neededBy: neededBy || undefined,
                  notes: notes || undefined,
                  warehouseId,
                  lines: draftLines.filter((l) => l.productId && l.quantity > 0),
                  submit: false,
                });
                if (ok) {
                  setOpen(false);
                  setTitle("");
                  setPriorityReason("");
                  if (typeof ok === "string") setDetailId(ok);
                }
              }}
            >
              Save draft
            </Button>
            <Button
              type="button"
              onClick={() => {
                const ok = store.createOpsRequest({
                  type,
                  priority,
                  priorityReason: priority === "Critical" ? priorityReason : undefined,
                  title: title || `${type} request`,
                  destination: destination || "TBD",
                  neededBy: neededBy || undefined,
                  notes: notes || undefined,
                  warehouseId,
                  lines: draftLines.filter((l) => l.productId && l.quantity > 0),
                  submit: true,
                });
                if (ok) {
                  setOpen(false);
                  setTitle("");
                  setPriorityReason("");
                  if (typeof ok === "string") setDetailId(ok);
                }
              }}
            >
              Submit request
            </Button>
          </div>
        </article>
      ) : null}

      <article className="tlb-panel tlb-orders-panel">
        {rows.length === 0 ? (
          <EmptyState
            title="No ops requests"
            detail="Create a request to start the operations workflow."
          />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="tlb-row-clickable"
                    tabIndex={0}
                    onClick={() => setDetailId(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetailId(r.id);
                      }
                    }}
                  >
                    <td>
                      <strong>{r.number}</strong>
                    </td>
                    <td>{r.title}</td>
                    <td>{r.type}</td>
                    <td>
                      <StatusBadge tone={opsStatusTone(r.priority)}>{r.priority}</StatusBadge>
                    </td>
                    <td>
                      <StatusBadge tone={opsStatusTone(r.status)}>{r.status}</StatusBadge>
                    </td>
                    <td>{r.requestedAt.slice(0, 10)}</td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Open ${r.number}`}
                        onClick={() => setDetailId(r.id)}
                      >
                        <ChevronRight />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

/* ─── 2. Warehouse Actions ─── */

const WAREHOUSE_ACTION_STATUSES = new Set([
  "Approved",
  "Partially Approved",
  "Warehouse Review",
  "Preparing",
  "Ready for Collection",
  "Issued",
]);

export function OpsWarehouseActionsModule({
  store,
  focusId,
  onFocusConsumed,
  onOpenRequest,
}: ModuleProps) {
  const [detailId, setDetailId] = useState<string | null>(focusId ?? null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!focusId) return;
    setDetailId(focusId);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const opsRequests = store.state.opsRequests;
  const rows = useMemo(() => {
    return (opsRequests ?? []).filter(
      (r) =>
        !r.deletedAt &&
        WAREHOUSE_ACTION_STATUSES.has(r.status) &&
        matchesSearch([r.number, r.title, r.status, r.priority, r.destination], search),
    );
  }, [opsRequests, search]);

  const detail = liveOpsRequests(store).find((r) => r.id === detailId) ?? null;
  if (detail) {
    return (
      <OpsRequestDetail
        store={store}
        request={detail}
        onBack={() => setDetailId(null)}
        backLabel="Warehouse Actions"
      />
    );
  }

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Communication Hub</span>
          <strong>Warehouse Actions</strong>
          <p className="tlb-muted-line">Review availability, prepare, ready, and release goods</p>
        </div>
        <ModuleSearch value={search} onChange={setSearch} placeholder="Search warehouse queue…" />
      </div>
      <article className="tlb-panel tlb-orders-panel">
        {rows.length === 0 ? (
          <EmptyState
            title="No warehouse work"
            detail="Approved requests needing pick/pack will appear here."
          />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Actions</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.number}</strong>
                    </td>
                    <td>{r.title}</td>
                    <td>
                      <StatusBadge tone={opsStatusTone(r.status)}>{r.status}</StatusBadge>
                    </td>
                    <td>
                      <StatusBadge tone={opsStatusTone(r.priority)}>{r.priority}</StatusBadge>
                    </td>
                    <td>
                      <div className="tlb-inline-actions compact">
                        {(r.status === "Approved" || r.status === "Partially Approved") && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => store.autoReviewOps(r.id)}
                          >
                            Review
                          </Button>
                        )}
                        {r.status === "Ready for Collection" && (
                          <Button type="button" onClick={() => store.releaseOpsGoods(r.id)}>
                            Release
                          </Button>
                        )}
                        {(r.status === "Issued" || r.status === "Ready for Collection") &&
                          !r.warehouseCollectConfirmed && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => store.confirmOpsWarehouseCollect(r.id)}
                            >
                              WH collect
                            </Button>
                          )}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Open ${r.number}`}
                        onClick={() => {
                          setDetailId(r.id);
                          onOpenRequest?.(r.id);
                        }}
                      >
                        <ChevronRight />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

/* ─── 3. Dispatch ─── */

export function OpsDispatchModule({ store, focusId, onFocusConsumed, onOpenRequest }: ModuleProps) {
  const [detailId, setDetailId] = useState<string | null>(focusId ?? null);
  const [search, setSearch] = useState("");
  const [assignMap, setAssignMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!focusId) return;
    setDetailId(focusId);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const opsRequests = store.state.opsRequests;
  const rows = useMemo(() => {
    return (opsRequests ?? []).filter((r) => {
      if (r.deletedAt) return false;
      const releaseReady =
        r.status === "Ready for Collection" ||
        r.status === "Issued" ||
        r.status === "Collected" ||
        r.status === "In Transit";
      if (!releaseReady) return false;
      return matchesSearch([r.number, r.title, r.status, r.driverName, r.destination], search);
    });
  }, [opsRequests, search]);

  const drivers = (store.state.opsDrivers ?? []).filter((d) => d.active && !d.deletedAt);
  const detail = liveOpsRequests(store).find((r) => r.id === detailId) ?? null;
  if (detail) {
    return (
      <OpsRequestDetail
        store={store}
        request={detail}
        onBack={() => setDetailId(null)}
        backLabel="Dispatch"
      />
    );
  }

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Communication Hub</span>
          <strong>Dispatch</strong>
          <p className="tlb-muted-line">Assign drivers to release-ready and in-flight requests</p>
        </div>
        <ModuleSearch value={search} onChange={setSearch} placeholder="Search dispatch queue…" />
      </div>
      <article className="tlb-panel tlb-orders-panel">
        {rows.length === 0 ? (
          <EmptyState
            title="Dispatch queue empty"
            detail="Ready-for-collection and issued jobs will show here."
          />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Destination</th>
                  <th>Status</th>
                  <th>Driver</th>
                  <th>Assign</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.number}</strong>
                      <div className="tlb-muted-line">{r.title}</div>
                    </td>
                    <td>{r.destination}</td>
                    <td>
                      <StatusBadge tone={opsStatusTone(r.status)}>{r.status}</StatusBadge>
                    </td>
                    <td>{r.driverName ?? "—"}</td>
                    <td>
                      <div className="tlb-inline-actions compact">
                        <select
                          value={assignMap[r.id] ?? r.driverId ?? ""}
                          onChange={(e) => setAssignMap((p) => ({ ...p, [r.id]: e.target.value }))}
                        >
                          <option value="">— Driver —</option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!(assignMap[r.id] ?? r.driverId)}
                          onClick={() => {
                            const id = assignMap[r.id] ?? r.driverId;
                            if (id) store.assignOpsDriver(r.id, id);
                          }}
                        >
                          Assign
                        </Button>
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Open ${r.number}`}
                        onClick={() => {
                          setDetailId(r.id);
                          onOpenRequest?.(r.id);
                        }}
                      >
                        <ChevronRight />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

/* ─── 4. Drivers ─── */

function requestOriginLabel(store: TlbStoreApi, request: OpsRequest): string {
  const lines = linesFor(store, request.id);
  const warehouseIds = [
    ...new Set(lines.map((l) => l.fulfilWarehouseId || l.warehouseId).filter(Boolean)),
  ];
  if (warehouseIds.length === 0) return "—";
  const names = warehouseIds.map(
    (id) => store.state.warehouses.find((w) => w.id === id)?.name ?? id,
  );
  return names.join(", ");
}

function DriverDetailModule({
  store,
  driverId,
  onBack,
  onOpenRequest,
}: {
  store: TlbStoreApi;
  driverId: string;
  onBack: () => void;
  onOpenRequest: (requestId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    phone: "",
    vehicle: "",
    notes: "",
    active: true,
  });
  const canEdit =
    store.can("ops.dispatch") ||
    store.can("delivery.manage") ||
    store.can("records.edit") ||
    store.can("settings.manage");
  const selected =
    (store.state.opsDrivers ?? []).find((d) => d.id === driverId && !isSoftDeleted(d)) ?? null;

  const users = store.state.users;
  const roles = store.state.roles;
  const opsRequests = store.state.opsRequests;
  const linkedUserLabel = useMemo(() => {
    if (!selected?.userId) return null as string | null;
    const user = (users ?? []).find((u) => u.id === selected.userId);
    if (!user) return null;
    const role = (roles ?? []).find((r) => r.id === user.roleId);
    return role ? `${user.name} · ${role.name}` : user.name;
  }, [selected, users, roles]);

  const assignedJobs = useMemo(() => {
    if (!selected) return [] as OpsRequest[];
    return (opsRequests ?? [])
      .filter((r) => !r.deletedAt && r.driverId === selected.id)
      .sort((a, b) =>
        (b.assignedAt ?? b.updatedAt ?? b.createdAt).localeCompare(
          a.assignedAt ?? a.updatedAt ?? a.createdAt,
        ),
      );
  }, [selected, opsRequests]);

  const todayJobs = useMemo(() => {
    if (!selected) return [] as OpsRequest[];
    return listDriverTodayJobs({ opsRequests } as TlbState, selected.id);
  }, [selected, opsRequests]);

  const recentJobs = useMemo(() => assignedJobs.slice(0, 20), [assignedJobs]);

  const assignmentActors = useMemo(() => {
    if (!selected) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const ev of store.state.opsActivity ?? []) {
      if (ev.action !== "driver_assigned") continue;
      if (!assignedJobs.some((j) => j.id === ev.requestId)) continue;
      if (!map.has(ev.requestId)) map.set(ev.requestId, ev.actor);
    }
    return map;
  }, [selected, assignedJobs, store.state.opsActivity]);

  const latestAssigner = useMemo(() => {
    if (!selected) return null as string | null;
    const events = (store.state.opsActivity ?? [])
      .filter(
        (ev) => ev.action === "driver_assigned" && assignedJobs.some((j) => j.id === ev.requestId),
      )
      .sort((a, b) => b.at.localeCompare(a.at));
    return events[0]?.actor ?? null;
  }, [selected, assignedJobs, store.state.opsActivity]);

  if (!selected) {
    return (
      <div className="tlb-module">
        <EmptyState title="Driver not found" detail="The selected driver is no longer available." />
        <DetailBackChrome label="Drivers" onBack={onBack} />
      </div>
    );
  }

  const blocking = findDriverBlockingAssignment(store.state, selected.id);
  const blockReason = blocking
    ? `Assigned to active request ${blocking.number} (${blocking.status}). Reassign or complete first.`
    : undefined;
  const statusLabel = selected.deletedAt ? "Trashed" : selected.active ? "Active" : "Inactive";
  const statusToneValue = selected.deletedAt ? "danger" : selected.active ? "success" : "warning";
  const inTransit = todayJobs.filter(
    (j) =>
      ["In Transit", "Collected", "Issued"].includes(j.status) ||
      ["Departed", "En Route Warehouse", "Collected"].includes(j.driverStatus ?? ""),
  ).length;
  const problems = todayJobs.filter((j) => j.driverStatus === "Problem").length;

  return (
    <RecordDetailPage
      backLabel="Drivers"
      onBack={onBack}
      code={selected.code}
      title={selected.name}
      subtitle={[selected.phone, selected.vehicle].filter(Boolean).join(" · ") || "Driver profile"}
      badges={
        <>
          <StatusBadge tone={statusToneValue}>{statusLabel}</StatusBadge>
          {todayJobs.length > 0 ? (
            <StatusBadge tone="info">
              {todayJobs.length} job{todayJobs.length === 1 ? "" : "s"} today
            </StatusBadge>
          ) : null}
        </>
      }
      actions={
        !editing ? (
          <>
            {canEdit ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setForm({
                    code: selected.code,
                    name: selected.name,
                    phone: selected.phone,
                    vehicle: selected.vehicle ?? "",
                    notes: selected.notes ?? "",
                    active: selected.active,
                  });
                  setEditing(true);
                }}
              >
                Edit driver
              </Button>
            ) : null}
            <MoveToTrashButton
              store={store}
              entityType="ops_driver"
              entityId={selected.id}
              recordLabel={`${selected.code} · ${selected.name}`}
              disabled={Boolean(blocking)}
              disabledReason={blockReason}
              onTrashed={onBack}
            />
          </>
        ) : null
      }
      flash={<Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />}
    >
      {editing ? (
        <article className="tlb-panel tlb-form-panel tlb-span-2">
          <form
            className="tlb-form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const ok = store.saveOpsDriver({
                id: selected.id,
                code: form.code,
                name: form.name,
                phone: form.phone,
                vehicle: form.vehicle || undefined,
                notes: form.notes || undefined,
                active: form.active,
              });
              if (ok) setEditing(false);
            }}
          >
            <div className="tlb-panel-heading">
              <div>
                <span>{selected.code}</span>
                <strong>Edit driver</strong>
              </div>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
            <label>
              Code
              <input
                required
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              />
            </label>
            <label>
              Name
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label>
              Phone
              <input
                required
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </label>
            <label>
              Vehicle
              <input
                value={form.vehicle}
                onChange={(e) => setForm((f) => ({ ...f, vehicle: e.target.value }))}
              />
            </label>
            <label>
              Active
              <select
                value={form.active ? "yes" : "no"}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === "yes" }))}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="tlb-span-2">
              Notes
              <input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
            <div className="tlb-form-actions tlb-span-2">
              <Button type="submit">Save driver</Button>
            </div>
          </form>
        </article>
      ) : null}
      {editing ? null : (
        <>
          <RecordDetailSection tone="summary" kicker="Overview" title="Today's jobs" span2>
            <div className="tlb-customer-summary" aria-label="Driver today summary">
              <div
                className={
                  todayJobs.length > 0
                    ? "tlb-customer-summary-tile--info"
                    : "tlb-customer-summary-tile--muted"
                }
              >
                <span>Today</span>
                <strong>{todayJobs.length}</strong>
              </div>
              <div
                className={
                  inTransit > 0
                    ? "tlb-customer-summary-tile--gold"
                    : "tlb-customer-summary-tile--muted"
                }
              >
                <span>In progress</span>
                <strong>{inTransit}</strong>
              </div>
              <div
                className={
                  problems > 0
                    ? "tlb-customer-summary-tile--danger"
                    : "tlb-customer-summary-tile--muted"
                }
              >
                <span>Problems</span>
                <strong>{problems}</strong>
              </div>
              <div className="tlb-customer-summary-tile--success">
                <span>All assigned</span>
                <strong>{assignedJobs.length}</strong>
              </div>
            </div>
          </RecordDetailSection>

          <RecordDetailSection tone="profile" kicker="Profile" title="Driver details" span2>
            <dl className="tlb-kv">
              <div>
                <dt>Name</dt>
                <dd>{selected.name}</dd>
              </div>
              <div>
                <dt>Code</dt>
                <dd>{selected.code}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{selected.phone || "—"}</dd>
              </div>
              <div>
                <dt>Vehicle</dt>
                <dd>{selected.vehicle || "—"}</dd>
              </div>
              <div>
                <dt>Registration</dt>
                <dd>{selected.vehicle || "—"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusBadge tone={statusToneValue}>{statusLabel}</StatusBadge>
                </dd>
              </div>
              <div>
                <dt>Linked user</dt>
                <dd>{linkedUserLabel || "—"}</dd>
              </div>
              <div>
                <dt>Assigned by</dt>
                <dd>{latestAssigner || "—"}</dd>
              </div>
              <div className="tlb-span-2">
                <dt>Notes</dt>
                <dd>{selected.notes?.trim() ? selected.notes : "—"}</dd>
              </div>
              {selected.deletedAt ? (
                <div className="tlb-span-2">
                  <dt>Trash</dt>
                  <dd>
                    Moved {new Date(selected.deletedAt).toLocaleString()}
                    {selected.deletedBy ? ` by ${selected.deletedBy}` : ""}
                    {selected.deletedReason ? ` · ${selected.deletedReason}` : ""}
                  </dd>
                </div>
              ) : null}
            </dl>
          </RecordDetailSection>

          <RecordDetailSection tone="deliveries" kicker="Jobs" title="Current / recent jobs" span2>
            {recentJobs.length === 0 ? (
              <EmptyState
                title="No jobs assigned"
                detail="Ops requests assigned to this driver will appear here."
              />
            ) : (
              <div className="tlb-table-scroll tlb-orders-panel">
                <table>
                  <thead>
                    <tr>
                      <th>Request</th>
                      <th>Status</th>
                      <th>Driver status</th>
                      <th>Origin</th>
                      <th>Destination</th>
                      <th>Assigned</th>
                      <th>Dates</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {recentJobs.map((job) => (
                      <tr key={job.id}>
                        <td>
                          <strong>{job.number}</strong>
                          <div className="tlb-muted-line">{job.title}</div>
                        </td>
                        <td>
                          <StatusBadge tone={opsStatusTone(job.status)}>{job.status}</StatusBadge>
                        </td>
                        <td>
                          {job.driverStatus ? (
                            <StatusBadge tone={opsStatusTone(job.driverStatus)}>
                              {job.driverStatus}
                            </StatusBadge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{requestOriginLabel(store, job)}</td>
                        <td>{job.destination || "—"}</td>
                        <td>
                          {job.assignedAt ? new Date(job.assignedAt).toLocaleString() : "—"}
                          {assignmentActors.get(job.id) ? (
                            <div className="tlb-muted-line">by {assignmentActors.get(job.id)}</div>
                          ) : null}
                        </td>
                        <td>
                          {job.neededBy ? <div>Needed {job.neededBy.slice(0, 10)}</div> : null}
                          {job.deliveredAt ? (
                            <div className="tlb-muted-line">
                              Delivered {new Date(job.deliveredAt).toLocaleDateString()}
                            </div>
                          ) : job.departedAt ? (
                            <div className="tlb-muted-line">
                              Departed {new Date(job.departedAt).toLocaleDateString()}
                            </div>
                          ) : (
                            <div className="tlb-muted-line">
                              Updated {new Date(job.updatedAt).toLocaleDateString()}
                            </div>
                          )}
                        </td>
                        <td>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenRequest(job.id)}
                          >
                            Open
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </RecordDetailSection>

          <RecordDetailSection tone="activity" kicker="Today" title="Today's job cards" span2>
            {todayJobs.length === 0 ? (
              <EmptyState
                title="No jobs today"
                detail="Assigned collection and transit jobs for today will appear here."
              />
            ) : (
              <div
                className="tlb-ops-driver-jobs"
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                }}
              >
                {todayJobs.map((job) => {
                  const next = nextDriverAction(job.driverStatus);
                  return (
                    <article
                      key={job.id}
                      className="tlb-panel"
                      style={{ padding: 16, display: "grid", gap: 10 }}
                    >
                      <div>
                        <span className="tlb-eyebrow">{job.number}</span>
                        <strong style={{ display: "block" }}>{job.title}</strong>
                        <p className="tlb-muted-line">
                          {requestOriginLabel(store, job)} → {job.destination}
                        </p>
                      </div>
                      <div className="tlb-inline-actions">
                        <StatusBadge tone={opsStatusTone(job.status)}>{job.status}</StatusBadge>
                        {job.driverStatus ? (
                          <StatusBadge tone={opsStatusTone(job.driverStatus)}>
                            {job.driverStatus}
                          </StatusBadge>
                        ) : null}
                      </div>
                      <div className="tlb-inline-actions" style={{ flexWrap: "wrap" }}>
                        {next ? (
                          <Button
                            type="button"
                            onClick={() => store.advanceOpsDriver(job.id, next.to)}
                          >
                            {next.label}
                          </Button>
                        ) : null}
                        {job.driverStatus !== "Problem" && job.driverStatus !== "Delivered" ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              store.advanceOpsDriver(job.id, "Problem", "Problem reported")
                            }
                          >
                            Report problem
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => onOpenRequest(job.id)}
                        >
                          Open
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </RecordDetailSection>
        </>
      )}
    </RecordDetailPage>
  );
}

export function OpsDriversModule({ store, focusId, onFocusConsumed, onOpenRequest }: ModuleProps) {
  const [requestDetailId, setRequestDetailId] = useState<string | null>(null);
  const [profileDriverId, setProfileDriverId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicle, setVehicle] = useState("");
  useEffect(() => {
    if (!focusId) return;
    const asRequest = liveOpsRequests(store).find((r) => r.id === focusId);
    const asDriver = (store.state.opsDrivers ?? []).find((d) => d.id === focusId && !d.deletedAt);
    if (asRequest) {
      setRequestDetailId(focusId);
      setProfileDriverId(null);
    } else if (asDriver) {
      setProfileDriverId(focusId);
      setRequestDetailId(null);
    }
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const drivers = useMemo(() => {
    return (store.state.opsDrivers ?? []).filter(
      (d) => !d.deletedAt && matchesSearch([d.code, d.name, d.phone, d.vehicle], search),
    );
  }, [store.state.opsDrivers, search]);

  /** Chip bar names: full live roster (not search-filtered), so add/remove stays in sync. */
  const chipDrivers = useMemo(() => {
    return (store.state.opsDrivers ?? []).filter((d) => !d.deletedAt);
  }, [store.state.opsDrivers]);

  const canBulkTrash = store.can("records.delete");
  const driverIds = useMemo(() => drivers.map((d) => d.id), [drivers]);
  const selection = useListSelection(canBulkTrash ? driverIds : []);

  const opsRequests = store.state.opsRequests;
  const jobs = useMemo(() => {
    const all = listDriverTodayJobs({ opsRequests } as TlbState, undefined);
    return all.filter((r) =>
      matchesSearch([r.number, r.title, r.destination, r.driverName, r.driverStatus], search),
    );
  }, [opsRequests, search]);

  const profileDriver =
    (store.state.opsDrivers ?? []).find((d) => d.id === profileDriverId) ?? null;
  const requestDetail = liveOpsRequests(store).find((r) => r.id === requestDetailId) ?? null;

  if (requestDetail) {
    const backLabel = profileDriver ? profileDriver.name : "Drivers";
    return (
      <OpsRequestDetail
        store={store}
        request={requestDetail}
        onBack={() => setRequestDetailId(null)}
        backLabel={backLabel}
      />
    );
  }

  if (profileDriverId) {
    return (
      <DriverDetailModule
        store={store}
        driverId={profileDriverId}
        onBack={() => setProfileDriverId(null)}
        onOpenRequest={(id) => setRequestDetailId(id)}
      />
    );
  }

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Communication Hub</span>
          <strong>Drivers</strong>
          <p className="tlb-muted-line">
            Roster and today&apos;s jobs — click a driver for full profile
          </p>
        </div>
        <div className="tlb-toolbar-actions">
          <ModuleSearch value={search} onChange={setSearch} placeholder="Search drivers or jobs…" />
          {canBulkTrash ? (
            <BulkTrashToolbar
              store={store}
              entityType="ops_driver"
              selectedIds={selection.selectedIds}
              onDone={selection.clear}
            />
          ) : null}
          {(store.can("ops.dispatch") || store.can("ops.drive")) && (
            <Button type="button" onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Close" : "Add driver"}
            </Button>
          )}
        </div>
      </div>

      {showForm ? (
        <article className="tlb-panel" style={{ padding: 16, display: "grid", gap: 12 }}>
          <div className="tlb-form-grid">
            <label>
              Code
              <input value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Phone
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label>
              Vehicle / registration
              <input
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
                placeholder="e.g. GN-4521-21"
              />
            </label>
          </div>
          <Button
            type="button"
            onClick={() => {
              const ok = store.saveOpsDriver({
                code,
                name,
                phone,
                vehicle: vehicle || undefined,
                active: true,
              });
              if (ok) {
                setShowForm(false);
                setCode("");
                setName("");
                setPhone("");
                setVehicle("");
              }
            }}
          >
            Save driver
          </Button>
        </article>
      ) : null}

      <section className="tlb-filter-bar tlb-module-filters">
        <div className="tlb-periods">
          <button
            type="button"
            className={!profileDriverId ? "active" : ""}
            onClick={() => setProfileDriverId(null)}
          >
            All drivers
          </button>
          {chipDrivers.map((d) => (
            <button
              key={d.id}
              type="button"
              className={profileDriverId === d.id ? "active" : ""}
              onClick={() => setProfileDriverId(d.id)}
            >
              {d.name}
            </button>
          ))}
        </div>
      </section>

      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-panel-heading">
          <div>
            <span>Roster</span>
            <strong>Drivers</strong>
          </div>
        </div>
        {drivers.length === 0 ? (
          <EmptyState title="No drivers" detail="Add a driver to assign dispatch jobs." />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  {canBulkTrash ? (
                    <SelectAllHeader
                      allSelected={selection.allVisibleSelected}
                      someSelected={selection.someVisibleSelected}
                      onToggle={selection.toggleAllVisible}
                    />
                  ) : null}
                  <th>Code</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Vehicle</th>
                  <th>Active</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                  {canBulkTrash ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => {
                  const blocking = findDriverBlockingAssignment(store.state, d.id);
                  const blockReason = blocking
                    ? `Assigned to active request ${blocking.number} (${blocking.status}). Reassign or complete first.`
                    : undefined;
                  return (
                    <tr
                      key={d.id}
                      className={`tlb-row-clickable${selection.isSelected(d.id) ? " tlb-row-selected" : ""}`}
                      tabIndex={0}
                      onClick={() => setProfileDriverId(d.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setProfileDriverId(d.id);
                        }
                      }}
                    >
                      {canBulkTrash ? (
                        <SelectRowCell
                          id={d.id}
                          checked={selection.isSelected(d.id)}
                          onToggle={selection.toggle}
                          label={`Select ${d.name}`}
                        />
                      ) : null}
                      <td>
                        <strong>{d.code}</strong>
                      </td>
                      <td>{d.name}</td>
                      <td>{d.phone}</td>
                      <td>{d.vehicle ?? "—"}</td>
                      <td>
                        <StatusBadge tone={d.active ? "success" : "neutral"}>
                          {d.active ? "Active" : "Off"}
                        </StatusBadge>
                      </td>
                      <td>
                        <button
                          type="button"
                          aria-label={`View ${d.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setProfileDriverId(d.id);
                          }}
                        >
                          <ChevronRight />
                        </button>
                      </td>
                      {canBulkTrash ? (
                        <td
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <MoveToTrashButton
                            store={store}
                            entityType="ops_driver"
                            entityId={d.id}
                            recordLabel={`${d.code} · ${d.name}`}
                            disabled={Boolean(blocking)}
                            disabledReason={blockReason}
                            onTrashed={() => {
                              if (profileDriverId === d.id) setProfileDriverId(null);
                              selection.clear();
                            }}
                          />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <div
        className="tlb-ops-driver-jobs"
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        }}
      >
        {jobs.length === 0 ? (
          <article className="tlb-panel" style={{ padding: 16 }}>
            <EmptyState
              title="No jobs today"
              detail="Assigned collection and transit jobs will appear as cards."
            />
          </article>
        ) : (
          jobs.map((job) => {
            const next = nextDriverAction(job.driverStatus);
            return (
              <article
                key={job.id}
                className="tlb-panel"
                style={{ padding: 16, display: "grid", gap: 10 }}
              >
                <div>
                  <span className="tlb-eyebrow">{job.number}</span>
                  <strong style={{ display: "block" }}>{job.title}</strong>
                  <p className="tlb-muted-line">{job.destination}</p>
                </div>
                <div className="tlb-inline-actions">
                  <StatusBadge tone={opsStatusTone(job.status)}>{job.status}</StatusBadge>
                  {job.driverStatus ? (
                    <StatusBadge tone={opsStatusTone(job.driverStatus)}>
                      {job.driverStatus}
                    </StatusBadge>
                  ) : null}
                </div>
                <div className="tlb-inline-actions" style={{ flexWrap: "wrap" }}>
                  {next ? (
                    <Button type="button" onClick={() => store.advanceOpsDriver(job.id, next.to)}>
                      {next.label}
                    </Button>
                  ) : null}
                  {job.driverStatus !== "Problem" && job.driverStatus !== "Delivered" ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => store.advanceOpsDriver(job.id, "Problem", "Problem reported")}
                    >
                      Report problem
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setRequestDetailId(job.id);
                      onOpenRequest?.(job.id);
                    }}
                  >
                    Open
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─── 5. Outstanding ─── */

export function OpsOutstandingModule({ store, onOpenRequest }: ModuleProps) {
  const [search, setSearch] = useState("");
  const [ageFilter, setAgeFilter] = useState<"all" | "0-2" | "3-7" | "8+">("all");

  const opsRequests = store.state.opsRequests;
  const opsRequestLines = store.state.opsRequestLines;
  const products = store.state.products;
  const rows = useMemo(() => {
    return listOutstandingOpsRows({ opsRequests, opsRequestLines, products } as TlbState).filter(
      (r) => {
        if (ageFilter === "0-2" && r.ageDays > 2) return false;
        if (ageFilter === "3-7" && (r.ageDays < 3 || r.ageDays > 7)) return false;
        if (ageFilter === "8+" && r.ageDays < 8) return false;
        return matchesSearch(
          [
            r.requestNumber,
            r.productName,
            r.title,
            r.status,
            r.priority,
            r.outstandingQty,
            r.missingDiscrepancyQty,
          ],
          search,
        );
      },
    );
  }, [opsRequests, opsRequestLines, products, search, ageFilter]);

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Communication Hub</span>
          <strong>Outstanding Requests</strong>
          <p className="tlb-muted-line">
            Warehouse shortage outstanding — separate from delivery missing
          </p>
        </div>
        <ModuleSearch value={search} onChange={setSearch} placeholder="Search outstanding…" />
      </div>
      <section className="tlb-filter-bar tlb-module-filters">
        <div className="tlb-periods">
          {(
            [
              ["all", "All ages"],
              ["0-2", "0–2 days"],
              ["3-7", "3–7 days"],
              ["8+", "8+ days"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={ageFilter === id ? "active" : ""}
              onClick={() => setAgeFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      <article className="tlb-panel tlb-orders-panel">
        {rows.length === 0 ? (
          <EmptyState
            title="No outstanding shortage"
            detail="Partial approvals leave shortage rows here until fulfilled."
          />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Product</th>
                  <th>Requested</th>
                  <th>Approved</th>
                  <th>Shortage outstanding</th>
                  <th>Delivery missing</th>
                  <th>Age</th>
                  <th>Priority</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.requestId}-${r.lineId}`}>
                    <td>
                      <strong>{r.requestNumber}</strong>
                      <div className="tlb-muted-line">{r.title}</div>
                    </td>
                    <td>{r.productName}</td>
                    <td>{r.requestedQty}</td>
                    <td>{r.approvedQty}</td>
                    <td>
                      <StatusBadge tone="warning">{r.outstandingQty}</StatusBadge>
                    </td>
                    <td>
                      {r.missingDiscrepancyQty > 0 ? (
                        <StatusBadge tone="danger">{r.missingDiscrepancyQty}</StatusBadge>
                      ) : (
                        0
                      )}
                    </td>
                    <td>{r.ageDays}d</td>
                    <td>
                      <StatusBadge tone={opsStatusTone(r.priority)}>{r.priority}</StatusBadge>
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Open ${r.requestNumber}`}
                        onClick={() => onOpenRequest?.(r.requestId)}
                      >
                        <ChevronRight />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

/* ─── 6. Exceptions ─── */

export function OpsExceptionsModule({ store, onOpenRequest }: ModuleProps) {
  const [search, setSearch] = useState("");
  const [showResolved, setShowResolved] = useState(false);

  const rows = useMemo(() => {
    return (store.state.opsDiscrepancies ?? []).filter((d) => {
      if (!showResolved && d.resolvedAt) return false;
      const req = store.state.opsRequests.find((r) => r.id === d.requestId);
      const product = store.state.products.find((p) => p.id === d.productId);
      return matchesSearch(
        [req?.number, product?.name, d.kind, d.quantity, d.notes, d.loggedBy],
        search,
      );
    });
  }, [
    store.state.opsDiscrepancies,
    store.state.opsRequests,
    store.state.products,
    search,
    showResolved,
  ]);

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Communication Hub</span>
          <strong>Exceptions / Discrepancies</strong>
          <p className="tlb-muted-line">
            Delivery missing, damaged, wrong, and rejected — not warehouse shortage
          </p>
        </div>
        <div className="tlb-toolbar-actions">
          <ModuleSearch value={search} onChange={setSearch} placeholder="Search discrepancies…" />
          <Button type="button" variant="outline" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? "Hide resolved" : "Show resolved"}
          </Button>
        </div>
      </div>
      <article className="tlb-panel tlb-orders-panel">
        {rows.length === 0 ? (
          <EmptyState
            title="No discrepancies"
            detail="Receipt shortfalls and damages will log here."
          />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Product</th>
                  <th>Kind</th>
                  <th>Qty</th>
                  <th>Logged</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const req = store.state.opsRequests.find((r) => r.id === d.requestId);
                  return (
                    <tr key={d.id}>
                      <td>
                        <strong>{req?.number ?? d.requestId}</strong>
                      </td>
                      <td>{productLabel(store, d.productId)}</td>
                      <td>
                        <StatusBadge tone="danger">{d.kind}</StatusBadge>
                      </td>
                      <td>{d.quantity}</td>
                      <td>
                        {d.loggedAt.slice(0, 10)} · {d.loggedBy}
                      </td>
                      <td>{d.resolvedAt ? "Resolved" : "Open"}</td>
                      <td>
                        <button
                          type="button"
                          aria-label="Open request"
                          onClick={() => onOpenRequest?.(d.requestId)}
                        >
                          <ChevronRight />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

/* ─── 7. My Actions ─── */

export function OpsMyActionsModule({
  store,
  onOpenRequest,
  onNavigateAction,
}: ModuleProps & { onNavigateAction?: (nav: string, requestId: string) => void }) {
  const [search, setSearch] = useState("");
  const items = useMemo(() => {
    return buildMyOpsActions(store.state).filter((a) =>
      matchesSearch(
        [a.title, a.subtitle, a.requestNumber, a.kind, a.status, a.priority, a.nav],
        search,
      ),
    );
  }, [store.state, search]);

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Communication Hub</span>
          <strong>My Actions</strong>
          <p className="tlb-muted-line">Role-aware tasks waiting on you</p>
        </div>
        <ModuleSearch value={search} onChange={setSearch} placeholder="Search my actions…" />
      </div>
      <article className="tlb-panel tlb-orders-panel">
        {items.length === 0 ? (
          <EmptyState
            title="You're clear"
            detail="No acknowledge, approve, warehouse, drive, or receive tasks right now."
          />
        ) : (
          <div className="tlb-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Request</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Go to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.title}</strong>
                      <div className="tlb-muted-line">{a.subtitle}</div>
                    </td>
                    <td>{a.requestNumber}</td>
                    <td>
                      <StatusBadge tone={opsStatusTone(a.priority)}>{a.priority}</StatusBadge>
                    </td>
                    <td>
                      <StatusBadge tone={opsStatusTone(a.status)}>{a.status}</StatusBadge>
                    </td>
                    <td>{a.nav}</td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Open ${a.requestNumber}`}
                        onClick={() => {
                          if (onNavigateAction) onNavigateAction(a.nav, a.requestId);
                          else onOpenRequest?.(a.requestId);
                        }}
                      >
                        <ChevronRight />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

/* ─── 8. Live Board ─── */

export function OpsLiveBoardModule({ store, onOpenRequest }: ModuleProps) {
  const opsRequests = store.state.opsRequests;
  const columns = useMemo(() => opsKanbanColumns({ opsRequests } as TlbState), [opsRequests]);

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Communication Hub</span>
          <strong>Live Operations Board</strong>
          <p className="tlb-muted-line">
            Kanban across submit → approve → prepare → transit → delivered
          </p>
        </div>
      </div>
      <div
        className="tlb-ops-kanban"
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          alignItems: "start",
        }}
      >
        {columns.map((col) => (
          <article key={col.id} className="tlb-panel" style={{ padding: 12, minHeight: 180 }}>
            <div className="tlb-panel-heading" style={{ marginBottom: 8 }}>
              <div>
                <span>{col.requests.length}</span>
                <strong>{col.title}</strong>
              </div>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {col.requests.length === 0 ? (
                <p className="tlb-muted-line">Empty</p>
              ) : (
                col.requests.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="tlb-panel"
                    style={{
                      padding: 10,
                      textAlign: "left",
                      border:
                        "1px solid color-mix(in oklab, var(--tlb-purple, #803EEA) 18%, transparent)",
                      background: "color-mix(in oklab, var(--tlb-gold, #FFDC7A) 8%, transparent)",
                      cursor: "pointer",
                    }}
                    onClick={() => onOpenRequest?.(r.id)}
                  >
                    <strong style={{ display: "block" }}>{r.number}</strong>
                    <span className="tlb-muted-line">{r.title}</span>
                    <div style={{ marginTop: 6 }}>
                      <StatusBadge tone={opsStatusTone(r.priority)}>{r.priority}</StatusBadge>{" "}
                      <StatusBadge tone={opsStatusTone(r.status)}>{r.status}</StatusBadge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
