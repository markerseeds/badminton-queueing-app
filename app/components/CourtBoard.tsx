"use client";

import { COURT_COUNTS } from "../lib/constants";
import type { CourtGame } from "../lib/types";
import { LimitNote } from "./LimitNote";
import { SkillBadge } from "./SkillBadge";
import { Button } from "./ui";

const MIN_COURTS = COURT_COUNTS[0];
const MAX_COURTS = COURT_COUNTS[COURT_COUNTS.length - 1];

// The <select> this replaced couldn't offer an out-of-range value; a stepper
// can, so it has to clamp explicitly.
function CourtCount({
  courts,
  disabled,
  ceiling,
  onChange,
}: {
  courts: number;
  disabled: boolean;
  // The lower of the table's hard limit and the owner's plan limit.
  ceiling: number;
  onChange: (next: number) => void;
}) {
  // A room can sit ABOVE its ceiling — created before the limits existed, or
  // owned by an account that has since lapsed. The server accepts any value at
  // or below the ceiling but nothing above it, so stepping down one at a time
  // would be rejected the whole way (5 → 4 is still over a ceiling of 2). Send
  // the first step straight to the ceiling instead; the note below says so.
  const stepDown = Math.min(courts - 1, ceiling);

  return (
    <div className="flex items-center gap-2">
      <span className="lbl">Courts</span>
      <div className="stepper" role="group" aria-label="Number of courts">
        <button
          type="button"
          aria-label="One fewer court"
          disabled={disabled || courts <= MIN_COURTS}
          onClick={() => onChange(stepDown)}
        >
          −
        </button>
        <span className="v num grid place-items-center" aria-live="polite">
          {courts}
        </span>
        <button
          type="button"
          aria-label="One more court"
          disabled={disabled || courts >= ceiling}
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
  maxCourts,
  readOnly = false,
  onChangeCourts,
  onEndGame,
  onSendNextFour,
  canSendNextFour,
}: {
  games: CourtGame[];
  courts: number;
  // The owner's plan ceiling, mirroring the `courts <= …` arm of the
  // sessions_update policy. As with readOnly, the policy is the real gate — this
  // just avoids offering a control whose write would be rejected.
  maxCourts: number;
  // Set when the organizer has locked the room and the viewer isn't the owner.
  // RLS is the real gate; this just avoids offering controls that would fail.
  readOnly?: boolean;
  onChangeCourts: (newCourts: number) => void;
  onEndGame: (courtNumber: number, courtIndex: number) => void;
  onSendNextFour: () => void;
  canSendNextFour: boolean;
}) {
  const ceiling = Math.min(MAX_COURTS, maxCourts);
  // Two different states worth distinguishing: at the plan's ceiling there is
  // something to do about it, at the table's hard 6 there isn't.
  const atPlanCeiling = !readOnly && courts >= ceiling && ceiling < MAX_COURTS;
  const abovePlanCeiling = !readOnly && courts > ceiling;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="heading text-xl">Courts</h2>
        <CourtCount
          courts={courts}
          disabled={readOnly}
          ceiling={ceiling}
          onChange={onChangeCourts}
        />
      </div>

      {abovePlanCeiling ? (
        <LimitNote>
          This room kept {courts} courts from before its plan allowed{" "}
          {ceiling}. You can keep playing on all of them, but lowering the count
          goes straight to {ceiling}.
        </LimitNote>
      ) : atPlanCeiling ? (
        <LimitNote>
          {ceiling} {ceiling === 1 ? "court" : "courts"} is this room&rsquo;s
          limit on the free plan.
        </LimitNote>
      ) : null}

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
