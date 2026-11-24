import type { Metadata } from "next";
import { Blank, LegalPage, LegalSection } from "../components/LegalPage";
import { LEGAL } from "../lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy · Badminton Queue",
};

// A draft for the owner to review (see lib/legal.ts), not legal advice. It
// describes what the code actually stores and sends — keep it that way: a
// privacy policy that has drifted from the schema is worse than a short one.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <LegalSection title="Who is responsible">
        <p>
          <Blank>{LEGAL.sellerName}</Blank> is responsible for the personal data
          Badminton Queue handles. Questions and requests:{" "}
          <Blank>{LEGAL.contactEmail}</Blank>.
        </p>
      </LegalSection>

      <LegalSection title="What we store">
        <ul className="list-disc pl-5">
          <li>
            <b>Rooms</b>: the room’s code, its optional name, the court count,
            and the players an organiser adds, each as a name and a skill level
            with a count of games played. Anyone with a room’s link can see it.
          </li>
          <li>
            <b>Accounts</b>: creating a room creates an anonymous account kept in
            your browser’s storage. If you sign in with Google we receive your
            email address and Google account identifier.
          </li>
          <li>
            <b>Purchases</b>: if you buy Pro, we keep a record of the
            transaction (Paddle’s transaction and customer ids, the price, the
            amount and currency, and its status, including any refund). We never
            see or store your card details.
          </li>
        </ul>
        <p>
          We don’t use advertising or analytics trackers. The only things kept
          in your browser are your sign-in session and, briefly during sign-in,
          a note of where to return you.
        </p>
      </LegalSection>

      <LegalSection title="Who processes it for us">
        <ul className="list-disc pl-5">
          <li>
            <b>Supabase</b> hosts the database and sign-in, and runs our payment
            functions.
          </li>
          <li>
            <b>Vercel</b> hosts the website.
          </li>
          <li>
            <b>Paddle</b> processes payments as the merchant of record and
            receives what checkout needs, such as your email, country and
            payment details, under its own privacy policy. The checkout and
            price display are loaded from Paddle.
          </li>
          <li>
            <b>Sentry</b> receives error reports from our payment functions,
            which can include transaction and event identifiers.
          </li>
          <li>
            <b>Google</b>, if you choose to sign in with it.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          Rooms and players stay until their owner deletes them. Purchase
          records are kept even if you delete your account, because they are
          what a refund, a chargeback or a tax question is answered from.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          You can ask us for a copy of your data, to correct it, or to delete
          your account, by writing to <Blank>{LEGAL.contactEmail}</Blank>.
          Depending on where you live, you may also have the right to complain
          to your data protection authority.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
