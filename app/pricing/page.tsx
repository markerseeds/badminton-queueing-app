"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountBar } from "../components/AccountBar";
import { CheckIcon, WarningIcon } from "../components/icons";
import { getPlanLimits } from "../lib/sessionStore";
import type { AccountLimits } from "../lib/types";

// Everything a plan gate links to. The numbers are read from `plan_limits()` —
// the same SQL function the RLS policies consult — rather than written out here,
// so this page cannot advertise a ceiling the server would refuse to honour.
// The free-tier numbers are an explicit hypothesis to tune against real club
// nights, which makes that drift likely rather than theoretical.

function unlimited(n: number): string {
  // plan_limits() spells "unlimited" as int4 max; anything near it isn't a
  // number worth printing.
  return n > 1000 ? "Unlimited" : String(n);
}

function PlanCard({
  name,
  price,
  blurb,
  limits,
  features,
  highlight = false,
}: {
  name: string;
  price: string;
  blurb: string;
  limits: AccountLimits | null;
  features: string[];
  highlight?: boolean;
}) {
  return (
    <div className="card flex flex-col gap-4 p-5">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="heading text-lg">{name}</h2>
          {highlight && <span className="pill pill-warn">Not on sale yet</span>}
        </div>
        <p className="num mt-1 text-2xl font-semibold">{price}</p>
        <p className="muted mt-1">{blurb}</p>
      </div>

      <dl className="flex flex-col gap-2 border-t border-line pt-4">
        {[
          ["Courts per room", limits && unlimited(limits.maxCourts)],
          ["Players per room", limits && unlimited(limits.maxPlayers)],
          ["Saved rooms", limits && unlimited(limits.maxRooms)],
        ].map(([label, value]) => (
          <div key={label as string} className="flex justify-between gap-3">
            <dt className="text-sm text-ink-2">{label}</dt>
            <dd className="num text-sm font-semibold">
              {value ?? <span className="skel inline-block h-4 w-14" />}
            </dd>
          </div>
        ))}
      </dl>

      <ul className="flex flex-col gap-2 border-t border-line pt-4">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <CheckIcon size={16} className="mt-0.5 shrink-0 text-accent" />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PricingPage() {
  const [free, setFree] = useState<AccountLimits | null>(null);
  const [pro, setPro] = useState<AccountLimits | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [f, p] = await Promise.all([
          getPlanLimits("free"),
          getPlanLimits("pro"),
        ]);
        if (!active) return;
        setFree(f);
        setPro(p);
      } catch (e) {
        if (!active) return;
        setError(
          e instanceof Error ? e.message : "Could not load the plan limits.",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <AccountBar />

      <main className="flex flex-col gap-5">
        <div>
          <h1 className="heading text-2xl">Free vs Pro</h1>
          <p className="muted mt-1 max-w-[55ch]">
            Free runs a small club night end to end. Pro is for organisers
            running it every week.
          </p>
        </div>

        {error && (
          <div role="alert" className="banner banner-danger">
            <WarningIcon size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <PlanCard
            name="Free"
            price="£0"
            blurb="Everything you need to run one small club night."
            limits={free}
            features={[
              "Fair, skill-matched auto-pick",
              "Live sync across every device",
              "Share one link — players never sign up",
              "Lock a room to just you",
            ]}
          />
          <PlanCard
            name="Pro"
            price="One-time"
            blurb="For a regular organiser, or more than one club."
            limits={pro}
            highlight
            features={[
              "Everything in Free",
              "Up to 6 courts at once",
              "As many players and saved rooms as you need",
            ]}
          />
        </div>

        {/* Said plainly rather than with a dead "Buy" button — an upgrade path
            that silently goes nowhere is worse than one that admits it. */}
        <div className="banner banner-warn">
          <WarningIcon size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Pro isn&rsquo;t on sale yet.</p>
            <p className="mt-1 text-[0.8125rem] opacity-90">
              The limits above are live and enforced, but checkout is still
              being built. Nothing you can do here will charge you.
            </p>
          </div>
        </div>

        <Link
          href="/"
          className="text-sm font-medium text-accent hover:underline"
        >
          ← Back to start
        </Link>
      </main>
    </div>
  );
}
