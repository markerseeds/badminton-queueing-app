"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AccountBar } from "../components/AccountBar";
import { CheckIcon, CloseIcon, WarningIcon } from "../components/icons";
import { SiteFooter } from "../components/SiteFooter";
import { Button, IconButton } from "../components/ui";
import { usePurchase } from "../hooks/usePurchase";
import { proCta } from "../lib/purchase";
import { getPlanLimits } from "../lib/sessionStore";
import type { AccountLimits } from "../lib/types";

// Everything a plan gate links to, and since Phase 3c the place Pro is bought.
//
// The numbers are read from `plan_limits()` — the same SQL function the RLS
// policies consult — rather than written out here, so this page cannot
// advertise a ceiling the server would refuse to honour. The price is Paddle's,
// localized for the visitor; what is actually sold is decided server-side by
// create-checkout, never by anything on this page.

function unlimited(n: number): string {
  // plan_limits() spells "unlimited" as int4 max; anything near it isn't a
  // number worth printing.
  return n > 1000 ? "Unlimited" : String(n);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function PlanCard({
  name,
  price,
  priceNote,
  blurb,
  limits,
  features,
  action,
}: {
  name: string;
  price: ReactNode;
  priceNote?: string;
  blurb: string;
  limits: AccountLimits | null;
  features: string[];
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col gap-4 p-5">
      <div>
        <h2 className="heading text-lg">{name}</h2>
        <p className="num mt-1 text-2xl font-semibold">
          {price}
          {priceNote && (
            <span className="ml-1.5 text-sm font-normal text-ink-2">{priceNote}</span>
          )}
        </p>
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

      {action && <div className="mt-auto pt-1">{action}</div>}
    </div>
  );
}

export default function PricingPage() {
  const [free, setFree] = useState<AccountLimits | null>(null);
  const [pro, setPro] = useState<AccountLimits | null>(null);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const purchase = usePurchase();

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
        setLimitsError(
          e instanceof Error ? e.message : "Could not load the plan limits.",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const cta = proCta({
    authLoading: purchase.authLoading,
    signedIn: purchase.isSignedIn,
    plan: purchase.plan,
    price: purchase.price,
    proSince: purchase.purchase?.proSince ?? null,
    configured: purchase.configured,
    formatDate,
  });
  const busy = ["starting", "checkout", "confirming", "verifying"].includes(purchase.status);
  const canVerify =
    purchase.configured && purchase.isSignedIn && purchase.plan !== "pro";

  let action: ReactNode;
  if (cta.kind === "loading") {
    action = <div aria-hidden="true" className="skel h-11 w-full" />;
  } else if (cta.kind === "owned") {
    action = (
      <p className="flex min-h-11 items-center justify-center gap-2 rounded-(--bq-radius) bg-accent-soft px-3 text-sm font-semibold text-accent">
        <CheckIcon size={16} />
        {cta.label}
      </p>
    );
  } else {
    action = (
      <Button
        block
        size="lg"
        disabled={cta.kind === "unavailable" || busy}
        onClick={purchase.buy}
      >
        {purchase.status === "starting" ? "Starting checkout…" : cta.label}
      </Button>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <AccountBar />

      <main className="flex flex-col gap-5">
        <div>
          <h1 className="heading text-2xl">Free vs Pro</h1>
          <p className="muted mt-1 max-w-[55ch]">
            Free runs a small club night end to end. Pro is for organisers
            running it every week — paid once, yours on every device you sign
            in on.
          </p>
        </div>

        {limitsError && (
          <div role="alert" className="banner banner-danger">
            <WarningIcon size={18} className="mt-0.5 shrink-0" />
            <span>{limitsError}</span>
          </div>
        )}

        {/* One live region for the whole purchase, always mounted so a screen
            reader hears each stage as it changes (a region inserted together
            with its content is often not announced). Empty, it would still
            claim a flex gap; the negative margin hands that gap back. */}
        <div role="status" aria-live="polite" className="flex flex-col gap-5 empty:-mb-5">
          {(purchase.status === "checkout" || purchase.status === "confirming") && (
            <div className="banner bg-accent-soft text-accent">
              <span>
                {purchase.status === "checkout"
                  ? "Complete your purchase in the Paddle window."
                  : "Payment received — confirming your Pro unlock…"}
              </span>
            </div>
          )}
          {purchase.status === "verifying" && (
            <div className="banner bg-accent-soft text-accent">
              <span>Checking with Paddle…</span>
            </div>
          )}
          {purchase.status === "pro" && (
            <div className="banner bg-accent-soft text-accent">
              <CheckIcon size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">You have Pro.</p>
                <p className="mt-1 text-[0.8125rem] opacity-90">
                  Your rooms now have Pro&rsquo;s limits
                  {pro ? ` — up to ${pro.maxCourts} courts` : ""}, and rooms
                  already open on other devices pick them up by themselves.
                </p>
              </div>
            </div>
          )}
          {purchase.status === "delayed" && (
            <div className="banner banner-warn">
              <WarningIcon size={18} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">Payment received — Pro is on its way.</p>
                <p className="mt-1 text-[0.8125rem] opacity-90">
                  It usually lands within seconds. If it hasn&rsquo;t in a
                  minute, check again — your payment is safe either way.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={purchase.verify}
                >
                  Verify purchase
                </Button>
              </div>
            </div>
          )}
          {purchase.notice && (
            <div className="banner bg-surface-2 text-ink-2">
              <span className="flex-1">{purchase.notice}</span>
              <IconButton
                aria-label="Dismiss"
                className="-my-1 size-8 border-0 bg-transparent"
                onClick={purchase.dismiss}
              >
                <CloseIcon size={16} />
              </IconButton>
            </div>
          )}
        </div>

        {purchase.error && (
          <div role="alert" className="banner banner-danger">
            <WarningIcon size={18} className="mt-0.5 shrink-0" />
            <span className="flex-1">{purchase.error}</span>
            <IconButton
              aria-label="Dismiss error"
              className="-my-1 size-8 border-0 bg-transparent"
              onClick={purchase.dismiss}
            >
              <CloseIcon size={16} />
            </IconButton>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <PlanCard
            name="Free"
            price="Free"
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
            price={purchase.price ?? "One-time"}
            priceNote={purchase.price ? "one-time" : undefined}
            blurb="For a regular organiser, or more than one club."
            limits={pro}
            features={[
              "Everything in Free",
              "Up to 6 courts at once",
              "As many players and saved rooms as you need",
            ]}
            action={action}
          />
        </div>

        {canVerify && (
          <p className="tiny text-center">
            Already paid on another device, or still waiting for Pro?{" "}
            <button
              type="button"
              onClick={purchase.verify}
              disabled={busy}
              className="inline-flex min-h-11 items-center font-semibold text-accent hover:underline disabled:opacity-60"
            >
              Verify purchase
            </button>
          </p>
        )}

        <p className="tiny text-center">
          Payments are handled by Paddle, our merchant of record. See the{" "}
          <Link href="/refunds" className="font-semibold text-accent hover:underline">
            refund policy
          </Link>
          .
        </p>

        <Link
          href="/"
          className="text-sm font-medium text-accent hover:underline"
        >
          ← Back to start
        </Link>
      </main>

      <SiteFooter />
    </div>
  );
}
