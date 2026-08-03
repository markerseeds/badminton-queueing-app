"use client";

import { useState } from "react";
import { clampGamesPlayed, parseGamesPlayedInput } from "../lib/logic";
import type { Player } from "../lib/types";
import { Button, Card } from "./ui";

// Per-player games counter. Typeable and stepper-driven: the − stepper clamps at
// 0, and the text field keeps what you type (digits only) without snapping to 0
// mid-edit — it commits a clamped value on blur/Enter.
function GamesCounter({
  value,
  playerName,
  disabled = false,
  onChange,
}: {
  value: number;
  playerName: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  // null = show the committed prop value; a string = the user is mid-edit.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const next = parseGamesPlayedInput(draft);
    if (next !== value) onChange(next);
    setDraft(null);
  };

  const step = (delta: number) => {
    setDraft(null);
    onChange(clampGamesPlayed(value + delta));
  };

  return (
    <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-gray-50/50 h-7">
      <button
        type="button"
        aria-label={`Decrease games for ${playerName}`}
        disabled={disabled}
        className="px-2 h-full hover:bg-gray-200 text-gray-600 transition-colors border-r border-gray-200 font-medium disabled:opacity-40"
        onClick={() => step(-1)}
      >
        −
      </button>

      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={`Games played by ${playerName}`}
        disabled={disabled}
        className="w-8 h-full text-center text-xs font-semibold bg-transparent focus:outline-none disabled:opacity-60"
        value={draft ?? String(value)}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "" || /^\d+$/.test(v)) setDraft(v);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />

      <button
        type="button"
        aria-label={`Increase games for ${playerName}`}
        disabled={disabled}
        className="px-2 h-full hover:bg-gray-200 text-gray-600 transition-colors border-l border-gray-200 font-medium disabled:opacity-40"
        onClick={() => step(1)}
      >
        +
      </button>
    </div>
  );
}

export function PlayerList({
  availablePlayers,
  readOnly = false,
  onAdd,
  onAutoPick,
  onBatchAdd,
  onDeleteAll,
  onQueue,
  onDeletePlayer,
  onUpdateGamesPlayed,
}: {
  availablePlayers: Player[];
  // See the note in CourtBoard — set when the room is locked to a non-owner.
  readOnly?: boolean;
  onAdd: () => void;
  onAutoPick: () => void;
  onBatchAdd: () => void;
  onDeleteAll: () => void;
  onQueue: (player: Player) => void;
  onDeletePlayer: (player: Player) => void;
  onUpdateGamesPlayed: (playerId: string, value: number) => void;
}) {
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <Card className="md:col-span-2 p-4">
      <div className="flex justify-between mb-3">
        <h2 className="font-semibold">Players</h2>
        <div className={readOnly ? "hidden" : "flex space-x-2"}>
          <Button
            className="bg-green-600"
            onClick={onAutoPick}
            disabled={availablePlayers.length < 4}
          >
            Auto-Pick (4)
          </Button>
          <Button onClick={onAdd}>Add</Button>
          {/* DROPDOWN MENU */}
          <div className="relative">
            <button
              type="button"
              aria-label="Player actions"
              aria-haspopup="true"
              aria-expanded={showDropdown}
              onClick={() => setShowDropdown(!showDropdown)}
              className="bg-black text-white p-2 rounded-lg hover:opacity-80 flex items-center justify-center transition-colors"
            >
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform duration-200 ${
                  showDropdown ? "rotate-180" : ""
                }`}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {showDropdown && (
              <>
                {/* Invisible backdrop to close dropdown when clicking outside */}
                <div
                  aria-hidden="true"
                  className="fixed inset-0 z-10"
                  onClick={() => setShowDropdown(false)}
                />

                <Card className="absolute right-0 mt-2 w-48 shadow-xl z-20 overflow-hidden border-gray-200">
                  <div className="flex flex-col py-1">
                    <button
                      type="button"
                      className="px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                      onClick={() => {
                        onBatchAdd();
                        setShowDropdown(false);
                      }}
                    >
                      <span aria-hidden="true" className="text-blue-600">
                        📝
                      </span>{" "}
                      Batch Add Players
                    </button>

                    <div className="border-t border-gray-100 my-1" />

                    <button
                      type="button"
                      className="px-4 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                      onClick={() => {
                        onDeleteAll();
                        setShowDropdown(false);
                      }}
                    >
                      <span aria-hidden="true">🗑️</span> Delete All Players
                    </button>
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {availablePlayers.map((p) => (
          <Card key={p.id} className="p-3 flex justify-between items-center">
            <div>
              <div>
                {p.name} ({p.skill})
              </div>
              <div className="flex items-center mt-2">
                <GamesCounter
                  value={p.gamesPlayed}
                  playerName={p.name}
                  disabled={readOnly}
                  onChange={(value) => onUpdateGamesPlayed(p.id, value)}
                />
                <span className="ml-2 text-[10px] uppercase font-bold text-gray-500 tracking-tight">
                  Games
                </span>
              </div>
            </div>
            <div className={readOnly ? "hidden" : "flex space-x-2"}>
              <Button onClick={() => onQueue(p)}>Queue</Button>
              <Button className="bg-red-600" onClick={() => onDeletePlayer(p)}>
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </Card>
  );
}
