/**
 * Staff invite delivery helpers.
 * Browser never holds Resend / Twilio / service-role secrets.
 * Email is attempted only when a server endpoint URL is configured.
 * SMS is not wired in this repo — Owner shares contact + copyable body manually.
 */

import { buildInviteLink } from "@/lib/domain/invites";

export type InviteCloudStatus = "pending" | "ok" | "failed" | "local_only";
export type InviteEmailStatus = "pending" | "sent" | "failed" | "not_configured";
export type InviteSmsStatus = "not_configured";

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

/** Optional POST URL that accepts { to, name, inviteCode, inviteLink }. Set on host only. */
export function inviteMailEndpoint(): string {
  return envFlag("VITE_TLB_INVITE_MAIL_ENDPOINT");
}

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
  const mailEndpoint = inviteMailEndpoint();
  const contact = input.contact?.trim();
  return {
    cloud: input.willPublishCloud ? "pending" : "local_only",
    cloudNote: input.willPublishCloud
      ? "Saving invite to cloud…"
      : "Local invite only (Supabase sync is off).",
    email: mailEndpoint ? "pending" : "not_configured",
    emailNote: mailEndpoint
      ? "Sending email…"
      : "Email was not sent — mail is not configured. Copy the link or code below. To enable email: set VITE_TLB_INVITE_MAIL_ENDPOINT to a server that sends mail (Resend), or use Supabase Auth invite from a server with SUPABASE_SERVICE_ROLE_KEY (never in VITE_*).",
    sms: "not_configured",
    smsNote: contact
      ? `SMS is not configured. Contact on file: ${contact}. Copy the SMS text below and send it yourself.`
      : "SMS is not configured in this portal. Keep the person's contact on their record and share the invite manually.",
    smsBody,
  };
}

export async function trySendInviteEmail(input: {
  to: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
}): Promise<{ ok: true } | { ok: false; error: string; notConfigured?: boolean }> {
  const endpoint = inviteMailEndpoint();
  if (!endpoint) {
    return {
      ok: false,
      notConfigured: true,
      error: "Mail endpoint is not configured.",
    };
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: input.to,
        name: input.name,
        inviteCode: input.inviteCode,
        inviteLink: input.inviteLink,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error: text.trim() || `Mail endpoint returned ${response.status}.`,
      };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
