/**
 * Server-only invite delivery via Resend (email) and Arkesel / Termii / Twilio (SMS).
 * Prefer Arkesel when ARKESEL_* is set; Termii then Twilio remain fallbacks.
 * Secrets stay in process.env — never import this from browser code.
 */

import {
  looksLikePhoneNumber,
  normalizePhoneDigits,
  normalizePhoneForSms,
  validateInvitePhone,
} from "@/lib/access/invite-phone";

export type InviteSendResult =
  | { ok: true; messageId?: string; provider?: string; delivery?: string }
  | { ok: false; notConfigured: true; error: string }
  | {
      ok: false;
      notConfigured?: false;
      error: string;
      messageId?: string;
      provider?: string;
      delivery?: string;
    };

export {
  looksLikePhoneNumber,
  normalizePhoneDigits,
  normalizePhoneForSms,
  validateInvitePhone,
};

const DEFAULT_ARKESEL_BASE_URL = "https://sms.arkesel.com";
const DEFAULT_TERMII_BASE_URL = "https://api.ng.termii.com";
/** Resend stays snappy — email must not inherit Arkesel latency. */
const EMAIL_PROVIDER_TIMEOUT_MS = 5_000;
/**
 * Arkesel often needs >5s from Vercel (logs: Timed out after 5s while email ok).
 * SMS-only budget — does not block Assign/Re-issue (UI is fire-and-forget).
 */
const SMS_PROVIDER_TIMEOUT_MS = 14_000;
/**
 * Cap Arkesel → Termii → Twilio waterfall.
 * Reserve leftover time so a slow Arkesel failure still leaves room for Termii/Twilio.
 */
const SMS_TOTAL_BUDGET_MS = 22_000;
/** Keep at least this much for the next SMS provider after Arkesel. */
const SMS_FALLBACK_RESERVE_MS = 5_000;
/** Brief wait after Resend/Arkesel accept to catch immediate bounce/fail events. */
const DELIVERY_VERIFY_BUDGET_MS = 2_800;
/** @deprecated alias — prefer EMAIL_ / SMS_ constants */
const PROVIDER_FETCH_TIMEOUT_MS = EMAIL_PROVIDER_TIMEOUT_MS;
const SMS_NOT_CONFIGURED_MESSAGE =
  "SMS is not configured. Set ARKESEL_API_KEY and ARKESEL_SENDER_ID on the host (Vercel), then redeploy. TERMII_* and TWILIO_* remain supported as fallbacks.";

function env(name: string): string {
  if (typeof process === "undefined" || !process.env) return "";
  return String(process.env[name] ?? "").trim();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = PROVIDER_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

function rewriteResendError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("testing email") ||
    lower.includes("only send testing") ||
    lower.includes("verify a domain") ||
    (lower.includes("domain") && lower.includes("not verified"))
  ) {
    return `${raw} — Resend is limited until you verify the domain used in RESEND_FROM_EMAIL (Resend → Domains). Until then only the account owner address works. Confirm SPF on send.tlbgh.com points at Resend (not forge.rmta), then Verify DNS again.`;
  }
  if (lower.includes("not delivered") || lower.includes("bounced") || lower.includes("suppressed")) {
    return `${raw} — Open Resend → Logs for this message id / recipient. Fix SPF/DKIM on tlbgh.com if bounces persist.`;
  }
  return raw;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resend API accept ≠ inbox delivery. Poll last_event briefly so hard bounces
 * are not reported as Sent.
 */
async function verifyResendDelivery(
  apiKey: string,
  messageId: string,
  budgetMs = DELIVERY_VERIFY_BUDGET_MS,
): Promise<{ delivery: string; bounced: boolean; detail?: string }> {
  const deadline = Date.now() + budgetMs;
  let lastEvent = "queued";
  const bounceEvents = new Set(["bounced", "failed", "complained", "suppressed"]);

  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(
        `https://api.resend.com/emails/${encodeURIComponent(messageId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
        Math.min(1_500, Math.max(400, deadline - Date.now())),
      );
      const text = await response.text().catch(() => "");
      if (response.ok && text.trim()) {
        try {
          const parsed = JSON.parse(text) as { last_event?: unknown };
          if (typeof parsed.last_event === "string" && parsed.last_event.trim()) {
            lastEvent = parsed.last_event.trim().toLowerCase();
            if (bounceEvents.has(lastEvent)) {
              return {
                delivery: lastEvent,
                bounced: true,
                detail: `Resend last_event=${lastEvent}`,
              };
            }
            if (lastEvent === "delivered") {
              return { delivery: "delivered", bounced: false };
            }
          }
        } catch {
          // ignore parse issues and keep waiting
        }
      }
    } catch {
      // ignore transient poll errors
    }
    await sleep(450);
  }

  // Accepted by Resend without an immediate bounce — still not a guarantee of inbox.
  return { delivery: lastEvent || "accepted", bounced: false };
}

/**
 * Arkesel HTTP 200 + status=success can still end FAILED at the network.
 * Poll once or twice when we have a message id.
 */
async function verifyArkeselDelivery(
  apiKey: string,
  baseUrl: string,
  messageId: string,
  budgetMs = DELIVERY_VERIFY_BUDGET_MS,
): Promise<{ delivery: string; failed: boolean; detail?: string }> {
  const deadline = Date.now() + budgetMs;
  let lastStatus = "accepted";

  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/api/v2/sms/${encodeURIComponent(messageId)}`,
        {
          method: "GET",
          headers: { "api-key": apiKey },
        },
        Math.min(1_500, Math.max(400, deadline - Date.now())),
      );
      const text = await response.text().catch(() => "");
      if (response.ok && text.trim()) {
        try {
          const parsed = JSON.parse(text) as {
            status?: unknown;
            data?: { status?: unknown; Status?: unknown };
            message?: unknown;
          };
          const row =
            parsed.data && typeof parsed.data === "object"
              ? (parsed.data as Record<string, unknown>)
              : null;
          const rawStatus =
            (row && typeof row["status"] === "string" && row["status"]) ||
            (row && typeof row["Status"] === "string" && row["Status"]) ||
            (typeof parsed.status === "string" && parsed.status) ||
            "";
          if (rawStatus.trim()) {
            lastStatus = rawStatus.trim().toUpperCase();
            if (
              lastStatus === "FAILED" ||
              lastStatus === "REJECTED" ||
              lastStatus === "UNDELIVERED" ||
              lastStatus === "EXPIRED"
            ) {
              const msg =
                typeof parsed.message === "string" && parsed.message.trim()
                  ? parsed.message.trim()
                  : lastStatus;
              return { delivery: lastStatus.toLowerCase(), failed: true, detail: msg };
            }
            if (lastStatus === "DELIVERED" || lastStatus === "SUCCESS") {
              return { delivery: "delivered", failed: false };
            }
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    await sleep(450);
  }

  return { delivery: lastStatus.toLowerCase() || "accepted", failed: false };
}

function rewriteArkeselError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("sender") &&
    (lower.includes("not") || lower.includes("invalid") || lower.includes("approv"))
  ) {
    return `${raw} — Register/approve sender ID “${env("ARKESEL_SENDER_ID") || "TLB"}” in Arkesel → Sender ID, then retry.`;
  }
  if (lower.includes("credit") || lower.includes("balance") || lower.includes("insufficient")) {
    return `${raw} — Top up Arkesel SMS credits, then Retry.`;
  }
  return raw;
}

export async function sendInviteEmailWithResend(input: {
  to: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
  role?: string;
  timeoutMs?: number;
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
    `Onboarding link: ${input.inviteLink}`,
    "",
    "Open the link. Confirm your email, access code, contact number, and position, then create your own password for future sign-in. Do not forward the code.",
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
    <p><a href="${escapeAttr(input.inviteLink)}">Open invite onboarding</a></p>
    <p style="color:#555;font-size:13px">Confirm your email, access code, contact number, and position, then create your own password for future sign-in. Do not forward the code.</p>
    <p>— TLB</p>
  `.trim();

  const timeoutMs = input.timeoutMs ?? EMAIL_PROVIDER_TIMEOUT_MS;
  try {
    const replyTo = env("RESEND_REPLY_TO");
    const payload: Record<string, unknown> = {
      from,
      to: [to],
      subject: "Your TLB portal access invite",
      text,
      html,
      tags: [{ name: "category", value: "tlb_invite" }],
    };
    if (replyTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
      payload["reply_to"] = [replyTo];
    }

    const response = await fetchWithTimeout(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
    );

    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        ok: false,
        provider: "resend",
        error: rewriteResendError(summarizeProviderError("Resend", response.status, bodyText)),
      };
    }

    let messageId: string | undefined;
    if (bodyText.trim()) {
      try {
        const parsed = JSON.parse(bodyText) as { id?: unknown };
        if (typeof parsed.id === "string" && parsed.id.trim()) {
          messageId = parsed.id.trim();
        }
      } catch {
        // ignore non-JSON success body
      }
    }

    if (!messageId) {
      // Soft-accept without an id — treat as accepted but note uncertainty.
      return { ok: true, provider: "resend", delivery: "accepted" };
    }

    const verified = await verifyResendDelivery(apiKey, messageId);
    if (verified.bounced) {
      return {
        ok: false,
        provider: "resend",
        messageId,
        delivery: verified.delivery,
        error: rewriteResendError(
          verified.detail ||
            `Resend accepted then ${verified.delivery} for ${to}. Check Resend → Logs and DNS (SPF on send.tlbgh.com).`,
        ),
      };
    }

    return {
      ok: true,
      provider: "resend",
      messageId,
      delivery: verified.delivery,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, provider: "resend", error: message };
  }
}

/**
 * Arkesel SMS v2 — POST {base}/api/v2/sms/send
 * Auth: `api-key` header. Body: { sender, message, recipients[] }.
 * Recipients: digits-only Ghana MSISDN `233XXXXXXXXX` (no leading +).
 * Docs: https://developers.arkesel.com/
 */
export async function sendInviteSmsWithArkesel(input: {
  to: string;
  body: string;
  timeoutMs?: number;
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

  const phone = validateInvitePhone(input.to);
  if (!phone.ok) {
    return { ok: false, error: phone.error };
  }
  const toDigits = phone.digits;
  const toPlus = phone.e164;
  const message = input.body.trim();
  if (!message) {
    return { ok: false, error: "SMS body is required." };
  }

  const baseUrl = (env("ARKESEL_BASE_URL") || DEFAULT_ARKESEL_BASE_URL).replace(/\/+$/, "");
  const url = `${baseUrl}/api/v2/sms/send`;
  const timeoutMs = input.timeoutMs ?? SMS_PROVIDER_TIMEOUT_MS;

  try {
    // Official Arkesel examples use +233…; digits-only 233… also works — prefer E.164 with +.
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify({
          sender: senderId,
          message,
          recipients: [toPlus],
        }),
      },
      timeoutMs,
    );

    const text = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        ok: false,
        provider: "arkesel",
        error: rewriteArkeselError(summarizeProviderError("Arkesel", response.status, text)),
      };
    }

    // Arkesel returns HTTP 200 with { status: "success" | "error", message?, data? }.
    // Never treat a bare 200 as success — parse JSON and require status === "success".
    if (!text.trim()) {
      return {
        ok: false,
        provider: "arkesel",
        error: "Arkesel returned HTTP 200 with an empty body — treating as failure.",
      };
    }

    let parsed: {
      status?: unknown;
      message?: unknown;
      code?: unknown;
      data?: unknown;
    };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      return {
        ok: false,
        provider: "arkesel",
        error: `Arkesel returned non-JSON body: ${text.trim().slice(0, 200)}`,
      };
    }

    const status =
      typeof parsed.status === "string"
        ? parsed.status.trim().toLowerCase()
        : typeof parsed.status === "number"
          ? String(parsed.status)
          : "";
    if (status !== "success") {
      const msg =
        (typeof parsed.message === "string" && parsed.message.trim()) ||
        (typeof parsed.code === "string" && parsed.code.trim()) ||
        status ||
        "unknown error";
      return {
        ok: false,
        provider: "arkesel",
        error: rewriteArkeselError(`Arkesel: ${msg} (HTTP 200, status=${status || "missing"})`),
      };
    }

    let messageId: string | undefined;
    const data = parsed.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const row = data as Record<string, unknown>;
      const id =
        (typeof row["id"] === "string" && row["id"]) ||
        (typeof row["ID"] === "string" && row["ID"]) ||
        (typeof row["message_id"] === "string" && row["message_id"]) ||
        "";
      if (id.trim()) messageId = id.trim();
    } else if (typeof data === "string" && data.trim()) {
      messageId = data.trim();
    } else if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      if (first && typeof first === "object") {
        const row = first as Record<string, unknown>;
        const id =
          (typeof row["id"] === "string" && row["id"]) ||
          (typeof row["ID"] === "string" && row["ID"]) ||
          (typeof row["message_id"] === "string" && row["message_id"]) ||
          "";
        if (id.trim()) messageId = id.trim();
      }
    }

    if (messageId) {
      const verified = await verifyArkeselDelivery(apiKey, baseUrl, messageId);
      if (verified.failed) {
        return {
          ok: false,
          provider: "arkesel",
          messageId,
          delivery: verified.delivery,
          error: rewriteArkeselError(
            `Arkesel accepted then ${verified.delivery} for ${toDigits}: ${verified.detail || verified.delivery}`,
          ),
        };
      }
      return {
        ok: true,
        provider: "arkesel",
        messageId,
        delivery: verified.delivery,
      };
    }

    return { ok: true, provider: "arkesel", delivery: "accepted" };
  } catch (err) {
    const messageErr = err instanceof Error ? err.message : String(err);
    return { ok: false, provider: "arkesel", error: messageErr };
  }
}

export async function sendInviteSmsWithTermii(input: {
  to: string;
  body: string;
  timeoutMs?: number;
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

  const phone = validateInvitePhone(input.to);
  if (!phone.ok) {
    return { ok: false, error: phone.error };
  }
  const to = phone.digits;
  const sms = input.body.trim();
  if (!sms) {
    return { ok: false, error: "SMS body is required." };
  }

  const baseUrl = (env("TERMII_BASE_URL") || DEFAULT_TERMII_BASE_URL).replace(/\/+$/, "");
  // Transactional invite codes: prefer dnd (docs); allow override via TERMII_CHANNEL.
  const channelRaw = env("TERMII_CHANNEL").toLowerCase();
  const channel = channelRaw === "generic" ? "generic" : "dnd";
  const url = `${baseUrl}/api/sms/send`;
  const timeoutMs = input.timeoutMs ?? SMS_PROVIDER_TIMEOUT_MS;

  try {
    const response = await fetchWithTimeout(
      url,
      {
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
      },
      timeoutMs,
    );

    const text = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        ok: false,
        provider: "termii",
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
          return { ok: false, provider: "termii", error: `Termii: ${msg}` };
        }
        const messageId =
          typeof parsed.message_id === "string" && parsed.message_id.trim()
            ? parsed.message_id.trim()
            : undefined;
        return { ok: true, provider: "termii", ...(messageId ? { messageId } : {}) };
      } catch {
        // Non-JSON success body is fine.
      }
    }

    return { ok: true, provider: "termii" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, provider: "termii", error: message };
  }
}

export async function sendInviteSmsWithTwilio(input: {
  to: string;
  body: string;
  timeoutMs?: number;
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

  const phone = validateInvitePhone(input.to);
  if (!phone.ok) {
    return { ok: false, error: phone.error };
  }
  const to = phone.e164;
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
  const timeoutMs = input.timeoutMs ?? SMS_PROVIDER_TIMEOUT_MS;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(accountSid, authToken),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
      timeoutMs,
    );

    const text = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        ok: false,
        provider: "twilio",
        error: summarizeProviderError("Twilio", response.status, text),
      };
    }
    let messageId: string | undefined;
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text) as { sid?: unknown };
        if (typeof parsed.sid === "string" && parsed.sid.trim()) {
          messageId = parsed.sid.trim();
        }
      } catch {
        // ignore
      }
    }
    return { ok: true, provider: "twilio", ...(messageId ? { messageId } : {}) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, provider: "twilio", error: message };
  }
}

/**
 * Prefer Arkesel when configured; on failure/timeout fall through to Termii then Twilio.
 * Total SMS wall time is capped by SMS_TOTAL_BUDGET_MS (Assign/Re-issue never await this).
 */
export async function sendInviteSms(input: {
  to: string;
  body: string;
}): Promise<InviteSendResult> {
  type Attempt = {
    label: string;
    configured: boolean;
    send: (timeoutMs: number) => Promise<InviteSendResult>;
  };

  const attempts: Attempt[] = [
    {
      label: "Arkesel",
      configured: arkeselConfigured(),
      send: (timeoutMs) => sendInviteSmsWithArkesel({ ...input, timeoutMs }),
    },
    {
      label: "Termii",
      configured: termiiConfigured(),
      send: (timeoutMs) => sendInviteSmsWithTermii({ ...input, timeoutMs }),
    },
    {
      label: "Twilio",
      configured: twilioConfigured(),
      send: (timeoutMs) => sendInviteSmsWithTwilio({ ...input, timeoutMs }),
    },
  ];

  const configured = attempts.filter((a) => a.configured);
  if (configured.length === 0) {
    return {
      ok: false,
      notConfigured: true,
      error: SMS_NOT_CONFIGURED_MESSAGE,
    };
  }

  const started = Date.now();
  const errors: string[] = [];
  const hasFallback = configured.length > 1;

  for (let i = 0; i < configured.length; i++) {
    const attempt = configured[i]!;
    const remaining = SMS_TOTAL_BUDGET_MS - (Date.now() - started);
    const laterProviders = configured.length - i - 1;
    const reserve = hasFallback && laterProviders > 0 ? SMS_FALLBACK_RESERVE_MS : 0;
    if (remaining < 1_500) {
      errors.push(`${attempt.label} skipped (SMS time budget exhausted)`);
      break;
    }
    const available = Math.max(1_500, remaining - reserve);
    const timeoutMs = Math.min(SMS_PROVIDER_TIMEOUT_MS, available);
    const result = await attempt.send(timeoutMs);
    if (result.ok) return result;
    if ("notConfigured" in result && result.notConfigured) {
      // Should not happen when filtered by configured(), but skip cleanly.
      continue;
    }
    errors.push(result.error);
  }

  return {
    ok: false,
    error:
      errors.length > 0
        ? errors.join(" → ")
        : "All configured SMS providers failed.",
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

/** Combined email+SMS body for /api/invite-deliver (single cold start, parallel fan-out). */
export function parseInviteDeliverBody(raw: unknown): {
  to: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
  role?: string;
  smsTo?: string;
  smsBody?: string;
} | null {
  const email = parseInviteEmailBody(raw);
  if (!email) return null;
  if (!raw || typeof raw !== "object") return email;
  const data = raw as Record<string, unknown>;
  const smsTo =
    (typeof data["smsTo"] === "string" && data["smsTo"].trim()) ||
    (typeof data["phone"] === "string" && data["phone"].trim()) ||
    "";
  const smsBody = typeof data["smsBody"] === "string" ? data["smsBody"].trim() : undefined;
  return {
    ...email,
    ...(smsTo ? { smsTo } : {}),
    ...(smsBody ? { smsBody } : {}),
  };
}

export function inviteSendResultToJson(result: InviteSendResult): Record<string, unknown> {
  if (result.ok) {
    return {
      ok: true,
      ...(result.messageId ? { messageId: result.messageId } : {}),
      ...(result.provider ? { provider: result.provider } : {}),
      ...(result.delivery ? { delivery: result.delivery } : {}),
    };
  }
  return {
    ok: false,
    error: result.error,
    ...("notConfigured" in result && result.notConfigured ? { notConfigured: true } : {}),
    ...("messageId" in result && result.messageId ? { messageId: result.messageId } : {}),
    ...("provider" in result && result.provider ? { provider: result.provider } : {}),
    ...("delivery" in result && result.delivery ? { delivery: result.delivery } : {}),
  };
}

/**
 * Fan out email + optional SMS in parallel on the server (one serverless cold start).
 */
export async function deliverInviteChannels(input: {
  to: string;
  name: string;
  inviteCode: string;
  inviteLink: string;
  role?: string;
  smsTo?: string;
  smsBody?: string;
}): Promise<{ email: InviteSendResult; sms: InviteSendResult | null }> {
  const emailPromise = sendInviteEmailWithResend({
    to: input.to,
    name: input.name,
    inviteCode: input.inviteCode,
    inviteLink: input.inviteLink,
    ...(input.role ? { role: input.role } : {}),
  });

  const smsTo = input.smsTo?.trim();
  const smsPromise = smsTo
    ? sendInviteSms({
        to: smsTo,
        body:
          input.smsBody?.trim() ||
          `TLB access for ${input.name}: code ${input.inviteCode}. Open ${input.inviteLink}`,
      })
    : Promise.resolve(null);

  const [email, sms] = await Promise.all([emailPromise, smsPromise]);
  return { email, sms };
}
