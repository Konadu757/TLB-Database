/**
 * Portal sign-in gate.
 * A Supabase Auth session is the only way in. A failed password, a missing
 * session, or missing publishable env never opens the dashboard and never
 * writes the Owner workspace session.
 */

export type PortalSession = {
  userId: string;
  email: string;
};

export type SignInResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; error: string };

export const SIGN_IN_REQUIRED =
  "Sign-in is required. Supabase Auth is not configured for this portal, so it stays closed.";

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

export async function readPortalSession(): Promise<PortalSession | null> {
  if (!publishableAuthConfigured() || typeof window === "undefined") return null;
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
    return { ok: false, error: "Enter the Owner email and password." };
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
      return {
        ok: false,
        error: error?.message || "Sign-in failed. Check the email and password.",
      };
    }
    return {
      ok: true,
      userId: data.session.user.id,
      email: data.session.user.email ?? trimmed,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign-in failed.";
    return { ok: false, error: message };
  }
}

export async function signOutPortal(): Promise<void> {
  if (!publishableAuthConfigured() || typeof window === "undefined") return;
  const supabase = await authClient();
  await supabase.auth.signOut();
}

export function subscribePortalAuth(
  onChange: (session: PortalSession | null) => void,
): () => void {
  if (!publishableAuthConfigured() || typeof window === "undefined") return () => {};
  let unsubscribe = () => {};
  let cancelled = false;
  void authClient().then((supabase) => {
    if (cancelled) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user?.id) {
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
