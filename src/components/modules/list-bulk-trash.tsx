import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Trash2 } from "lucide-react";

import { TrashConfirmDialog } from "@/components/modules/trash-confirm-dialog";
import { Button } from "@/components/ui/button";
import type { TrashEntityType } from "@/lib/domain/types";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

export function useListSelection(visibleIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);

  const selectedVisible = useMemo(
    () => visibleIds.filter((id) => selected.has(id)),
    [visibleIds, selected],
  );

  const allVisibleSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

  const someVisibleSelected = selectedVisible.length > 0 && !allVisibleSelected;

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (visibleIds.length > 0 && visibleIds.every((id) => next.has(id))) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }, [visibleIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  /** Drop ids that disappeared from the current list (e.g. after trash). */
  const pruneToVisible = useCallback(() => {
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleSet.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visibleSet]);

  return {
    selectedIds: selectedVisible,
    count: selectedVisible.length,
    allVisibleSelected,
    someVisibleSelected,
    toggle,
    toggleAllVisible,
    clear,
    isSelected,
    pruneToVisible,
  };
}

export function stopRowCheckboxClick(e: MouseEvent) {
  e.stopPropagation();
}

export function SelectionCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="checkbox"
      className="tlb-row-checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = Boolean(indeterminate) && !checked;
      }}
      aria-label={ariaLabel}
      onClick={stopRowCheckboxClick}
      onChange={(e) => {
        e.stopPropagation();
        onChange();
      }}
    />
  );
}

export function BulkTrashToolbar({
  store,
  entityType,
  selectedIds,
  mode = "trash",
  onDone,
}: {
  store: TlbStoreApi;
  entityType: TrashEntityType;
  selectedIds: string[];
  mode?: "trash" | "purge";
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const count = selectedIds.length;
  if (count === 0) return null;

  const canAct = mode === "purge" ? store.can("trash.purge") : store.can("records.delete");
  if (!canAct) return null;

  return (
    <>
      <Button
        type="button"
        variant={mode === "purge" ? "destructive" : "outline"}
        onClick={() => setOpen(true)}
      >
        <Trash2 />
        {mode === "purge" ? `Delete permanently (${count})` : `Move to Trash (${count})`}
      </Button>
      <TrashConfirmDialog
        open={open}
        mode={mode}
        count={count}
        recordLabel={`${count} selected item${count === 1 ? "" : "s"}`}
        onOpenChange={setOpen}
        onConfirm={(reason) => {
          let ok = true;
          for (const entityId of selectedIds) {
            const result =
              mode === "purge"
                ? store.purgeFromTrash({ entityType, entityId })
                : store.moveToTrash({
                    entityType,
                    entityId,
                    ...(reason ? { reason } : {}),
                  });
            if (!result) ok = false;
          }
          if (ok) onDone?.();
        }}
      />
    </>
  );
}

/** Trash list supports mixed entity types — purge each item with its own type. */
export function BulkPurgeMixedToolbar({
  store,
  items,
  onDone,
}: {
  store: TlbStoreApi;
  items: Array<{ entityType: TrashEntityType; entityId: string }>;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const count = items.length;
  if (count === 0 || !store.can("trash.purge")) return null;

  return (
    <>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        <Trash2 /> Delete permanently ({count})
      </Button>
      <TrashConfirmDialog
        open={open}
        mode="purge"
        count={count}
        recordLabel={`${count} selected item${count === 1 ? "" : "s"}`}
        onOpenChange={setOpen}
        onConfirm={() => {
          let ok = true;
          for (const item of items) {
            if (!store.purgeFromTrash(item)) ok = false;
          }
          if (ok) onDone?.();
        }}
      />
    </>
  );
}

export function SelectAllHeader({
  allSelected,
  someSelected,
  onToggle,
  label = "Select all",
}: {
  allSelected: boolean;
  someSelected: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <th className="tlb-col-select">
      <SelectionCheckbox
        checked={allSelected}
        indeterminate={someSelected}
        onChange={onToggle}
        ariaLabel={label}
      />
    </th>
  );
}

export function SelectRowCell({
  id,
  checked,
  onToggle,
  label,
}: {
  id: string;
  checked: boolean;
  onToggle: (id: string) => void;
  label: string;
}): ReactNode {
  return (
    <td className="tlb-col-select" onClick={stopRowCheckboxClick}>
      <SelectionCheckbox checked={checked} onChange={() => onToggle(id)} ariaLabel={label} />
    </td>
  );
}
