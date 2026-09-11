import { cn } from "../lib/cn";
import { skillLabel, skillRank } from "../lib/skillDisplay";

// A skill band, shown as a ramp dot plus a short label.
//
// Skill used to render as grey lowercase text in brackets — "(upper
// intermediate)" — despite being the value that decides who a player gets
// matched with. The dot encodes the band's position on an ordinal ramp so the
// spread of a court or a queue reads at a glance; the label always sits on
// --bq-ink, so contrast holds at every step.
//
// An unrecognized band (rank 0) keeps the neutral mid-ramp dot and its own
// literal text — see skillOptions in lib/skillDisplay.ts for why those exist.
export function SkillBadge({
  skill,
  className,
}: {
  skill: string;
  className?: string;
}) {
  return (
    <span className={cn("skill", className)} data-skill={skillRank(skill)}>
      <span className="rk" />
      {skillLabel(skill)}
    </span>
  );
}
