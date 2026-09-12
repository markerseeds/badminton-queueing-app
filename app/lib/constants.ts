// Skill bands in ascending order. Order is significant: the index is used by the
// auto-pick logic to keep a group of four within one skill band.
export const SKILLS = [
  "new",
  "beginner",
  "intermediate",
  "upper intermediate",
  "advanced",
  "expert",
];

// Selectable number of courts. The upper bound is the `courts between 1 and 6`
// CHECK on `sessions`; how many of these a given room may actually use depends
// on its owner's plan (see SessionLimits).
export const COURT_COUNTS = [1, 2, 3, 4, 5, 6];

// What a brand-new room starts with. Has to be legal on the free plan, so it
// tracks the free court cap in `plan_limits()` — a room created above its own
// ceiling would be rejected by `sessions_insert`.
export const DEFAULT_COURTS = 2;
