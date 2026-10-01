/**
 * Staff invite delivery helpers (browser-safe).
 * Browser never holds Resend / Twilio / service-role secrets.
 * POSTs to same-origin /api/invite-email and /api/invite-sms (server reads env).
 * Optional override: VITE_TLB_INVITE_MAIL_ENDPOINT for a custom mail URL.
 */

import { looksLikePhoneNumber } from "@/lib/access/invite-phone";
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
/** Built-in same-origin SMS route (Twilio on the server). */
export const BUILTIN_INVITE_SMS_PATH = "/api/invite-sms";

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

export { looksLikePhoneNumber };

export function buildInviteSmsBody(input: {
  name: string;
  inviteCode: string;
  inviteToken: string;
  origin?: string;
}): string {
  const link = buildInviteLink(input.inviteToken, input.origin);
  return `TLB access for ${input.name}: code ${input.inviteCode}. Open ${link}`;
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
    sms: phone ? "pending" : contact ? "skipped" : "not_configured",
    smsNote: phone
      ? `Sending SMS to ${phone}…`
      : contact
        ? `SMS skipped — contact “${contact}” does not look like a phone number. Copy the SMS text below if needed.`
        : "No phone on the person record. Add a contact number to send SMS, or copy the SMS text below.",
    smsBody,
  };
}

type SendClientResult =
  | { ok: true }
  | { ok: false; error: string; notConfigured?: boolean };

async function postInviteJson(
  endpoint: string,
  payload: Record<string, string>,
): Promise<SendClientResult> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data: { ok?: unknown; error?: unknown; notConfigured?: unknown } | null = null;
    try {
      data = (await response.json()) as {
        ok?: unknown;
        error?: unknown;
        notConfigured?: unknown;
      };
    } catch {
      data = null;
    }

    if (response.ok && data?.ok === true) {
      return { ok: true };
    }

    const notConfigured =
      data?.notConfigured === true || response.status === 503;
    const error =
      (typeof data?.error === "string" && data.error.trim()) ||
      `Endpoint returned ${response.status}.`;

    return { ok: false, error, ...(notConfigured ? { notConfigured: true } : {}) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
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
