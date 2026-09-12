"use client";

import { useState } from "react";
import { cn } from "../lib/cn";
import { clampGamesPlayed, parseGamesPlayedInput } from "../lib/logic";
import type { Player } from "../lib/types";
import { ListIcon, MoreIcon, PencilIcon, TrashIcon } from "./icons";
import { LimitNote } from "./LimitNote";
import { SkillBadge } from "./SkillBadge";
import { Button, IconButton } from "./ui";

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
    <div className="stepper">
      <button
        type="button"
        aria-label={`One fewer game for ${playerName}`}
        disabled={disabled || value <= 0}
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
        className="v num"
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
        aria-label={`One more game for ${playerName}`}
        disabled={disabled}
        onClick={() => step(1)}
      >
        +
      </button>
    </div>
  );
}

// A click-outside backdrop plus a positioned panel — the pattern the players
// menu already used, extracted so per-row menus behave the same way.
function Menu({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <IconButton
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => onToggle(!open)}
      >
        <MoreIcon />
      </IconButton>

      {open && (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-10"
            onClick={() => onToggle(false)}
          />
          <div className="card absolute right-0 z-20 mt-2 flex w-52 flex-col overflow-hidden py-1 shadow-lg">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  danger = false,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-11 items-center gap-2.5 px-3.5 text-left text-sm",
        danger
          ? "text-danger hover:bg-danger-soft"
          : "text-ink hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

export function PlayerList({
  availablePlayers,
  playersRemaining,
  readOnly = false,
  onAdd,
  onAutoPick,
  onBatchAdd,
  onDeleteAll,
  onQueue,
  onDeletePlayer,
  onEditPlayer,
  onUpdateGamesPlayed,
}: {
  availablePlayers: Player[];
  // Player slots left on this room's plan. Counted against the whole roster, not
  // `availablePlayers` — queued and on-court players still occupy a slot.
  playersRemaining: number;
  // See the note in CourtBoard — set when the room is locked to a non-owner.
  readOnly?: boolean;
  onAdd: () => void;
  onAutoPick: () => void;
  onBatchAdd: () => void;
  onDeleteAll: () => void;
  onQueue: (player: Player) => void;
  onDeletePlayer: (player: Player) => void;
  onEditPlayer: (player: Player) => void;
  onUpdateGamesPlayed: (playerId: string, value: number) => void;
}) {
  const [panelMenu, setPanelMenu] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="heading text-xl">
          Players{" "}
          <span className="num text-sm font-normal text-ink-3">
            · {availablePlayers.length} free
          </span>
        </h2>

        <div className={cn("flex gap-2", readOnly && "hidden")}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onAutoPick}
            disabled={availablePlayers.length < 4}
          >
            Auto-pick 4
          </Button>
          <Button size="sm" onClick={onAdd} disabled={playersRemaining <= 0}>
            Add
          </Button>

          <Menu
            label="More player actions"
            open={panelMenu}
            onToggle={setPanelMenu}
          >
            <MenuItem
              onClick={() => {
                onBatchAdd();
                setPanelMenu(false);
              }}
            >
              <ListIcon size={16} />
              Add several at once
            </MenuItem>
            <MenuItem
              danger
              onClick={() => {
                onDeleteAll();
                setPanelMenu(false);
              }}
            >
              <TrashIcon size={16} />
              Remove everyone
            </MenuItem>
          </Menu>
        </div>
      </div>

      {/* "Add several at once" stays tappable at zero on purpose: the batch
          modal can say how many slots are left, which a dead menu item can't. */}
      {!readOnly && playersRemaining <= 0 && (
        <LimitNote>This room is full on the free plan.</LimitNote>
      )}

      {availablePlayers.length === 0 ? (
        <p className="muted">
          Everyone is queued or on court. Add more players to keep the rotation
          going.
        </p>
      ) : (
        <div className="plist">
          {availablePlayers.map((p) => (
            <div key={p.id} className="prow">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="pname">
                  {p.name}
                  <SkillBadge skill={p.skill} />
                </div>
                <div className="flex items-center gap-2">
                  <GamesCounter
                    value={p.gamesPlayed}
                    playerName={p.name}
                    disabled={readOnly}
                    onChange={(value) => onUpdateGamesPlayed(p.id, value)}
                  />
                  <span className="lbl">Games</span>
                </div>
              </div>

              {/* Queue is the big tap; Edit and Delete moved behind the overflow
                  so a destructive action no longer sits a thumb-width from the
                  one you press forty times a night. */}
              <div className={cn("flex items-center gap-2", readOnly && "hidden")}>
                <Button size="sm" onClick={() => onQueue(p)}>
                  Queue
                </Button>
                <Menu
                  label={`More actions for ${p.name}`}
                  open={openRow === p.id}
                  onToggle={(open) => setOpenRow(open ? p.id : null)}
                >
                  <MenuItem
                    onClick={() => {
                      onEditPlayer(p);
                      setOpenRow(null);
                    }}
                  >
                    <PencilIcon size={16} />
                    Edit name or level
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      onDeletePlayer(p);
                      setOpenRow(null);
                    }}
                  >
                    <TrashIcon size={16} />
                    Remove {p.name}
                  </MenuItem>
                </Menu>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
