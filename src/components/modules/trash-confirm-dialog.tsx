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
  count,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  mode: Mode;
  recordLabel: string;
  /** When set, uses bulk copy (“Move N selected items…”). */
  count?: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason?: string) => void;
}) {
  const [reason, setReason] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (!next) setReason("");
    onOpenChange(next);
  };

  const isPurge = mode === "purge";
  const n = count ?? 0;
  const isBulk = n > 1 || (count !== undefined && n === 1 && recordLabel.includes("selected"));

  const title = isPurge
    ? isBulk || count !== undefined
      ? `Permanently delete ${count} item${count === 1 ? "" : "s"}?`
      : "Delete permanently?"
    : isBulk || count !== undefined
      ? `Move ${count} selected item${count === 1 ? "" : "s"} to Trash?`
      : "Move to Trash?";

  const description = isPurge
    ? count !== undefined
      ? `This cannot be undone. Permanently delete ${count} selected item${count === 1 ? "" : "s"} from Trash.`
      : `This cannot be undone. Permanently delete ${recordLabel}.`
    : count !== undefined
      ? `Send ${count} selected item${count === 1 ? "" : "s"} to Trash. You can restore them later from the Trash module.`
      : `Send ${recordLabel} to Trash. You can restore it later from the Trash module.`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="tlb-trash-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
