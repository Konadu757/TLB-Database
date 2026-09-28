/**
 * Notifications center — full list, mark read, delete, open related records.
 */
import { useMemo, useState } from "react";
import { Bell, CheckCheck, Trash2, X } from "lucide-react";

import {
  SelectAllHeader,
  SelectRowCell,
  useListSelection,
} from "@/components/modules/list-bulk-trash";
import { TrashConfirmDialog } from "@/components/modules/trash-confirm-dialog";
import { Button } from "@/components/ui/button";
import { listVisibleNotifications } from "@/lib/domain/notifications";
import { canManageAllNotifications, resolveRole } from "@/lib/domain/permissions";
import type { AppNotification } from "@/lib/domain/types";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso.slice(0, 19).replace("T", " ");
  }
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
      <button type="button" onClick={onClear} aria-label="Dismiss">
        <X />
      </button>
    </div>
  );
}

function relatedLabel(n: AppNotification): string {
  if (n.opsRequestId) return `Ops request · ${n.opsRequestId}`;
  if (n.orderId) return `Order · ${n.orderId}`;
  if (n.productId) return `Product · ${n.productId}`;
  return "—";
}

function alertTone(type: string): string {
  if (type.includes("overdue") || type.includes("extended") || type.includes("exception"))
    return "danger";
  if (type.includes("approaching") || type.includes("partial") || type.includes("shortage"))
    return "warning";
  return "info";
}

export function NotificationsModule({
  store,
  onOpenRelated,
}: {
  store: TlbStoreApi;
  onOpenRelated: (n: AppNotification) => void;
}) {
  const manageAll = canManageAllNotifications(store.state);
  const role = resolveRole(store.state);
  const visible = useMemo(() => {
    const session = {
      currentUserId: store.state.currentUserId,
      currentRole: store.state.currentRole,
      roleName: role?.name,
      systemKey: role?.systemKey,
      manageAll,
    };
    return listVisibleNotifications(store.state.notifications, session);
  }, [store.state, manageAll, role?.name, role?.systemKey]);

  const unreadIds = useMemo(() => visible.filter((n) => !n.readAt).map((n) => n.id), [visible]);
  const ids = useMemo(() => visible.map((n) => n.id), [visible]);
  const selection = useListSelection(ids);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = visible.find((n) => n.id === selectedId) ?? null;

  const openRow = (n: AppNotification) => {
    store.readNotification(n.id);
    setSelectedId(n.id);
  };

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Communication Hub</span>
          <strong>Notifications</strong>
          <p className="tlb-muted" style={{ margin: "0.35rem 0 0" }}>
            {manageAll
              ? "Owner/Admin view — all workspace notifications."
              : "Your relevant notifications (broadcast, role, and assigned to you)."}
          </p>
        </div>
        <div className="tlb-toolbar-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={unreadIds.length === 0}
            onClick={() => store.markAllNotificationsRead(unreadIds)}
          >
            <CheckCheck /> Mark all read
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={selection.selectedIds.length === 0}
            onClick={() => setDeleteIds([...selection.selectedIds])}
          >
            <Trash2 /> Move to Trash selected
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => store.refreshNotifications()}
          >
            <Bell /> Refresh
          </Button>
        </div>
      </div>

      <div
        className="tlb-split-panels"
        style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
        }}
      >
        <article className="tlb-panel tlb-orders-panel">
          <div className="tlb-table-scroll">
            {visible.length === 0 ? (
              <EmptyState
                title="No notifications"
                detail="Operational and outstanding alerts will appear here as work happens."
              />
            ) : (
              <table>
                <thead>
                  <tr>
                    <SelectAllHeader
                      allSelected={selection.allVisibleSelected}
                      someSelected={selection.someVisibleSelected}
                      onToggle={selection.toggleAllVisible}
                    />
                    <th>Status</th>
                    <th>Title</th>
                    <th>Type</th>
                    <th>When</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((n) => (
                    <tr
                      key={n.id}
                      className={!n.readAt ? "tlb-row-unread" : undefined}
                      data-selected={selectedId === n.id ? "true" : undefined}
                    >
                      <SelectRowCell
                        id={n.id}
                        checked={selection.isSelected(n.id)}
                        onToggle={selection.toggle}
                        label={`Select ${n.title}`}
                      />
                      <td>
                        <span className={`status-badge status-${n.readAt ? "neutral" : "info"}`}>
                          {n.readAt ? "Read" : "Unread"}
                        </span>
                      </td>
                      <td>
                        <button type="button" className="tlb-linkish" onClick={() => openRow(n)}>
                          <strong>{n.title}</strong>
                        </button>
                        <div className="tlb-muted">{n.body}</div>
                      </td>
                      <td>
                        <span
                          className={`tlb-alert-dot tlb-alert-${alertTone(n.type)}`}
                          aria-hidden
                        />{" "}
                        {n.type}
                      </td>
                      <td>{formatWhen(n.createdAt)}</td>
                      <td>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Move ${n.title} to trash`}
                          onClick={() => setDeleteIds([n.id])}
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </article>

        <article className="tlb-panel">
          {selected ? (
            <>
              <div className="tlb-module-toolbar" style={{ marginBottom: "0.75rem" }}>
                <div>
                  <span className="tlb-eyebrow">{selected.type}</span>
                  <strong>{selected.title}</strong>
                </div>
              </div>
              <dl className="tlb-detail-grid">
                <div>
                  <dt>Body</dt>
                  <dd>{selected.body}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatWhen(selected.createdAt)}</dd>
                </div>
                <div>
                  <dt>Read</dt>
                  <dd>{selected.readAt ? formatWhen(selected.readAt) : "Unread"}</dd>
                </div>
                <div>
                  <dt>Related</dt>
                  <dd>{relatedLabel(selected)}</dd>
                </div>
                {selected.targetUserId ? (
                  <div>
                    <dt>Target user</dt>
                    <dd>{selected.targetUserId}</dd>
                  </div>
                ) : null}
                {selected.targetRole ? (
                  <div>
                    <dt>Target role</dt>
                    <dd>{selected.targetRole}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Dedupe key</dt>
                  <dd>
                    <code>{selected.dedupeKey}</code>
                  </dd>
                </div>
              </dl>
              <div
                className="tlb-toolbar-actions"
                style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
              >
                {!selected.readAt ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => store.readNotification(selected.id)}
                  >
                    Mark as read
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenRelated(selected)}
                >
                  Open related
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDeleteIds([selected.id])}
                >
                  <Trash2 /> Move to Trash
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              title="Select a notification"
              detail="Click a row to see full detail and actions."
            />
          )}
        </article>
      </div>

      <TrashConfirmDialog
        open={Boolean(deleteIds?.length)}
        mode="trash"
        recordLabel={
          deleteIds?.length === 1
            ? (visible.find((n) => n.id === deleteIds[0])?.title ?? "notification")
            : `${deleteIds?.length ?? 0} selected notifications`
        }
        {...(deleteIds && deleteIds.length > 1 ? { count: deleteIds.length } : {})}
        onOpenChange={(open) => {
          if (!open) setDeleteIds(null);
        }}
        onConfirm={(reason) => {
          if (!deleteIds?.length) return;
          for (const entityId of deleteIds) {
            store.moveToTrash({
              entityType: "notification",
              entityId,
              ...(reason ? { reason } : {}),
            });
          }
          if (selectedId && deleteIds.includes(selectedId)) setSelectedId(null);
          selection.clear();
          setDeleteIds(null);
        }}
      />
    </div>
  );
}
