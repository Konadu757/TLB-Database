import { useState } from "react";
import { Trash2 } from "lucide-react";

import { TrashConfirmDialog } from "@/components/modules/trash-confirm-dialog";
import { Button } from "@/components/ui/button";
import type { TrashEntityType } from "@/lib/domain/types";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

/** Permission-gated soft-delete control with confirmation dialog. */
export function MoveToTrashButton({
  store,
  entityType,
  entityId,
  recordLabel,
  onTrashed,
  variant = "outline",
}: {
  store: TlbStoreApi;
  entityType: TrashEntityType;
  entityId: string;
  recordLabel: string;
  onTrashed?: () => void;
  variant?: "outline" | "destructive" | "default";
}) {
  const [open, setOpen] = useState(false);
  if (!store.can("records.delete")) return null;

  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        <Trash2 /> Move to Trash
      </Button>
      <TrashConfirmDialog
        open={open}
        mode="trash"
        recordLabel={recordLabel}
        onOpenChange={setOpen}
        onConfirm={(reason) => {
          const ok = store.moveToTrash({ entityType, entityId, ...(reason ? { reason } : {}) });
          if (ok) onTrashed?.();
        }}
      />
    </>
  );
}
