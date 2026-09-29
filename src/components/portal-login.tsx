import { useState } from "react";

import logoUrl from "@/assets/tlb-logo.png";
import { SIGN_IN_REQUIRED } from "@/lib/auth/portal-auth";

type PortalLoginProps = {
  configured: boolean;
  checking: boolean;
  pending: boolean;
  error: string | null;
  onSubmit: (email: string, password: string) => void;
};

export function PortalLogin({ configured, checking, pending, error, onSubmit }: PortalLoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="tlb-login">
      <section className="tlb-login-card" aria-labelledby="tlb-login-title">
        <div className="tlb-login-brand">
          <div>
            <span className="tlb-login-mark">
              <img src={logoUrl} alt="" className="tlb-brand-logo" />
            </span>
            <h1 id="tlb-login-title">TLB Enterprise</h1>
            <i className="tlb-login-rule" aria-hidden="true" />
            <p>Operations portal</p>
          </div>
          <p className="tlb-login-note">
            The workspace opens only after this sign-in is accepted. The Owner uses the same gate.
          </p>
        </div>
        <div className="tlb-login-body">
          <div className="tlb-login-heading">
            <span>Access</span>
            <strong>{checking ? "Checking session" : "Sign in"}</strong>
          </div>
          {checking ? (
            <p className="tlb-login-status">Checking your session…</p>
          ) : (
            <form
              className="tlb-form-grid tlb-login-form"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit(email, password);
              }}
            >
              <p className="tlb-login-lead tlb-span-2">
                Enter the Owner email and password. Nothing in the portal is available until this
                check succeeds.
              </p>
              {!configured ? <p className="tlb-login-error tlb-span-2">{SIGN_IN_REQUIRED}</p> : null}
              <label className="tlb-span-2">
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={pending}
                />
              </label>
              <label className="tlb-span-2">
                Password
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={pending}
                />
              </label>
              {error ? <p className="tlb-login-error tlb-span-2">{error}</p> : null}
              <div className="tlb-form-actions tlb-span-2">
                <button className="tlb-login-submit" type="submit" disabled={pending}>
                  {pending ? "Checking…" : "Sign in"}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
