import Link from "next/link";
import type { ReactNode } from "react";
import { WarningIcon } from "./icons";
import { SiteFooter } from "./SiteFooter";
import { LEGAL } from "../lib/legal";

// Shared frame for /terms, /privacy and /refunds. Server-rendered on purpose:
// Paddle's reviewers — and anyone with scripts off — read the HTML as sent.

// A value only the owner can supply, highlighted so none slips through review.
export function Blank({ children }: { children: ReactNode }) {
  return <mark className="rounded-sm bg-warn-soft px-1 text-warn">{children}</mark>;
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="heading text-lg">{title}</h2>
      <div className="flex flex-col gap-2 text-[0.9375rem] leading-relaxed text-ink-2">
        {children}
      </div>
    </section>
  );
}

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <main className="flex flex-col gap-6">
        <div>
          <h1 className="heading text-2xl">{title}</h1>
          <p className="muted mt-1">
            Badminton Queue · Last updated <Blank>{LEGAL.lastUpdated}</Blank>
          </p>
        </div>

        {LEGAL.draft && (
          <div className="banner banner-warn">
            <WarningIcon size={18} className="mt-0.5 shrink-0" />
            <p>
              Draft for review. The highlighted parts are placeholders that must
              be filled in, and the wording checked, before this site is
              submitted to Paddle.
            </p>
          </div>
        )}

        {children}

        <Link href="/" className="text-sm font-medium text-accent hover:underline">
          ← Back to start
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
