import { useRouterState } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { PortalLogin } from "@/components/portal-login";
import {
  dashboardAllowed,
  discardRestoredSessionIfColdVisit,
  hasTabAuthSession,
  publishableAuthConfigured,
  readPortalSession,
  sessionFromSignIn,
  signInWithOwnerPassword,
  signOutPortal,
  subscribePortalAuth,
} from "@/lib/auth/portal-auth";

type PortalAuthContextValue = {
  signOut: () => Promise<void>;
};

const PortalAuthContext = createContext<PortalAuthContextValue | null>(null);

export function usePortalSignOut(): () => Promise<void> {
  const ctx = useContext(PortalAuthContext);
  return (
    ctx?.signOut ??
    (async () => {
      await signOutPortal();
    })
  );
}

/** Neutral shell while tab auth is still resolving — never the login form. */
function PortalAuthResolving() {
  return (
    <div className="tlb-portal-resolving" aria-busy="true" aria-live="polite">
      <span className="tlb-portal-resolving-label">Loading portal…</span>
    </div>
  );
}

/**
 * Withholds the dashboard until a Supabase Auth session exists for this tab.
 * A cold URL visit (no tab sign-in marker) clears any restored token and shows
 * the login screen. Refresh after a successful sign-in stays open without
 * flashing the login form while session state resolves.
 */
export function PortalGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<"checking" | "closed" | "open">("checking");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const configured = publishableAuthConfigured();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    let cancelled = false;
    let stop = () => {};
    let initialResolved = false;

    void (async () => {
      await discardRestoredSessionIfColdVisit();
      if (cancelled) return;

      const tabMarked = hasTabAuthSession();

      stop = subscribePortalAuth((session) => {
        if (cancelled) return;
        // While the first resolve is in flight, ignore null events from
        // onAuthStateChange (e.g. INITIAL_SESSION before storage hydrate).
        // A positive session may open early; closing waits for readPortalSession
        // (or post-resolve sign-out / expiry).
        if (!initialResolved) {
          if (dashboardAllowed(session)) {
            initialResolved = true;
            setPhase("open");
          }
          return;
        }
        setPhase(dashboardAllowed(session) ? "open" : "closed");
      });

      if (!tabMarked) {
        initialResolved = true;
        setPhase("closed");
        return;
      }

      const session = await readPortalSession();
      if (cancelled) return;
      initialResolved = true;
      setPhase(dashboardAllowed(session) ? "open" : "closed");
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useEffect(() => {
    if (phase === "checking") return;
    document.title =
      phase === "closed"
        ? "Sign in | TLB Enterprise"
        : pathname === "/profile"
          ? "Profile | TLB Enterprise"
          : "Executive Dashboard | TLB Enterprise";
  }, [phase, pathname]);

  if (phase === "checking") {
    return <PortalAuthResolving />;
  }

  if (phase === "closed") {
    return (
      <PortalLogin
        configured={configured}
        pending={pending}
        error={error}
        onSubmit={(email, password) => {
          setPending(true);
          setError(null);
          void signInWithOwnerPassword(email, password).then((result) => {
            const session = sessionFromSignIn(result);
            setPending(false);
            if (!result.ok || !dashboardAllowed(session)) {
              setPhase("closed");
              setError(result.ok ? "Sign-in did not open a session." : result.error);
              return;
            }
            setPhase("open");
          });
        }}
      />
    );
  }

  return (
    <PortalAuthContext.Provider
      value={{
        signOut: async () => {
          await signOutPortal();
          setPhase("closed");
          setError(null);
        },
      }}
    >
      {children}
    </PortalAuthContext.Provider>
  );
}
