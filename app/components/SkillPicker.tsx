"use client";

import { useId } from "react";
import { skillLabel, skillOptions } from "../lib/skillDisplay";

// A single-choice band picker, replacing the native <select>.
//
// Implemented as real radios rather than the `aria-pressed` buttons the mockup
// drew: aria-pressed is the toggle-button pattern, and would announce six
// independent toggles for what is one choice. Radios give arrow-key movement
// within the group and "Intermediate, 3 of 6, selected" for free.
export function SkillPicker({
  value,
  saved,
  onChange,
}: {
  value: string;
  // The band saved on the player, when editing. Options are derived from this
  // rather than from `value` so an out-of-range band stays offered for the
  // whole session — tapping a real band and changing your mind has to be able
  // to put the original back.
  saved?: string;
  onChange: (skill: string) => void;
}) {
  const groupName = useId();
  const options = skillOptions(saved ?? value);

  return (
    <fieldset className="modal-field">
      <legend className="lbl">Skill — sets who they get matched with</legend>
      <div className="skillpick mt-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="skillopt"
            data-legacy={option.legacy ? "true" : undefined}
            data-selected={value === option.value}
          >
            <input
              type="radio"
              className="sr-only"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="skill border-0 p-0" data-skill={option.rank}>
              <span className="rk" />
            </span>
            <span className="nm">{skillLabel(option.value)}</span>
            {option.legacy && (
              <span className="tiny">
                Their current level. Not one of the standard bands — pick one to
                change it.
              </span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
