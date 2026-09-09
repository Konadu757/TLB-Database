import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "trash" | "purge";

/** Soft-delete confirmation phrase (case-insensitive). */
export const TRASH_CONFIRM_PHRASE = "DELETE";

/** Permanent purge confirmation phrase (case-insensitive). */
export const PURGE_CONFIRM_PHRASE = "DELETE PERMANENTLY";

function phrasesMatch(typed: string, expected: string) {
  return typed.trim().toLowerCase() === expected.toLowerCase();
}

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
  const [confirmText, setConfirmText] = useState("");
  const confirmInputId = useId();
  const reasonId = useId();

  const resetForm = () => {
    setReason("");
    setConfirmText("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const isPurge = mode === "purge";
  const n = count ?? 0;
  const isBulk = n > 1 || (count !== undefined && n === 1 && recordLabel.includes("selected"));
  const confirmPhrase = isPurge ? PURGE_CONFIRM_PHRASE : TRASH_CONFIRM_PHRASE;
  const confirmed = phrasesMatch(confirmText, confirmPhrase);

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

        <div className="tlb-trash-confirm-fields">
          {!isPurge ? (
            <div className="tlb-trash-reason">
              <Label htmlFor={reasonId}>Reason (optional)</Label>
              <textarea
                id={reasonId}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why is this being removed?"
              />
            </div>
          ) : (
            <p className="tlb-trash-purge-warning" role="note">
              Permanent deletion removes this data from Trash forever. Soft-deleted items on list
              pages are only moved to Trash and can be restored.
            </p>
          )}

          <div className="tlb-trash-type-confirm">
            <Label htmlFor={confirmInputId}>
              Type <strong>{confirmPhrase}</strong> to confirm
            </Label>
            <Input
              id={confirmInputId}
              type="text"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmPhrase}
              aria-describedby={`${confirmInputId}-hint`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && confirmed) {
                  e.preventDefault();
                  onConfirm(reason.trim() || undefined);
                  resetForm();
                  onOpenChange(false);
                }
              }}
            />
            <span id={`${confirmInputId}-hint`} className="tlb-trash-type-hint">
              Confirmation is case-insensitive. Confirm stays disabled until the phrase matches.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={isPurge ? "destructive" : "default"}
            disabled={!confirmed}
            onClick={() => {
              if (!confirmed) return;
              onConfirm(reason.trim() || undefined);
              resetForm();
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
