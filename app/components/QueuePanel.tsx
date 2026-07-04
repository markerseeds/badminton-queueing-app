"use client";

import type { Player } from "../lib/types";
import { Button, Card } from "./ui";

export function QueuePanel({
  queue,
  startDisabled,
  onStartGame,
  onShuffleTop,
  onRemoveFromQueue,
}: {
  queue: Player[];
  startDisabled: boolean;
  onStartGame: () => void;
  onShuffleTop: () => void;
  onRemoveFromQueue: (player: Player) => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold">Queue</h2>
        {queue.length >= 4 && (
          <button
            onClick={onShuffleTop}
            className="text-[10px] bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded flex items-center gap-1 transition-colors"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M2 6h1.4c1.3 0 2.5.6 3.3 1.7l2.2 3M22 18h-5.9c-1.3 0-2.5-.6-3.3-1.7l-2.2-3" />
            </svg>
            Shuffle Teams
          </button>
        )}
      </div>

      <Button onClick={onStartGame} className="mb-3 w-full" disabled={startDisabled}>
        Start Game
      </Button>

      <ul className="space-y-2">
        {queue.map((p, i) => (
          <li
            key={p.id}
            className={`flex justify-between items-center p-2 rounded-lg transition-colors ${
              i < 2
                ? "bg-blue-50 border border-blue-100" // If i < 2 (Team 1)
                : i < 4
                  ? "bg-red-50 border border-red-100" // Else if i < 4 (Team 2)
                  : "bg-gray-50" // Else (Rest of Queue)
            }`}
          >
            <div className="flex flex-col text-sm">
              <span className="font-medium">
                {i + 1}. {p.name}{" "}
                {i < 4 && (
                  <span
                    className={`text-[10px] ${
                      i < 2 ? "text-blue-500" : "text-red-500"
                    }  font-bold ml-1`}
                  >
                    (T{i < 2 ? "1" : "2"})
                  </span>
                )}
              </span>
              <span className="text-xs text-gray-500">
                {p.skill} | Games: {p.gamesPlayed}
              </span>
            </div>
            <Button
              className="bg-gray-600 px-2 py-0.5 text-xs"
              onClick={() => onRemoveFromQueue(p)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
