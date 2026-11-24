import Link from "next/link";

// Paddle's site review wants the terms, privacy policy and refund policy one
// click away from anywhere a purchase can start, so this sits on the landing
// page, the pricing page and the legal pages themselves. Not in a room: the
// courtside screen has no room to spare and nothing to buy.
//
// Each link is a 44px target like every other control (--bq-touch); a footer
// link is still something a thumb has to hit.
const LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds" },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line pt-2">
      <nav aria-label="Site" className="flex flex-wrap items-center justify-center gap-x-2">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="inline-flex min-h-11 items-center px-2 text-[0.8125rem] text-ink-2 hover:text-ink hover:underline"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
