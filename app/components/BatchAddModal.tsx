"use client";

import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { parseBatchInput } from "../lib/logic";
import type { NewPlayer } from "../lib/types";
import { WarningIcon } from "./icons";
import { LimitNote } from "./LimitNote";
import { Button } from "./ui";

export function BatchAddModal({
  remaining,
  onSubmit,
  onCancel,
}: {
  // Player slots left on this room's plan. The batch is one INSERT statement and
  // the SQL trigger rejects the whole thing, so a paste that overshoots has to be
  // caught here rather than landing partially.
  remaining: number;
  onSubmit: (players: NewPlayer[]) => void;
  onCancel: () => void;
}) {
  const [batchInput, setBatchInput] = useState("");
  const [batchError, setBatchError] = useState<string | null>(null);

  useEscapeKey(onCancel);

  const lineCount = batchInput.split("\n").filter((l) => l.trim()).length;
  const tooMany = lineCount > remaining;

  const handleImport = () => {
    setBatchError(null);
    if (tooMany) return;
    const { players, error } = parseBatchInput(batchInput);
    if (error) {
      setBatchError(error);
      return;
    }
    if (players && players.length > 0) {
      onSubmit(players);
    }
  };

  return (
    <div className="modal-scrim z-40">
      <div
        className="modal max-w-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-add-title"
      >
        <div className="modal-grab" aria-hidden="true" />

        <div>
          <h3 id="batch-add-title" className="heading text-base">
            Add several players
          </h3>
          <p id="batch-add-help" className="muted mt-1">
            One per line, as <span className="font-mono">Name, skill</span>.
            Every line needs both.
          </p>
        </div>

        <div className="modal-field">
          <label className="sr-only" htmlFor="batch-input">
            Players to add
          </label>
          <textarea
            autoFocus
            id="batch-input"
            className="modal-ta"
            aria-describedby="batch-add-help"
            spellCheck={false}
            placeholder={`Priya Raman, upper intermediate
Marcus Bell, new
Wei Chen, intermediate`}
            value={batchInput}
            onChange={(e) => {
              setBatchInput(e.target.value);
              // Clear a stale error as soon as they start fixing it.
              if (batchError) setBatchError(null);
            }}
          />
        </div>

        {batchError ? (
          <p
            role="alert"
            className="flex items-start gap-2 text-sm text-danger"
          >
            <WarningIcon size={16} className="mt-0.5 shrink-0" />
            {batchError}
          </p>
        ) : tooMany ? (
          <LimitNote>
            {remaining === 0
              ? "This room is already full on the free plan."
              : `Only ${remaining} more ${
                  remaining === 1 ? "player" : "players"
                } fit on the free plan — that's ${lineCount}.`}
          </LimitNote>
        ) : (
          <p className="tiny num">
            {lineCount === 0
              ? "Nothing to add yet."
              : `${lineCount} ${lineCount === 1 ? "line" : "lines"} ready.`}
          </p>
        )}

        <div className="modal-actions">
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={lineCount === 0 || tooMany}>
            Add {lineCount > 0 ? lineCount : ""}{" "}
            {lineCount === 1 ? "player" : "players"}
          </Button>
        </div>
      </div>
    </div>
  );
}
