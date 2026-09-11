"use client";

import { useEscapeKey } from "../hooks/useEscapeKey";
import { TrashIcon } from "./icons";
import { Button } from "./ui";

export function ConfirmationModal({
  message,
  confirmLabel = "Yes, do it",
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscapeKey(onCancel);

  return (
    // z-50, not z-40: a confirmation can be raised while another modal is open,
    // so it has to stack above them.
    <div className="modal-scrim z-50">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <div className="modal-grab" aria-hidden="true" />

        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger"
          >
            <TrashIcon size={19} />
          </span>
          <div>
            <h3 id="confirm-title" className="heading text-base">
              Are you sure?
            </h3>
            <p id="confirm-message" className="muted mt-1.5">
              {message}
            </p>
          </div>
        </div>

        <div className="modal-actions">
          {/* Focus lands on the way out, not the way through. */}
          <Button autoFocus variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="dangerSolid" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
