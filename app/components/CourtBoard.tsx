"use client";

import { COURT_COUNTS } from "../lib/constants";
import type { CourtGame } from "../lib/types";
import { Button, Card, Select } from "./ui";

export function CourtBoard({
  games,
  courts,
  readOnly = false,
  onChangeCourts,
  onEndGame,
}: {
  games: CourtGame[];
  courts: number;
  // Set when the organizer has locked the room and the viewer isn't the owner.
  // RLS is the real gate; this just avoids offering controls that would fail.
  readOnly?: boolean;
  onChangeCourts: (newCourts: number) => void;
  onEndGame: (courtNumber: number, courtIndex: number) => void;
}) {
  return (
    <Card className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-semibold">Courts</h1>
        <div className="flex items-center space-x-2">
          <label htmlFor="courts-select" className="text-sm">
            Number of Courts:
          </label>
          <Select
            id="courts-select"
            className="w-20"
            value={courts}
            disabled={readOnly}
            onChange={(e) => onChangeCourts(Number(e.target.value))}
          >
            {COURT_COUNTS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {games.map((game, index) => (
          <Card key={game.court} className="p-4 border-2 border-gray-100">
            <h2 className="font-bold text-center mb-3 border-b pb-2">
              Court {game.court}
            </h2>

            {game.players.length ? (
              <div className="space-y-4">
                {/* TEAM 1 */}
                <div className="bg-blue-50/50 p-2 rounded-lg border border-blue-100">
                  <span className="text-[10px] font-bold uppercase text-blue-600 tracking-wider">
                    Team 1
                  </span>
                  <ul className="text-sm mt-1">
                    {game.players.slice(0, 2).map((p) => (
                      <li key={p.id} className="font-medium text-gray-800">
                        {p.name}{" "}
                        <span className="text-xs font-normal text-gray-500">
                          ({p.skill})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div
                  aria-hidden="true"
                  className="text-center text-xs font-bold text-gray-500 italic"
                >
                  VS
                </div>

                {/* TEAM 2 */}
                <div className="bg-red-50/50 p-2 rounded-lg border border-red-100">
                  <span className="text-[10px] font-bold uppercase text-red-600 tracking-wider">
                    Team 2
                  </span>
                  <ul className="text-sm mt-1">
                    {game.players.slice(2, 4).map((p) => (
                      <li key={p.id} className="font-medium text-gray-800">
                        {p.name}{" "}
                        <span className="text-xs font-normal text-gray-500">
                          ({p.skill})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Button
                  className="w-full bg-red-600 mt-2"
                  disabled={readOnly}
                  onClick={() => onEndGame(game.court, index)}
                >
                  End Game
                </Button>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center border-2 border-dashed border-gray-100 rounded-lg">
                <p className="text-sm text-gray-500">Empty</p>
              </div>
            )}
          </Card>
        ))}
      </div>
    </Card>
  );
}
