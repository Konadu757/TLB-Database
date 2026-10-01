/**
 * Server-only invite delivery via Resend (email) and Twilio (SMS).
 * Secrets stay in process.env — never import this from browser code.
 */

import { looksLikePhoneNumber, normalizePhoneForSms } from "@/lib/access/invite-phone";

export type InviteSendResult =
  | { ok: true }
  | { ok: false; notConfigured: true; error: string }
  | { ok: false; notConfigured?: false; error: string };

export { looksLikePhoneNumber, normalizePhoneForSms };

function env(name: string): string {
  if (typeof process === "undefined" || !process.env) return "";
  return String(process.env[name] ?? "").trim();
}

function basicAuthHeader(user: string, pass: string): string {
  const raw = `${user}:${pass}`;
  if (typeof Buffer !== "undefined") {
    return `Basic ${Buffer.from(raw).toString("base64")}`;
  }
  return `Basic ${btoa(raw)}`;
}

export async function sendInviteEmailWithResend(input: {
  to: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
  role?: string;
}): Promise<InviteSendResult> {
  const apiKey = env("RESEND_API_KEY");
  const from = env("RESEND_FROM_EMAIL");
  if (!apiKey || !from) {
    return {
      ok: false,
      notConfigured: true,
      error:
        "Email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL on the host (Vercel), then redeploy.",
    };
  }

  const to = input.to.trim();
  if (!to || !to.includes("@")) {
    return { ok: false, error: "A valid recipient email is required." };
  }

  const roleLine = input.role?.trim() ? `Role: ${input.role.trim()}\n` : "";
  const text = [
    `Hello ${input.name},`,
    "",
    "You have been invited to the TLB portal.",
    roleLine.trimEnd(),
    `Access code: ${input.inviteCode}`,
    `Sign-in link: ${input.inviteLink}`,
    "",
    "Treat this code like a password. Do not forward it.",
    "",
    "— TLB",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");

  const html = `
    <p>Hello ${escapeHtml(input.name)},</p>
    <p>You have been invited to the TLB portal.</p>
    ${input.role?.trim() ? `<p><strong>Role:</strong> ${escapeHtml(input.role.trim())}</p>` : ""}
    <p><strong>Access code:</strong> <code>${escapeHtml(input.inviteCode)}</code></p>
    <p><a href="${escapeAttr(input.inviteLink)}">Open invite link</a></p>
    <p style="color:#555;font-size:13px">Treat this code like a password. Do not forward it.</p>
    <p>— TLB</p>
  `.trim();

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Your TLB portal access invite",
        text,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: summarizeProviderError("Resend", response.status, body),
      };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export async function sendInviteSmsWithTwilio(input: {
  to: string;
  body: string;
}): Promise<InviteSendResult> {
  const accountSid = env("TWILIO_ACCOUNT_SID");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const from = env("TWILIO_FROM_NUMBER");
  if (!accountSid || !authToken || !from) {
    return {
      ok: false,
      notConfigured: true,
      error:
        "SMS is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER on the host (Vercel), then redeploy.",
    };
  }

  if (!looksLikePhoneNumber(input.to)) {
    return { ok: false, error: "Contact does not look like a phone number." };
  }

  const to = normalizePhoneForSms(input.to);
  const body = input.body.trim();
  if (!body) {
    return { ok: false, error: "SMS body is required." };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const form = new URLSearchParams({
    To: to,
    From: from,
    Body: body,
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(accountSid, authToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        error: summarizeProviderError("Twilio", response.status, text),
      };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function summarizeProviderError(provider: string, status: number, body: string): string {
  const trimmed = body.trim().slice(0, 280);
  if (!trimmed) return `${provider} returned ${status}.`;
  try {
    const parsed = JSON.parse(trimmed) as {
      message?: unknown;
      error?: unknown;
      errors?: Array<{ message?: unknown }>;
    };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return `${provider}: ${parsed.message.trim()}`;
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return `${provider}: ${parsed.error.trim()}`;
    }
    const first = parsed.errors?.[0]?.message;
    if (typeof first === "string" && first.trim()) {
      return `${provider}: ${first.trim()}`;
    }
  } catch {
    // fall through
  }
  return `${provider} returned ${status}: ${trimmed}`;
}

export function parseInviteEmailBody(raw: unknown): {
  to: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
  role?: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const to = typeof body["to"] === "string" ? body["to"].trim() : "";
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  const inviteCode = typeof body["inviteCode"] === "string" ? body["inviteCode"].trim() : "";
  const inviteLink = typeof body["inviteLink"] === "string" ? body["inviteLink"].trim() : "";
  const role = typeof body["role"] === "string" ? body["role"].trim() : undefined;
  if (!to || !name || !inviteCode || !inviteLink) return null;
  return { to, name, inviteCode, inviteLink, ...(role ? { role } : {}) };
}

export function parseInviteSmsBody(raw: unknown): {
  to: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
  body?: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const to = typeof data["to"] === "string" ? data["to"].trim() : "";
  const name = typeof data["name"] === "string" ? data["name"].trim() : "";
  const inviteCode = typeof data["inviteCode"] === "string" ? data["inviteCode"].trim() : "";
  const inviteLink = typeof data["inviteLink"] === "string" ? data["inviteLink"].trim() : "";
  const body = typeof data["body"] === "string" ? data["body"].trim() : undefined;
  if (!to || !name || !inviteCode || !inviteLink) return null;
  return { to, name, inviteCode, inviteLink, ...(body ? { body } : {}) };
}
