"use client";

import type { Player } from "../lib/types";
import { CloseIcon, ShuffleIcon } from "./icons";
import { SkillBadge } from "./SkillBadge";
import { Button, IconButton } from "./ui";

export function QueuePanel({
  queue,
  startDisabled,
  nextCourt,
  readOnly = false,
  onStartGame,
  onShuffleTop,
  onRemoveFromQueue,
}: {
  queue: Player[];
  startDisabled: boolean;
  // The court the front four are heading to, or null when none is free.
  nextCourt: number | null;
  // See the note in CourtBoard — set when the room is locked to a non-owner.
  readOnly?: boolean;
  onStartGame: () => void;
  onShuffleTop: () => void;
  onRemoveFromQueue: (player: Player) => void;
}) {
  const front = queue.slice(0, 4);
  const rest = queue.slice(4);
  const hasFour = front.length === 4;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="heading text-xl">Queue</h2>
        {hasFour && !readOnly && (
          <Button variant="quiet" size="sm" onClick={onShuffleTop}>
            <ShuffleIcon size={14} />
            Shuffle sides
          </Button>
        )}
      </div>

      {queue.length === 0 ? (
        <p className="muted">
          Nobody waiting. Queue a player from the list to get started.
        </p>
      ) : (
        <>
          {hasFour && (
            <div className="upnext">
              <div className="flex items-center justify-between gap-2">
                <span className="lbl text-accent">
                  {nextCourt === null
                    ? "Up next — waiting for a court"
                    : `Up next → Court ${nextCourt}`}
                </span>
                <span className="tiny num">
                  {queue.length} waiting
                </span>
              </div>

              <div className="upnext-grid">
                <div className="side side-1">
                  <span className="lbl">Side 1</span>
                  {front.slice(0, 2).map((p) => (
                    <span key={p.id} className="nm">
                      {p.name}
                    </span>
                  ))}
                </div>
                <div className="vs" aria-hidden="true">
                  vs
                </div>
                <div className="side side-2">
                  <span className="lbl">Side 2</span>
                  {front.slice(2, 4).map((p) => (
                    <span key={p.id} className="nm">
                      {p.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* Duplicated by the sticky bar on a phone, where this one is
                  usually scrolled out of reach. */}
              <Button
                block
                className="hidden md:flex"
                disabled={startDisabled || readOnly}
                onClick={onStartGame}
              >
                Start game
              </Button>
            </div>
          )}

          {/* Fewer than four waiting: no "up next" to show, but Start Game
              still has to be reachable on a wide screen. */}
          {!hasFour && (
            <Button
              block
              className="hidden md:flex"
              disabled={startDisabled || readOnly}
              onClick={onStartGame}
            >
              Start game
            </Button>
          )}

          <ul className="flex flex-col gap-2">
            {(hasFour ? rest : queue).map((p, i) => (
              <li key={p.id} className="qrow">
                <span className="qpos num">{(hasFour ? 4 : 0) + i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="qname">
                    {p.name}
                    <SkillBadge skill={p.skill} />
                  </div>
                  <div className="tiny num">
                    {p.gamesPlayed} {p.gamesPlayed === 1 ? "game" : "games"} so
                    far
                  </div>
                </div>
                <IconButton
                  aria-label={`Remove ${p.name} from the queue`}
                  disabled={readOnly}
                  onClick={() => onRemoveFromQueue(p)}
                >
                  <CloseIcon />
                </IconButton>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
