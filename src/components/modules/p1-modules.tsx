import { useMemo, useState } from "react";
import { X } from "lucide-react";

import { TrashConfirmDialog } from "@/components/modules/trash-confirm-dialog";
import { Button } from "@/components/ui/button";
import { listAssignableRoles, resolveRole } from "@/lib/domain/permissions";
import { buildInviteLink, isInvitePending } from "@/lib/domain/invites";
import { isSoftDeleted } from "@/lib/domain/trash";
import type { RoleDefinition } from "@/lib/domain/types";
import { formatMoney } from "@/lib/store/tlb-store";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback below */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function StatusBadge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="tlb-empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function Flash({
  error,
  notice,
  onClear,
}: {
  error: string | null;
  notice: string | null;
  onClear: () => void;
}) {
  if (!error && !notice) return null;
  return (
    <div className={`tlb-flash ${error ? "tlb-flash-error" : "tlb-flash-ok"}`} role="status">
      <span>{error ?? notice}</span>
      <button type="button" aria-label="Dismiss" onClick={onClear}>
        <X />
      </button>
    </div>
  );
}

export { FinanceModule, DeliveriesModule } from "@/components/modules/finance-deliveries-modules";
export { ReportsModule } from "@/components/modules/reports-module";

export function AuditModule({ store }: { store: TlbStoreApi }) {
  if (!store.can("audit.view")) {
    return <EmptyState title="Audit restricted" detail="Your role cannot view the audit trail." />;
  }
  return (
    <div className="tlb-module">
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Control</span>
          <strong>Audit log</strong>
          <p className="tlb-muted-line">Append-only — users cannot delete audit history</p>
        </div>
      </div>
      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {store.state.audit.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.at).toLocaleString()}</td>
                  <td>{a.actor}</td>
                  <td>{a.action}</td>
                  <td>{a.entityType}</td>
                  <td>{a.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

export function SettingsModule({ store }: { store: TlbStoreApi }) {
  const [company, setCompany] = useState(store.state.company);
  const [vat, setVat] = useState({
    id: store.state.vatRates[0]?.id,
    code: store.state.vatRates[0]?.code ?? "CFG",
    label: store.state.vatRates[0]?.label ?? "Configured VAT",
    ratePercent: store.state.vatRates[0]?.ratePercent ?? 0,
    active: true,
  });
  const [ageing, setAgeing] = useState(store.state.ageing);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    roleId: store.state.roles[0]?.id ?? "",
  });
  const [roleTrash, setRoleTrash] = useState<RoleDefinition | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUser, setEditUser] = useState({
    name: "",
    email: "",
    roleId: "",
    active: true,
  });

  const activeRoles = useMemo(
    () => listAssignableRoles(store.state.roles).filter((role) => role.systemKey === "Owner"),
    [store.state.roles],
  );
  const editingUser = store.state.users.find((u) => u.id === editingUserId) ?? null;
  const canManageUsers = store.can("users.manage");
  const canManageSettings = store.can("settings.manage");
  const isOwnerSession = resolveRole(store.state)?.systemKey === "Owner";

  const startEditUser = (user: (typeof store.state.users)[number]) => {
    setEditingUserId(user.id);
    setEditUser({
      name: user.name,
      email: user.email,
      roleId: user.roleId,
      active: user.active,
    });
  };

  const cancelEditUser = () => {
    setEditingUserId(null);
    setEditUser({ name: "", email: "", roleId: "", active: true });
  };

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Control</span>
          <strong>Settings</strong>
        </div>
      </div>

      <article className="tlb-panel" style={{ marginBottom: 14 }}>
        <div className="tlb-panel-heading">
          <div>
            <span>Session</span>
            <strong>Signed-in identity (mock auth)</strong>
          </div>
        </div>
        <div className="tlb-inline-actions" style={{ padding: 12 }}>
          <span className="tlb-muted-line">
            Signed in as {store.state.currentUser} · {store.state.currentRole}
          </span>
        </div>
      </article>

      {canManageUsers ? (
        <>
          <article className="tlb-panel" style={{ marginBottom: 14 }}>
            <div className="tlb-panel-heading">
              <div>
                <span>Access</span>
                <strong>Users &amp; role assignment</strong>
              </div>
            </div>
            {store.lastInvite ? (
              <div
                className="tlb-flash tlb-flash-ok"
                style={{ margin: "12px 12px 0", flexDirection: "column", alignItems: "stretch" }}
                role="status"
              >
                <strong style={{ fontSize: "0.875rem" }}>
                  Invite ready for {store.lastInvite.name} ({store.lastInvite.email})
                </strong>
                <p className="tlb-muted-line" style={{ margin: "6px 0 0" }}>
                  Send manually — email is not sent. Treat the link and access code as credentials.
                </p>
                <p
                  className="tlb-mono"
                  style={{ margin: "8px 0 0", fontSize: "0.9375rem", fontWeight: 600 }}
                >
                  {store.lastInvite.inviteCode}
                </p>
                <div className="tlb-inline-actions" style={{ marginTop: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="tlb-link-btn"
                    onClick={() => {
                      void copyToClipboard(buildInviteLink(store.lastInvite!.inviteToken));
                    }}
                  >
                    Copy invite link
                  </button>
                  <button
                    type="button"
                    className="tlb-link-btn"
                    onClick={() => {
                      void copyToClipboard(store.lastInvite!.inviteCode);
                    }}
                  >
                    Copy access code
                  </button>
                  <button type="button" className="tlb-link-btn" onClick={store.clearLastInvite}>
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}
            {store.state.users.length === 0 ? (
              <EmptyState title="No users" detail="Create a user to assign roles." />
            ) : (
              <div className="tlb-table-scroll tlb-orders-panel">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Session</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {store.state.users.map((user) => (
                      <tr
                        key={user.id}
                        className={editingUserId === user.id ? "tlb-row-selected" : undefined}
                      >
                        <td>{user.name}</td>
                        <td>{user.email}</td>
                        <td>
                          {store.state.roles.find((r) => r.id === user.roleId)?.name ?? "Owner"}
                        </td>
                        <td>
                          {user.active ? "Active" : "Inactive"}
                          {isInvitePending(user) ? (
                            <>
                              {" "}
                              <StatusBadge tone="warning">Pending</StatusBadge>
                            </>
                          ) : null}
                        </td>
                        <td>
                          {store.state.currentUserId === user.id ? (
                            <StatusBadge tone="success">Signed in</StatusBadge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {isInvitePending(user) && user.inviteToken ? (
                            <>
                              <button
                                type="button"
                                className="tlb-link-btn"
                                onClick={() => {
                                  void copyToClipboard(buildInviteLink(user.inviteToken!));
                                }}
                              >
                                Copy invite
                              </button>{" "}
                              <button
                                type="button"
                                className="tlb-link-btn"
                                onClick={() => store.issueUserInvite(user.id)}
                              >
                                Re-issue
                              </button>{" "}
                            </>
                          ) : null}
                          <button
                            type="button"
                            className="tlb-link-btn"
                            onClick={() =>
                              editingUserId === user.id ? cancelEditUser() : startEditUser(user)
                            }
                          >
                            {editingUserId === user.id ? "Cancel" : "Edit"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {editingUser ? (
              <form
                className="tlb-form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    store.saveUser({
                      id: editingUser.id,
                      name: editUser.name,
                      email: editUser.email,
                      roleId: editUser.roleId,
                      active: editUser.active,
                    })
                  ) {
                    cancelEditUser();
                  }
                }}
              >
                <div
                  className="tlb-panel-heading tlb-span-2"
                  style={{ padding: 0, marginBottom: 4 }}
                >
                  <div>
                    <span>Staff</span>
                    <strong>Edit {editingUser.name}</strong>
                  </div>
                  <button type="button" onClick={cancelEditUser}>
                    Cancel
                  </button>
                </div>
                <label>
                  Name
                  <input
                    value={editUser.name}
                    onChange={(e) => setEditUser({ ...editUser, name: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={editUser.email}
                    onChange={(e) => setEditUser({ ...editUser, email: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Role
                  <select
                    value={editUser.roleId}
                    onChange={(e) => setEditUser({ ...editUser, roleId: e.target.value })}
                  >
                    {activeRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select
                    value={editUser.active ? "active" : "inactive"}
                    onChange={(e) =>
                      setEditUser({ ...editUser, active: e.target.value === "active" })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                <div className="tlb-form-actions tlb-span-2">
                  <Button type="submit">Save staff</Button>
                </div>
              </form>
            ) : (
              <form
                className="tlb-form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (store.saveUser(newUser)) {
                    setNewUser({ name: "", email: "", roleId: activeRoles[0]?.id ?? "" });
                  }
                }}
              >
                <label>
                  New user name
                  <input
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  />
                </label>
                <label>
                  Role
                  <select
                    value={newUser.roleId}
                    onChange={(e) => setNewUser({ ...newUser, roleId: e.target.value })}
                  >
                    {activeRoles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="tlb-form-actions">
                  <Button type="submit">Add user</Button>
                </div>
              </form>
            )}
          </article>

          <article className="tlb-panel" style={{ marginBottom: 14 }}>
            <div className="tlb-panel-heading">
              <div>
                <span>Access</span>
                <strong>Roles</strong>
              </div>
            </div>
            <p className="tlb-muted-line" style={{ padding: "0 17px 8px" }}>
              The workspace signs in as Owner. Owner permissions are predefined and cannot be
              customized. The Owner role is protected. Other roles can be moved to Trash even when
              people or tasks are already assigned; those people move to Owner.
            </p>
            <div className="tlb-table-scroll tlb-orders-panel">
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Type</th>
                    <th>Active users</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...store.state.roles]
                    .filter((role) => role.active && !isSoftDeleted(role))
                    .sort((a, b) => {
                      if (a.systemKey === "Owner") return -1;
                      if (b.systemKey === "Owner") return 1;
                      return a.name.localeCompare(b.name);
                    })
                    .map((role) => {
                      const assigned = store.state.users.filter(
                        (u) => u.roleId === role.id && u.active,
                      ).length;
                      const isOwnerRole = role.systemKey === "Owner";
                      return (
                        <tr key={role.id}>
                          <td>
                            <strong>{role.name}</strong>
                            {role.description ? (
                              <div className="tlb-muted">{role.description}</div>
                            ) : null}
                          </td>
                          <td>{role.systemKey ? "System" : "Custom"}</td>
                          <td>{assigned}</td>
                          <td>Active</td>
                          <td>
                            {isOwnerRole ? (
                              <StatusBadge tone="neutral">Protected</StatusBadge>
                            ) : isOwnerSession ? (
                              <button
                                type="button"
                                className="tlb-link-btn"
                                onClick={() => setRoleTrash(role)}
                              >
                                Delete
                              </button>
                            ) : (
                              <span className="tlb-muted">Owner only</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </article>
          <TrashConfirmDialog
            open={Boolean(roleTrash)}
            mode="trash"
            recordLabel={roleTrash?.name ?? "this role"}
            {...(roleTrash
              ? {
                  extraNote: `Assigned people will move to Owner (${store.state.users.filter((u) => u.roleId === roleTrash.id).length} user(s)). Tasks already assigned to this role do not block deletion.`,
                }
              : {})}
            onOpenChange={(open) => {
              if (!open) setRoleTrash(null);
            }}
            onConfirm={(reason) => {
              if (!roleTrash) return;
              if (reason) store.deleteRole(roleTrash.id, reason);
              else store.deleteRole(roleTrash.id);
              setRoleTrash(null);
            }}
          />
        </>
      ) : (
        <article className="tlb-panel" style={{ marginBottom: 14 }}>
          <EmptyState
            title="Users & roles restricted"
            detail="Owner or Admin required to assign users to roles."
          />
        </article>
      )}

      {!canManageSettings ? (
        <EmptyState
          title="Settings restricted"
          detail="Manager, Owner, or Admin required to edit company, VAT, and ageing."
        />
      ) : (
        <>
          <article className="tlb-panel" style={{ marginBottom: 14 }}>
            <div className="tlb-panel-heading">
              <div>
                <span>Company</span>
                <strong>Invoice letterhead</strong>
              </div>
            </div>
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                store.saveCompany(company);
              }}
            >
              <label>
                Legal name
                <input
                  value={company.legalName}
                  onChange={(e) => setCompany({ ...company, legalName: e.target.value })}
                />
              </label>
              <label>
                Trading name
                <input
                  value={company.tradingName}
                  onChange={(e) => setCompany({ ...company, tradingName: e.target.value })}
                />
              </label>
              <label className="tlb-span-2">
                Address
                <input
                  value={company.address}
                  onChange={(e) => setCompany({ ...company, address: e.target.value })}
                />
              </label>
              <label>
                Phone
                <input
                  value={company.phone}
                  onChange={(e) => setCompany({ ...company, phone: e.target.value })}
                />
              </label>
              <label>
                Email
                <input
                  value={company.email}
                  onChange={(e) => setCompany({ ...company, email: e.target.value })}
                />
              </label>
              <label>
                Company TIN (optional)
                <input
                  value={company.tin ?? ""}
                  onChange={(e) => {
                    const tin = e.target.value;
                    setCompany((prev) => {
                      const next = { ...prev };
                      if (tin) next.tin = tin;
                      else delete next.tin;
                      return next;
                    });
                  }}
                />
              </label>
              <div className="tlb-form-actions tlb-span-2">
                <Button type="submit">Save company</Button>
              </div>
            </form>
          </article>

          <article className="tlb-panel" style={{ marginBottom: 14 }}>
            <div className="tlb-panel-heading">
              <div>
                <span>VAT rates</span>
                <strong>Configurable — do not hard-code jurisdiction %</strong>
              </div>
            </div>
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                store.saveVatRate({
                  code: vat.code,
                  label: vat.label,
                  ratePercent: vat.ratePercent,
                  active: vat.active,
                  ...(vat.id ? { id: vat.id } : {}),
                });
              }}
            >
              <label>
                Code
                <input
                  value={vat.code}
                  onChange={(e) => setVat({ ...vat, code: e.target.value })}
                />
              </label>
              <label>
                Label
                <input
                  value={vat.label}
                  onChange={(e) => setVat({ ...vat, label: e.target.value })}
                />
              </label>
              <label>
                Rate %
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={vat.ratePercent}
                  onChange={(e) => setVat({ ...vat, ratePercent: Number(e.target.value) })}
                />
              </label>
              <div className="tlb-form-actions tlb-span-2">
                <Button type="submit">Save VAT rate</Button>
              </div>
            </form>
          </article>

          <article className="tlb-panel">
            <div className="tlb-panel-heading">
              <div>
                <span>Outstanding ageing & reminders</span>
                <strong>Thresholds</strong>
              </div>
            </div>
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                store.setAgeing(
                  ageing.normalMaxDays,
                  ageing.attentionMaxDays,
                  ageing.extendedUnfulfilledDays,
                  ageing.expectedApproachingDays,
                );
              }}
            >
              <label>
                Normal max days
                <input
                  type="number"
                  min={0}
                  value={ageing.normalMaxDays}
                  onChange={(e) => setAgeing({ ...ageing, normalMaxDays: Number(e.target.value) })}
                />
              </label>
              <label>
                Attention max days
                <input
                  type="number"
                  min={0}
                  value={ageing.attentionMaxDays}
                  onChange={(e) =>
                    setAgeing({ ...ageing, attentionMaxDays: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Extended unfulfilled days
                <input
                  type="number"
                  min={1}
                  value={ageing.extendedUnfulfilledDays}
                  onChange={(e) =>
                    setAgeing({ ...ageing, extendedUnfulfilledDays: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Expected approaching days
                <input
                  type="number"
                  min={0}
                  value={ageing.expectedApproachingDays}
                  onChange={(e) =>
                    setAgeing({ ...ageing, expectedApproachingDays: Number(e.target.value) })
                  }
                />
              </label>
              <div className="tlb-form-actions tlb-span-2">
                <Button type="submit">Save reminder settings</Button>
              </div>
            </form>
          </article>
        </>
      )}
    </div>
  );
}
