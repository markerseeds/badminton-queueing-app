"use client";

import { useState } from "react";
import type { Player } from "../lib/types";
import { Button, Card } from "./ui";

export function PlayerList({
  availablePlayers,
  onAdd,
  onAutoPick,
  onBatchAdd,
  onDeleteAll,
  onQueue,
  onDeletePlayer,
  onUpdateGamesPlayed,
}: {
  availablePlayers: Player[];
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
        <div className="flex space-x-2">
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
              onClick={() => setShowDropdown(!showDropdown)}
              className="bg-black text-white p-2 rounded-lg hover:opacity-80 flex items-center justify-center transition-colors"
            >
              <svg
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
                  className="fixed inset-0 z-10"
                  onClick={() => setShowDropdown(false)}
                />

                <Card className="absolute right-0 mt-2 w-48 shadow-xl z-20 overflow-hidden border-gray-200">
                  <div className="flex flex-col py-1">
                    <button
                      className="px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
                      onClick={() => {
                        onBatchAdd();
                        setShowDropdown(false);
                      }}
                    >
                      <span className="text-blue-600">📝</span> Batch Add
                      Players
                    </button>

                    <div className="border-t border-gray-100 my-1" />

                    <button
                      className="px-4 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                      onClick={() => {
                        onDeleteAll();
                        setShowDropdown(false);
                      }}
                    >
                      <span>🗑️</span> Delete All Players
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
                <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-gray-50/50 h-7">
                  {/* Minus Button */}
                  <button
                    className="px-2 h-full hover:bg-gray-200 text-gray-600 transition-colors border-r border-gray-200 font-medium"
                    onClick={() => onUpdateGamesPlayed(p.id, p.gamesPlayed - 1)}
                  >
                    −
                  </button>

                  {/* Number Input */}
                  <input
                    type="number"
                    className="w-8 h-full text-center text-xs font-semibold bg-transparent focus:outline-none"
                    value={p.gamesPlayed}
                    onChange={(e) =>
                      onUpdateGamesPlayed(p.id, parseInt(e.target.value) || 0)
                    }
                  />

                  {/* Plus Button */}
                  <button
                    className="px-2 h-full hover:bg-gray-200 text-gray-600 transition-colors border-l border-gray-200 font-medium"
                    onClick={() => onUpdateGamesPlayed(p.id, p.gamesPlayed + 1)}
                  >
                    +
                  </button>
                </div>
                <span className="ml-2 text-[10px] uppercase font-bold text-gray-400 tracking-tight">
                  Games
                </span>
              </div>
            </div>
            <div className="flex space-x-2">
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
