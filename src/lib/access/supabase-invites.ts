/**
 * Browser calls for tlb invites. Uses the publishable key only.
 * public.create_invite / public.accept_invite / public.validate_invite are the Data API names.
 * Neither call sends or stores a service-role key.
 */

import { supabase } from "@/integrations/supabase/client";
import type { CloudStaffAccessStatus } from "@/lib/domain/invites";
import type { HostedInviteAcceptance } from "@/lib/store/tlb-store";

type RpcResult = { data: unknown; error: { message: string } | null };

const CLOUD_INVITE_TIMEOUT_MS = 6_000;

export type HostedInvitePreview = {
  email: string;
  fullName: string;
  roleCode: string;
  accessCode?: string;
  /** Phone/contact when present on the invite row (optional column). */
  contact?: string;
};

async function rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const client = supabase as unknown as {
    rpc: (name: string, params: Record<string, unknown>) => Promise<RpcResult>;
  };
  return client.rpc(fn, args);
}

async function rpcWithTimeout(
  fn: string,
  args: Record<string, unknown>,
  timeoutMs = CLOUD_INVITE_TIMEOUT_MS,
): Promise<RpcResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Force a real Promise so Promise.race always settles on timeout
    // (PostgREST builders are thenable but can confuse some runtimes).
    const rpcPromise = Promise.resolve().then(() => rpc(fn, args));
    return await Promise.race([
      rpcPromise,
      new Promise<RpcResult>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${fn}.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseInviteProfile(data: unknown): HostedInviteAcceptance | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const profileId = typeof row["profile_id"] === "string" ? row["profile_id"] : "";
  const email = typeof row["email"] === "string" ? row["email"] : "";
  const fullName = typeof row["full_name"] === "string" ? row["full_name"] : "";
  const roleCode = typeof row["role_code"] === "string" ? row["role_code"] : "";
  if (!profileId || !email || !fullName || !roleCode) return null;
  return { profileId, email, fullName, roleCode };
}

function parseInvitePreview(data: unknown): HostedInvitePreview | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const email = typeof row["email"] === "string" ? row["email"] : "";
  const fullName = typeof row["full_name"] === "string" ? row["full_name"] : "";
  const roleCode = typeof row["role_code"] === "string" ? row["role_code"] : "";
  const accessCode = typeof row["access_code"] === "string" ? row["access_code"] : undefined;
  const contactRaw =
    (typeof row["phone"] === "string" && row["phone"]) ||
    (typeof row["contact"] === "string" && row["contact"]) ||
    "";
  const contact = contactRaw.trim() || undefined;
  if (!email || !fullName || !roleCode) return null;
  return {
    email,
    fullName,
    roleCode,
    ...(accessCode ? { accessCode } : {}),
    ...(contact ? { contact } : {}),
  };
}

export async function createInviteOnSupabase(input: {
  email: string;
  fullName: string;
  roleCode: string;
  token: string;
  accessCode: string;
  replacesToken?: string;
  phone?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const baseArgs: Record<string, unknown> = {
    p_email: input.email,
    p_full_name: input.fullName,
    p_role_code: input.roleCode,
    p_token: input.token,
    p_access_code: input.accessCode,
    p_expires_at: null,
    p_replaces_token: input.replacesToken ?? null,
  };
  const phone = input.phone?.trim();

  const attempt = async (args: Record<string, unknown>) => {
    const { data, error } = await rpcWithTimeout("create_invite", args);
    if (error) return { ok: false as const, error: `Supabase invite was not stored: ${error.message}` };
    if (!data) return { ok: false as const, error: "Supabase invite was not stored." };
    return { ok: true as const };
  };

  try {
    if (phone) {
      const withPhone = await attempt({ ...baseArgs, p_phone: phone });
      if (withPhone.ok) return withPhone;
      // Older create_invite (no p_phone) — retry without phone so Re-issue still works.
      const missingPhoneArg =
        /Could not find the function public\.create_invite/i.test(withPhone.error) ||
        /p_phone/i.test(withPhone.error) ||
        /schema cache/i.test(withPhone.error);
      if (missingPhoneArg) {
        // Must await — a bare `return attempt(...)` rejects past this try/catch and
        // leaves the Invitation panel stuck on Cloud “Saving…”.
        return await attempt(baseArgs);
      }
      return withPhone;
    }
    return await attempt(baseArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Supabase invite was not stored: ${message}` };
  }
}

export async function validateInviteOnSupabase(input: {
  token?: string;
  code?: string;
}): Promise<{ ok: true; data: HostedInvitePreview } | { ok: false; error: string }> {
  try {
    const { data, error } = await rpcWithTimeout("validate_invite", {
      p_token: input.token ?? null,
      p_access_code: input.code ?? null,
    });
    if (error) return { ok: false, error: error.message };
    const preview = parseInvitePreview(data);
    if (!preview) return { ok: false, error: "Invalid or expired invite." };
    return { ok: true, data: preview };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export async function acceptInviteOnSupabase(input: {
  token?: string;
  code?: string;
  password: string;
}): Promise<{ ok: true; data: HostedInviteAcceptance } | { ok: false; error: string }> {
  try {
    const { data, error } = await rpcWithTimeout("accept_invite", {
      p_token: input.token ?? null,
      p_access_code: input.code ?? null,
      p_password: input.password,
    });
    if (error) return { ok: false, error: error.message };
    const profile = parseInviteProfile(data);
    if (!profile) return { ok: false, error: "Invalid or expired invite." };
    return { ok: true, data: profile };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function parseStaffAccessStatuses(data: unknown): CloudStaffAccessStatus[] {
  if (!Array.isArray(data)) return [];
  const out: CloudStaffAccessStatus[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const item = row as Record<string, unknown>;
    const email = typeof item["email"] === "string" ? item["email"].trim().toLowerCase() : "";
    if (!email) continue;
    const fullName = typeof item["full_name"] === "string" ? item["full_name"] : undefined;
    const profileId =
      typeof item["profile_id"] === "string"
        ? item["profile_id"]
        : item["profile_id"] == null
          ? null
          : undefined;
    const roleCode = typeof item["role_code"] === "string" ? item["role_code"] : null;
    const invitePending = Boolean(item["invite_pending"]);
    const inviteAcceptedAt =
      typeof item["invite_accepted_at"] === "string" ? item["invite_accepted_at"] : null;
    const lastSignInAt =
      typeof item["last_sign_in_at"] === "string" ? item["last_sign_in_at"] : null;
    const active = typeof item["active"] === "boolean" ? item["active"] : undefined;
    out.push({
      email,
      ...(fullName ? { fullName } : {}),
      profileId: profileId ?? null,
      roleCode,
      invitePending,
      inviteAcceptedAt,
      ...(lastSignInAt ? { lastSignInAt } : {}),
      ...(active !== undefined ? { active } : {}),
    });
  }
  return out;
}

/**
 * Owner hydrate: read invite consumption + profile roster from cloud.
 * Missing RPC is non-fatal (older DBs) — caller keeps local/auth_directory merge.
 */
export async function fetchStaffAccessStatusesFromSupabase(): Promise<
  { ok: true; data: CloudStaffAccessStatus[] } | { ok: false; error: string }
> {
  try {
    const { data, error } = await rpcWithTimeout("list_staff_access_status", {}, 8_000);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: parseStaffAccessStatuses(data) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
