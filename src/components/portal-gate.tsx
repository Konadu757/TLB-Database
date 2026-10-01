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

/**
 * Withholds the dashboard until a Supabase Auth session exists for this tab.
 * A cold URL visit (no tab sign-in marker) clears any restored token and shows
 * the login screen. Refresh after a successful sign-in stays open.
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

    void (async () => {
      await discardRestoredSessionIfColdVisit();
      if (cancelled) return;

      if (!hasTabAuthSession()) {
        setPhase("closed");
      }

      let authEventSeen = false;
      stop = subscribePortalAuth((session) => {
        if (cancelled) return;
        authEventSeen = true;
        setPhase(dashboardAllowed(session) ? "open" : "closed");
      });

      if (!hasTabAuthSession()) return;

      const session = await readPortalSession();
      if (cancelled || authEventSeen) return;
      setPhase(dashboardAllowed(session) ? "open" : "closed");
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useEffect(() => {
    document.title =
      phase !== "open"
        ? "Sign in | TLB Enterprise"
        : pathname === "/profile"
          ? "Profile | TLB Enterprise"
          : "Executive Dashboard | TLB Enterprise";
  }, [phase, pathname]);

  if (phase !== "open") {
    return (
      <PortalLogin
        configured={configured}
        checking={phase === "checking"}
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
