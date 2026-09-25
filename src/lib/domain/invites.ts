/** Invite / access-code helpers for mock-auth staff onboarding. */

import type { AppUser } from "./types";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomChunk(len: number): string {
  let out = "";
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(len);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
    return out;
  }
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Short human-readable access code, e.g. TLB-A7K2-M9QX */
export function generateInviteCode(): string {
  return `TLB-${randomChunk(4)}-${randomChunk(4)}`;
}

/** Opaque invite token for shareable URLs. */
export function generateInviteToken(): string {
  return `inv_${randomChunk(8)}${randomChunk(8)}${Date.now().toString(36)}`;
}

export function normalizeAccessCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function isInvitePending(user: AppUser): boolean {
  return Boolean(user.invitePending && user.inviteToken && user.inviteCode && !user.inviteAcceptedAt);
}

/** Build absolute invite URL for the current origin (or production fallback). */
export function buildInviteLink(token: string, origin?: string): string {
  const base =
    origin ??
    (typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://portal.tlbgh.com");
  return `${base.replace(/\/$/, "")}/access?invite=${encodeURIComponent(token)}`;
}

export function applyFreshInvite(user: AppUser, at = new Date().toISOString()): AppUser {
  return {
    ...user,
    inviteToken: generateInviteToken(),
    inviteCode: generateInviteCode(),
    inviteCreatedAt: at,
    inviteAcceptedAt: undefined,
    invitePending: true,
  };
}

export function markInviteAccepted(user: AppUser, at = new Date().toISOString()): AppUser {
  return {
    ...user,
    invitePending: false,
    inviteAcceptedAt: at,
  };
}

export function findUserByInviteToken(users: AppUser[], token: string): AppUser | undefined {
  const t = token.trim();
  if (!t) return undefined;
  return users.find((u) => u.inviteToken === t && u.active);
}

export function findUserByInviteCode(users: AppUser[], code: string): AppUser | undefined {
  const c = normalizeAccessCode(code);
  if (!c) return undefined;
  return users.find((u) => u.inviteCode && normalizeAccessCode(u.inviteCode) === c && u.active);
}
