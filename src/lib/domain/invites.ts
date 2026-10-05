/** Invite / access-code helpers for mock-auth staff onboarding. */

import {
  isPortalOwnerAuth,
  SYSTEM_ROLE_IDS,
  systemRoleKeyForDbCode,
} from "./permissions";
import type { AppUser } from "./types";

/**
 * Map tlb.roles.code / accept_invite role_code onto a local system role id.
 * Never returns Owner for non-portal-Owner Auth identities.
 */
export function staffRoleIdFromCloudCode(
  roleCode: string | null | undefined,
  identity?: { authUserId?: string; email?: string },
): string | undefined {
  if (!roleCode?.trim()) return undefined;
  const key = systemRoleKeyForDbCode(roleCode);
  if (!key) return undefined;
  if (key === "Owner") {
    return isPortalOwnerAuth({
      authUserId: identity?.authUserId,
      email: identity?.email,
    })
      ? SYSTEM_ROLE_IDS.Owner
      : undefined;
  }
  return SYSTEM_ROLE_IDS[key];
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const AUTH_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  // Signed-in / Auth-provisioned staff are never Pending in Owner UI.
  if (user.lastLoginAt) return false;
  if (user.inviteAcceptedAt) return false;
  if (user.invitePending === false) return false;
  if (isAuthProfileId(user.id) && !user.inviteToken && !user.inviteCode) return false;
  return Boolean(user.invitePending && user.inviteToken && user.inviteCode);
}

export function isAuthProfileId(id: string): boolean {
  return AUTH_UUID_RE.test(id.trim());
}

function emailKey(user: { email?: string | null }): string {
  return (user.email ?? "").trim().toLowerCase();
}

function inviteLooksAccepted(user: AppUser): boolean {
  return Boolean(user.inviteAcceptedAt) || user.invitePending === false;
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
  const next: AppUser = {
    ...user,
    invitePending: false,
    inviteAcceptedAt: at,
  };
  delete next.inviteToken;
  delete next.inviteCode;
  return next;
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
    // Never publish a stale Pending flag once acceptance / login is known.
    if (inviteLooksAccepted(user) || user.lastLoginAt || isAuthProfileId(user.id)) {
      copy.invitePending = false;
      if (!copy.inviteAcceptedAt && user.lastLoginAt) {
        copy.inviteAcceptedAt = user.lastLoginAt;
      }
    }
    return copy;
  });
}

function mergeInviteFields(remoteUser: AppUser, localUser: AppUser): Partial<AppUser> {
  // Acceptance on either side wins. Invitee remaps to Auth UUID and clears pending;
  // Owner's browser still holds the old token/code and invitePending:true.
  if (inviteLooksAccepted(remoteUser) || inviteLooksAccepted(localUser)) {
    const acceptedAt =
      remoteUser.inviteAcceptedAt ?? localUser.inviteAcceptedAt ?? new Date().toISOString();
    return {
      invitePending: false,
      inviteAcceptedAt: acceptedAt,
      inviteCreatedAt: remoteUser.inviteCreatedAt ?? localUser.inviteCreatedAt,
      inviteToken: undefined,
      inviteCode: undefined,
    };
  }
  return {
    inviteToken: remoteUser.inviteToken ?? localUser.inviteToken,
    inviteCode: remoteUser.inviteCode ?? localUser.inviteCode,
    inviteCreatedAt: remoteUser.inviteCreatedAt ?? localUser.inviteCreatedAt,
    inviteAcceptedAt: remoteUser.inviteAcceptedAt ?? localUser.inviteAcceptedAt,
    invitePending: remoteUser.invitePending ?? localUser.invitePending,
  };
}

function preferStaffId(remoteUser: AppUser, localUser: AppUser): string {
  if (isAuthProfileId(remoteUser.id)) return remoteUser.id;
  if (isAuthProfileId(localUser.id)) return localUser.id;
  return remoteUser.id || localUser.id;
}

/**
 * Prefer remote staff rows, but keep invite secrets that exist only on this browser.
 * Remote auth_directory intentionally omits token and code.
 * Soft-delete on either side must survive hydrate (local tombstone wins if remote is stale).
 * Permanently purged ids never reappear from remote or local seed.
 * Rows are matched by id OR email so Auth UUID remaps after accept_invite collapse Pending.
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
  const localByEmail = new Map<string, AppUser>();
  for (const user of local) {
    const key = emailKey(user);
    if (key && !localByEmail.has(key)) localByEmail.set(key, user);
  }

  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  const merged: AppUser[] = [];

  for (const remoteUser of remote) {
    if (isPurged(remoteUser.id)) continue;
    const key = emailKey(remoteUser);
    const localUser = localById.get(remoteUser.id) ?? (key ? localByEmail.get(key) : undefined);

    if (!localUser) {
      seenIds.add(remoteUser.id);
      if (key) seenEmails.add(key);
      merged.push(remoteUser);
      continue;
    }

    seenIds.add(remoteUser.id);
    seenIds.add(localUser.id);
    if (key) seenEmails.add(key);

    const soft =
      remoteUser.deletedAt
        ? {
            deletedAt: remoteUser.deletedAt,
            deletedBy: remoteUser.deletedBy,
            deletedReason: remoteUser.deletedReason,
            active: false as const,
          }
        : localUser.deletedAt
          ? {
              deletedAt: localUser.deletedAt,
              deletedBy: localUser.deletedBy,
              deletedReason: localUser.deletedReason,
              active: false as const,
            }
          : {};

    const inviteFields = mergeInviteFields(remoteUser, localUser);
    const next: AppUser = {
      ...remoteUser,
      ...soft,
      id: preferStaffId(remoteUser, localUser),
      name: remoteUser.name || localUser.name,
      email: remoteUser.email || localUser.email,
      contact: remoteUser.contact ?? localUser.contact,
      roleId: remoteUser.roleId || localUser.roleId,
      active: soft.active === false ? false : (remoteUser.active && localUser.active),
      ...inviteFields,
    };
    if (inviteFields.inviteToken === undefined) delete next.inviteToken;
    if (inviteFields.inviteCode === undefined) delete next.inviteCode;
    merged.push(next);
  }

  for (const localUser of local) {
    if (isPurged(localUser.id) || seenIds.has(localUser.id)) continue;
    const key = emailKey(localUser);
    if (key && seenEmails.has(key)) continue;
    merged.push(localUser);
  }
  return merged;
}

/** Cloud roster row from public.list_staff_access_status. */
export type CloudStaffAccessStatus = {
  email: string;
  fullName?: string;
  profileId?: string | null;
  roleCode?: string | null;
  invitePending: boolean;
  inviteAcceptedAt?: string | null;
  active?: boolean;
  /** auth.users.last_sign_in_at when the profile exists. */
  lastSignInAt?: string | null;
};

/**
 * Apply hosted invite/profile status onto the Owner staff list.
 * Consumed invites, Auth profiles, and any last_sign_in clear Pending even when
 * localStorage / auth_directory still hold the pre-accept token row.
 *
 * Permanent rule: profileId or lastSignInAt always means Active (not Pending),
 * even if a leftover live invite row still exists in tlb.invites.
 *
 * Permanent rule: role_code from tlb.user_roles / invites always wins over a
 * stale local/auth_directory roleId (so Finance never stays Owner/Admin).
 */
export function applyCloudStaffAccessStatuses(
  users: AppUser[],
  statuses: CloudStaffAccessStatus[],
): AppUser[] {
  if (!statuses.length) return users;

  const byEmail = new Map<string, CloudStaffAccessStatus>();
  for (const status of statuses) {
    const key = (status.email ?? "").trim().toLowerCase();
    if (!key) continue;
    const prev = byEmail.get(key);
    // Prefer rows that already have a profile / acceptance / sign-in over bare pending invites.
    const statusRank =
      (status.profileId ? 4 : 0) +
      (status.lastSignInAt ? 2 : 0) +
      (!status.invitePending ? 1 : 0);
    const prevRank = prev
      ? (prev.profileId ? 4 : 0) + (prev.lastSignInAt ? 2 : 0) + (!prev.invitePending ? 1 : 0)
      : -1;
    if (!prev || statusRank >= prevRank) {
      byEmail.set(key, status);
    }
  }

  const seenEmails = new Set<string>();
  const merged = users.map((user) => {
    const key = emailKey(user);
    const status = byEmail.get(key);
    if (!status) return user;
    if (key) seenEmails.add(key);

    const next: AppUser = { ...user };
    const profileId = status.profileId?.trim() || "";
    if (profileId) next.id = profileId;
    if (status.fullName?.trim()) next.name = status.fullName.trim();
    if (typeof status.active === "boolean") next.active = status.active;

    if (status.lastSignInAt?.trim()) {
      next.lastLoginAt = status.lastSignInAt.trim();
    }

    const cloudRoleId = staffRoleIdFromCloudCode(status.roleCode, {
      authUserId: profileId || next.id,
      email: status.email || next.email,
    });
    if (cloudRoleId) {
      next.roleId = cloudRoleId;
    } else if (
      !isPortalOwnerAuth({ authUserId: next.id, email: next.email }) &&
      next.roleId === SYSTEM_ROLE_IDS.Owner
    ) {
      // Stale Owner on a staff row with no cloud code — drop to Admin until
      // the next invite/role sync; never keep Owner for non-Owner Auth.
      next.roleId = SYSTEM_ROLE_IDS.Admin;
    }

    const onboarded =
      Boolean(profileId) ||
      Boolean(status.lastSignInAt?.trim()) ||
      Boolean(status.inviteAcceptedAt?.trim()) ||
      !status.invitePending;

    if (onboarded) {
      next.invitePending = false;
      next.inviteAcceptedAt =
        status.inviteAcceptedAt?.trim() ||
        next.inviteAcceptedAt ||
        status.lastSignInAt?.trim() ||
        new Date().toISOString();
      delete next.inviteToken;
      delete next.inviteCode;
    } else if (!next.inviteAcceptedAt && !next.lastLoginAt) {
      next.invitePending = true;
    }

    return next;
  });

  // Upsert cloud-only profiles (accepted Finance invitee missing from local/auth_directory).
  for (const status of byEmail.values()) {
    const key = (status.email ?? "").trim().toLowerCase();
    if (!key || seenEmails.has(key)) continue;
    if (isPortalOwnerAuth({ email: key, authUserId: status.profileId ?? undefined })) {
      continue;
    }
    const profileId = status.profileId?.trim() || "";
    const roleId =
      staffRoleIdFromCloudCode(status.roleCode, {
        authUserId: profileId,
        email: key,
      }) ?? SYSTEM_ROLE_IDS.Admin;
    const created: AppUser = {
      id: profileId || `invite-cloud-${key}`,
      name: status.fullName?.trim() || key.split("@")[0] || "Staff",
      email: key,
      roleId,
      active: status.active !== false,
      invitePending: Boolean(status.invitePending) && !profileId && !status.lastSignInAt,
    };
    if (status.inviteAcceptedAt?.trim()) created.inviteAcceptedAt = status.inviteAcceptedAt.trim();
    if (status.lastSignInAt?.trim()) created.lastLoginAt = status.lastSignInAt.trim();
    if (!created.invitePending) {
      delete created.inviteToken;
      delete created.inviteCode;
      if (!created.inviteAcceptedAt && created.lastLoginAt) {
        created.inviteAcceptedAt = created.lastLoginAt;
      }
    }
    merged.push(created);
    seenEmails.add(key);
  }

  return merged;
}
