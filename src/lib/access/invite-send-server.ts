/**
 * Server-only invite delivery via Resend (email) and Arkesel / Termii / Twilio (SMS).
 * Prefer Arkesel when ARKESEL_* is set; Termii then Twilio remain fallbacks.
 * Secrets stay in process.env — never import this from browser code.
 */

import {
  looksLikePhoneNumber,
  normalizePhoneDigits,
  normalizePhoneForSms,
} from "@/lib/access/invite-phone";

export type InviteSendResult =
  | { ok: true }
  | { ok: false; notConfigured: true; error: string }
  | { ok: false; notConfigured?: false; error: string };

export { looksLikePhoneNumber, normalizePhoneDigits, normalizePhoneForSms };

const DEFAULT_ARKESEL_BASE_URL = "https://sms.arkesel.com";
const DEFAULT_TERMII_BASE_URL = "https://api.ng.termii.com";
const SMS_NOT_CONFIGURED_MESSAGE =
  "SMS is not configured. Set ARKESEL_API_KEY and ARKESEL_SENDER_ID on the host (Vercel), then redeploy. TERMII_* and TWILIO_* remain supported as fallbacks.";

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

function arkeselConfigured(): boolean {
  return Boolean(env("ARKESEL_API_KEY") && env("ARKESEL_SENDER_ID"));
}

function termiiConfigured(): boolean {
  return Boolean(env("TERMII_API_KEY") && env("TERMII_SENDER_ID"));
}

function twilioConfigured(): boolean {
  return Boolean(
    env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM_NUMBER"),
  );
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

  const to = input.to.trim().toLowerCase();
  // Require a real mailbox shape (reject "name@" / "@domain" / spaces).
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
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

/**
 * Arkesel SMS v2 — POST {base}/api/v2/sms/send
 * Auth: `api-key` header. Body: { sender, message, recipients[] }.
 * Docs: https://developers.arkesel.com/
 */
export async function sendInviteSmsWithArkesel(input: {
  to: string;
  body: string;
}): Promise<InviteSendResult> {
  const apiKey = env("ARKESEL_API_KEY");
  const senderId = env("ARKESEL_SENDER_ID");
  if (!apiKey || !senderId) {
    return {
      ok: false,
      notConfigured: true,
      error: SMS_NOT_CONFIGURED_MESSAGE,
    };
  }

  if (!looksLikePhoneNumber(input.to)) {
    return { ok: false, error: "Contact does not look like a phone number." };
  }

  const to = normalizePhoneDigits(input.to);
  if (!to || to.startsWith("0")) {
    return {
      ok: false,
      error: `Phone “${input.to.trim()}” could not be normalized to international format (e.g. 23324…).`,
    };
  }
  const message = input.body.trim();
  if (!message) {
    return { ok: false, error: "SMS body is required." };
  }

  const baseUrl = (env("ARKESEL_BASE_URL") || DEFAULT_ARKESEL_BASE_URL).replace(/\/+$/, "");
  const url = `${baseUrl}/api/v2/sms/send`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: senderId,
        message,
        recipients: [to],
      }),
    });

    const text = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        ok: false,
        error: summarizeProviderError("Arkesel", response.status, text),
      };
    }

    // Arkesel returns HTTP 200 with { status: "success" | ... } for many outcomes.
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text) as {
          status?: unknown;
          message?: unknown;
          data?: unknown;
        };
        const status = typeof parsed.status === "string" ? parsed.status.trim().toLowerCase() : "";
        if (status && status !== "success") {
          const msg =
            typeof parsed.message === "string" && parsed.message.trim()
              ? parsed.message.trim()
              : status;
          return { ok: false, error: `Arkesel: ${msg}` };
        }
      } catch {
        // Non-JSON success body is fine.
      }
    }

    return { ok: true };
  } catch (err) {
    const messageErr = err instanceof Error ? err.message : String(err);
    return { ok: false, error: messageErr };
  }
}

export async function sendInviteSmsWithTermii(input: {
  to: string;
  body: string;
}): Promise<InviteSendResult> {
  const apiKey = env("TERMII_API_KEY");
  const senderId = env("TERMII_SENDER_ID");
  if (!apiKey || !senderId) {
    return {
      ok: false,
      notConfigured: true,
      error: SMS_NOT_CONFIGURED_MESSAGE,
    };
  }

  if (!looksLikePhoneNumber(input.to)) {
    return { ok: false, error: "Contact does not look like a phone number." };
  }

  const to = normalizePhoneDigits(input.to);
  if (!to || to.startsWith("0")) {
    return {
      ok: false,
      error: `Phone “${input.to.trim()}” could not be normalized to international format (e.g. 23324…).`,
    };
  }
  const sms = input.body.trim();
  if (!sms) {
    return { ok: false, error: "SMS body is required." };
  }

  const baseUrl = (env("TERMII_BASE_URL") || DEFAULT_TERMII_BASE_URL).replace(/\/+$/, "");
  // Transactional invite codes: prefer dnd (docs); allow override via TERMII_CHANNEL.
  const channelRaw = env("TERMII_CHANNEL").toLowerCase();
  const channel = channelRaw === "generic" ? "generic" : "dnd";
  const url = `${baseUrl}/api/sms/send`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        to,
        from: senderId,
        sms,
        type: "plain",
        channel,
      }),
    });

    const text = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        ok: false,
        error: summarizeProviderError("Termii", response.status, text),
      };
    }

    // Termii often returns HTTP 200 with a business error payload.
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text) as {
          code?: unknown;
          message?: unknown;
          message_id?: unknown;
        };
        const code = typeof parsed.code === "string" ? parsed.code.trim() : "";
        if (code && code !== "ok") {
          const msg =
            typeof parsed.message === "string" && parsed.message.trim()
              ? parsed.message.trim()
              : code;
          return { ok: false, error: `Termii: ${msg}` };
        }
      } catch {
        // Non-JSON success body is fine.
      }
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
      error: SMS_NOT_CONFIGURED_MESSAGE,
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

/** Prefer Arkesel when configured; then Termii; then Twilio; otherwise notConfigured. */
export async function sendInviteSms(input: {
  to: string;
  body: string;
}): Promise<InviteSendResult> {
  if (arkeselConfigured()) {
    return sendInviteSmsWithArkesel(input);
  }
  if (termiiConfigured()) {
    return sendInviteSmsWithTermii(input);
  }
  if (twilioConfigured()) {
    return sendInviteSmsWithTwilio(input);
  }
  return {
    ok: false,
    notConfigured: true,
    error: SMS_NOT_CONFIGURED_MESSAGE,
  };
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
