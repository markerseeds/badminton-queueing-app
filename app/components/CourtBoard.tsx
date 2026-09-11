"use client";

import { COURT_COUNTS } from "../lib/constants";
import type { CourtGame } from "../lib/types";
import { SkillBadge } from "./SkillBadge";
import { Button } from "./ui";

const MIN_COURTS = COURT_COUNTS[0];
const MAX_COURTS = COURT_COUNTS[COURT_COUNTS.length - 1];

// The <select> this replaced couldn't offer an out-of-range value; a stepper
// can, so it has to clamp explicitly.
function CourtCount({
  courts,
  disabled,
  onChange,
}: {
  courts: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="lbl">Courts</span>
      <div className="stepper" role="group" aria-label="Number of courts">
        <button
          type="button"
          aria-label="One fewer court"
          disabled={disabled || courts <= MIN_COURTS}
          onClick={() => onChange(courts - 1)}
        >
          −
        </button>
        <span className="v num grid place-items-center" aria-live="polite">
          {courts}
        </span>
        <button
          type="button"
          aria-label="One more court"
          disabled={disabled || courts >= MAX_COURTS}
          onClick={() => onChange(courts + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function CourtBoard({
  games,
  courts,
  readOnly = false,
  onChangeCourts,
  onEndGame,
  onSendNextFour,
  canSendNextFour,
}: {
  games: CourtGame[];
  courts: number;
  // Set when the organizer has locked the room and the viewer isn't the owner.
  // RLS is the real gate; this just avoids offering controls that would fail.
  readOnly?: boolean;
  onChangeCourts: (newCourts: number) => void;
  onEndGame: (courtNumber: number, courtIndex: number) => void;
  onSendNextFour: () => void;
  canSendNextFour: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="heading text-xl">Courts</h2>
        <CourtCount
          courts={courts}
          disabled={readOnly}
          onChange={onChangeCourts}
        />
      </div>

      <div className="courts-rail">
        {games.map((game, index) => {
          const inPlay = game.players.length > 0;
          return (
            <article key={game.court} className="court">
              <div className="flex items-center justify-between gap-2">
                <span className="court-no">Court {game.court}</span>
                <span className={inPlay ? "pill pill-live" : "pill pill-open"}>
                  {inPlay && <span className="dot" aria-hidden="true" />}
                  {inPlay ? "In play" : "Open"}
                </span>
              </div>

              {inPlay ? (
                <>
                  <div className="side side-1">
                    <span className="lbl">Side 1</span>
                    {game.players.slice(0, 2).map((p) => (
                      <span key={p.id} className="nm">
                        {p.name}
                        <SkillBadge skill={p.skill} />
                      </span>
                    ))}
                  </div>

                  <div className="vs" aria-hidden="true">
                    vs
                  </div>

                  <div className="side side-2">
                    <span className="lbl">Side 2</span>
                    {game.players.slice(2, 4).map((p) => (
                      <span key={p.id} className="nm">
                        {p.name}
                        <SkillBadge skill={p.skill} />
                      </span>
                    ))}
                  </div>

                  <Button
                    variant="danger"
                    block
                    className="mt-auto"
                    disabled={readOnly}
                    onClick={() => onEndGame(game.court, index)}
                  >
                    End game
                  </Button>
                </>
              ) : (
                <div className="court-empty">
                  <p className="muted">Nobody on this court.</p>
                  {!readOnly && (
                    <Button
                      size="sm"
                      disabled={!canSendNextFour}
                      onClick={onSendNextFour}
                    >
                      Send the next four
                    </Button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
