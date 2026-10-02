import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

import { TrashConfirmDialog } from "@/components/modules/trash-confirm-dialog";
import { Button } from "@/components/ui/button";
import { listAssignableRoles, OWNER_USER_ID } from "@/lib/domain/permissions";
import { buildInviteLink, isInvitePending } from "@/lib/domain/invites";
import { notSoftDeleted } from "@/lib/domain/trash";
import type { AppUser, RoleDefinition, TaxMode, VatRate } from "@/lib/domain/types";
import { ensureTaxCatalog, normalizeTaxMode, TAX_MODE_LABELS, taxKindOf } from "@/lib/domain/tax";
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

function inviteDeliveryTone(
  status: string,
  label?: string,
): "success" | "warning" | "danger" | "info" | "pending" {
  if (status === "ok" || status === "sent") return "success";
  // Cloud-only failure is secondary: local code/link still work on this browser.
  if (label === "Cloud" && status === "failed") return "warning";
  if (status === "failed" || status === "not_configured") return "danger";
  if (status === "skipped" || status === "local_only") return "warning";
  if (status === "pending") return "pending";
  return "info";
}

function invitePanelIsError(invite: {
  contact?: string;
  delivery: { email: string; sms: string; cloud?: string };
}): boolean {
  const { email, sms } = invite.delivery;
  // Cloud sync failure alone must not paint the whole Invitation ready panel red.
  if (email === "failed" || email === "not_configured") return true;
  if (email === "pending") return false;
  if (sms === "failed" || sms === "not_configured") return true;
  if (sms === "skipped" && Boolean(invite.contact?.trim())) return true;
  if (sms === "pending") return false;
  return email !== "sent" || (Boolean(invite.contact?.trim()) && sms !== "sent");
}

function InviteDeliveryLine({
  label,
  status,
  note,
  onRetry,
}: {
  label: string;
  status: string;
  note: string;
  onRetry?: () => void;
}) {
  const tone = inviteDeliveryTone(status, label);
  const color =
    tone === "success"
      ? "var(--success)"
      : tone === "danger"
        ? "var(--danger)"
        : tone === "warning"
          ? "var(--warning-foreground)"
          : "inherit";
  const statusWord =
    status === "sent" || status === "ok"
      ? "Sent"
      : status === "failed" && label === "Cloud"
        ? "Not synced"
        : status === "failed"
          ? "Failed"
          : status === "not_configured"
            ? "Not configured"
            : status === "skipped"
              ? "Skipped"
              : status === "pending"
                ? label === "Cloud"
                  ? "Saving…"
                  : "Sending…"
                : status;
  const showRetry =
    Boolean(onRetry) && (status === "failed" || status === "not_configured");
  return (
    <div className="tlb-invite-status-row">
      <strong style={{ fontSize: "0.8125rem", letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </strong>
      <StatusBadge tone={tone}>{statusWord}</StatusBadge>
      <span
        style={{
          color,
          fontWeight: tone === "danger" ? 700 : 500,
          fontSize: "0.875rem",
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        {note}
      </span>
      {showRetry ? (
        <button
          type="button"
          className="tlb-user-action tlb-user-action--copy"
          style={{ justifySelf: "start", height: 28, padding: "0 10px", fontSize: "0.75rem" }}
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="tlb-empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function RoleMenu({
  roles,
  value,
  onChange,
}: {
  roles: RoleDefinition[];
  value: string;
  onChange: (roleId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = roles.find((role) => role.id === value);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="tlb-role-field">
      <span id={`${listId}-label`}>Role</span>
      <div
        className="tlb-role-select"
        data-open={open ? "true" : "false"}
        ref={rootRef}
      >
        <button
          type="button"
          className="tlb-role-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={`${listId}-label`}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{selected?.name ?? "Select a role"}</span>
          <ChevronDown className="tlb-role-chevron" aria-hidden="true" />
        </button>
        {open ? (
          <div className="tlb-role-menu" id={listId} role="listbox" aria-label="Role">
            {roles.map((role) => (
              <button
                key={role.id}
                type="button"
                role="option"
                aria-selected={role.id === value}
                className={role.id === value ? "is-selected" : undefined}
                onClick={() => {
                  onChange(role.id);
                  setOpen(false);
                }}
              >
                {role.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
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
          <p className="tlb-muted-line">Append-only — includes portal sign-ins and access events</p>
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
  const [taxDraft, setTaxDraft] = useState<VatRate[]>(() => ensureTaxCatalog(store.state.vatRates));
  const [ageing, setAgeing] = useState(store.state.ageing);
  const [newUser, setNewUser] = useState({
    name: "",
    contact: "",
    email: "",
    roleId: "",
  });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUser, setEditUser] = useState({
    name: "",
    contact: "",
    email: "",
    roleId: "",
    active: true,
  });
  const [pendingDelete, setPendingDelete] = useState<AppUser | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const invitePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTaxDraft(ensureTaxCatalog(store.state.vatRates));
  }, [store.state.vatRates]);

  useEffect(() => {
    if (!store.lastInvite) return;
    // Instant jump — smooth scroll made Assign feel like it was still "busy".
    invitePanelRef.current?.scrollIntoView({ behavior: "auto", block: "nearest" });
    // Scroll only when a new invite code appears — not on every email/SMS status tick.
  }, [store.lastInvite?.userId, store.lastInvite?.inviteCode]);

  const copyInviteValue = async (key: string, value: string) => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 2000);
    }
  };

  const activeRoles = useMemo(() => listAssignableRoles(store.state.roles), [store.state.roles]);
  const editRoles = useMemo(
    () => listAssignableRoles(store.state.roles, { forUserId: editingUserId ?? undefined }),
    [store.state.roles, editingUserId],
  );
  const assignedUsers = useMemo(
    () => notSoftDeleted(store.state.users),
    [store.state.users],
  );
  const recentAccessActivity = useMemo(
    () =>
      store.state.audit
        .filter((a) =>
          [
            "user.login",
            "user.invite_issued",
            "user.invite_accepted",
            "user.role_assigned",
            "user.updated",
          ].includes(a.action),
        )
        .slice(0, 12),
    [store.state.audit],
  );
  const editingUser = assignedUsers.find((u) => u.id === editingUserId) ?? null;
  const canManageUsers = store.can("users.manage");
  const canManageSettings = store.can("settings.manage");
  const canDeleteAssignment = store.can("records.delete");

  const activeTaxPreview = useMemo(
    () =>
      taxDraft.filter(
        (t) => normalizeTaxMode(t) === "active" && Number(t.ratePercent) > 0,
      ),
    [taxDraft],
  );

  const updateTaxDraft = (id: string, patch: Partial<VatRate>) => {
    setTaxDraft((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        if (patch.mode) next.active = patch.mode === "active";
        return next;
      }),
    );
  };

  const saveAllTaxes = () => {
    store.saveTaxRates(
      taxDraft.map((t) => ({
        id: t.id,
        code: t.code,
        label: t.label,
        ratePercent: Number(t.ratePercent) || 0,
        mode: normalizeTaxMode(t),
        kind: taxKindOf(t),
        active: normalizeTaxMode(t) === "active",
        sortOrder: t.sortOrder ?? (taxKindOf(t) === "vat" ? 0 : 10),
      })),
    );
  };

  const startEditUser = (user: (typeof store.state.users)[number]) => {
    setEditingUserId(user.id);
    setEditUser({
      name: user.name,
      contact: user.contact ?? "",
      email: user.email,
      roleId: user.roleId,
      active: user.active,
    });
  };

  const cancelEditUser = () => {
    setEditingUserId(null);
    setEditUser({ name: "", contact: "", email: "", roleId: "", active: true });
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
                <span>Staff</span>
                <strong>Users &amp; role assignment</strong>
                <p className="tlb-muted-line">
                  Enter the person’s name, contact, and email, then choose a predefined role. After
                  you assign, the invitation code and shareable link stay on this page so you can
                  copy them.
                </p>
              </div>
            </div>
            {store.lastInvite ? (
              <div
                ref={invitePanelRef}
                className={
                  invitePanelIsError(store.lastInvite)
                    ? "tlb-flash tlb-flash-error"
                    : "tlb-flash tlb-flash-ok"
                }
                style={{
                  margin: "12px",
                  flexDirection: "column",
                  alignItems: "stretch",
                  gap: 10,
                  borderWidth: 2,
                  outline: invitePanelIsError(store.lastInvite)
                    ? "2px solid var(--danger)"
                    : undefined,
                }}
                role="status"
                aria-live="assertive"
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <strong style={{ fontSize: "1.125rem" }}>
                    Invitation ready for {store.lastInvite.name}
                  </strong>
                  <span className="tlb-muted-line" style={{ fontSize: "0.75rem", margin: 0 }}>
                    Code and link are ready to copy. Email/SMS status updates below.
                  </span>
                </div>
                <p className="tlb-muted-line" style={{ margin: 0 }}>
                  {store.lastInvite.email}
                  {store.lastInvite.contact ? ` · ${store.lastInvite.contact}` : ""}
                </p>
                <div
                  style={{
                    display: "grid",
                    gap: 0,
                    marginTop: 2,
                    padding: "4px 12px 8px",
                    borderRadius: 8,
                    background: "color-mix(in oklab, var(--surface) 88%, transparent)",
                    border: "1px solid var(--border)",
                    fontSize: "0.8125rem",
                    lineHeight: 1.45,
                  }}
                >
                  <InviteDeliveryLine
                    label="Email"
                    status={store.lastInvite.delivery.email}
                    note={store.lastInvite.delivery.emailNote}
                    onRetry={() => store.retryInviteChannel("email")}
                  />
                  {store.lastInvite.delivery.sms === "skipped" ? (
                    <InviteDeliveryLine
                      label="SMS"
                      status={store.lastInvite.delivery.sms}
                      note={store.lastInvite.delivery.smsNote}
                    />
                  ) : (
                    <InviteDeliveryLine
                      label="SMS"
                      status={store.lastInvite.delivery.sms}
                      note={store.lastInvite.delivery.smsNote}
                      onRetry={() => store.retryInviteChannel("sms")}
                    />
                  )}
                  <InviteDeliveryLine
                    label="Cloud"
                    status={store.lastInvite.delivery.cloud}
                    note={store.lastInvite.delivery.cloudNote}
                  />
                </div>
                <div>
                  <span
                    className="tlb-muted-line"
                    style={{ display: "block", marginBottom: 4, fontSize: "0.6875rem" }}
                  >
                    Access code
                  </span>
                  <p
                    className="tlb-mono"
                    style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, letterSpacing: "0.04em" }}
                  >
                    {store.lastInvite.inviteCode}
                  </p>
                </div>
                <div>
                  <span
                    className="tlb-muted-line"
                    style={{ display: "block", marginBottom: 4, fontSize: "0.6875rem" }}
                  >
                    Shareable link
                  </span>
                  <p
                    className="tlb-mono"
                    style={{
                      margin: 0,
                      fontSize: "0.75rem",
                      wordBreak: "break-all",
                      lineHeight: 1.45,
                    }}
                  >
                    {store.lastInvite.inviteLink}
                  </p>
                </div>
                <div className="tlb-inline-actions" style={{ flexWrap: "wrap", gap: 12 }}>
                  <button
                    type="button"
                    className="tlb-user-action tlb-user-action--copy"
                    onClick={() => {
                      void copyInviteValue("code", store.lastInvite!.inviteCode);
                    }}
                  >
                    {copiedKey === "code" ? "Copied code" : "Copy access code"}
                  </button>
                  <button
                    type="button"
                    className="tlb-user-action tlb-user-action--copy"
                    onClick={() => {
                      void copyInviteValue("link", store.lastInvite!.inviteLink);
                    }}
                  >
                    {copiedKey === "link" ? "Copied link" : "Copy invite link"}
                  </button>
                  <button
                    type="button"
                    className="tlb-user-action tlb-user-action--copy"
                    onClick={() => {
                      void copyInviteValue("sms", store.lastInvite!.delivery.smsBody);
                    }}
                  >
                    {copiedKey === "sms" ? "Copied SMS text" : "Copy SMS text"}
                  </button>
                  <button
                    type="button"
                    className="tlb-user-action tlb-user-action--delete"
                    onClick={store.clearLastInvite}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}
            {assignedUsers.length === 0 ? (
              <EmptyState title="No users" detail="Create a user to assign roles." />
            ) : (
              <div className="tlb-table-scroll tlb-orders-panel">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Contact</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Last login</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignedUsers.map((user) => (
                      <tr
                        key={user.id}
                        className={editingUserId === user.id ? "tlb-row-selected" : undefined}
                      >
                        <td>{user.name}</td>
                        <td>{user.contact?.trim() || "—"}</td>
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
                          ) : user.lastLoginAt ? (
                            <span title={new Date(user.lastLoginAt).toLocaleString()}>
                              {new Date(user.lastLoginAt).toLocaleString()}
                            </span>
                          ) : isInvitePending(user) ? (
                            "—"
                          ) : (
                            <span className="tlb-muted-line">Never</span>
                          )}
                        </td>
                        <td>
                          {isInvitePending(user) && user.inviteToken ? (
                            <span className="tlb-invite-row-actions">
                              <button
                                type="button"
                                className="tlb-user-action tlb-user-action--copy"
                                onClick={() => {
                                  void copyInviteValue(
                                    `row-link-${user.id}`,
                                    buildInviteLink(user.inviteToken!),
                                  );
                                }}
                              >
                                {copiedKey === `row-link-${user.id}` ? "Copied link" : "Copy invite"}
                              </button>
                              {user.inviteCode ? (
                                <button
                                  type="button"
                                  className="tlb-user-action tlb-user-action--copy"
                                  onClick={() => {
                                    void copyInviteValue(`row-code-${user.id}`, user.inviteCode!);
                                  }}
                                >
                                  {copiedKey === `row-code-${user.id}`
                                    ? "Copied code"
                                    : "Copy code"}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="tlb-user-action tlb-user-action--reissue"
                                onClick={() => store.issueUserInvite(user.id)}
                              >
                                Re-issue
                              </button>
                            </span>
                          ) : null}
                          <span className="tlb-user-row-actions">
                            <button
                              type="button"
                              className="tlb-user-action tlb-user-action--edit"
                              onClick={() =>
                                editingUserId === user.id ? cancelEditUser() : startEditUser(user)
                              }
                            >
                              {editingUserId === user.id ? "Cancel" : "Edit"}
                            </button>
                            {canDeleteAssignment &&
                            user.id !== store.state.currentUserId &&
                            user.id !== OWNER_USER_ID ? (
                              <button
                                type="button"
                                className="tlb-user-action tlb-user-action--delete"
                                onClick={() => setPendingDelete(user)}
                              >
                                Delete
                              </button>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {recentAccessActivity.length > 0 ? (
              <div style={{ margin: "14px 12px 4px" }}>
                <div className="tlb-panel-heading" style={{ marginBottom: 8 }}>
                  <div>
                    <span>Activity</span>
                    <strong>Recent access events</strong>
                    <p className="tlb-muted-line">
                      Sign-ins, invites, and role changes — synced from the cloud so they survive
                      refresh.
                    </p>
                  </div>
                </div>
                <div className="tlb-table-scroll tlb-orders-panel">
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Who</th>
                        <th>Event</th>
                        <th>Summary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentAccessActivity.map((a) => (
                        <tr key={a.id}>
                          <td>{new Date(a.at).toLocaleString()}</td>
                          <td>{a.actor}</td>
                          <td>{a.action}</td>
                          <td>{a.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {editingUser ? (
              <form
                className="tlb-form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    store.saveUser({
                      id: editingUser.id,
                      name: editUser.name,
                      contact: editUser.contact,
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
                  Contact
                  <input
                    type="tel"
                    value={editUser.contact}
                    onChange={(e) => setEditUser({ ...editUser, contact: e.target.value })}
                    placeholder="0544967381"
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
                <RoleMenu
                  roles={editRoles}
                  value={editUser.roleId}
                  onChange={(roleId) => setEditUser({ ...editUser, roleId })}
                />
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
                    setNewUser({ name: "", contact: "", email: "", roleId: "" });
                  }
                }}
              >
                <label>
                  Name
                  <input
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Contact
                  <input
                    type="tel"
                    value={newUser.contact}
                    onChange={(e) => setNewUser({ ...newUser, contact: e.target.value })}
                    placeholder="0544967381"
                    required
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    required
                  />
                </label>
                <RoleMenu
                  roles={activeRoles}
                  value={newUser.roleId}
                  onChange={(roleId) => setNewUser({ ...newUser, roleId })}
                />
                <div className="tlb-form-actions tlb-span-2">
                  <Button type="submit">Assign role</Button>
                </div>
              </form>
            )}
            <TrashConfirmDialog
              open={pendingDelete !== null}
              mode="trash"
              recordLabel={
                pendingDelete ? `${pendingDelete.name}'s role assignment` : "role assignment"
              }
              extraNote="This removes that person's assigned role. You stay signed in as Owner."
              onOpenChange={(open) => {
                if (!open) setPendingDelete(null);
              }}
              onConfirm={(reason) => {
                if (!pendingDelete) return;
                if (
                  pendingDelete.id === store.state.currentUserId ||
                  pendingDelete.id === OWNER_USER_ID
                ) {
                  return;
                }
                const id = pendingDelete.id;
                const ok = store.moveToTrash({
                  entityType: "user",
                  entityId: id,
                  ...(reason ? { reason } : {}),
                });
                if (ok && editingUserId === id) cancelEditUser();
              }}
            />
          </article>
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
          detail="Manager, Owner, or Admin required to edit company, taxes, and ageing."
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
                <span>Taxes</span>
                <strong>Smart tax controls — minimal by default</strong>
                <p className="tlb-muted-line">
                  VAT is the primary Ghana tax. Optional levies (NHIL, GETFund, COVID) stay Off
                  unless you turn them on — so the company is not stacked with every levy by
                  default. Exempt never applies; Off ignores the tax entirely.
                </p>
              </div>
            </div>
            <div style={{ padding: "0 12px 4px" }}>
              <p className="tlb-muted-line" style={{ marginBottom: 10 }}>
                Currently applying:{" "}
                {activeTaxPreview.length === 0 ? (
                  <strong>none (ex-tax totals)</strong>
                ) : (
                  <strong>
                    {activeTaxPreview.map((t) => `${t.code} ${t.ratePercent}%`).join(" + ")}
                  </strong>
                )}
              </p>
            </div>
            <form
              className="tlb-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                saveAllTaxes();
              }}
            >
              {taxDraft.map((tax) => {
                const mode = normalizeTaxMode(tax);
                const kind = taxKindOf(tax);
                return (
                  <div
                    key={tax.id}
                    className="tlb-span-2"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 0.7fr) minmax(0, 1.4fr)",
                      gap: 10,
                      alignItems: "end",
                      padding: "10px 0",
                      borderBottom: "1px solid color-mix(in srgb, #6420D0 12%, transparent)",
                    }}
                  >
                    <label>
                      {kind === "vat" ? "VAT" : "Optional levy"}
                      <input
                        value={tax.label}
                        onChange={(e) => updateTaxDraft(tax.id, { label: e.target.value })}
                      />
                      <span className="tlb-muted-line" style={{ fontSize: "0.75rem" }}>
                        {tax.code}
                        {kind === "levy" ? " · off unless activated" : " · primary"}
                      </span>
                    </label>
                    <label>
                      Rate %
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={tax.ratePercent}
                        onChange={(e) =>
                          updateTaxDraft(tax.id, { ratePercent: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Application
                      <select
                        value={mode}
                        onChange={(e) =>
                          updateTaxDraft(tax.id, { mode: e.target.value as TaxMode })
                        }
                      >
                        {(Object.keys(TAX_MODE_LABELS) as TaxMode[]).map((m) => (
                          <option key={m} value={m}>
                            {m === "active"
                              ? "Active"
                              : m === "exempt"
                                ? "Exempt"
                                : "Off / Ignored"}
                            {kind === "levy" && m === "off" ? " (default)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                );
              })}
              <div className="tlb-form-actions tlb-span-2" style={{ marginTop: 8 }}>
                <Button type="submit">Save tax settings</Button>
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
