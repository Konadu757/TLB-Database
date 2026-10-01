import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { signInWithOwnerPassword } from "@/lib/auth/portal-auth";
import { useTlbStore } from "@/lib/store/use-tlb-store";

export const Route = createFileRoute("/access")({
  validateSearch: (search: Record<string, unknown>) => ({
    invite: typeof search["invite"] === "string" ? search["invite"] : undefined,
    code: typeof search["code"] === "string" ? search["code"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Access | TLB Enterprise" },
      {
        name: "description",
        content: "Activate your TLB staff invite with an access code, then set your password.",
      },
    ],
  }),
  component: AccessPage,
});

type Step = "code" | "password";

function AccessPage() {
  const search = Route.useSearch();
  const inviteToken = search.invite;
  const codeFromUrl = search.code;
  const navigate = useNavigate();
  const store = useTlbStore();
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState(codeFromUrl?.trim() ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [previewEmail, setPreviewEmail] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const autoChecked = useRef<string | null>(null);

  const error = localError ?? store.error;

  useEffect(() => {
    if (!store.hydrated) return;
    if (!inviteToken && !codeFromUrl) return;
    const key = `${inviteToken ?? ""}|${codeFromUrl ?? ""}`;
    if (autoChecked.current === key) return;
    autoChecked.current = key;
    if (codeFromUrl?.trim()) setCode(codeFromUrl.trim());
    setPending(true);
    setLocalError(null);
    const validateInput: { token?: string; code?: string } = {};
    if (inviteToken) validateInput.token = inviteToken;
    const trimmedFromUrl = codeFromUrl?.trim();
    if (trimmedFromUrl) validateInput.code = trimmedFromUrl;
    void store.validateInvite(validateInput).then((result) => {
      setPending(false);
      if (!result.ok || !result.data) return;
      setPreviewEmail(result.data.email);
      setPreviewName(result.data.fullName);
      if (result.data.accessCode) setCode(result.data.accessCode);
      setStep("password");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one auto-check when hydrated + invite link present
  }, [store.hydrated, inviteToken, codeFromUrl]);

  const onConfirmCode = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    const trimmed = code.trim();
    if (!inviteToken && !trimmed) {
      setLocalError("Enter the access code from your invite.");
      return;
    }
    setPending(true);
    const validateInput: { token?: string; code?: string } = {};
    if (inviteToken) validateInput.token = inviteToken;
    if (trimmed) validateInput.code = trimmed;
    void store.validateInvite(validateInput).then((result) => {
      setPending(false);
      if (!result.ok || !result.data) return;
      setPreviewEmail(result.data.email);
      setPreviewName(result.data.fullName);
      if (result.data.accessCode) setCode(result.data.accessCode);
      setStep("password");
    });
  };

  const onSetPassword = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (password.length < 8) {
      setLocalError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setLocalError("Passwords do not match.");
      return;
    }
    setPending(true);
    const acceptInput: { token?: string; code?: string; password: string } = { password };
    if (inviteToken) acceptInput.token = inviteToken;
    const trimmedCode = code.trim();
    if (trimmedCode) acceptInput.code = trimmedCode;
    void store.acceptInvite(acceptInput).then(async (result) => {
      if (!result.ok || !result.data) {
        setPending(false);
        return;
      }
      const email = result.data.email;
      const signIn = await signInWithOwnerPassword(email, password);
      setPending(false);
      if (!signIn.ok) {
        setLocalError(
          signIn.error ||
            "Password was saved, but sign-in failed. Open the home page and sign in with your email and new password.",
        );
        return;
      }
      void navigate({ to: "/" });
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <article className="tlb-panel" style={{ width: "100%", maxWidth: 420 }}>
        <div className="tlb-panel-heading">
          <div>
            <span>Access</span>
            <strong className="font-display">
              {step === "code" ? "Enter access code" : "Create your password"}
            </strong>
          </div>
        </div>

        {step === "code" ? (
          <form className="tlb-form-grid" style={{ padding: 16 }} onSubmit={onConfirmCode}>
            <p className="tlb-muted-line tlb-span-2" style={{ margin: 0 }}>
              Enter the access code your administrator shared. This is not a password — you will
              create your own password next.
            </p>
            {inviteToken ? (
              <p className="tlb-muted-line tlb-span-2" style={{ margin: 0 }}>
                Invite link detected. Confirm with your access code, or continue if the link alone
                is enough.
              </p>
            ) : null}
            <label className="tlb-span-2">
              Access code
              <input
                className="tlb-mono"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="TLB-XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
              />
            </label>
            {error ? (
              <p
                className="tlb-span-2"
                style={{ color: "var(--destructive)", margin: 0, fontSize: "0.8125rem" }}
              >
                {error}
              </p>
            ) : null}
            <div className="tlb-form-actions tlb-span-2">
              <Button type="submit" disabled={!store.hydrated || store.saving || pending}>
                {!store.hydrated ? "Loading…" : pending ? "Checking…" : "Continue"}
              </Button>
            </div>
            <p className="tlb-muted-line tlb-span-2" style={{ margin: 0 }}>
              Already activated?{" "}
              <Link to="/" style={{ textDecoration: "underline" }}>
                Sign in with email and password
              </Link>
            </p>
          </form>
        ) : (
          <form className="tlb-form-grid" style={{ padding: 16 }} onSubmit={onSetPassword}>
            <p className="tlb-muted-line tlb-span-2" style={{ margin: 0 }}>
              {previewName ? `Welcome, ${previewName}. ` : null}
              Choose a password for{" "}
              <span className="tlb-mono">{previewEmail ?? "your account"}</span>. Use this email and
              password to sign in from now on.
            </p>
            <label className="tlb-span-2">
              New password
              <span className="tlb-login-password">
                <input
                  type={showPassword ? "text" : "password"}
                  name="new-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
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
            <label className="tlb-span-2">
              Confirm password
              <input
                type={showPassword ? "text" : "password"}
                name="confirm-password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                disabled={pending}
              />
            </label>
            {error ? (
              <p
                className="tlb-span-2"
                style={{ color: "var(--destructive)", margin: 0, fontSize: "0.8125rem" }}
              >
                {error}
              </p>
            ) : null}
            <div className="tlb-form-actions tlb-span-2" style={{ gap: 8 }}>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setStep("code");
                  setPassword("");
                  setConfirmPassword("");
                  setLocalError(null);
                }}
              >
                Back
              </Button>
              <Button type="submit" disabled={pending || store.saving}>
                {pending ? "Saving…" : "Set password and enter"}
              </Button>
            </div>
          </form>
        )}
      </article>
    </div>
  );
}
