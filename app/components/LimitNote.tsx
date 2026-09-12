"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

// The one upgrade affordance, so a plan gate reads the same wherever it's hit:
// what the ceiling is, and the single place to lift it.
//
// Deliberately not a `.banner` — hitting a plan limit is a fact about the room,
// not something going wrong, and the warn/danger banners are already spoken for
// by the room lock and by real errors. All of its styling is utilities on top of
// the existing `.tiny`, so it needs nothing in globals.css.
export function LimitNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("tiny flex flex-wrap items-center gap-x-1.5", className)}>
      <span>{children}</span>
      <Link
        href="/pricing"
        className="font-semibold text-accent hover:underline"
      >
        Upgrade
      </Link>
    </p>
  );
}
