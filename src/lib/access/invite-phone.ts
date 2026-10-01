/** Shared phone heuristics for invite SMS (safe for browser + server). */

/** Pull the first plausible phone fragment from free text (e.g. "024 123 4567 MTN"). */
function phoneFragment(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/\+?\d[\d\s().-]{6,20}\d/);
  return match?.[0]?.trim() ?? trimmed;
}

/** Ghana mobile subscriber prefixes (without leading 0 / country code). */
const GHANA_MOBILE_PREFIX =
  /^(20|23|24|25|26|27|28|50|53|54|55|56|57|59)\d{7}$/;

export function looksLikePhoneNumber(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.includes("@")) return false;

  const fragment = phoneFragment(trimmed);
  const digits = fragment.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;

  // Ghana local (024… / 020…) or international (233… / +233…)
  if (/^0\d{9}$/.test(digits)) return true;
  if (/^233\d{9}$/.test(digits)) return true;
  // 9-digit local without leading 0 (241234567)
  if (GHANA_MOBILE_PREFIX.test(digits)) return true;

  const allowed = /^[+]?[\d\s().-]{8,22}$/;
  return allowed.test(fragment);
}

/**
 * Normalize to E.164 with leading +.
 * Ghana: 0241234567 / 24 123 4567 → +233241234567 (never leave a leading 0 for gateways).
 */
export function normalizePhoneForSms(raw: string): string {
  const fragment = phoneFragment(raw.trim());
  let digits = fragment.replace(/\D/g, "");

  if (/^0\d{9}$/.test(digits)) {
    digits = `233${digits.slice(1)}`;
  } else if (/^2330\d{9}$/.test(digits)) {
    // Mistyped +2330XXXXXXXXX
    digits = `233${digits.slice(4)}`;
  } else if (GHANA_MOBILE_PREFIX.test(digits)) {
    digits = `233${digits}`;
  }

  if (!digits) return "";
  return `+${digits}`;
}

/**
 * Digits-only international MSISDN for Arkesel / Termii (no leading +).
 * Arkesel docs accept both `233XXXXXXXXX` and `+233XXXXXXXXX`; we send digits-only.
 */
export function normalizePhoneDigits(raw: string): string {
  return normalizePhoneForSms(raw).replace(/^\+/, "");
}

/** True when digits are a plausible Ghana MSISDN after normalization. */
export function isNormalizedGhanaMsisdn(digits: string): boolean {
  return /^233\d{9}$/.test(digits);
}
