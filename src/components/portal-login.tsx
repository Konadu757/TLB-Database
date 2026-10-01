import { useState } from "react";

import logoUrl from "@/assets/tlb-logo.png";
import { SIGN_IN_REQUIRED } from "@/lib/auth/portal-auth";

type PortalLoginProps = {
  configured: boolean;
  pending: boolean;
  error: string | null;
  onSubmit: (email: string, password: string) => void;
};

export function PortalLogin({ configured, pending, error, onSubmit }: PortalLoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

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
        </div>
        <div className="tlb-login-body">
          <div className="tlb-login-heading">
            <strong>Sign in</strong>
          </div>
          <form
            className="tlb-form-grid tlb-login-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit(email, password);
            }}
          >
            {!configured ? (
              <p className="tlb-login-error tlb-span-2">{SIGN_IN_REQUIRED}</p>
            ) : null}
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
              <span className="tlb-login-password">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={pending}
                />
                <button
                  type="button"
                  className="tlb-login-reveal"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((visible) => !visible)}
                  disabled={pending}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>
            {error ? <p className="tlb-login-error tlb-span-2">{error}</p> : null}
            <div className="tlb-form-actions tlb-span-2">
              <button className="tlb-login-submit" type="submit" disabled={pending}>
                {pending ? "Checking…" : "Sign in"}
              </button>
            </div>
            <p className="tlb-login-invite tlb-span-2">
              Have an invite?{" "}
              <a href="/access">Enter your access code</a>
              {" — confirm details, then set your password."}
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}
