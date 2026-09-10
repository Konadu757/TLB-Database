import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { statusTone } from "@/lib/domain/calculations";
import { ALL_PERMISSIONS, PERMISSION_LABELS, listAssignableRoles } from "@/lib/domain/permissions";
import type { Permission } from "@/lib/domain/types";
import { formatMoney } from "@/lib/store/tlb-store";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

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

function Flash({ error, notice, onClear }: { error: string | null; notice: string | null; onClear: () => void }) {
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

export { FinanceModule, DeliveriesModule } from '@/components/modules/finance-deliveries-modules';
export { ReportsModule } from '@/components/modules/reports-module';

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
  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(
    store.state.roles.find((r) => r.active)?.id ?? null,
  );
  const [draftPermissions, setDraftPermissions] = useState<Permission[]>([]);
  const [newUser, setNewUser] = useState({ name: "", email: "", roleId: store.state.roles[0]?.id ?? "" });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUser, setEditUser] = useState({
    name: "",
    email: "",
    roleId: "",
    active: true,
  });

  const activeRoles = useMemo(() => listAssignableRoles(store.state.roles), [store.state.roles]);
  const selectedRole = store.state.roles.find((r) => r.id === selectedRoleId) ?? null;
  const editingUser = store.state.users.find((u) => u.id === editingUserId) ?? null;
  const canManageUsers = store.can("users.manage");
  const canManageSettings = store.can("settings.manage");

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

  useEffect(() => {
    if (selectedRole) setDraftPermissions([...selectedRole.permissions]);
  }, [selectedRole]);

  const permissionGroups = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const perm of ALL_PERMISSIONS) {
      const module = PERMISSION_LABELS[perm].module;
      const list = groups.get(module) ?? [];
      list.push(perm);
      groups.set(module, list);
    }
    return [...groups.entries()];
  }, []);

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
          <div><span>Session</span><strong>Signed-in identity (mock auth)</strong></div>
        </div>
        <div className="tlb-inline-actions" style={{ padding: 12 }}>
          <label className="tlb-select">
            Act as user
            <select
              value={store.state.currentUserId}
              onChange={(e) => store.switchUser(e.target.value)}
            >
              {store.state.users.filter((u) => u.active).map((u) => {
                const role = store.state.roles.find((r) => r.id === u.roleId);
                return (
                  <option key={u.id} value={u.id}>
                    {u.name} · {role?.name ?? "—"}
                  </option>
                );
              })}
            </select>
          </label>
          <span className="tlb-muted-line">
            Display: {store.state.currentUser} · Role: {store.state.currentRole}
          </span>
        </div>
      </article>

      {canManageUsers ? (
        <>
          <article className="tlb-panel" style={{ marginBottom: 14 }}>
            <div className="tlb-panel-heading">
              <div><span>Access</span><strong>Users &amp; role assignment</strong></div>
            </div>
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
                      <tr key={user.id} className={editingUserId === user.id ? "tlb-row-selected" : undefined}>
                        <td>{user.name}</td>
                        <td>{user.email}</td>
                        <td>
                          <select
                            className="tlb-inline-select"
                            value={user.roleId}
                            disabled={!user.active || editingUserId === user.id}
                            onChange={(e) => store.assignUserRole(user.id, e.target.value)}
                          >
                            {activeRoles.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>{user.active ? "Active" : "Inactive"}</td>
                        <td>
                          {store.state.currentUserId === user.id ? (
                            <StatusBadge tone="success">Signed in</StatusBadge>
                          ) : (
                            <button type="button" className="tlb-link-btn" onClick={() => store.switchUser(user.id)}>
                              Switch
                            </button>
                          )}
                        </td>
                        <td>
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
                <div className="tlb-panel-heading tlb-span-2" style={{ padding: 0, marginBottom: 4 }}>
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
              <div><span>Access</span><strong>Roles &amp; permissions</strong></div>
            </div>
            <div className="tlb-roles-layout">
              <div className="tlb-roles-list">
                {activeRoles.length === 0 ? (
                  <EmptyState title="No roles" detail="Create a custom role to get started." />
                ) : (
                  activeRoles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      className={`tlb-role-chip ${selectedRoleId === role.id ? "active" : ""}`}
                      onClick={() => {
                        setSelectedRoleId(role.id);
                        setDraftPermissions([...role.permissions]);
                      }}
                    >
                      <strong>{role.name}</strong>
                      <span>{role.systemKey ? "System" : "Custom"} · {role.permissions.length} caps</span>
                    </button>
                  ))
                )}
              </div>
              <div className="tlb-roles-detail">
                {selectedRole ? (
                  <>
                    <div className="tlb-inline-actions compact" style={{ marginBottom: 10 }}>
                      <label className="tlb-select" style={{ flex: 1 }}>
                        Role name
                        <input
                          value={selectedRole.name}
                          disabled={!!selectedRole.systemKey}
                          onChange={(e) => store.updateRole(selectedRole.id, { name: e.target.value })}
                        />
                      </label>
                      {!selectedRole.systemKey && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            if (store.deactivateRole(selectedRole.id)) {
                              const next = activeRoles.find((r) => r.id !== selectedRole.id);
                              setSelectedRoleId(next?.id ?? null);
                            }
                          }}
                        >
                          Deactivate
                        </Button>
                      )}
                    </div>
                    <p className="tlb-muted-line" style={{ padding: "0 0 10px" }}>
                      {selectedRole.description || "No description"}
                    </p>
                    <div className="tlb-perm-matrix">
                      {permissionGroups.map(([module, perms]) => (
                        <div key={module} className="tlb-perm-group">
                          <strong>{module}</strong>
                          {perms.map((perm) => (
                            <label key={perm} className="tlb-perm-row">
                              <input
                                type="checkbox"
                                checked={draftPermissions.includes(perm)}
                                onChange={(e) => {
                                  setDraftPermissions((prev) =>
                                    e.target.checked ? [...prev, perm] : prev.filter((p) => p !== perm),
                                  );
                                }}
                              />
                              <span>{PERMISSION_LABELS[perm].label}</span>
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="tlb-form-actions" style={{ paddingTop: 12 }}>
                      <Button
                        type="button"
                        onClick={() => store.updateRole(selectedRole.id, { permissions: draftPermissions })}
                      >
                        Save permissions
                      </Button>
                    </div>
                  </>
                ) : (
                  <EmptyState title="Select a role" detail="Choose a role to edit its permission matrix." />
                )}
              </div>
            </div>
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                if (store.createRole({ name: roleName, description: roleDescription, permissions: ["dashboard.view"] })) {
                  setRoleName("");
                  setRoleDescription("");
                }
              }}
            >
              <label>New role name<input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Procurement" /></label>
              <label>Description<input value={roleDescription} onChange={(e) => setRoleDescription(e.target.value)} placeholder="What this role can access" /></label>
              <div className="tlb-form-actions tlb-span-2"><Button type="submit">Create role</Button></div>
            </form>
          </article>
        </>
      ) : (
        <article className="tlb-panel" style={{ marginBottom: 14 }}>
          <EmptyState title="Users & roles restricted" detail="Owner or Admin required to create roles and assign users." />
        </article>
      )}

      {!canManageSettings ? (
        <EmptyState title="Settings restricted" detail="Manager, Owner, or Admin required to edit company, VAT, and ageing." />
      ) : (
        <>
          <article className="tlb-panel" style={{ marginBottom: 14 }}>
            <div className="tlb-panel-heading">
              <div><span>Company</span><strong>Invoice letterhead</strong></div>
            </div>
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                store.saveCompany(company);
              }}
            >
              <label>Legal name<input value={company.legalName} onChange={(e) => setCompany({ ...company, legalName: e.target.value })} /></label>
              <label>Trading name<input value={company.tradingName} onChange={(e) => setCompany({ ...company, tradingName: e.target.value })} /></label>
              <label className="tlb-span-2">Address<input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} /></label>
              <label>Phone<input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} /></label>
              <label>Email<input value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} /></label>
              <label>Company TIN (optional)<input value={company.tin ?? ""} onChange={(e) => {
                const tin = e.target.value;
                setCompany((prev) => {
                  const next = { ...prev };
                  if (tin) next.tin = tin;
                  else delete next.tin;
                  return next;
                });
              }} /></label>
              <div className="tlb-form-actions tlb-span-2"><Button type="submit">Save company</Button></div>
            </form>
          </article>

          <article className="tlb-panel" style={{ marginBottom: 14 }}>
            <div className="tlb-panel-heading">
              <div><span>VAT rates</span><strong>Configurable — do not hard-code jurisdiction %</strong></div>
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
              <label>Code<input value={vat.code} onChange={(e) => setVat({ ...vat, code: e.target.value })} /></label>
              <label>Label<input value={vat.label} onChange={(e) => setVat({ ...vat, label: e.target.value })} /></label>
              <label>Rate %<input type="number" min={0} step="0.01" value={vat.ratePercent} onChange={(e) => setVat({ ...vat, ratePercent: Number(e.target.value) })} /></label>
              <div className="tlb-form-actions tlb-span-2"><Button type="submit">Save VAT rate</Button></div>
            </form>
          </article>

          <article className="tlb-panel">
            <div className="tlb-panel-heading">
              <div><span>Outstanding ageing & reminders</span><strong>Thresholds</strong></div>
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
              <label>Normal max days<input type="number" min={0} value={ageing.normalMaxDays} onChange={(e) => setAgeing({ ...ageing, normalMaxDays: Number(e.target.value) })} /></label>
              <label>Attention max days<input type="number" min={0} value={ageing.attentionMaxDays} onChange={(e) => setAgeing({ ...ageing, attentionMaxDays: Number(e.target.value) })} /></label>
              <label>Extended unfulfilled days<input type="number" min={1} value={ageing.extendedUnfulfilledDays} onChange={(e) => setAgeing({ ...ageing, extendedUnfulfilledDays: Number(e.target.value) })} /></label>
              <label>Expected approaching days<input type="number" min={0} value={ageing.expectedApproachingDays} onChange={(e) => setAgeing({ ...ageing, expectedApproachingDays: Number(e.target.value) })} /></label>
              <div className="tlb-form-actions tlb-span-2"><Button type="submit">Save reminder settings</Button></div>
            </form>
          </article>
        </>
      )}
    </div>
  );
}
