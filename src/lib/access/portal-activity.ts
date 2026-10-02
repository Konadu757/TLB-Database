/**
 * Cloud portal activity: login recording + Owner hydrate.
 * Durable rows live in tlb.activity_events (via public RPCs).
 */
import { supabase } from "@/integrations/supabase/client";
import type { AuditAction, AuditEvent } from "@/lib/domain/types";

export type CloudActivityEvent = {
  id: string;
  createdAt: string;
  actorId?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  meta?: Record<string, string | number | boolean | null> | null;
};

async function rpc(fn: string, args: Record<string, unknown>) {
  return supabase.rpc(fn as never, args as never);
}

/** After a successful Auth sign-in, persist a cloud activity row (non-fatal on failure). */
export async function recordPortalLoginActivity(): Promise<
  { ok: true; id?: string } | { ok: false; error: string }
> {
  try {
    const userAgent =
      typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
        ? navigator.userAgent.slice(0, 400)
        : null;
    const { data, error } = await rpc("record_portal_login", {
      p_user_agent: userAgent,
      p_ip: null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: typeof data === "string" ? data : undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function parseMeta(raw: unknown): CloudActivityEvent["meta"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }
  return out;
}

function parseActivityEvents(data: unknown): CloudActivityEvent[] {
  if (!Array.isArray(data)) return [];
  const out: CloudActivityEvent[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const item = row as Record<string, unknown>;
    const id = typeof item["id"] === "string" ? item["id"] : "";
    const createdAt =
      typeof item["created_at"] === "string"
        ? item["created_at"]
        : typeof item["createdAt"] === "string"
          ? item["createdAt"]
          : "";
    const action = typeof item["action"] === "string" ? item["action"] : "";
    const summary = typeof item["summary"] === "string" ? item["summary"] : "";
    const entityType =
      typeof item["entity_type"] === "string"
        ? item["entity_type"]
        : typeof item["entityType"] === "string"
          ? item["entityType"]
          : "user";
    if (!id || !createdAt || !action || !summary) continue;
    out.push({
      id,
      createdAt,
      actorId:
        typeof item["actor_id"] === "string"
          ? item["actor_id"]
          : item["actor_id"] == null
            ? null
            : undefined,
      actorEmail: typeof item["actor_email"] === "string" ? item["actor_email"] : null,
      actorName: typeof item["actor_name"] === "string" ? item["actor_name"] : null,
      actorRole: typeof item["actor_role"] === "string" ? item["actor_role"] : null,
      action,
      entityType,
      entityId:
        typeof item["entity_id"] === "string"
          ? item["entity_id"]
          : item["entity_id"] == null
            ? null
            : undefined,
      summary,
      meta: parseMeta(item["meta"]),
    });
  }
  return out;
}

/** Owner (or audit.view) loads recent cloud activity for Audit / Activity UI. */
export async function fetchActivityEventsFromSupabase(
  limit = 150,
): Promise<{ ok: true; data: CloudActivityEvent[] } | { ok: false; error: string }> {
  try {
    const { data, error } = await rpc("list_activity_events", {
      p_limit: Math.max(1, Math.min(limit, 500)),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: parseActivityEvents(data) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

const KNOWN_AUDIT_ACTIONS = new Set<string>([
  "user.login",
  "user.invite_issued",
  "user.invite_accepted",
  "user.role_assigned",
  "user.updated",
  "role.deleted",
  "record.trashed",
  "record.purged",
]);

/** Map cloud activity rows into AuditEvent shape for the existing Audit Log UI. */
export function activityEventsToAudit(events: CloudActivityEvent[]): AuditEvent[] {
  return events.map((event) => {
    const action = (
      KNOWN_AUDIT_ACTIONS.has(event.action) ? event.action : "user.updated"
    ) as AuditAction;
    const actor =
      event.actorName?.trim() ||
      event.actorEmail?.trim() ||
      event.actorRole?.trim() ||
      "Portal";
    return {
      id: `act-${event.id}`,
      at: event.createdAt,
      actor,
      action,
      entityType: event.entityType || "user",
      entityId: event.entityId?.trim() || event.actorId?.trim() || event.id,
      summary: event.summary,
      meta: event.meta ?? undefined,
    };
  });
}

/**
 * Merge cloud activity into local audit (cloud wins on same id; keep newest first).
 * Local-only rows without act- prefix are preserved.
 */
export function mergeCloudActivityIntoAudit(
  local: AuditEvent[],
  cloud: CloudActivityEvent[],
): AuditEvent[] {
  if (!cloud.length) return local;
  const fromCloud = activityEventsToAudit(cloud);
  const byId = new Map<string, AuditEvent>();
  for (const row of fromCloud) byId.set(row.id, row);
  for (const row of local) {
    if (byId.has(row.id)) continue;
    if (row.action === "user.login") {
      const dup = fromCloud.some(
        (c) =>
          c.action === "user.login" &&
          Math.abs(new Date(c.at).getTime() - new Date(row.at).getTime()) < 60_000 &&
          (c.summary === row.summary || c.entityId === row.entityId),
      );
      if (dup) continue;
    }
    byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 500);
}
