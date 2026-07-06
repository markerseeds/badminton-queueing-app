"use client";

import { useEscapeKey } from "../hooks/useEscapeKey";
import { Button, Card } from "./ui";

export function ConfirmationModal({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscapeKey(onCancel);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="p-6 w-full max-w-sm"
      >
        <h3 id="confirm-title" className="font-semibold text-lg mb-4">
          Confirm Action
        </h3>
        <p id="confirm-message" className="text-gray-700 mb-6">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <Button autoFocus className="bg-gray-600" onClick={onCancel}>
            Cancel
          </Button>
          <Button className="bg-red-600" onClick={onConfirm}>
            Confirm
          </Button>
        </div>
      </Card>
    </div>
  );
}
