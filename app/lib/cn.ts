import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Colour and font tokens need no configuration here: tailwind-merge's `color`
// and `font` validators accept any unknown name, so `bg-surface` already
// conflicts with `bg-danger` the same way `bg-black` conflicts with
// `bg-red-600`. That is also why the design tokens in globals.css are *only*
// colours and fonts — a `rounded-card` or `text-lbl` would not be arbitrated,
// and the override contract below would quietly stop holding. See
// tests/lib/cn.test.ts, which pins all of that down.
//
// The button variants are the exception: they are hand-written component
// classes, invisible to tailwind-merge. Without these groups, passing
// `btn-danger` to a Button whose base is `btn-primary` would keep both and let
// stylesheet order decide which colour wins.
// The type parameter declares the new group ids; without it `extend` only
// accepts tailwind-merge's own built-in group names.
const twMerge = extendTailwindMerge<"btn-variant" | "btn-size">({
  extend: {
    classGroups: {
      "btn-variant": [
        "btn-primary",
        "btn-ghost",
        "btn-quiet",
        "btn-danger",
        "btn-danger-solid",
      ],
      "btn-size": ["btn-sm", "btn-lg"],
    },
  },
});

// Merge class names, resolving conflicting Tailwind utilities so a later class
// wins over an earlier one (e.g. a passed `bg-red-600` beats a base `bg-black`).
// clsx handles conditional/array/object inputs; tailwind-merge dedupes conflicts.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
