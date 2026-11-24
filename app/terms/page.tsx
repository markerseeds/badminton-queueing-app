import type { Metadata } from "next";
import Link from "next/link";
import { Blank, LegalPage, LegalSection } from "../components/LegalPage";
import { LEGAL } from "../lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service · Badminton Queue",
};

// A draft for the owner to review (see lib/legal.ts), not legal advice. The
// merchant-of-record paragraph is Paddle's required wording, verbatim.
export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <LegalSection title="Who we are">
        <p>
          Badminton Queue is provided by <Blank>{LEGAL.sellerName}</Blank> (“we”,
          “us”). You can reach us at <Blank>{LEGAL.contactEmail}</Blank>.
        </p>
      </LegalSection>

      <LegalSection title="The service">
        <p>
          Badminton Queue helps organisers run club nights: it keeps a queue of
          players, picks fair groups of four for each court, and keeps every
          device in a room in sync. Anyone with a room’s link can view and edit
          it unless its owner locks it.
        </p>
        <p>
          The free plan is limited to 2 courts, 10 players per room and 2 saved
          rooms. Pro, a one-time purchase, raises those limits to 6 courts and
          unlimited players and saved rooms, as described on the{" "}
          <Link href="/pricing" className="text-accent hover:underline">
            pricing page
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="Accounts">
        <p>
          Creating a room signs you in anonymously in that browser. Signing in
          with Google keeps your rooms with your Google account. Pro belongs to
          a signed-in account, one unlock per account, and is available on any
          device where you sign in to that account. An anonymous session cannot
          hold Pro, because it can’t be recovered if the browser’s data is
          cleared.
        </p>
      </LegalSection>

      <LegalSection title="Payments">
        <p>
          Our order process is conducted by our online reseller Paddle.com.
          Paddle.com is the Merchant of Record for all our orders. Paddle
          provides all customer service inquiries and handles returns.
        </p>
        <p>
          Prices are shown in your local currency and include any sales tax or
          VAT that applies where you live. Refunds are covered by our{" "}
          <Link href="/refunds" className="text-accent hover:underline">
            refund policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>
          Don’t use the service to break the law, to harass anyone, to store
          other people’s personal data beyond what running a session needs (a
          name and a skill level), or to disrupt the service for others.
        </p>
      </LegalSection>

      <LegalSection title="Availability and liability">
        <p>
          We work to keep the service running but provide it “as is”, without a
          guarantee that it will always be available or free of errors. To the
          extent the law allows, we aren’t liable for indirect or consequential
          losses, and our total liability is limited to the amount you paid us
          in the twelve months before a claim. Nothing in these terms limits
          rights you have under consumer law that can’t be excluded.
        </p>
      </LegalSection>

      <LegalSection title="Changes and governing law">
        <p>
          We may update these terms; we’ll change the date at the top when we
          do. These terms are governed by the laws of{" "}
          <Blank>{LEGAL.country}</Blank>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
