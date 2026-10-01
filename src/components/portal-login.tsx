import { useState } from "react";

import logoUrl from "@/assets/tlb-logo.png";
import { requestPasswordReset, SIGN_IN_REQUIRED } from "@/lib/auth/portal-auth";

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
  const [mode, setMode] = useState<"sign-in" | "forgot">("sign-in");
  const [resetPending, setResetPending] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetNotice, setResetNotice] = useState<string | null>(null);

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
            <strong>{mode === "forgot" ? "Reset password" : "Sign in"}</strong>
          </div>
          {mode === "sign-in" ? (
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
                <button
                  type="button"
                  className="tlb-login-text-link"
                  disabled={pending || !configured}
                  onClick={() => {
                    setMode("forgot");
                    setResetError(null);
                    setResetNotice(null);
                  }}
                >
                  Forgot password?
                </button>
              </p>
              <p className="tlb-login-invite tlb-span-2">
                Have an invite?{" "}
                <a href="/access">Enter your access code</a>
                {" — confirm details, then set your password."}
              </p>
            </form>
          ) : (
            <form
              className="tlb-form-grid tlb-login-form"
              onSubmit={(event) => {
                event.preventDefault();
                setResetPending(true);
                setResetError(null);
                setResetNotice(null);
                void requestPasswordReset(email).then((result) => {
                  setResetPending(false);
                  if (!result.ok) {
                    setResetError(result.error);
                    return;
                  }
                  setResetNotice(
                    "If that email has an account, a reset link was sent. Check your inbox and spam folder.",
                  );
                });
              }}
            >
              {!configured ? (
                <p className="tlb-login-error tlb-span-2">{SIGN_IN_REQUIRED}</p>
              ) : null}
              <p className="tlb-login-invite tlb-span-2">
                Enter the Owner or staff email. We send a Supabase Auth reset link when mail delivery
                is configured for this project.
              </p>
              <label className="tlb-span-2">
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={resetPending}
                />
              </label>
              {resetError ? <p className="tlb-login-error tlb-span-2">{resetError}</p> : null}
              {resetNotice ? <p className="tlb-login-status tlb-span-2">{resetNotice}</p> : null}
              <div className="tlb-form-actions tlb-span-2">
                <button className="tlb-login-submit" type="submit" disabled={resetPending || !configured}>
                  {resetPending ? "Sending…" : "Send reset link"}
                </button>
              </div>
              <p className="tlb-login-invite tlb-span-2">
                <button
                  type="button"
                  className="tlb-login-text-link"
                  disabled={resetPending}
                  onClick={() => {
                    setMode("sign-in");
                    setResetError(null);
                    setResetNotice(null);
                  }}
                >
                  Back to sign in
                </button>
              </p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
