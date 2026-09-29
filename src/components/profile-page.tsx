import { RecordDetailSection } from "@/components/modules/record-browser";
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
      </section>
    </div>
  );
}
