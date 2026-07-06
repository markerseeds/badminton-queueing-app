"use client";

import { useEffect } from "react";

// Calls `onEscape` while mounted whenever the Escape key is pressed. Used by
// modals so they can be dismissed from the keyboard, not just the mouse.
export function useEscapeKey(onEscape: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onEscape]);
}
