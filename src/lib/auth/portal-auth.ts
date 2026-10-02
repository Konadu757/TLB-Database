/**
 * Portal sign-in gate.
 * A Supabase Auth session is the only way in. A failed password, a missing
 * session, or missing publishable env never opens the dashboard and never
 * writes the Owner workspace session.
 *
 * Persisted tokens alone do not open the portal on a cold URL visit. This tab
 * must complete email/password sign-in once (sessionStorage marker). Refresh
 * in the same tab stays signed in; a new tab or browser session asks again.
 */

export type PortalSession = {
  userId: string;
  email: string;
};

export type SignInResult =
  { ok: true; userId: string; email: string } | { ok: false; error: string };

export const SIGN_IN_REQUIRED =
  "Sign-in is required. Supabase Auth is not configured for this portal, so it stays closed.";

export const SIGN_IN_UNREACHABLE =
  "Could not reach Supabase (Failed to fetch). The sign-in host did not respond, so the password was not checked. Confirm the Supabase project is active and VITE_SUPABASE_URL is that project's URL.";

/** sessionStorage flag: this tab completed password sign-in. */
const TAB_AUTH_KEY = "tlb-portal-tab-auth";

/** Browser "Failed to fetch" is a network failure, not a rejected password. */
export function signInFailureMessage(
  error: {
    message?: string;
    name?: string;
    status?: number;
  } | null,
): string {
  const message = error?.message?.trim() ?? "";
  const lower = message.toLowerCase();
  const unreachable =
    lower === "failed to fetch" ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("load failed") ||
    (error?.name === "AuthRetryableFetchError" && !error.status && !message);
  if (unreachable) return SIGN_IN_UNREACHABLE;
  if (message) return message;
  return "Sign-in failed. Check the email and password.";
}

function envValue(name: string): string {
  try {
    const vite = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const fromVite = vite?.[name];
    if (typeof fromVite === "string" && fromVite.trim()) return fromVite.trim();
  } catch {
    /* import.meta.env is a Vite field; Node scripts may not have it. */
  }
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return typeof fromProcess === "string" ? fromProcess.trim() : "";
}

/** True when the browser can talk to GoTrue with the publishable key. */
export function publishableAuthConfigured(): boolean {
  const url = envValue("VITE_SUPABASE_URL") || envValue("SUPABASE_URL");
  const key = envValue("VITE_SUPABASE_PUBLISHABLE_KEY") || envValue("SUPABASE_PUBLISHABLE_KEY");
  return Boolean(url && key);
}

/** True when this browser tab has completed a fresh email/password sign-in. */
export function hasTabAuthSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(TAB_AUTH_KEY) === "1";
  } catch {
    return false;
  }
}

function markTabAuthSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(TAB_AUTH_KEY, "1");
  } catch {
    /* private mode / blocked storage */
  }
}

function clearTabAuthSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(TAB_AUTH_KEY);
  } catch {
    /* private mode / blocked storage */
  }
}

/** A rejected password produces no session. */
export function sessionFromSignIn(result: SignInResult): PortalSession | null {
  if (!result.ok || !result.userId) return null;
  return { userId: result.userId, email: result.email };
}

/** The dashboard may render only when a real auth user id is present. */
export function dashboardAllowed(session: PortalSession | null): boolean {
  return Boolean(session?.userId);
}

async function authClient() {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase;
}

/**
 * On a cold visit (no tab sign-in marker), clear any restored localStorage
 * session so typing the portal URL cannot bypass the login screen.
 * Preserve Auth recovery / invite callback sessions from email links.
 */
export async function discardRestoredSessionIfColdVisit(): Promise<void> {
  if (!publishableAuthConfigured() || typeof window === "undefined") return;
  if (hasTabAuthSession()) return;
  if (authCallbackInUrl()) {
    markTabAuthSession();
    return;
  }
  try {
    const supabase = await authClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* stay closed; gate will show sign-in */
  }
}

/** True when the URL carries an Auth callback (recovery / magic / OAuth code). */
function authCallbackInUrl(): boolean {
  if (typeof window === "undefined") return false;
  const { hash, search } = window.location;
  if (/type=(recovery|signup|magiclink|invite)/i.test(hash)) return true;
  if (/access_token=/i.test(hash)) return true;
  if (/[?&]code=/.test(search)) return true;
  return false;
}

export async function readPortalSession(): Promise<PortalSession | null> {
  if (!publishableAuthConfigured() || typeof window === "undefined") return null;
  if (!hasTabAuthSession()) return null;
  try {
    const supabase = await authClient();
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.user?.id) return null;
    return {
      userId: data.session.user.id,
      email: data.session.user.email ?? "",
    };
  } catch {
    return null;
  }
}

export async function signInWithOwnerPassword(
  email: string,
  password: string,
): Promise<SignInResult> {
  const trimmed = email.trim();
  if (!trimmed || !password) {
    return { ok: false, error: "Enter your email and password." };
  }
  if (!publishableAuthConfigured()) {
    return { ok: false, error: SIGN_IN_REQUIRED };
  }
  try {
    const supabase = await authClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimmed,
      password,
    });
    if (error || !data.session?.user?.id) {
      clearTabAuthSession();
      return { ok: false, error: signInFailureMessage(error as { message?: string; name?: string; status?: number } | null) };
    }
    markTabAuthSession();
    // Durable Owner-visible trail — failures must not block a successful sign-in.
    try {
      const { recordPortalLoginActivity } = await import("@/lib/access/portal-activity");
      const recorded = await recordPortalLoginActivity();
      if (!recorded.ok) {
        console.warn("[portal-auth] login activity not recorded:", recorded.error);
      }
    } catch (activityErr) {
      console.warn(
        "[portal-auth] login activity skipped:",
        activityErr instanceof Error ? activityErr.message : activityErr,
      );
    }
    return {
      ok: true,
      userId: data.session.user.id,
      email: data.session.user.email ?? trimmed,
    };
  } catch (err) {
    clearTabAuthSession();
    const named = err instanceof Error ? err : null;
    return { ok: false, error: signInFailureMessage(named) };
  }
}

export async function signOutPortal(): Promise<void> {
  clearTabAuthSession();
  if (!publishableAuthConfigured() || typeof window === "undefined") return;
  const supabase = await authClient();
  await supabase.auth.signOut();
}

export type PasswordResetResult = { ok: true } | { ok: false; error: string };

/** Sends Supabase Auth recovery email when project mailer/SMTP is configured. */
export async function requestPasswordReset(email: string): Promise<PasswordResetResult> {
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: "Enter your email to reset the password." };
  if (!publishableAuthConfigured()) {
    return { ok: false, error: SIGN_IN_REQUIRED };
  }
  try {
    const supabase = await authClient();
    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/profile` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo,
    });
    if (error) {
      return { ok: false, error: signInFailureMessage(error as { message?: string; name?: string; status?: number }) };
    }
    return { ok: true };
  } catch (err) {
    const named = err instanceof Error ? err : null;
    return { ok: false, error: signInFailureMessage(named) };
  }
}

/** Updates the signed-in Auth user's password (after login or recovery link). */
export async function updatePortalPassword(password: string): Promise<PasswordResetResult> {
  const next = password.trim();
  if (next.length < 8) {
    return { ok: false, error: "Use a password with at least 8 characters." };
  }
  if (!publishableAuthConfigured()) {
    return { ok: false, error: SIGN_IN_REQUIRED };
  }
  try {
    const supabase = await authClient();
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) {
      return { ok: false, error: signInFailureMessage(error as { message?: string; name?: string; status?: number }) };
    }
    return { ok: true };
  } catch (err) {
    const named = err instanceof Error ? err : null;
    return { ok: false, error: signInFailureMessage(named) };
  }
}

export function subscribePortalAuth(onChange: (session: PortalSession | null) => void): () => void {
  if (!publishableAuthConfigured() || typeof window === "undefined") return () => {};
  let unsubscribe = () => {};
  let cancelled = false;
  void authClient().then((supabase) => {
    if (cancelled) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user?.id || !hasTabAuthSession()) {
        onChange(null);
        return;
      }
      onChange({
        userId: session.user.id,
        email: session.user.email ?? "",
      });
    });
    unsubscribe = () => data.subscription.unsubscribe();
  });
  return () => {
    cancelled = true;
    unsubscribe();
  };
}
