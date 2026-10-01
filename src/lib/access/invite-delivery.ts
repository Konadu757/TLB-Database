/**
 * Staff invite delivery helpers (browser-safe).
 * Browser never holds Resend / Arkesel / Termii / Twilio / service-role secrets.
 * Prefers same-origin /api/invite-deliver (email+SMS in parallel, one cold start).
 * Fallback/retry: /api/invite-email and /api/invite-sms.
 * Optional override: VITE_TLB_INVITE_MAIL_ENDPOINT for a custom mail URL.
 */

import {
  looksLikePhoneNumber,
  normalizePhoneDigits,
  normalizePhoneForSms,
} from "@/lib/access/invite-phone";
import { buildInviteLink } from "@/lib/domain/invites";

export type InviteCloudStatus = "pending" | "ok" | "failed" | "local_only";
export type InviteEmailStatus = "pending" | "sent" | "failed" | "not_configured";
export type InviteSmsStatus =
  | "pending"
  | "sent"
  | "failed"
  | "not_configured"
  | "skipped";

export type InviteDeliveryStatus = {
  cloud: InviteCloudStatus;
  cloudNote: string;
  email: InviteEmailStatus;
  emailNote: string;
  sms: InviteSmsStatus;
  smsNote: string;
  smsBody: string;
};

function envFlag(name: string): string {
  const vite = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const fromVite = vite?.[name]?.trim() ?? "";
  if (fromVite) return fromVite;
  if (typeof process !== "undefined" && process.env?.[name]) {
    return String(process.env[name]).trim();
  }
  return "";
}

/** Built-in same-origin mail route (Resend on the server). */
export const BUILTIN_INVITE_MAIL_PATH = "/api/invite-email";
/** Built-in same-origin SMS route (Arkesel preferred; Termii then Twilio fallback on the server). */
export const BUILTIN_INVITE_SMS_PATH = "/api/invite-sms";
/** Combined email+SMS fan-out (preferred — one serverless cold start). */
export const BUILTIN_INVITE_DELIVER_PATH = "/api/invite-deliver";

/** Client budget for invite API routes — fail fast so UI never feels stuck. */
const INVITE_FETCH_TIMEOUT_MS = 7_000;

/**
 * Optional POST URL override that accepts { to, name, inviteCode, inviteLink, role? }.
 * Prefer leaving unset so the portal uses /api/invite-email with RESEND_* on Vercel.
 */
export function inviteMailEndpoint(): string {
  return envFlag("VITE_TLB_INVITE_MAIL_ENDPOINT") || BUILTIN_INVITE_MAIL_PATH;
}

export function inviteSmsEndpoint(): string {
  return BUILTIN_INVITE_SMS_PATH;
}

export function inviteDeliverEndpoint(): string {
  return BUILTIN_INVITE_DELIVER_PATH;
}

export { looksLikePhoneNumber, normalizePhoneDigits, normalizePhoneForSms };

export function buildInviteSmsBody(input: {
  name: string;
  inviteCode: string;
  inviteToken: string;
  origin?: string;
}): string {
  const link = buildInviteLink(input.inviteToken, input.origin);
  return `TLB invite for ${input.name}: code ${input.inviteCode}. Open ${link} — confirm details, then create your password.`;
}

/**
 * Cloud sync failed but local code/link are still usable on this browser.
 * Keep the wording secondary so the Invitation ready panel does not read as a total failure.
 */
export function formatCloudInviteFailureNote(error: string): string {
  const trimmed = error.trim().replace(/\bSupbase\b/gi, "Supabase");
  const missingRpc = /Could not find the function public\.create_invite/i.test(trimmed);
  if (missingRpc) {
    return "Cloud copy not saved yet (invite SQL missing on database). Access code and link below still work on this browser — share them, then ask an Owner to apply invite SQL and Re-issue.";
  }
  const needsManage = /users\.manage required/i.test(trimmed);
  if (needsManage) {
    return "Cloud copy not saved: Owner Auth account is missing users.manage on the database. Access code and link below still work on this browser — apply Owner bootstrap SQL, then Re-issue.";
  }
  const emailTaken =
    /already belongs to the Owner account/i.test(trimmed) ||
    /already has a sign-in account/i.test(trimmed) ||
    /already registered to a staff account/i.test(trimmed) ||
    /use a (different|unique) email/i.test(trimmed);
  if (emailTaken) {
    return "Cloud invite blocked: that email is already used by Owner or another login. Edit the staff row to a unique email, then Re-issue. One email = one person.";
  }
  return `Cloud copy not saved: ${trimmed} Access code and link below still work on this browser.`;
}

export function initialInviteDelivery(input: {
  name: string;
  inviteCode: string;
  inviteToken: string;
  contact?: string;
  willPublishCloud: boolean;
}): InviteDeliveryStatus {
  const smsBody = buildInviteSmsBody(input);
  const contact = input.contact?.trim();
  const phone = contact && looksLikePhoneNumber(contact) ? contact : "";
  return {
    cloud: input.willPublishCloud ? "pending" : "local_only",
    cloudNote: input.willPublishCloud
      ? "Saving invite to cloud…"
      : "Local invite only (Supabase sync is off).",
    email: "pending",
    emailNote: "Sending email…",
    sms: phone ? "pending" : "skipped",
    smsNote: phone
      ? `Sending SMS to ${phone}…`
      : contact
        ? `SMS skipped — contact “${contact}” does not look like a phone number. Copy the SMS text below if needed.`
        : "No phone on the person record. Add a contact number to send SMS, or copy the SMS text below.",
    smsBody,
  };
}

export type SendClientResult =
  | { ok: true; messageId?: string; provider?: string }
  | { ok: false; error: string; notConfigured?: boolean; messageId?: string; provider?: string };

function parseSendClientResult(data: unknown, fallbackError: string): SendClientResult {
  if (!data || typeof data !== "object") {
    return { ok: false, error: fallbackError };
  }
  const row = data as Record<string, unknown>;
  const messageIdRaw = row["messageId"];
  const providerRaw = row["provider"];
  const messageId =
    typeof messageIdRaw === "string" && messageIdRaw.trim() ? messageIdRaw.trim() : undefined;
  const provider =
    typeof providerRaw === "string" && providerRaw.trim() ? providerRaw.trim() : undefined;
  if (row["ok"] === true) {
    return {
      ok: true,
      ...(messageId ? { messageId } : {}),
      ...(provider ? { provider } : {}),
    };
  }
  const notConfigured = row["notConfigured"] === true;
  const errorRaw = row["error"];
  const error =
    typeof errorRaw === "string" && errorRaw.trim() ? errorRaw.trim() : fallbackError;
  return {
    ok: false,
    error,
    ...(notConfigured ? { notConfigured: true } : {}),
    ...(messageId ? { messageId } : {}),
    ...(provider ? { provider } : {}),
  };
}

async function postInviteJson(
  endpoint: string,
  payload: Record<string, string>,
): Promise<SendClientResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INVITE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let data: {
      ok?: unknown;
      error?: unknown;
      notConfigured?: unknown;
      messageId?: unknown;
      provider?: unknown;
    } | null = null;
    try {
      data = (await response.json()) as {
        ok?: unknown;
        error?: unknown;
        notConfigured?: unknown;
        messageId?: unknown;
        provider?: unknown;
      };
    } catch {
      data = null;
    }

    const messageId =
      typeof data?.messageId === "string" && data.messageId.trim()
        ? data.messageId.trim()
        : undefined;
    const provider =
      typeof data?.provider === "string" && data.provider.trim()
        ? data.provider.trim()
        : undefined;

    if (response.ok && data?.ok === true) {
      return {
        ok: true,
        ...(messageId ? { messageId } : {}),
        ...(provider ? { provider } : {}),
      };
    }

    const notConfigured = data?.notConfigured === true || response.status === 503;
    const error =
      (typeof data?.error === "string" && data.error.trim()) ||
      (response.status === 404
        ? `Invite API route missing (${endpoint}). Redeploy the portal so /api/invite-deliver (or /api/invite-email and /api/invite-sms) exist.`
        : `Endpoint returned ${response.status}.`);

    return {
      ok: false,
      error,
      ...(notConfigured ? { notConfigured: true } : {}),
      ...(messageId ? { messageId } : {}),
      ...(provider ? { provider } : {}),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        ok: false,
        error: `Timed out after ${Math.round(INVITE_FETCH_TIMEOUT_MS / 1000)}s waiting for ${endpoint}.`,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function trySendInviteEmail(input: {
  to: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
  role?: string;
}): Promise<SendClientResult> {
  const endpoint = inviteMailEndpoint();
  const payload: Record<string, string> = {
    to: input.to,
    name: input.name,
    inviteCode: input.inviteCode,
    inviteLink: input.inviteLink,
  };
  if (input.role?.trim()) payload["role"] = input.role.trim();
  return postInviteJson(endpoint, payload);
}

export async function trySendInviteSms(input: {
  to: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
  body: string;
}): Promise<SendClientResult> {
  if (!looksLikePhoneNumber(input.to)) {
    return {
      ok: false,
      error: "Contact does not look like a phone number.",
    };
  }
  return postInviteJson(inviteSmsEndpoint(), {
    to: input.to,
    name: input.name,
    inviteCode: input.inviteCode,
    inviteLink: input.inviteLink,
    body: input.body,
  });
}

/**
 * Preferred path: one POST → server fans out email + SMS in parallel.
 * Falls back to dual client posts if /api/invite-deliver is missing (404).
 */
export async function tryDeliverInvite(input: {
  to: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
  role?: string;
  smsTo?: string;
  smsBody?: string;
}): Promise<{ email: SendClientResult; sms: SendClientResult | null }> {
  const customMail = Boolean(envFlag("VITE_TLB_INVITE_MAIL_ENDPOINT"));
  // Custom mail endpoint cannot use the combined route — still fan out in parallel.
  if (customMail) {
    const [email, sms] = await Promise.all([
      trySendInviteEmail({
        to: input.to,
        name: input.name,
        inviteCode: input.inviteCode,
        inviteLink: input.inviteLink,
        ...(input.role ? { role: input.role } : {}),
      }),
      input.smsTo && looksLikePhoneNumber(input.smsTo)
        ? trySendInviteSms({
            to: input.smsTo,
            name: input.name,
            inviteCode: input.inviteCode,
            inviteLink: input.inviteLink,
            body: input.smsBody || "",
          })
        : Promise.resolve(null),
    ]);
    return { email, sms };
  }

  const payload: Record<string, string> = {
    to: input.to,
    name: input.name,
    inviteCode: input.inviteCode,
    inviteLink: input.inviteLink,
  };
  if (input.role?.trim()) payload["role"] = input.role.trim();
  if (input.smsTo?.trim()) payload["smsTo"] = input.smsTo.trim();
  if (input.smsBody?.trim()) payload["smsBody"] = input.smsBody.trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INVITE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(inviteDeliverEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.status === 404) {
      // Older deploy without combined route — parallel client posts.
      const [email, sms] = await Promise.all([
        trySendInviteEmail({
          to: input.to,
          name: input.name,
          inviteCode: input.inviteCode,
          inviteLink: input.inviteLink,
          ...(input.role ? { role: input.role } : {}),
        }),
        input.smsTo && looksLikePhoneNumber(input.smsTo)
          ? trySendInviteSms({
              to: input.smsTo,
              name: input.name,
              inviteCode: input.inviteCode,
              inviteLink: input.inviteLink,
              body: input.smsBody || "",
            })
          : Promise.resolve(null),
      ]);
      return { email, sms };
    }

    let data: { email?: unknown; sms?: unknown; error?: unknown } | null = null;
    try {
      data = (await response.json()) as { email?: unknown; sms?: unknown; error?: unknown };
    } catch {
      data = null;
    }

    if (!data?.email) {
      const error =
        (typeof data?.error === "string" && data.error.trim()) ||
        `Invite deliver returned ${response.status}.`;
      return {
        email: { ok: false, error },
        sms: input.smsTo
          ? { ok: false, error: "Combined deliver response missing channel results." }
          : null,
      };
    }

    return {
      email: parseSendClientResult(data.email, "Email delivery failed."),
      sms: data.sms == null ? null : parseSendClientResult(data.sms, "SMS delivery failed."),
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      const error = `Timed out after ${Math.round(INVITE_FETCH_TIMEOUT_MS / 1000)}s waiting for ${inviteDeliverEndpoint()}.`;
      return {
        email: { ok: false, error },
        sms: input.smsTo ? { ok: false, error } : null,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      email: { ok: false, error: message },
      sms: input.smsTo ? { ok: false, error: message } : null,
    };
  } finally {
    clearTimeout(timer);
  }
}
