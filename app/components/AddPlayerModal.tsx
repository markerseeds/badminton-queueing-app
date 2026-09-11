"use client";

import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { NewPlayer } from "../lib/types";
import { SkillPicker } from "./SkillPicker";
import { Button } from "./ui";

// A player added in a hurry should land mid-range rather than at the bottom:
// skill drives the ±1 band window in pickFourPlayers, so defaulting to "new"
// quietly strands anyone nobody triaged at the bottom of the ladder all night.
const DEFAULT_SKILL = "intermediate";

export function AddPlayerModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (player: NewPlayer) => void;
  onCancel: () => void;
}) {
  const [playerName, setPlayerName] = useState("");
  const [skill, setSkill] = useState(DEFAULT_SKILL);

  useEscapeKey(onCancel);

  const trimmedName = playerName.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedName) return;
    onSubmit({ name: trimmedName, skill });
  };

  return (
    <div className="modal-scrim z-40">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-player-title"
        onSubmit={handleSubmit}
      >
        <div className="modal-grab" aria-hidden="true" />

        <h3 id="add-player-title" className="heading text-base">
          Add a player
        </h3>

        <div className="modal-field">
          <label className="lbl" htmlFor="add-player-name">
            Name
          </label>
          <input
            autoFocus
            id="add-player-name"
            className="modal-input"
            placeholder="e.g. Priya Raman"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
        </div>

        <SkillPicker value={skill} onChange={setSkill} />

        <div className="modal-actions">
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trimmedName}>
            Add player
          </Button>
        </div>
      </form>
    </div>
  );
}
