/** Shared phone heuristics for invite SMS (safe for browser + server). */

export function looksLikePhoneNumber(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.includes("@")) return false;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  const allowed = /^[+]?[\d\s().-]{8,22}$/;
  return allowed.test(trimmed);
}

/** E.164-ish: keep leading +, strip other non-digits. */
export function normalizePhoneForSms(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}
