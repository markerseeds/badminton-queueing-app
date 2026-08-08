"use client";

import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { SKILLS } from "../lib/constants";
import { normalizePlayerName } from "../lib/logic";
import type { Player } from "../lib/types";
import { Button, Card, Input, Select } from "./ui";

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

  // `Player.skill` is a plain string, so a row can carry a value outside SKILLS.
  // A native <select> reports its first option when handed an unknown value, so
  // without this the player would be silently demoted to "new" on save.
  const options = SKILLS.includes(player.skill)
    ? SKILLS
    : [player.skill, ...SKILLS];

  const handleSave = () => {
    if (!normalizePlayerName(playerName)) return;
    onSubmit({ name: playerName, skill });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-player-title"
        className="p-6 w-full max-w-sm"
      >
        <h3 id="edit-player-title" className="font-semibold mb-4">
          Edit Player
        </h3>
        <div className="flex flex-col justify-between gap-2 mt-4">
          <Input
            autoFocus
            aria-label="Player name"
            placeholder="Name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <Select
            aria-label="Skill level"
            className="mt-3"
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
          >
            {options.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button className="bg-gray-600" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </Card>
    </div>
  );
}
