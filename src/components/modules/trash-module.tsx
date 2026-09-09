import { useMemo, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";

import {
  BulkPurgeMixedToolbar,
  SelectAllHeader,
  SelectRowCell,
  useListSelection,
} from "@/components/modules/list-bulk-trash";
import { TrashConfirmDialog } from "@/components/modules/trash-confirm-dialog";
import { Button } from "@/components/ui/button";
import { listTrashItems } from "@/lib/domain/trash";
import type { TrashListItem } from "@/lib/domain/types";
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
        ×
      </button>
    </div>
  );
}

export function TrashModule({ store }: { store: TlbStoreApi }) {
  const items = useMemo(() => listTrashItems(store.state), [store.state]);
  const canRestore = store.can("records.delete");
  const canPurge = store.can("trash.purge");
  const [purgeTarget, setPurgeTarget] = useState<TrashListItem | null>(null);
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const selection = useListSelection(canPurge ? itemIds : []);
  const selectedItems = useMemo(
    () => items.filter((i) => selection.selectedIds.includes(i.id)),
    [items, selection.selectedIds],
  );

  if (!store.can("trash.view")) {
    return <EmptyState title="Trash restricted" detail="Your role cannot view the trash." />;
  }

  return (
    <div className="tlb-module">
      <Flash error={store.error} notice={store.notice} onClear={store.clearMessages} />
      <div className="tlb-module-toolbar">
        <div>
          <span className="tlb-eyebrow">Control</span>
          <strong>Trash</strong>
        </div>
        <div className="tlb-toolbar-actions">
          {canPurge ? (
            <BulkPurgeMixedToolbar
              store={store}
              items={selectedItems.map((i) => ({
                entityType: i.entityType,
                entityId: i.entityId,
              }))}
              onDone={selection.clear}
            />
          ) : null}
        </div>
      </div>

      <article className="tlb-panel tlb-orders-panel">
        <div className="tlb-table-scroll">
          {items.length === 0 ? (
            <EmptyState
              title="Trash is empty"
              detail="Soft-deleted customers, suppliers, orders, products, and catalog records will appear here."
            />
          ) : (
            <table>
              <thead>
                <tr>
                  {canPurge ? (
                    <SelectAllHeader
                      allSelected={selection.allVisibleSelected}
                      someSelected={selection.someVisibleSelected}
                      onToggle={selection.toggleAllVisible}
                    />
                  ) : null}
                  <th>Type</th>
                  <th>Name / ref</th>
                  <th>Deleted by</th>
                  <th>Deleted at</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className={selection.isSelected(item.id) ? "tlb-row-selected" : undefined}
                  >
                    {canPurge ? (
                      <SelectRowCell
                        id={item.id}
                        checked={selection.isSelected(item.id)}
                        onToggle={selection.toggle}
                        label={`Select ${item.label}`}
                      />
                    ) : null}
                    <td>
                      <strong>{item.typeLabel}</strong>
                    </td>
                    <td>
                      {item.label}
                      {item.subtitle ? <div className="tlb-muted-line">{item.subtitle}</div> : null}
                      {item.deletedReason ? (
                        <div className="tlb-muted-line">Reason: {item.deletedReason}</div>
                      ) : null}
                    </td>
                    <td>{item.deletedBy}</td>
                    <td>{formatWhen(item.deletedAt)}</td>
                    <td>
                      <div className="tlb-inline-actions">
                        {canRestore ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              store.restoreFromTrash({
                                entityType: item.entityType,
                                entityId: item.entityId,
                              })
                            }
                          >
                            <RotateCcw /> Restore
                          </Button>
                        ) : null}
                        {canPurge ? (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => setPurgeTarget(item)}
                          >
                            <Trash2 /> Delete permanently
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {items.length > 0 ? (
          <div className="tlb-list-meta">
            {items.length} item{items.length === 1 ? "" : "s"} in trash
            {selection.count > 0 ? ` · ${selection.count} selected` : ""}
          </div>
        ) : null}
      </article>

      <TrashConfirmDialog
        open={Boolean(purgeTarget)}
        mode="purge"
        recordLabel={purgeTarget?.label ?? "this record"}
        onOpenChange={(open) => {
          if (!open) setPurgeTarget(null);
        }}
        onConfirm={() => {
          if (!purgeTarget) return;
          store.purgeFromTrash({
            entityType: purgeTarget.entityType,
            entityId: purgeTarget.entityId,
          });
          setPurgeTarget(null);
        }}
      />
    </div>
  );
}
