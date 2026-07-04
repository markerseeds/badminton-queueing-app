"use client";

import { useState } from "react";
import { SKILLS } from "../lib/constants";
import type { NewPlayer } from "../lib/types";
import { Button, Card, Input, Select } from "./ui";

export function AddPlayerModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (player: NewPlayer) => void;
  onCancel: () => void;
}) {
  const [playerName, setPlayerName] = useState("");
  const [skill, setSkill] = useState(SKILLS[0]);

  const handleAdd = () => {
    if (!playerName.trim()) return;
    onSubmit({ name: playerName.trim(), skill });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
      <Card className="p-6 w-full max-w-sm">
        <h3 className="font-semibold mb-4">Add Player</h3>
        <div className="flex flex-col justify-between gap-2 mt-4">
          <Input
            placeholder="Name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <Select
            className="mt-3"
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
          >
            {SKILLS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button className="bg-gray-600" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleAdd}>Add</Button>
        </div>
      </Card>
    </div>
  );
}
