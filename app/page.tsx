/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { db } from "./lib/firebase"; // adjust path as needed
import {
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

// ---------- UI ----------
const Card = ({ children, className = "" }: any) => (
  <div className={`bg-white border rounded-xl ${className}`}>{children}</div>
);

const Button = ({ children, className = "", ...props }: any) => (
  <button
    {...props}
    className={`px-3 py-1 rounded-lg bg-black text-white hover:opacity-80 disabled:opacity-40 ${className}`}
  >
    {children}
  </button>
);

const Input = (props: any) => (
  <input {...props} className="border rounded-lg px-2 py-1 w-full" />
);

const Select = (props: any) => (
  <select {...props} className="border rounded-lg px-2 py-1 w-full" />
);

// New Confirmation Modal Component
const ConfirmationModal = ({ message, onConfirm, onCancel }: any) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <Card className="p-6 w-full max-w-sm">
      <h3 className="font-semibold text-lg mb-4">Confirm Action</h3>
      <p className="text-gray-700 mb-6">{message}</p>
      <div className="flex justify-end gap-2">
        <Button className="bg-gray-600" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="bg-red-600" onClick={onConfirm}>
          Confirm
        </Button>
      </div>
    </Card>
  </div>
);

// ---------- CONSTANTS ----------
const SKILLS = [
  "new",
  "beginner",
  "intermediate",
  "upper intermediate",
  "advanced",
  "expert",
];

// Array of possible court counts
const COURT_COUNTS = [1, 2, 3, 4, 5, 6];

// ---------- TYPES ----------
type Player = {
  id: string;
  name: string;
  skill: string;
  gamesPlayed: number;
};

type CourtGame = {
  court: number;
  players: Player[];
};

type SessionState = {
  courts: number;
  players: Player[];
  queue: Player[];
  games: CourtGame[];
};

// ---------- APP ----------
export default function BadmintonQueueApp() {
  const sessionId = "club-session-1"; // must be the same across devices
  const sessionRef = doc(db, "sessions", sessionId);

  const [state, setState] = useState<SessionState | null>(null);

  const [showModal, setShowModal] = useState(false); // For Add Player modal
  const [playerName, setPlayerName] = useState("");
  const [skill, setSkill] = useState(SKILLS[0]);

  // Confirmation Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);

  // Batch Add Modal State
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchInput, setBatchInput] = useState("");
  const [batchError, setBatchError] = useState<string | null>(null);

  // Dropdown State
  const [showDropdown, setShowDropdown] = useState(false);

  // ---------- SUBSCRIBE ----------
  useEffect(() => {
    const unsub = onSnapshot(sessionRef, async (snap) => {
      if (!snap.exists()) {
        const initialCourts = 3;
        // initialize Firestore-safe structure
        const initialGames: CourtGame[] = Array.from(
          { length: initialCourts },
          (_, i) => ({
            court: i + 1,
            players: [],
          })
        );

        await setDoc(sessionRef, {
          courts: initialCourts,
          players: [],
          queue: [],
          games: initialGames,
          updatedAt: serverTimestamp(),
        });
        return;
      }
      setState(snap.data() as SessionState);
    });

    return () => unsub();
  }, []);

  if (!state) return <div className="p-6">Loading session…</div>;

  // ---------- HELPERS ----------
  const isPlaying = (player: Player) =>
    state.games.flatMap((g) => g.players).some((p) => p.id === player.id);

  // Check if player is currently in the queue
  const isQueued = (player: Player) =>
    state.queue.some((p) => p.id === player.id);

  // Maps skill string to a number for comparison (0 to 5)
  const getSkillIndex = (skill: string) => SKILLS.indexOf(skill);

  const updateSession = async (updates: Partial<SessionState>) => {
    await updateDoc(sessionRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  };

  const uuid = () => Math.random().toString(36).substring(2, 11); // safe replacement

  // Helper to shuffle an array (used for tie-breaking randomization)
  const shuffleArray = (array: any[]) => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  };

  // ---------- ACTIONS ----------

  // --- DELETE PLAYER LOGIC ---
  const executeDeletePlayer = async (playerToDelete: Player) => {
    // 1. Remove player from the main players list
    const updatedPlayers = state.players.filter(
      (p) => p.id !== playerToDelete.id
    );

    // 2. Remove player from the queue if they are in it
    const updatedQueue = state.queue.filter((p) => p.id !== playerToDelete.id);

    // 3. If the player is currently playing, remove them from the court
    const updatedGames = state.games.map((game) => ({
      ...game,
      players: game.players.filter((p) => p.id !== playerToDelete.id),
    }));

    await updateSession({
      players: updatedPlayers,
      queue: updatedQueue,
      games: updatedGames,
    });
  };

  const confirmDeletePlayer = (player: Player) => {
    setConfirmMessage(
      `Are you sure you want to delete player: ${player.name}? This cannot be undone.`
    );
    setConfirmAction(() => () => executeDeletePlayer(player));
    setShowConfirmModal(true);
  };

  // --- END GAME LOGIC ---
  const executeEndGame = async (courtIndex: number) => {
    const updatedGames = [...state.games];
    updatedGames[courtIndex] = { ...updatedGames[courtIndex], players: [] };
    await updateSession({ games: updatedGames });
  };

  const confirmEndGame = (courtNumber: number, courtIndex: number) => {
    setConfirmMessage(
      `Are you sure you want to end the game on Court ${courtNumber}? The players will return to the available list.`
    );
    setConfirmAction(() => () => executeEndGame(courtIndex));
    setShowConfirmModal(true);
  };

  // --- GENERAL ACTIONS (No confirmation needed) ---
  const addPlayer = async () => {
    if (!playerName.trim()) return;

    await updateSession({
      players: [
        ...state.players,
        {
          id: uuid(),
          name: playerName.trim(),
          skill,
          gamesPlayed: 0,
        },
      ],
    });

    setPlayerName("");
    setSkill(SKILLS[0]);
    setShowModal(false);
  };

  const addToQueue = async (player: Player) => {
    if (isQueued(player)) return;
    await updateSession({ queue: [...state.queue, player] });
  };

  const autoPickPlayers = async () => {
    let availablePlayers = state.players.filter(
      (p) => !isPlaying(p) && !isQueued(p)
    );

    if (availablePlayers.length < 4) return;

    // 1. Sort by Games Played (Lowest first) and then shuffle (for fair tie-breaking)
    availablePlayers.sort((a, b) => a.gamesPlayed - b.gamesPlayed);
    availablePlayers = shuffleArray(availablePlayers);

    // 2. Find the optimal group of 4
    let playersToQueue: Player[] = [];

    for (let i = 0; i <= availablePlayers.length - 4; i++) {
      const potentialGroup = availablePlayers.slice(i, i + 4);
      const skillIndices = potentialGroup.map((p) => getSkillIndex(p.skill));
      const minSkill = Math.min(...skillIndices);
      const maxSkill = Math.max(...skillIndices);

      if (maxSkill - minSkill <= 1) {
        playersToQueue = potentialGroup;
        break;
      }
    }

    if (playersToQueue.length === 0) {
      playersToQueue = availablePlayers.slice(0, 4);
      console.warn(
        "Could not find 4 players within 1 skill level difference. Picking the 4 with the lowest games played."
      );
    }

    // 3. Add them to the existing queue
    const updatedQueue = [...state.queue, ...playersToQueue];

    await updateSession({ queue: updatedQueue });
  };

  const removeFromQueue = async (player: Player) => {
    await updateSession({
      queue: state.queue.filter((p) => p.id !== player.id),
    });
  };

  const startGame = async () => {
    const emptyCourtIndex = state.games.findIndex(
      (g) => g.players.length === 0
    );
    if (emptyCourtIndex === -1 || state.queue.length < 4) return;

    const playersForGame = state.queue.slice(0, 4);

    const updatedPlayers = state.players.map((p) =>
      playersForGame.some((gp) => gp.id === p.id)
        ? { ...p, gamesPlayed: p.gamesPlayed + 1 }
        : p
    );

    const updatedGames = [...state.games];
    updatedGames[emptyCourtIndex] = {
      ...updatedGames[emptyCourtIndex],
      players: playersForGame,
    };

    await updateSession({
      players: updatedPlayers,
      queue: state.queue.slice(4),
      games: updatedGames,
    });
  };

  const changeCourts = async (newCourts: number) => {
    if (newCourts === state.courts) return;

    let updatedGames = [...state.games];

    if (newCourts > state.courts) {
      // Add new empty courts
      for (let i = state.courts; i < newCourts; i++) {
        updatedGames.push({
          court: i + 1,
          players: [],
        });
      }
    } else {
      // Remove courts and their players if necessary
      updatedGames = updatedGames.slice(0, newCourts);
    }

    await updateSession({
      courts: newCourts,
      games: updatedGames,
    });
  };

  // --- BATCH ADD PLAYERS LOGIC ---
  const batchAddPlayers = async () => {
    setBatchError(null);
    const lines = batchInput.split("\n").filter((line) => line.trim() !== "");
    const newPlayers: Player[] = [];

    for (let i = 0; i < lines.length; i++) {
      const [name, skill] = lines[i].split(",").map((item) => item.trim());

      // Validation: Check format
      if (!name || !skill) {
        setBatchError(`Line ${i + 1}: Format must be "Name, Skill"`);
        return;
      }

      // Validation: Check skill against SKILLS array
      const formattedSkill = skill.toLowerCase();
      if (!SKILLS.includes(formattedSkill)) {
        setBatchError(`Line ${i + 1}: "${skill}" is not a valid skill level.`);
        return;
      }

      newPlayers.push({
        id: uuid(),
        name: name,
        skill: formattedSkill,
        gamesPlayed: 0,
      });
    }

    if (newPlayers.length > 0) {
      await updateSession({
        players: [...state.players, ...newPlayers],
      });
      setBatchInput("");
      setShowBatchModal(false);
    }
  };

  // --- DELETE ALL LOGIC ---
  const executeDeleteAll = async () => {
    // Reset everything to empty/initial state
    const resetGames = state.games.map((game) => ({
      ...game,
      players: [],
    }));

    await updateSession({
      players: [],
      queue: [],
      games: resetGames,
    });
  };

  const confirmDeleteAll = () => {
    setConfirmMessage(
      "DANGER: Are you sure you want to delete ALL players and clear all courts? This action cannot be undone."
    );
    setConfirmAction(() => () => executeDeleteAll());
    setShowConfirmModal(true);
  };

  const handleConfirm = () => {
    if (confirmAction) {
      confirmAction();
    }
    setShowConfirmModal(false);
    setConfirmAction(null);
  };

  const handleCancel = () => {
    setShowConfirmModal(false);
    setConfirmAction(null);
  };

  // ---------- RENDER ----------
  const availablePlayersCount = state.players.filter(
    (p) => !isPlaying(p) && !isQueued(p)
  ).length;

  return (
    <div className="p-6 space-y-6">
      {/* COURTS */}
      <Card className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-xl font-semibold">Courts</h1>
          <div className="flex items-center space-x-2">
            <span className="text-sm">Number of Courts:</span>
            <Select
              className="w-20"
              value={state.courts}
              onChange={(e: any) => changeCourts(Number(e.target.value))}
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
          {state.games.map((game, index) => (
            <Card key={game.court} className="p-4">
              <h2 className="font-medium mb-2">Court {game.court}</h2>
              {game.players.length ? (
                <>
                  <ul className="text-sm space-y-1">
                    {game.players.map((p) => (
                      <li key={p.id}>
                        {p.name} ({p.skill})
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-3 w-full bg-red-600"
                    onClick={() => confirmEndGame(game.court, index)} // Use confirmEndGame
                  >
                    End Game
                  </Button>
                </>
              ) : (
                <p className="text-sm text-gray-400">Empty</p>
              )}
            </Card>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* QUEUE */}
        <Card className="p-4">
          <h2 className="font-semibold mb-3">Queue</h2>
          <Button
            onClick={startGame}
            className="mb-3 w-full"
            disabled={
              state.queue.length < 4 ||
              state.games.every((g) => g.players.length > 0)
            }
          >
            Start Game
          </Button>

          <ul className="space-y-2">
            {state.queue.map((p, i) => (
              <li
                key={p.id}
                className="flex justify-between items-center bg-gray-50 p-2 rounded-lg"
              >
                <div className="flex flex-col text-sm">
                  <span className="font-medium">
                    {i + 1}. {p.name}
                  </span>
                  <span className="text-xs text-gray-500">
                    {p.skill} | Games: {p.gamesPlayed}
                  </span>
                </div>
                <Button
                  className="bg-gray-600 px-2 py-0.5 text-xs"
                  onClick={() => removeFromQueue(p)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        {/* PLAYERS */}
        <Card className="md:col-span-2 p-4">
          <div className="flex justify-between mb-3">
            <h2 className="font-semibold">Players</h2>
            <div className="flex space-x-2">
              <Button
                className="bg-green-600"
                onClick={autoPickPlayers}
                disabled={availablePlayersCount < 4}
              >
                Auto-Pick (4)
              </Button>
              <Button onClick={() => setShowModal(true)}>Add</Button>
              {/* DROPDOWN MENU */}
              <div className="relative">
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="bg-black text-white p-2 rounded-lg hover:opacity-80 flex items-center justify-center transition-colors"
                >
                  {/* Icon representing your uploaded image */}
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
                            setShowBatchModal(true);
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
                            confirmDeleteAll();
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
            {state.players
              .filter((p) => !isPlaying(p) && !isQueued(p)) // Only show available players
              .map((p) => (
                <Card
                  key={p.id}
                  className="p-3 flex justify-between items-center"
                >
                  <div>
                    <div>
                      {p.name} ({p.skill})
                    </div>
                    <div className="text-xs text-gray-500">
                      Games: {p.gamesPlayed}
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button onClick={() => addToQueue(p)}>Queue</Button>
                    <Button
                      className="bg-red-600"
                      onClick={() => confirmDeletePlayer(p)} // Use confirmDeletePlayer
                    >
                      Delete
                    </Button>
                  </div>
                </Card>
              ))}
          </div>
        </Card>
      </div>

      {/* ADD PLAYER MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
          <Card className="p-6 w-full max-w-sm">
            <h3 className="font-semibold mb-4">Add Player</h3>
            <div className="flex flex-col justify-between gap-2 mt-4">
              <Input
                placeholder="Name"
                value={playerName}
                onChange={(e: any) => setPlayerName(e.target.value)}
              />
              <Select
                className="mt-3"
                value={skill}
                onChange={(e: any) => setSkill(e.target.value)}
              >
                {SKILLS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <Button
                className="bg-gray-600"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </Button>
              <Button onClick={addPlayer}>Add</Button>
            </div>
          </Card>
        </div>
      )}

      {/* CONFIRMATION MODAL */}
      {showConfirmModal && (
        <ConfirmationModal
          message={confirmMessage}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {showBatchModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
          <Card className="p-6 w-full max-w-lg">
            <h3 className="font-semibold mb-2">Batch Add Players</h3>
            <p className="text-xs text-gray-500 mb-4">
              Format: Name, Skill (One per line)
              <br />
              Example: Mark, new
            </p>

            <textarea
              className="border rounded-lg px-2 py-2 w-full h-48 font-mono text-sm"
              placeholder={`John, new
James, beginner
Charlie, intermediate`}
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
            />

            {batchError && (
              <div className="mt-2 text-red-600 text-sm font-medium">
                ⚠️ {batchError}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <Button
                className="bg-gray-600"
                onClick={() => {
                  setShowBatchModal(false);
                  setBatchError(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={batchAddPlayers}>
                Import {batchInput.split("\n").filter((l) => l.trim()).length}{" "}
                Players
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
