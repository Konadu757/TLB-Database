import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Mode = "trash" | "purge";

export function TrashConfirmDialog({
  open,
  mode,
  recordLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  mode: Mode;
  recordLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason?: string) => void;
}) {
  const [reason, setReason] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (!next) setReason("");
    onOpenChange(next);
  };

  const isPurge = mode === "purge";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="tlb-trash-dialog">
        <DialogHeader>
          <DialogTitle>{isPurge ? "Delete permanently?" : "Move to Trash?"}</DialogTitle>
          <DialogDescription>
            {isPurge
              ? `This cannot be undone. Permanently delete ${recordLabel}.`
              : `Send ${recordLabel} to Trash. You can restore it later from the Trash module.`}
          </DialogDescription>
        </DialogHeader>
        {!isPurge ? (
          <label className="tlb-trash-reason">
            <span>Reason (optional)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this being removed?"
            />
          </label>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={isPurge ? "destructive" : "default"}
            onClick={() => {
              onConfirm(reason.trim() || undefined);
              setReason("");
              onOpenChange(false);
            }}
          >
            {isPurge ? "Delete permanently" : "Move to Trash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
