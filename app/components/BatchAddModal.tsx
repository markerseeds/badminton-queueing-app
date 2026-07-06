"use client";

import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { parseBatchInput } from "../lib/logic";
import type { NewPlayer } from "../lib/types";
import { Button, Card } from "./ui";

export function BatchAddModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (players: NewPlayer[]) => void;
  onCancel: () => void;
}) {
  const [batchInput, setBatchInput] = useState("");
  const [batchError, setBatchError] = useState<string | null>(null);

  useEscapeKey(onCancel);

  const handleImport = () => {
    setBatchError(null);
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-add-title"
        className="p-6 w-full max-w-lg"
      >
        <h3 id="batch-add-title" className="font-semibold mb-2">
          Batch Add Players
        </h3>
        <p id="batch-add-help" className="text-xs text-gray-500 mb-4">
          Format: Name, Skill (One per line)
          <br />
          Example: Mark, new
        </p>

        <textarea
          autoFocus
          aria-label="Players to add"
          aria-describedby="batch-add-help"
          className="border rounded-lg px-2 py-2 w-full h-48 font-mono text-sm"
          placeholder={`John, new
James, beginner
Charlie, intermediate`}
          value={batchInput}
          onChange={(e) => setBatchInput(e.target.value)}
        />

        {batchError && (
          <div role="alert" className="mt-2 text-red-600 text-sm font-medium">
            <span aria-hidden="true">⚠️</span> {batchError}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button className="bg-gray-600" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleImport}>
            Import {batchInput.split("\n").filter((l) => l.trim()).length}{" "}
            Players
          </Button>
        </div>
      </Card>
    </div>
  );
}
