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
  return Boolean(
    user.invitePending && user.inviteToken && user.inviteCode && !user.inviteAcceptedAt,
  );
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

/** Drop URL token and access code before writing users into anon-readable settings. */
export function staffUsersForRemoteDirectory(users: AppUser[]): AppUser[] {
  return users.map((user) => {
    const copy: AppUser = { ...user };
    delete copy.inviteToken;
    delete copy.inviteCode;
    return copy;
  });
}

/**
 * Prefer remote staff rows, but keep invite secrets that exist only on this browser.
 * Remote auth_directory intentionally omits token and code.
 * Soft-delete on either side must survive hydrate (local tombstone wins if remote is stale).
 * Permanently purged ids never reappear from remote or local seed.
 */
export function mergeStaffUsers(
  remote: AppUser[] | undefined,
  local: AppUser[],
  purgedIds?: Iterable<string> | null,
): AppUser[] {
  const purged = purgedIds ? (purgedIds instanceof Set ? purgedIds : new Set(purgedIds)) : null;
  const isPurged = (id: string) =>
    Boolean(purged && (purged.has(`user:${id}`) || purged.has(id)));

  if (!remote?.length) {
    return purged ? local.filter((user) => !isPurged(user.id)) : local;
  }
  const localById = new Map(local.map((user) => [user.id, user]));
  const seen = new Set<string>();
  const merged: AppUser[] = [];
  for (const remoteUser of remote) {
    if (isPurged(remoteUser.id)) continue;
    seen.add(remoteUser.id);
    const localUser = localById.get(remoteUser.id);
    if (!localUser) {
      merged.push(remoteUser);
      continue;
    }
    const soft =
      remoteUser.deletedAt
        ? {
            deletedAt: remoteUser.deletedAt,
            deletedBy: remoteUser.deletedBy,
            deletedReason: remoteUser.deletedReason,
            active: false,
          }
        : localUser.deletedAt
          ? {
              deletedAt: localUser.deletedAt,
              deletedBy: localUser.deletedBy,
              deletedReason: localUser.deletedReason,
              active: false,
            }
          : {};
    merged.push({
      ...remoteUser,
      ...soft,
      inviteToken: remoteUser.inviteToken ?? localUser.inviteToken,
      inviteCode: remoteUser.inviteCode ?? localUser.inviteCode,
      inviteCreatedAt: remoteUser.inviteCreatedAt ?? localUser.inviteCreatedAt,
      inviteAcceptedAt: remoteUser.inviteAcceptedAt ?? localUser.inviteAcceptedAt,
      invitePending: remoteUser.invitePending ?? localUser.invitePending,
    });
  }
  for (const localUser of local) {
    if (seen.has(localUser.id) || isPurged(localUser.id)) continue;
    merged.push(localUser);
  }
  return merged;
}
