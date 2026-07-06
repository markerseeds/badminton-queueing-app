import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Merge class names, resolving conflicting Tailwind utilities so a later class
// wins over an earlier one (e.g. a passed `bg-red-600` beats a base `bg-black`).
// clsx handles conditional/array/object inputs; tailwind-merge dedupes conflicts.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
