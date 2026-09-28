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
import {
  PURGE_CONFIRM_PHRASE,
  RESTORE_CONFIRM_PHRASE,
  TRASH_CONFIRM_PHRASE,
} from "@/lib/domain/trash";

type Mode = "trash" | "purge" | "restore";

export { PURGE_CONFIRM_PHRASE, RESTORE_CONFIRM_PHRASE, TRASH_CONFIRM_PHRASE };

function phrasesMatch(typed: string, expected: string) {
  return typed.trim().toLowerCase() === expected.toLowerCase();
}

function phraseFor(mode: Mode) {
  if (mode === "purge") return PURGE_CONFIRM_PHRASE;
  if (mode === "restore") return RESTORE_CONFIRM_PHRASE;
  return TRASH_CONFIRM_PHRASE;
}

export function TrashConfirmDialog({
  open,
  mode,
  recordLabel,
  count,
  extraNote,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  mode: Mode;
  recordLabel: string;
  /** When set, uses bulk copy (“Move N selected items…”). */
  count?: number;
  /** Extra Owner-facing note, such as role reassignment. */
  extraNote?: string;
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
  const isRestore = mode === "restore";
  const n = count ?? 0;
  const isBulk = n > 1 || (count !== undefined && n === 1 && recordLabel.includes("selected"));
  const confirmPhrase = phraseFor(mode);
  const confirmed = phrasesMatch(confirmText, confirmPhrase);
  const subject = recordLabel;

  const title = isPurge
    ? isBulk || count !== undefined
      ? `Permanently delete ${count} item${count === 1 ? "" : "s"}?`
      : `Permanently delete ${subject}?`
    : isRestore
      ? `Restore ${subject}?`
      : isBulk || count !== undefined
        ? `Move ${count} selected item${count === 1 ? "" : "s"} to Trash?`
        : `Move ${subject} to Trash?`;

  const description = isPurge
    ? count !== undefined
      ? `This cannot be undone. Permanently delete ${count} selected item${count === 1 ? "" : "s"} from Trash.`
      : `This cannot be undone. Permanently delete ${subject}.`
    : isRestore
      ? `Restore ${subject} from Trash. This confirmation is separate from the one used to move it here.`
      : count !== undefined
        ? `Send ${count} selected item${count === 1 ? "" : "s"} to Trash. You can restore them later from the Trash module.`
        : `Send ${subject} to Trash. You can restore it later from the Trash module.`;

  const confirm = () => {
    if (!confirmed) return;
    const trimmed = reason.trim();
    if (mode === "trash" && trimmed) onConfirm(trimmed);
    else onConfirm();
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="tlb-trash-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="tlb-trash-confirm-fields">
          {extraNote ? (
            <p className="tlb-trash-purge-warning" role="note">
              {extraNote}
            </p>
          ) : null}
          {mode === "trash" ? (
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
              {isPurge
                ? "Permanent deletion removes this data from Trash forever. Type PERMANENT — the move-to-trash phrase DELETE will not work here."
                : "Type RESTORE to bring this item back. DELETE and PERMANENT will not confirm this action."}
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
                  confirm();
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
            onClick={confirm}
          >
            {isPurge ? "Delete permanently" : isRestore ? "Restore" : "Move to Trash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
