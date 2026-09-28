/**
 * Operations Hub store — Request → Approval → Warehouse → Dispatch → Driver → Delivery.
 * Every physical release posts immutable stock movement ledger entries via postStockMovement.
 */
import { calcAvailable } from "../domain/calculations";
import { nextDocumentNumber } from "../domain/numbering";
import {
  bestFulfilWarehouse,
  defaultOpsApprovalRules,
  opsOutstandingShortage,
  opsRequestNeedsApproval,
  recomputeOpsLineDerived,
  warehouseAvailabilityForProduct,
} from "../domain/ops-hub";
import { hasPermission } from "../domain/permissions";
import type {
  AuditAction,
  OpsCustodyHolder,
  OpsDriver,
  OpsDriverJobStatus,
  OpsMessageChip,
  OpsReceiptOutcome,
  OpsRequest,
  OpsRequestLine,
  OpsRequestPriority,
  OpsRequestType,
  OpsWarehouseAvailability,
  Permission,
  StoreResult,
  TlbState,
} from "../domain/types";
import { recommendBatches } from "../domain/inventory";
import { consumeBatch, getOrCreateBalance, postStockMovement } from "./inventory-store";

type MutResult<T> = StoreResult<{ state: TlbState; data: T }>;

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function requireAny(state: TlbState, perms: Permission[]): string | null {
  if (perms.some((p) => hasPermission(state, p))) return null;
  return `Role ${state.currentRole} cannot perform ${perms.join(" / ")}.`;
}

function pushAudit(
  state: TlbState,
  partial: {
    action: AuditAction;
    entityType: string;
    entityId: string;
    summary: string;
    meta?: Record<string, string | number | boolean | null>;
    at?: string;
  },
): void {
  state.audit.unshift({
    id: uid("aud"),
    at: partial.at ?? new Date().toISOString(),
    actor: state.currentUser,
    action: partial.action,
    entityType: partial.entityType,
    entityId: partial.entityId,
    summary: partial.summary,
    ...(partial.meta ? { meta: partial.meta } : {}),
  });
  if (state.audit.length > 500) state.audit.length = 500;
}

function pushActivity(
  state: TlbState,
  requestId: string,
  action: string,
  summary: string,
  meta?: Record<string, string | number | boolean | null>,
  at?: string,
): void {
  if (!state.opsActivity) state.opsActivity = [];
  state.opsActivity.unshift({
    id: uid("oact"),
    requestId,
    at: at ?? new Date().toISOString(),
    actor: state.currentUser,
    action,
    summary,
    ...(meta ? { meta } : {}),
  });
}

function pushCustody(
  state: TlbState,
  requestId: string,
  fromHolder: OpsCustodyHolder,
  toHolder: OpsCustodyHolder,
  summary: string,
  holderName?: string,
  at?: string,
): void {
  if (!state.opsCustody) state.opsCustody = [];
  state.opsCustody.unshift({
    id: uid("cust"),
    requestId,
    at: at ?? new Date().toISOString(),
    actor: state.currentUser,
    fromHolder,
    toHolder,
    summary,
    ...(holderName ? { holderName } : {}),
  });
}

function pushOpsNotification(
  state: TlbState,
  input: {
    type: TlbState["notifications"][number]["type"];
    title: string;
    body: string;
    opsRequestId: string;
    targetUserId?: string | undefined;
    targetRole?: string | undefined;
    dedupeKey: string;
  },
): void {
  if (!state.notifications) state.notifications = [];
  if (state.notifications.some((n) => n.dedupeKey === input.dedupeKey && !n.readAt)) return;
  state.notifications.unshift({
    id: uid("ntf"),
    type: input.type,
    title: input.title,
    body: input.body,
    opsRequestId: input.opsRequestId,
    dedupeKey: input.dedupeKey,
    createdAt: new Date().toISOString(),
    ...(input.targetUserId ? { targetUserId: input.targetUserId } : {}),
    ...(input.targetRole ? { targetRole: input.targetRole } : {}),
  });
  if (state.notifications.length > 200) state.notifications.length = 200;
}

function ensureOpsCollections(state: TlbState): void {
  if (!state.opsRequests) state.opsRequests = [];
  if (!state.opsRequestLines) state.opsRequestLines = [];
  if (!state.opsDrivers) state.opsDrivers = [];
  if (!state.opsMessages) state.opsMessages = [];
  if (!state.opsActivity) state.opsActivity = [];
  if (!state.opsCustody) state.opsCustody = [];
  if (!state.opsDiscrepancies) state.opsDiscrepancies = [];
  if (!state.opsApprovalRules) state.opsApprovalRules = defaultOpsApprovalRules();
  if (state.counters.opsRequest == null) state.counters.opsRequest = 0;
}

function getRequest(state: TlbState, requestId: string): OpsRequest | undefined {
  return state.opsRequests.find((r) => r.id === requestId && !r.deletedAt);
}

function getLines(state: TlbState, requestId: string): OpsRequestLine[] {
  return state.opsRequestLines.filter((l) => l.requestId === requestId);
}

function touch(req: OpsRequest, now: string): void {
  req.updatedAt = now;
}

export function upsertOpsDriver(
  state: TlbState,
  input: {
    id?: string | undefined;
    code: string;
    name: string;
    phone: string;
    vehicle?: string | undefined;
    active?: boolean | undefined;
    userId?: string | undefined;
    notes?: string | undefined;
  },
): MutResult<{ driverId: string }> {
  const blocked = requireAny(state, [
    "ops.dispatch",
    "ops.view",
    "settings.manage",
    "delivery.manage",
    "records.edit",
  ]);
  if (blocked) return { ok: false, error: blocked };
  const code = input.code.trim();
  const name = input.name.trim();
  const phone = input.phone.trim();
  if (!code) return { ok: false, error: "Driver code is required." };
  if (!name) return { ok: false, error: "Driver name is required." };
  if (!phone) return { ok: false, error: "Phone is required." };

  const next = cloneState(state);
  ensureOpsCollections(next);
  const id = input.id ?? uid("drv");
  const existing = next.opsDrivers.find((d) => d.id === id);
  if (existing) {
    if (existing.deletedAt) {
      return { ok: false, error: "Restore this driver from trash before editing." };
    }
    Object.assign(existing, {
      code,
      name,
      phone,
      vehicle: input.vehicle?.trim(),
      active: input.active ?? existing.active,
      userId: input.userId,
      notes: input.notes,
    });
    pushAudit(next, {
      action: "driver.updated",
      entityType: "ops_driver",
      entityId: id,
      summary: `Updated driver ${code} · ${name}.`,
    });
    pushAudit(next, {
      action: "record.edited",
      entityType: "ops_driver",
      entityId: id,
      summary: `Edited driver ${code}.`,
    });
  } else {
    next.opsDrivers.push({
      id,
      code,
      name,
      phone,
      vehicle: input.vehicle?.trim(),
      active: input.active ?? true,
      userId: input.userId,
      notes: input.notes,
    });
    pushAudit(next, {
      action: "driver.created",
      entityType: "ops_driver",
      entityId: id,
      summary: `Created driver ${code} · ${name}.`,
    });
  }
  return { ok: true, data: { state: next, data: { driverId: id } } };
}

export function createOpsRequest(
  state: TlbState,
  input: {
    type: OpsRequestType;
    priority: OpsRequestPriority;
    priorityReason?: string | undefined;
    title: string;
    destination: string;
    neededBy?: string | undefined;
    notes?: string | undefined;
    customerId?: string | undefined;
    orderId?: string | undefined;
    warehouseId: string;
    lines: Array<{
      productId: string;
      quantity: number;
      notes?: string | undefined;
      warehouseId?: string | undefined;
    }>;
    submit?: boolean | undefined;
  },
): MutResult<{ requestId: string; number: string }> {
  const blocked = requireAny(state, ["ops.request", "ops.view", "orders.create", "supply.create"]);
  if (blocked) return { ok: false, error: blocked };
  if (!input.lines.length) return { ok: false, error: "Add at least one request line." };
  if (input.priority === "Critical" && !input.priorityReason?.trim()) {
    return { ok: false, error: "Critical priority requires a reason." };
  }
  for (const line of input.lines) {
    if (line.quantity <= 0) return { ok: false, error: "Line quantities must be positive." };
    if (!state.products.some((p) => p.id === line.productId && p.active)) {
      return { ok: false, error: "Unknown or inactive product on a line." };
    }
  }

  const next = cloneState(state);
  ensureOpsCollections(next);
  const numbered = nextDocumentNumber("opsRequest", next.counters);
  next.counters = numbered.counters;
  const now = new Date().toISOString();
  const requestId = uid("oreq");

  const req: OpsRequest = {
    id: requestId,
    number: numbered.number,
    type: input.type,
    priority: input.priority,
    priorityReason: input.priorityReason?.trim(),
    status: "Draft",
    title: input.title.trim() || `${input.type} request`,
    destination: input.destination.trim(),
    requestedBy: next.currentUser,
    requestedByUserId: next.currentUserId,
    requestedAt: now,
    neededBy: input.neededBy,
    notes: input.notes,
    customerId: input.customerId,
    orderId: input.orderId,
    createdAt: now,
    updatedAt: now,
  };
  next.opsRequests.unshift(req);

  for (const line of input.lines) {
    const product = next.products.find((p) => p.id === line.productId);
    next.opsRequestLines.push(
      recomputeOpsLineDerived({
        id: uid("orln"),
        requestId,
        productId: line.productId,
        warehouseId: line.warehouseId ?? input.warehouseId,
        requestedQty: line.quantity,
        approvedQty: 0,
        preparedQty: 0,
        issuedQty: 0,
        receivedQty: 0,
        cancelledQty: 0,
        missingQty: 0,
        damagedQty: 0,
        wrongQty: 0,
        rejectedQty: 0,
        unit: product?.unit,
        notes: line.notes,
      }),
    );
  }

  pushAudit(next, {
    action: "ops.request_created",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Ops request ${numbered.number} created.`,
    at: now,
  });
  pushActivity(
    next,
    requestId,
    "created",
    `Created ${numbered.number} (${input.type}, ${input.priority}).`,
    undefined,
    now,
  );

  if (input.submit) {
    const submitted = submitOpsRequest(next, requestId);
    if (!submitted.ok) return submitted;
    return {
      ok: true,
      data: { state: submitted.data.state, data: { requestId, number: numbered.number } },
    };
  }

  return { ok: true, data: { state: next, data: { requestId, number: numbered.number } } };
}

export function updateOpsRequestDraft(
  state: TlbState,
  requestId: string,
  input: {
    title?: string;
    destination?: string;
    priority?: OpsRequestPriority;
    priorityReason?: string;
    type?: OpsRequestType;
    neededBy?: string;
    notes?: string;
    lines?: Array<{ productId: string; quantity: number; notes?: string; warehouseId?: string }>;
    warehouseId?: string;
  },
): MutResult<{ requestId: string }> {
  const blocked = requireAny(state, ["ops.request", "ops.view"]);
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  if (req.deletedAt) return { ok: false, error: "Restore this request from trash before editing." };
  if (req.status !== "Draft") return { ok: false, error: "Only draft requests can be edited." };
  if (input.priority === "Critical" && !(input.priorityReason ?? req.priorityReason)?.trim()) {
    return { ok: false, error: "Critical priority requires a reason." };
  }
  const now = new Date().toISOString();
  if (input.title != null) req.title = input.title.trim();
  if (input.destination != null) req.destination = input.destination.trim();
  if (input.priority != null) req.priority = input.priority;
  if (input.priorityReason != null) req.priorityReason = input.priorityReason.trim();
  if (input.type != null) req.type = input.type;
  if (input.neededBy != null) req.neededBy = input.neededBy;
  if (input.notes != null) req.notes = input.notes;
  if (input.lines) {
    next.opsRequestLines = next.opsRequestLines.filter((l) => l.requestId !== requestId);
    for (const line of input.lines) {
      const product = next.products.find((p) => p.id === line.productId);
      next.opsRequestLines.push(
        recomputeOpsLineDerived({
          id: uid("orln"),
          requestId,
          productId: line.productId,
          warehouseId: line.warehouseId ?? input.warehouseId ?? "wh-main",
          requestedQty: line.quantity,
          approvedQty: 0,
          preparedQty: 0,
          issuedQty: 0,
          receivedQty: 0,
          cancelledQty: 0,
          missingQty: 0,
          damagedQty: 0,
          wrongQty: 0,
          rejectedQty: 0,
          unit: product?.unit,
          notes: line.notes,
        }),
      );
    }
  }
  touch(req, now);
  pushActivity(next, requestId, "updated", `Draft ${req.number} updated.`, undefined, now);
  pushAudit(next, {
    action: "record.edited",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Edited draft ops request ${req.number}.`,
    at: now,
  });
  return { ok: true, data: { state: next, data: { requestId } } };
}

export function submitOpsRequest(
  state: TlbState,
  requestId: string,
): MutResult<{ requestId: string }> {
  const blocked = requireAny(state, ["ops.request", "ops.view"]);
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  if (req.status !== "Draft" && req.status !== "Rejected") {
    return { ok: false, error: "Only draft or rejected requests can be submitted." };
  }
  if (req.priority === "Critical" && !req.priorityReason?.trim()) {
    return { ok: false, error: "Critical priority requires a reason." };
  }
  const lines = getLines(next, requestId);
  if (!lines.length) return { ok: false, error: "Add at least one line before submit." };

  const now = new Date().toISOString();
  req.submittedAt = now;
  touch(req, now);

  const gate = opsRequestNeedsApproval(next, {
    type: req.type,
    priority: req.priority,
    lines: lines.map((l) => ({ productId: l.productId, quantity: l.requestedQty })),
  });

  if (gate.needs) {
    req.status = "Pending Approval";
    const approvalId = uid("appr");
    next.approvals.unshift({
      id: approvalId,
      kind: "ops_request",
      status: "Pending",
      title: `Ops ${req.number}`,
      summary: `${req.title} · ${req.priority} · ${lines.length} line(s)`,
      refType: "ops_request",
      refId: requestId,
      amount: lines.reduce((s, l) => {
        const cost = next.products.find((p) => p.id === l.productId)?.standardCost ?? 0;
        return s + cost * l.requestedQty;
      }, 0),
      requestedAt: now,
      requestedBy: next.currentUser,
    });
    req.approvalId = approvalId;
    pushOpsNotification(next, {
      type: "ops_approval_needed",
      title: `Approval needed · ${req.number}`,
      body: `${req.title} awaits manager approval.`,
      opsRequestId: requestId,
      targetRole: "Manager",
      dedupeKey: `ops-appr-${requestId}`,
    });
  } else {
    for (const line of lines) {
      line.approvedQty = line.requestedQty - line.cancelledQty;
    }
    req.status = "Approved";
    req.approvedAt = now;
    req.approvedBy = "Auto (rules)";
  }

  pushAudit(next, {
    action: "ops.request_submitted",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Submitted ${req.number} → ${req.status}.`,
    at: now,
  });
  pushActivity(
    next,
    requestId,
    "submitted",
    `Submitted → ${req.status}.`,
    { needsApproval: gate.needs },
    now,
  );
  pushOpsNotification(next, {
    type: "ops_request_submitted",
    title: `Request submitted · ${req.number}`,
    body: req.title,
    opsRequestId: requestId,
    targetRole: "Warehouse",
    dedupeKey: `ops-sub-${requestId}`,
  });

  return { ok: true, data: { state: next, data: { requestId } } };
}

export function acknowledgeOpsRequest(
  state: TlbState,
  requestId: string,
): MutResult<{ requestId: string; responseMinutes: number }> {
  const blocked = requireAny(state, [
    "ops.approve",
    "ops.warehouse",
    "approvals.manage",
    "ops.view",
  ]);
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  if (req.acknowledgedAt) {
    return {
      ok: true,
      data: { state: next, data: { requestId, responseMinutes: req.responseMinutes ?? 0 } },
    };
  }
  if (!req.submittedAt) return { ok: false, error: "Request not submitted yet." };
  const now = new Date().toISOString();
  const mins = Math.max(
    0,
    Math.round((new Date(now).getTime() - new Date(req.submittedAt).getTime()) / 60_000),
  );
  req.acknowledgedAt = now;
  req.acknowledgedBy = next.currentUser;
  req.responseMinutes = mins;
  if (req.status === "Submitted") req.status = "Acknowledged";
  touch(req, now);
  pushAudit(next, {
    action: "ops.request_acknowledged",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Acknowledged ${req.number} in ${mins} min.`,
    at: now,
  });
  pushActivity(
    next,
    requestId,
    "acknowledged",
    `First opened / acknowledged by ${next.currentUser} (${mins} min).`,
    { responseMinutes: mins },
    now,
  );
  return { ok: true, data: { state: next, data: { requestId, responseMinutes: mins } } };
}

export function decideOpsRequestApproval(
  state: TlbState,
  requestId: string,
  decision: "Approved" | "Rejected" | "Partial",
  input?: {
    note?: string | undefined;
    lineApprovals?: Array<{ lineId: string; approvedQty: number }> | undefined;
  },
): MutResult<{ requestId: string }> {
  const blocked = requireAny(state, ["ops.approve", "approvals.manage"]);
  if (blocked) return { ok: false, error: blocked };
  let next = cloneState(state);
  ensureOpsCollections(next);
  const req0 = getRequest(next, requestId);
  if (!req0) return { ok: false, error: "Request not found." };
  if (
    !["Pending Approval", "Partially Approved", "Acknowledged", "Submitted"].includes(req0.status)
  ) {
    return { ok: false, error: `Cannot approve from status ${req0.status}.` };
  }
  if (!req0.acknowledgedAt) {
    const ack = acknowledgeOpsRequest(next, requestId);
    if (!ack.ok) return ack;
    next = ack.data.state;
  }
  const live = getRequest(next, requestId)!;
  const lines = getLines(next, requestId);
  const now = new Date().toISOString();

  if (decision === "Rejected") {
    live.status = "Rejected";
    live.rejectedAt = now;
    live.rejectedBy = next.currentUser;
    live.rejectionReason = input?.note;
    for (const line of lines) line.approvedQty = 0;
    if (live.approvalId) {
      const ap = next.approvals.find((a) => a.id === live.approvalId);
      if (ap && ap.status === "Pending") {
        ap.status = "Rejected";
        ap.decidedAt = now;
        ap.decidedBy = next.currentUser;
        ap.decisionNote = input?.note;
      }
    }
    touch(live, now);
    pushAudit(next, {
      action: "ops.request_rejected",
      entityType: "ops_request",
      entityId: requestId,
      summary: `Rejected ${live.number}.`,
      at: now,
    });
    pushActivity(
      next,
      requestId,
      "rejected",
      `Rejected: ${input?.note ?? "no reason"}`,
      undefined,
      now,
    );
    return { ok: true, data: { state: next, data: { requestId } } };
  }

  if (decision === "Partial" && input?.lineApprovals?.length) {
    for (const la of input.lineApprovals) {
      const line = lines.find((l) => l.id === la.lineId);
      if (!line) continue;
      const max = line.requestedQty - line.cancelledQty;
      if (la.approvedQty < 0 || la.approvedQty > max) {
        return { ok: false, error: `Approved qty for line must be 0–${max}.` };
      }
      line.approvedQty = la.approvedQty;
    }
  } else {
    for (const line of lines) {
      line.approvedQty = line.requestedQty - line.cancelledQty;
    }
  }

  const allFull = lines.every((l) => l.approvedQty >= l.requestedQty - l.cancelledQty);
  const any = lines.some((l) => l.approvedQty > 0);
  if (!any) return { ok: false, error: "Approve at least one line quantity." };

  live.status = allFull ? "Approved" : "Partially Approved";
  live.approvedAt = now;
  live.approvedBy = next.currentUser;
  if (live.approvalId) {
    const ap = next.approvals.find((a) => a.id === live.approvalId);
    if (ap && ap.status === "Pending") {
      ap.status = "Approved";
      ap.decidedAt = now;
      ap.decidedBy = next.currentUser;
      ap.decisionNote = input?.note ?? (allFull ? "Full" : "Partial");
    }
  }
  touch(live, now);

  const shortageNotes = lines
    .filter((l) => opsOutstandingShortage(l) > 0)
    .map((l) => {
      const p = next.products.find((x) => x.id === l.productId);
      return `${p?.name ?? l.productId} outstanding ${opsOutstandingShortage(l)}`;
    });

  pushAudit(next, {
    action: "ops.request_approved",
    entityType: "ops_request",
    entityId: requestId,
    summary: `${allFull ? "Approved" : "Partially approved"} ${live.number}.`,
    at: now,
  });
  pushActivity(
    next,
    requestId,
    allFull ? "approved" : "partially_approved",
    `${live.status}${shortageNotes.length ? ` · ${shortageNotes.join("; ")}` : ""}`,
    undefined,
    now,
  );
  if (shortageNotes.length) {
    pushOpsNotification(next, {
      type: "ops_outstanding",
      title: `Outstanding on ${live.number}`,
      body: shortageNotes.join("; "),
      opsRequestId: requestId,
      targetUserId: live.requestedByUserId,
      dedupeKey: `ops-out-${requestId}-${now.slice(0, 10)}`,
    });
  }
  pushOpsNotification(next, {
    type: "ops_approval_needed",
    title: `${live.status} · ${live.number}`,
    body: live.title,
    opsRequestId: requestId,
    targetRole: "Warehouse",
    dedupeKey: `ops-apr-done-${requestId}`,
  });

  return { ok: true, data: { state: next, data: { requestId } } };
}

export function reviewOpsWarehouse(
  state: TlbState,
  requestId: string,
  input: {
    lines: Array<{
      lineId: string;
      fulfilWarehouseId?: string | undefined;
      availability: OpsWarehouseAvailability;
      availabilityNote?: string | undefined;
      fefoBatchId?: string | undefined;
      fefoOverrideReason?: string | undefined;
      clarificationNote?: string | undefined;
    }>;
  },
): MutResult<{ requestId: string }> {
  const blocked = requireAny(state, ["ops.warehouse", "stock.issue", "stock.view"]);
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  if (!["Approved", "Partially Approved", "Warehouse Review", "Preparing"].includes(req.status)) {
    return { ok: false, error: `Cannot warehouse-review from ${req.status}.` };
  }
  const now = new Date().toISOString();
  for (const row of input.lines) {
    const line = next.opsRequestLines.find((l) => l.id === row.lineId && l.requestId === requestId);
    if (!line) continue;
    if (row.fulfilWarehouseId) line.fulfilWarehouseId = row.fulfilWarehouseId;
    line.availability = row.availability;
    line.availabilityNote = row.availabilityNote;
    const wh = line.fulfilWarehouseId ?? line.warehouseId;
    const recommended = recommendBatches(next, line.productId, wh, line.approvedQty);
    const defaultBatch = recommended[0]?.batchId;
    if (
      row.fefoBatchId &&
      defaultBatch &&
      row.fefoBatchId !== defaultBatch &&
      !row.fefoOverrideReason?.trim()
    ) {
      return { ok: false, error: "Overriding FEFO recommendation requires a reason." };
    }
    line.fefoBatchId = row.fefoBatchId ?? defaultBatch;
    line.fefoOverrideReason = row.fefoOverrideReason;
    line.clarificationNote = row.clarificationNote;
    if (row.availability === "Clarification" && !row.clarificationNote?.trim()) {
      return { ok: false, error: "Clarification status requires a note." };
    }
  }
  req.status = "Warehouse Review";
  req.warehouseReviewedAt = now;
  req.warehouseReviewedBy = next.currentUser;
  touch(req, now);
  pushAudit(next, {
    action: "ops.warehouse_reviewed",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Warehouse reviewed ${req.number}.`,
    at: now,
  });
  pushActivity(
    next,
    requestId,
    "warehouse_review",
    `Warehouse availability reviewed.`,
    undefined,
    now,
  );
  return { ok: true, data: { state: next, data: { requestId } } };
}

export function prepareOpsRequest(
  state: TlbState,
  requestId: string,
  input: {
    lines: Array<{
      lineId: string;
      preparedQty: number;
      fefoBatchId?: string;
      fefoOverrideReason?: string;
    }>;
  },
): MutResult<{ requestId: string }> {
  const blocked = requireAny(state, ["ops.warehouse", "stock.issue"]);
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  if (
    ![
      "Approved",
      "Partially Approved",
      "Warehouse Review",
      "Preparing",
      "Ready for Collection",
    ].includes(req.status)
  ) {
    return { ok: false, error: `Cannot prepare from ${req.status}.` };
  }
  const now = new Date().toISOString();
  for (const row of input.lines) {
    const line = next.opsRequestLines.find((l) => l.id === row.lineId && l.requestId === requestId);
    if (!line) continue;
    if (row.preparedQty < 0 || row.preparedQty > line.approvedQty) {
      return { ok: false, error: `Prepared qty must be ≤ approved (${line.approvedQty}).` };
    }
    if (row.fefoBatchId) {
      const wh = line.fulfilWarehouseId ?? line.warehouseId;
      const recommended = recommendBatches(next, line.productId, wh, row.preparedQty);
      const defaultBatch = recommended[0]?.batchId;
      if (
        defaultBatch &&
        row.fefoBatchId !== defaultBatch &&
        !row.fefoOverrideReason?.trim() &&
        !line.fefoOverrideReason
      ) {
        return { ok: false, error: "FEFO override requires a reason." };
      }
      line.fefoBatchId = row.fefoBatchId;
      if (row.fefoOverrideReason) line.fefoOverrideReason = row.fefoOverrideReason;
    }
    line.preparedQty = row.preparedQty;
  }
  req.status = "Preparing";
  req.preparedAt = now;
  req.preparedBy = next.currentUser;
  touch(req, now);
  pushAudit(next, {
    action: "ops.prepared",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Prepared ${req.number}.`,
    at: now,
  });
  pushActivity(next, requestId, "prepared", `Preparation quantities set.`, undefined, now);
  return { ok: true, data: { state: next, data: { requestId } } };
}

export function markOpsReadyForCollection(
  state: TlbState,
  requestId: string,
): MutResult<{ requestId: string }> {
  const blocked = requireAny(state, ["ops.warehouse", "stock.issue"]);
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  const lines = getLines(next, requestId).filter((l) => l.approvedQty > 0);
  if (!lines.length) return { ok: false, error: "No approved lines to prepare." };
  if (lines.some((l) => l.preparedQty <= 0)) {
    return { ok: false, error: "Set prepared quantities before Ready for Collection." };
  }
  if (lines.some((l) => l.preparedQty > l.approvedQty)) {
    return { ok: false, error: "Prepared cannot exceed approved." };
  }
  const now = new Date().toISOString();
  req.status = "Ready for Collection";
  req.readyAt = now;
  touch(req, now);
  pushAudit(next, {
    action: "ops.ready_collection",
    entityType: "ops_request",
    entityId: requestId,
    summary: `${req.number} ready for collection.`,
    at: now,
  });
  pushActivity(next, requestId, "ready", `Ready for collection.`, undefined, now);
  pushOpsNotification(next, {
    type: "ops_ready_collection",
    title: `Ready · ${req.number}`,
    body: `${req.title} ready for driver collection.`,
    opsRequestId: requestId,
    targetRole: "Driver",
    dedupeKey: `ops-ready-${requestId}`,
  });
  return { ok: true, data: { state: next, data: { requestId } } };
}

export function releaseOpsGoods(
  state: TlbState,
  requestId: string,
  input?: { driverId?: string | undefined; vehicle?: string | undefined },
): MutResult<{ requestId: string; issueId: string; issueNumber: string }> {
  const blocked = requireAny(state, ["ops.warehouse", "stock.issue"]);
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  if (req.status !== "Ready for Collection" && req.status !== "Preparing") {
    return { ok: false, error: `Cannot release from ${req.status}.` };
  }
  const lines = getLines(next, requestId).filter((l) => l.preparedQty > 0);
  if (!lines.length) return { ok: false, error: "Nothing prepared to release." };

  const now = new Date().toISOString();
  const issueNumbered = nextDocumentNumber("stockIssue", next.counters);
  next.counters = issueNumbered.counters;
  const issueId = uid("iss");
  const primaryWh = lines[0]!.fulfilWarehouseId ?? lines[0]!.warehouseId;

  next.stockIssues.unshift({
    id: issueId,
    number: issueNumbered.number,
    reason:
      req.type === "Sample"
        ? "Sample"
        : req.type === "Factory Draw"
          ? "Production"
          : "Internal use",
    warehouseId: primaryWh,
    issuedAt: now,
    issuedBy: next.currentUser,
    opsRequestId: requestId,
    notes: `Release for ${req.number}`,
  });

  for (const line of lines) {
    const wh = line.fulfilWarehouseId ?? line.warehouseId;
    const qty = line.preparedQty;
    const bal = getOrCreateBalance(next, line.productId, wh);
    if (
      calcAvailable(bal) < qty &&
      !next.products.find((p) => p.id === line.productId)?.allowNegativeStock
    ) {
      return {
        ok: false,
        error: `Insufficient stock to release ${qty} of product ${line.productId}.`,
      };
    }
    const picks = line.fefoBatchId
      ? [
          {
            batchId: line.fefoBatchId,
            code: next.batches.find((b) => b.id === line.fefoBatchId)?.code ?? "",
            quantity: qty,
          },
        ]
      : recommendBatches(next, line.productId, wh, qty);
    try {
      if (picks.length) {
        let left = qty;
        for (const pick of picks) {
          const take = Math.min(left, pick.quantity);
          if (take <= 0) continue;
          consumeBatch(next, pick.batchId, take);
          postStockMovement(next, {
            type: "issue",
            productId: line.productId,
            warehouseId: wh,
            quantity: take,
            batchId: pick.batchId,
            reason: `Ops release ${req.number}`,
            refType: "ops_request",
            refId: requestId,
            refNumber: req.number,
            at: now,
          });
          next.stockIssueLines.push({
            id: uid("issl"),
            issueId,
            productId: line.productId,
            warehouseId: wh,
            batchId: pick.batchId,
            quantity: take,
          });
          left -= take;
        }
        if (left > 0) return { ok: false, error: "Not enough batch qty for FEFO release." };
      } else {
        postStockMovement(next, {
          type: "issue",
          productId: line.productId,
          warehouseId: wh,
          quantity: qty,
          reason: `Ops release ${req.number}`,
          refType: "ops_request",
          refId: requestId,
          refNumber: req.number,
          at: now,
        });
        next.stockIssueLines.push({
          id: uid("issl"),
          issueId,
          productId: line.productId,
          warehouseId: wh,
          quantity: qty,
        });
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Release failed." };
    }
    line.issuedQty = qty;
  }

  req.stockIssueId = issueId;
  req.stockIssueNumber = issueNumbered.number;
  req.releasedAt = now;
  req.releasedBy = next.currentUser;
  req.status = "Issued";
  touch(req, now);

  if (input?.driverId) {
    const driver = next.opsDrivers.find((d) => d.id === input.driverId && !d.deletedAt && d.active);
    if (!driver) return { ok: false, error: "Driver not found or inactive." };
    req.driverId = driver.id;
    req.driverName = driver.name;
    req.vehicle = input.vehicle ?? driver.vehicle;
    req.driverStatus = "Assigned";
    req.assignedAt = now;
    pushOpsNotification(next, {
      type: "ops_driver_assigned",
      title: `Assigned · ${req.number}`,
      body: `Driver ${driver.name}`,
      opsRequestId: requestId,
      ...(driver.userId ? { targetUserId: driver.userId } : {}),
      targetRole: "Driver",
      dedupeKey: `ops-drv-${requestId}`,
    });
  }

  pushCustody(
    next,
    requestId,
    "warehouse",
    "driver",
    `Goods released ${issueNumbered.number} — custody to driver.`,
    req.driverName,
    now,
  );
  pushAudit(next, {
    action: "ops.released",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Released ${req.number} via ${issueNumbered.number}.`,
    at: now,
    meta: { issueId, issueNumber: issueNumbered.number },
  });
  pushActivity(
    next,
    requestId,
    "released",
    `Goods released (${issueNumbered.number}) — ledger posted.`,
    undefined,
    now,
  );

  return {
    ok: true,
    data: { state: next, data: { requestId, issueId, issueNumber: issueNumbered.number } },
  };
}

export function assignOpsDriver(
  state: TlbState,
  requestId: string,
  driverId: string,
  vehicle?: string,
): MutResult<{ requestId: string }> {
  const blocked = requireAny(state, ["ops.dispatch", "ops.warehouse", "delivery.manage"]);
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  const driver = next.opsDrivers.find((d) => d.id === driverId && d.active && !d.deletedAt);
  if (!driver) return { ok: false, error: "Driver not found or inactive." };
  const now = new Date().toISOString();
  req.driverId = driver.id;
  req.driverName = driver.name;
  req.vehicle = vehicle ?? driver.vehicle;
  req.driverStatus = req.driverStatus ?? "Assigned";
  req.assignedAt = now;
  touch(req, now);
  pushAudit(next, {
    action: "ops.driver_assigned",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Driver ${driver.name} → ${req.number}.`,
    at: now,
  });
  pushActivity(
    next,
    requestId,
    "driver_assigned",
    `Assigned driver ${driver.name}${req.vehicle ? ` · ${req.vehicle}` : ""}.`,
    undefined,
    now,
  );
  pushOpsNotification(next, {
    type: "ops_driver_assigned",
    title: `Job ${req.number}`,
    body: `${req.destination}`,
    opsRequestId: requestId,
    targetUserId: driver.userId,
    targetRole: "Driver",
    dedupeKey: `ops-drv-asg-${requestId}`,
  });
  return { ok: true, data: { state: next, data: { requestId } } };
}

const DRIVER_TRANSITIONS: Record<OpsDriverJobStatus, OpsDriverJobStatus[]> = {
  Assigned: ["En Route Warehouse", "Problem"],
  "En Route Warehouse": ["Arrived Warehouse", "Problem"],
  "Arrived Warehouse": ["Collected", "Problem"],
  Collected: ["Departed", "Problem"],
  Departed: ["Arrived Destination", "Problem"],
  "Arrived Destination": ["Delivered", "Problem"],
  Delivered: [],
  Problem: ["Assigned", "En Route Warehouse", "Arrived Warehouse"],
};

export function advanceOpsDriverStatus(
  state: TlbState,
  requestId: string,
  toStatus: OpsDriverJobStatus,
  note?: string,
): MutResult<{ requestId: string }> {
  const blocked = requireAny(state, [
    "ops.drive",
    "ops.dispatch",
    "delivery.manage",
    "ops.warehouse",
  ]);
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  if (!req.driverId) return { ok: false, error: "No driver assigned." };
  const from = req.driverStatus ?? "Assigned";
  const allowed = DRIVER_TRANSITIONS[from] ?? [];
  if (!allowed.includes(toStatus) && toStatus !== "Problem") {
    return { ok: false, error: `Cannot move driver status ${from} → ${toStatus}.` };
  }
  const now = new Date().toISOString();
  req.driverStatus = toStatus;
  touch(req, now);

  if (toStatus === "Collected") {
    req.driverCollectConfirmed = true;
    req.collectedByDriver = next.currentUser;
    if (req.warehouseCollectConfirmed) {
      req.collectedAt = now;
      req.status = "Collected";
    }
  }
  if (toStatus === "Departed") {
    req.departedAt = now;
    req.status = "In Transit";
    pushOpsNotification(next, {
      type: "ops_in_transit",
      title: `In transit · ${req.number}`,
      body: `Departed toward ${req.destination}`,
      opsRequestId: requestId,
      targetUserId: req.requestedByUserId,
      dedupeKey: `ops-transit-${requestId}`,
    });
  }
  if (toStatus === "Arrived Destination") req.arrivedDestAt = now;
  if (toStatus === "Delivered") {
    req.status = req.status === "Partially Delivered" ? "Partially Delivered" : "Delivered";
    req.deliveredAt = now;
  }

  pushAudit(next, {
    action: "ops.driver_status",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Driver ${from} → ${toStatus} on ${req.number}.`,
    at: now,
    meta: { note: note ?? null },
  });
  pushActivity(
    next,
    requestId,
    "driver_status",
    `Driver: ${from} → ${toStatus}${note ? ` · ${note}` : ""}`,
    undefined,
    now,
  );
  return { ok: true, data: { state: next, data: { requestId } } };
}

export function confirmOpsWarehouseCollection(
  state: TlbState,
  requestId: string,
): MutResult<{ requestId: string }> {
  const blocked = requireAny(state, ["ops.warehouse", "stock.issue"]);
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  if (!req.releasedAt && req.status !== "Issued" && req.status !== "Ready for Collection") {
    return { ok: false, error: "Release goods before collection confirmation." };
  }
  const now = new Date().toISOString();
  req.warehouseCollectConfirmed = true;
  req.collectedByWarehouse = next.currentUser;
  if (req.driverCollectConfirmed) {
    req.collectedAt = now;
    req.status = "Collected";
    pushCustody(
      next,
      requestId,
      "warehouse",
      "driver",
      `Dual-confirmed collection of ${req.number}.`,
      req.driverName,
      now,
    );
  }
  touch(req, now);
  pushAudit(next, {
    action: "ops.collected",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Warehouse confirmed collection ${req.number}.`,
    at: now,
  });
  pushActivity(
    next,
    requestId,
    "warehouse_collect",
    `Warehouse dual-confirm collection.`,
    undefined,
    now,
  );
  return { ok: true, data: { state: next, data: { requestId } } };
}

export function confirmOpsDeliveryReceipt(
  state: TlbState,
  requestId: string,
  input: {
    outcome: OpsReceiptOutcome;
    receivedBy: string;
    notes?: string | undefined;
    lines: Array<{
      lineId: string;
      receivedQty: number;
      missingQty?: number | undefined;
      damagedQty?: number | undefined;
      wrongQty?: number | undefined;
      rejectedQty?: number | undefined;
    }>;
  },
): MutResult<{ requestId: string }> {
  const blocked = requireAny(state, ["ops.receive", "ops.request", "delivery.manage", "ops.view"]);
  if (blocked) return { ok: false, error: blocked };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  if (
    !["In Transit", "Collected", "Issued", "Partially Delivered"].includes(req.status) &&
    req.driverStatus !== "Arrived Destination"
  ) {
    return { ok: false, error: `Cannot confirm delivery from ${req.status}.` };
  }
  const now = new Date().toISOString();

  for (const row of input.lines) {
    const line = next.opsRequestLines.find((l) => l.id === row.lineId && l.requestId === requestId);
    if (!line) continue;
    if (row.receivedQty < 0 || row.receivedQty > line.issuedQty) {
      return { ok: false, error: `Received qty must be 0–issued (${line.issuedQty}).` };
    }
    line.receivedQty = row.receivedQty;
    line.missingQty =
      row.missingQty ??
      Math.max(
        0,
        line.issuedQty -
          row.receivedQty -
          (row.damagedQty ?? 0) -
          (row.wrongQty ?? 0) -
          (row.rejectedQty ?? 0),
      );
    line.damagedQty = row.damagedQty ?? 0;
    line.wrongQty = row.wrongQty ?? 0;
    line.rejectedQty = row.rejectedQty ?? 0;

    if (line.missingQty > 0) {
      next.opsDiscrepancies.unshift({
        id: uid("odsc"),
        requestId,
        lineId: line.id,
        productId: line.productId,
        kind: "missing",
        quantity: line.missingQty,
        notes: `Delivery missing — separate from warehouse outstanding ${opsOutstandingShortage(line)}`,
        loggedAt: now,
        loggedBy: next.currentUser,
      });
    }
    if (line.damagedQty > 0) {
      next.opsDiscrepancies.unshift({
        id: uid("odsc"),
        requestId,
        lineId: line.id,
        productId: line.productId,
        kind: "damaged",
        quantity: line.damagedQty,
        loggedAt: now,
        loggedBy: next.currentUser,
      });
    }
    if (line.wrongQty > 0) {
      next.opsDiscrepancies.unshift({
        id: uid("odsc"),
        requestId,
        lineId: line.id,
        productId: line.productId,
        kind: "wrong",
        quantity: line.wrongQty,
        loggedAt: now,
        loggedBy: next.currentUser,
      });
    }
    if (line.rejectedQty > 0) {
      next.opsDiscrepancies.unshift({
        id: uid("odsc"),
        requestId,
        lineId: line.id,
        productId: line.productId,
        kind: "rejected",
        quantity: line.rejectedQty,
        loggedAt: now,
        loggedBy: next.currentUser,
      });
    }
  }

  const lines = getLines(next, requestId).filter((l) => l.issuedQty > 0);
  const allFull = lines.every(
    (l) => l.receivedQty >= l.issuedQty && l.missingQty === 0 && l.damagedQty === 0,
  );
  const anyShort = lines.some(
    (l) => l.receivedQty < l.issuedQty || l.missingQty > 0 || l.damagedQty > 0,
  );

  req.receiptOutcome = input.outcome;
  req.receivedBy = input.receivedBy;
  req.receiptNotes = input.notes;
  req.deliveredAt = now;
  req.driverStatus = "Delivered";
  req.status = allFull && !anyShort ? "Delivered" : "Partially Delivered";
  touch(req, now);

  pushCustody(
    next,
    requestId,
    "driver",
    "destination",
    `Delivery confirmed at ${req.destination}.`,
    input.receivedBy,
    now,
  );
  pushAudit(next, {
    action: "ops.delivery_confirmed",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Delivery ${req.status} for ${req.number}.`,
    at: now,
  });
  pushActivity(
    next,
    requestId,
    "delivery_confirmed",
    `Receipt ${input.outcome}: three-way REQUESTED vs ISSUED vs RECEIVED recorded.`,
    undefined,
    now,
  );
  if (anyShort) {
    pushAudit(next, {
      action: "ops.discrepancy_logged",
      entityType: "ops_request",
      entityId: requestId,
      summary: `Discrepancies logged on ${req.number} (shortage outstanding unchanged).`,
      at: now,
    });
    pushOpsNotification(next, {
      type: "ops_discrepancy",
      title: `Discrepancy · ${req.number}`,
      body: input.notes ?? "Delivery discrepancy logged",
      opsRequestId: requestId,
      targetRole: "Manager",
      dedupeKey: `ops-disc-${requestId}-${now}`,
    });
  }
  pushOpsNotification(next, {
    type: "ops_delivery_confirmed",
    title: `${req.status} · ${req.number}`,
    body: `Received by ${input.receivedBy}`,
    opsRequestId: requestId,
    targetUserId: req.requestedByUserId,
    dedupeKey: `ops-del-${requestId}`,
  });

  return { ok: true, data: { state: next, data: { requestId } } };
}

export function postOpsMessage(
  state: TlbState,
  requestId: string,
  body: string,
  chip?: OpsMessageChip,
): MutResult<{ messageId: string }> {
  const blocked = requireAny(state, [
    "ops.communicate",
    "ops.request",
    "ops.view",
    "ops.warehouse",
    "ops.drive",
  ]);
  if (blocked) return { ok: false, error: blocked };
  const text = body.trim() || chip || "";
  if (!text) return { ok: false, error: "Message body or chip required." };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  const now = new Date().toISOString();
  const messageId = uid("omsg");
  next.opsMessages.push({
    id: messageId,
    requestId,
    at: now,
    actor: next.currentUser,
    actorUserId: next.currentUserId,
    body: body.trim() || String(chip),
    chip,
  });
  pushAudit(next, {
    action: "ops.message_posted",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Message on ${req.number}: ${chip ?? body.slice(0, 80)}`,
    at: now,
  });
  pushActivity(
    next,
    requestId,
    "message",
    chip ? `[${chip}] ${body.trim()}`.trim() : body.trim(),
    undefined,
    now,
  );
  pushOpsNotification(next, {
    type: "ops_message",
    title: `Message · ${req.number}`,
    body: chip ?? body.trim().slice(0, 120),
    opsRequestId: requestId,
    targetUserId: req.requestedByUserId !== next.currentUserId ? req.requestedByUserId : undefined,
    targetRole: "Warehouse",
    dedupeKey: `ops-msg-${messageId}`,
  });
  return { ok: true, data: { state: next, data: { messageId } } };
}

export function cancelOpsRequest(
  state: TlbState,
  requestId: string,
  reason: string,
): MutResult<{ requestId: string }> {
  const blocked = requireAny(state, ["ops.request", "ops.approve", "approvals.manage"]);
  if (blocked) return { ok: false, error: blocked };
  if (!reason.trim()) return { ok: false, error: "Cancellation reason required." };
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  if (
    ["Issued", "Collected", "In Transit", "Delivered", "Partially Delivered", "Closed"].includes(
      req.status,
    )
  ) {
    return { ok: false, error: "Cannot cancel after goods release." };
  }
  const now = new Date().toISOString();
  req.status = "Cancelled";
  req.notes = [req.notes, `Cancelled: ${reason.trim()}`].filter(Boolean).join(" · ");
  touch(req, now);
  pushAudit(next, {
    action: "ops.request_cancelled",
    entityType: "ops_request",
    entityId: requestId,
    summary: `Cancelled ${req.number}.`,
    at: now,
  });
  pushActivity(next, requestId, "cancelled", reason.trim(), undefined, now);
  return { ok: true, data: { state: next, data: { requestId } } };
}

export function autoReviewOpsLines(
  state: TlbState,
  requestId: string,
): MutResult<{ requestId: string }> {
  const next = cloneState(state);
  ensureOpsCollections(next);
  const req = getRequest(next, requestId);
  if (!req) return { ok: false, error: "Request not found." };
  const lines = getLines(next, requestId);
  const reviews = lines.map((line) => {
    const needed = line.approvedQty > 0 ? line.approvedQty : line.requestedQty;
    const best = bestFulfilWarehouse(next, line.productId, needed, line.warehouseId);
    const availRows = warehouseAvailabilityForProduct(next, line.productId, needed);
    const note = availRows
      .filter((r) => r.available > 0)
      .slice(0, 3)
      .map((r) => `${r.warehouseName} can fulfil ${r.available}`)
      .join("; ");
    const recommended = recommendBatches(
      next,
      line.productId,
      best?.warehouseId ?? line.warehouseId,
      needed,
    );
    return {
      lineId: line.id,
      fulfilWarehouseId: best?.warehouseId ?? line.warehouseId,
      availability: (best?.status ?? "Out of Stock") as OpsWarehouseAvailability,
      availabilityNote: note || "No warehouse stock",
      ...(recommended[0]?.batchId ? { fefoBatchId: recommended[0].batchId } : {}),
    };
  });
  return reviewOpsWarehouse(next, requestId, { lines: reviews });
}

/** Active assignment that blocks moving a driver to trash (in transit / open jobs). */
export function findDriverBlockingAssignment(
  state: TlbState,
  driverId: string,
): OpsRequest | undefined {
  return (state.opsRequests ?? []).find((r) => {
    if (r.deletedAt || r.driverId !== driverId) return false;
    if (["Delivered", "Closed", "Cancelled", "Rejected"].includes(r.status)) return false;
    if (r.driverStatus === "Delivered") return false;
    return (
      ["Ready for Collection", "Issued", "Collected", "In Transit", "Partially Delivered"].includes(
        r.status,
      ) || r.driverStatus != null
    );
  });
}

export function listDriverTodayJobs(state: TlbState, driverId?: string): OpsRequest[] {
  const today = new Date().toISOString().slice(0, 10);
  return (state.opsRequests ?? []).filter((r) => {
    if (r.deletedAt) return false;
    if (driverId && r.driverId !== driverId) return false;
    if (!r.driverId) return false;
    if (
      ["Delivered", "Closed", "Cancelled", "Rejected"].includes(r.status) &&
      r.deliveredAt &&
      !r.deliveredAt.startsWith(today)
    ) {
      return false;
    }
    return (
      ["Ready for Collection", "Issued", "Collected", "In Transit", "Partially Delivered"].includes(
        r.status,
      ) ||
      (r.driverStatus != null && r.driverStatus !== "Delivered")
    );
  });
}

export type { OpsDriver };
