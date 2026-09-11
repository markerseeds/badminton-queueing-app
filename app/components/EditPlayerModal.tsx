"use client";

import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { normalizePlayerName } from "../lib/logic";
import type { Player } from "../lib/types";
import { SkillPicker } from "./SkillPicker";
import { Button } from "./ui";

export function EditPlayerModal({
  player,
  onSubmit,
  onCancel,
}: {
  player: Player;
  onSubmit: (details: { name: string; skill: string }) => void;
  onCancel: () => void;
}) {
  const [playerName, setPlayerName] = useState(player.name);
  const [skill, setSkill] = useState(player.skill);

  useEscapeKey(onCancel);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizePlayerName(playerName)) return;
    onSubmit({ name: playerName, skill });
  };

  return (
    <div className="modal-scrim z-40">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-player-title"
        onSubmit={handleSubmit}
      >
        <div className="modal-grab" aria-hidden="true" />

        <h3 id="edit-player-title" className="heading text-base">
          Edit player
        </h3>

        <div className="modal-field">
          <label className="lbl" htmlFor="edit-player-name">
            Name
          </label>
          <input
            autoFocus
            id="edit-player-name"
            className="modal-input"
            placeholder="Name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
        </div>

        {/* `saved` is the player's stored band, so a value outside SKILLS keeps
            its own option for the whole session — see lib/skillDisplay.ts. */}
        <SkillPicker value={skill} saved={player.skill} onChange={setSkill} />

        <div className="modal-actions">
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!normalizePlayerName(playerName)}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
