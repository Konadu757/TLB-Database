import { useState } from "react";

import { RecordDetailSection } from "@/components/modules/record-browser";
import { updatePortalPassword } from "@/lib/auth/portal-auth";
import { resolveRole, userInitials } from "@/lib/domain/permissions";
import { useTlbStore } from "@/lib/store/use-tlb-store";

/**
 * Signed-in workspace profile. Rendered in the app shell main canvas.
 * Requires the portal session: this route sits behind PortalGate.
 */
export function ProfilePage() {
  const store = useTlbStore();
  const person = store.state.users.find((user) => user.id === store.state.currentUserId);
  const role = resolveRole(store.state);
  const name = person?.name || store.state.currentUser;
  const roleName = role?.name || store.state.currentRole;
  const workspace = store.state.company.tradingName || "TLB Enterprise";
  const signedIn = Boolean(store.state.currentUserId && name);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <div className="tlb-module">
        <article className="tlb-panel">
          <div className="tlb-panel-heading">
            <div>
              <span>Signed in</span>
              <strong>Profile</strong>
            </div>
          </div>
          <p className="tlb-muted-line" style={{ margin: 0, padding: "14px 17px 18px" }}>
            Sign in to view this profile.
          </p>
        </article>
      </div>
    );
  }

  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div className="tlb-profile-identity">
          <div className="tlb-avatar" aria-hidden="true">
            {userInitials(name)}
          </div>
          <div>
            <span className="tlb-eyebrow">Signed in</span>
            <strong>{name}</strong>
          </div>
        </div>
        <span
          className={`status-badge ${person?.active === false ? "status-warning" : "status-success"}`}
        >
          {person?.active === false ? "Inactive" : "Active"}
        </span>
      </div>

      <section className="tlb-detail-sections tlb-record-detail">
        <RecordDetailSection tone="profile" kicker="Profile" title="Signed-in identity" span2>
          <dl className="tlb-kv">
            <div>
              <dt>Name</dt>
              <dd>{name}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{roleName}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{workspace}</dd>
            </div>
            {person?.email ? (
              <div>
                <dt>Email</dt>
                <dd>{person.email}</dd>
              </div>
            ) : null}
            {role?.description ? (
              <div className="tlb-span-2">
                <dt>Access</dt>
                <dd>{role.description}</dd>
              </div>
            ) : null}
          </dl>
        </RecordDetailSection>

        <RecordDetailSection tone="summary" kicker="Workspace" title={workspace} span2>
          <dl className="tlb-kv">
            <div>
              <dt>Role</dt>
              <dd>{roleName}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{workspace}</dd>
            </div>
            <div className="tlb-span-2">
              <dt>Users &amp; roles</dt>
              <dd>Owner manages users &amp; roles under Settings.</dd>
            </div>
          </dl>
        </RecordDetailSection>

        <RecordDetailSection tone="profile" kicker="Security" title="Change password" span2>
          <form
            className="tlb-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              setPasswordError(null);
              setPasswordNotice(null);
              if (newPassword !== confirmPassword) {
                setPasswordError("Passwords do not match.");
                return;
              }
              setPasswordPending(true);
              void updatePortalPassword(newPassword).then((result) => {
                setPasswordPending(false);
                if (!result.ok) {
                  setPasswordError(result.error);
                  return;
                }
                setNewPassword("");
                setConfirmPassword("");
                setPasswordNotice("Password updated. Use the new password next time you sign in.");
              });
            }}
          >
            <label className="tlb-span-2">
              New password
              <input
                type="password"
                name="new-password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                minLength={8}
                disabled={passwordPending}
              />
            </label>
            <label className="tlb-span-2">
              Confirm password
              <input
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={8}
                disabled={passwordPending}
              />
            </label>
            {passwordError ? <p className="tlb-login-error tlb-span-2">{passwordError}</p> : null}
            {passwordNotice ? <p className="tlb-login-status tlb-span-2">{passwordNotice}</p> : null}
            <div className="tlb-form-actions tlb-span-2">
              <button type="submit" disabled={passwordPending}>
                {passwordPending ? "Saving…" : "Update password"}
              </button>
            </div>
          </form>
        </RecordDetailSection>
      </section>
    </div>
  );
}
