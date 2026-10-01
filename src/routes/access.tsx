import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import logoUrl from "@/assets/tlb-logo.png";
import { Button } from "@/components/ui/button";
import { looksLikePhoneNumber } from "@/lib/access/invite-phone";
import {
  ALL_ROLES,
  SYSTEM_ROLE_DB_CODE,
  systemRoleKeyForDbCode,
} from "@/lib/domain/permissions";
import type { SystemRoleKey } from "@/lib/domain/types";
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
        content:
          "Activate your TLB staff invite: confirm email, access code, contact, and position, then create your password.",
      },
    ],
  }),
  component: AccessPage,
});

type Step = "details" | "password";

type StaffPosition = Exclude<SystemRoleKey, "Owner">;

const POSITION_OPTIONS: StaffPosition[] = ALL_ROLES.filter(
  (role): role is StaffPosition => role !== "Owner",
);

function positionLabelFromRoleCode(roleCode: string | null | undefined): StaffPosition | "" {
  if (!roleCode || roleCode === "local") return "";
  const key = systemRoleKeyForDbCode(roleCode);
  if (!key || key === "Owner") return "";
  return key;
}

function AccessPage() {
  const search = Route.useSearch();
  const inviteToken = search.invite;
  const codeFromUrl = search.code;
  const navigate = useNavigate();
  const store = useTlbStore();
  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(codeFromUrl?.trim() ?? "");
  const [contact, setContact] = useState("");
  const [position, setPosition] = useState<StaffPosition | "">("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [previewEmail, setPreviewEmail] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [previewRoleCode, setPreviewRoleCode] = useState<string | null>(null);
  const autoChecked = useRef<string | null>(null);

  const error = localError ?? store.error;

  const positionOptions = useMemo(() => {
    const locked = positionLabelFromRoleCode(previewRoleCode);
    if (locked && !POSITION_OPTIONS.includes(locked)) {
      return [locked, ...POSITION_OPTIONS];
    }
    return POSITION_OPTIONS;
  }, [previewRoleCode]);

  const applyPreview = (data: {
    email: string;
    fullName: string;
    roleCode: string;
    accessCode?: string;
    contact?: string;
  }) => {
    setPreviewEmail(data.email);
    setPreviewName(data.fullName);
    setPreviewRoleCode(data.roleCode);
    setEmail((prev) => (prev.trim() ? prev : data.email));
    if (data.accessCode) setCode(data.accessCode);
    const roleLabel = positionLabelFromRoleCode(data.roleCode);
    if (roleLabel) setPosition(roleLabel);
    if (data.contact?.trim()) {
      setContact((prev) => (prev.trim() ? prev : data.contact!.trim()));
    }
  };

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
      applyPreview(result.data);
      // Stay on details page so the invitee confirms email, contact, and position.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one auto-check when hydrated + invite link present
  }, [store.hydrated, inviteToken, codeFromUrl]);

  const onConfirmDetails = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedCode = code.trim();
    const trimmedContact = contact.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setLocalError("Enter a valid email address.");
      return;
    }
    if (!inviteToken && !trimmedCode) {
      setLocalError("Enter the access code from your invite.");
      return;
    }
    if (!trimmedContact) {
      setLocalError("Enter your contact phone number.");
      return;
    }
    if (!looksLikePhoneNumber(trimmedContact)) {
      setLocalError("Contact does not look like a phone number.");
      return;
    }
    if (!position) {
      setLocalError("Select the position assigned on your invite.");
      return;
    }

    setPending(true);
    const validateInput: { token?: string; code?: string } = {};
    if (inviteToken) validateInput.token = inviteToken;
    if (trimmedCode) validateInput.code = trimmedCode;
    void store.validateInvite(validateInput).then((result) => {
      setPending(false);
      if (!result.ok || !result.data) return;
      applyPreview(result.data);

      const inviteEmail = result.data.email.trim().toLowerCase();
      if (inviteEmail && trimmedEmail !== inviteEmail) {
        setLocalError(
          `Email does not match this invite. Use ${result.data.email}, or ask an Owner to re-issue.`,
        );
        return;
      }

      const inviteRole = positionLabelFromRoleCode(result.data.roleCode);
      if (inviteRole && position !== inviteRole) {
        setLocalError(
          `Position does not match this invite. Select “${inviteRole}” (assigned by your administrator).`,
        );
        return;
      }
      if (result.data.roleCode === "local" && !inviteRole) {
        // Local-only preview without role code — trust the selected system role label.
      } else if (result.data.roleCode && result.data.roleCode !== "local" && !inviteRole) {
        const expectedCode = SYSTEM_ROLE_DB_CODE[position];
        if (expectedCode !== result.data.roleCode.toUpperCase()) {
          setLocalError("Position does not match this invite.");
          return;
        }
      }

      setEmail(trimmedEmail);
      setContact(trimmedContact);
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
      const signInEmail = result.data.email || email.trim().toLowerCase();
      const signIn = await signInWithOwnerPassword(signInEmail, password);
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
    <div className="tlb-access">
      <article className="tlb-access-card" aria-labelledby="tlb-access-title">
        <header className="tlb-access-brand">
          <span className="tlb-access-mark">
            <img src={logoUrl} alt="" className="tlb-brand-logo" />
          </span>
          <div className="tlb-access-brand-copy">
            <h1 id="tlb-access-title">TLB Enterprise</h1>
            <p>Staff invite onboarding</p>
          </div>
        </header>

        <div className="tlb-access-body">
          <div className="tlb-access-heading">
            <span>Access · Step {step === "details" ? "1" : "2"} of 2</span>
            <strong className="font-display">
              {step === "details" ? "Confirm your details" : "Create your password"}
            </strong>
          </div>

          {step === "details" ? (
            <form className="tlb-access-form" onSubmit={onConfirmDetails}>
              <p className="tlb-access-lead">
                Enter the email and access code from your invite, confirm your contact number and
                position, then create a password on the next screen.
              </p>
              {inviteToken ? (
                <p className="tlb-access-note">
                  Invite link detected. Confirm the fields below — your access code may already be
                  filled in.
                </p>
              ) : null}

              <label>
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  disabled={pending}
                />
              </label>

              <label>
                Access code
                <input
                  className="tlb-mono"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="TLB-XXXX-XXXX"
                  autoComplete="one-time-code"
                  spellCheck={false}
                  disabled={pending}
                />
              </label>

              <label>
                Contact detail
                <input
                  type="tel"
                  name="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="+233 …"
                  required
                  disabled={pending}
                />
              </label>

              <label>
                Position
                <select
                  value={position}
                  onChange={(e) => setPosition(e.target.value as StaffPosition | "")}
                  required
                  disabled={pending}
                >
                  <option value="">Select position</option>
                  {positionOptions.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>

              {error ? <p className="tlb-access-error">{error}</p> : null}

              <div className="tlb-access-actions">
                <Button
                  type="submit"
                  className="tlb-access-primary"
                  disabled={!store.hydrated || store.saving || pending}
                >
                  {!store.hydrated ? "Loading…" : pending ? "Checking…" : "Continue"}
                </Button>
              </div>

              <p className="tlb-access-footer">
                Already activated?{" "}
                <Link to="/" className="tlb-access-link">
                  Sign in with email and password
                </Link>
              </p>
            </form>
          ) : (
            <form className="tlb-access-form" onSubmit={onSetPassword}>
              <p className="tlb-access-lead">
                {previewName ? `Welcome, ${previewName}. ` : null}
                Choose a password for{" "}
                <span className="tlb-mono">{(previewEmail ?? email) || "your account"}</span>
                {position ? (
                  <>
                    {" "}
                    ({position}
                    {contact ? ` · ${contact}` : ""})
                  </>
                ) : null}
                . Use this email and password to sign in from now on.
              </p>

              <label>
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

              <label>
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

              {error ? <p className="tlb-access-error">{error}</p> : null}

              <div className="tlb-access-actions tlb-access-actions-split">
                <Button
                  type="button"
                  variant="outline"
                  className="tlb-access-secondary"
                  disabled={pending}
                  onClick={() => {
                    setStep("details");
                    setPassword("");
                    setConfirmPassword("");
                    setLocalError(null);
                  }}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  className="tlb-access-primary"
                  disabled={pending || store.saving}
                >
                  {pending ? "Saving…" : "Set password and enter"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </article>
    </div>
  );
}
