/**
 * Notifications center — readable inbox list, mark read, delete, open related.
 */
import { useMemo, useState } from "react";
import { Bell, CheckCheck, Trash2, X } from "lucide-react";

import {
  SelectionCheckbox,
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

function typeLabel(type: string): string {
  return type.replace(/_/g, " ");
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
  return "None";
}

function hasRelated(n: AppNotification): boolean {
  return Boolean(n.opsRequestId || n.orderId || n.productId);
}

function alertTone(type: string): "danger" | "warning" | "info" {
  if (type.includes("overdue") || type.includes("extended") || type.includes("exception"))
    return "danger";
  if (type.includes("approaching") || type.includes("partial") || type.includes("shortage"))
    return "warning";
  return "info";
}

function statusChipClass(tone: "danger" | "warning" | "info", unread: boolean): string {
  if (!unread) return "status-badge status-neutral";
  if (tone === "warning") return "status-badge status-gold";
  if (tone === "danger") return "status-badge status-danger";
  return "status-badge status-info";
}

export function NotificationsModule({
  store,
  onOpenRelated,
}: {
  store: TlbStoreApi;
  onOpenRelated: (n: AppNotification) => void;
}) {
  const manageAll = canManageAllNotifications(store.state);
  const canTrash = store.can("records.delete");
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
    <div className="tlb-module tlb-notifications-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Operations</span>
          <strong>Notifications</strong>
          <p className="tlb-muted-line">
            {manageAll
              ? "All workspace alerts — open one to review or jump to the related record."
              : "Alerts for you — open one to review or jump to the related record."}
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
          {canTrash ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={selection.selectedIds.length === 0}
              onClick={() => setDeleteIds([...selection.selectedIds])}
            >
              <Trash2 /> Move to Trash selected
            </Button>
          ) : null}
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

      <div className="tlb-notifications-layout">
        <article className="tlb-panel tlb-notifications-list-panel">
          {visible.length === 0 ? (
            <EmptyState
              title="No notifications"
              detail="Operational and outstanding alerts will appear here as work happens."
            />
          ) : (
            <>
              <div className="tlb-notifications-list-head">
                {canTrash ? (
                  <SelectionCheckbox
                    checked={selection.allVisibleSelected}
                    indeterminate={selection.someVisibleSelected}
                    onChange={selection.toggleAllVisible}
                    ariaLabel="Select all notifications"
                  />
                ) : null}
                <span>
                  {visible.length} {visible.length === 1 ? "notification" : "notifications"}
                  {unreadIds.length > 0 ? ` · ${unreadIds.length} unread` : ""}
                </span>
              </div>
              <ul
                className={`tlb-notifications-list${canTrash ? " tlb-notifications-list--selectable" : ""}`}
                role="list"
              >
                {visible.map((n) => {
                  const unread = !n.readAt;
                  const tone = alertTone(n.type);
                  const active = selectedId === n.id;
                  return (
                    <li key={n.id}>
                      <div
                        className={[
                          "tlb-notifications-item",
                          unread ? "tlb-notifications-item--unread" : "",
                          active ? "tlb-notifications-item--active" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {canTrash ? (
                          <div className="tlb-notifications-item-select">
                            <SelectionCheckbox
                              checked={selection.isSelected(n.id)}
                              onChange={() => selection.toggle(n.id)}
                              ariaLabel={`Select ${n.title}`}
                            />
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="tlb-notifications-item-main"
                          onClick={() => openRow(n)}
                          aria-current={active ? "true" : undefined}
                        >
                          <span className="tlb-notifications-item-top">
                            <strong>{n.title}</strong>
                            <span className={statusChipClass(tone, unread)}>
                              {unread ? "Unread" : "Read"}
                            </span>
                          </span>
                          <span className="tlb-notifications-item-body">{n.body}</span>
                          <span className="tlb-notifications-item-meta">
                            <span
                              className={`tlb-notifications-tone tlb-notifications-tone--${tone}`}
                            >
                              {typeLabel(n.type)}
                            </span>
                            <span>{formatWhen(n.createdAt)}</span>
                          </span>
                        </button>
                        {canTrash ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="tlb-notifications-item-trash"
                            aria-label={`Move ${n.title} to trash`}
                            onClick={() => setDeleteIds([n.id])}
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </article>

        <article className="tlb-panel tlb-notifications-detail-panel">
          {selected ? (
            <div className="tlb-notifications-detail">
              <header className="tlb-notifications-detail-header">
                <div>
                  <span className="tlb-eyebrow">{typeLabel(selected.type)}</span>
                  <strong>{selected.title}</strong>
                </div>
                <span
                  className={statusChipClass(alertTone(selected.type), !selected.readAt)}
                >
                  {selected.readAt ? "Read" : "Unread"}
                </span>
              </header>

              <p className="tlb-notifications-detail-body">{selected.body}</p>

              <dl className="tlb-notifications-meta">
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
              </dl>

              <div className="tlb-notifications-detail-actions">
                {!selected.readAt ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => store.readNotification(selected.id)}
                  >
                    Mark as read
                  </Button>
                ) : null}
                {hasRelated(selected) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenRelated(selected)}
                  >
                    Open related
                  </Button>
                ) : null}
                {canTrash ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDeleteIds([selected.id])}
                  >
                    <Trash2 /> Move to Trash
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <EmptyState
              title="Select a notification"
              detail="Pick an item from the list to read the full message and open the related record."
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
