import type { Metadata } from "next";
import { Blank, LegalPage, LegalSection } from "../components/LegalPage";
import { LEGAL } from "../lib/legal";

export const metadata: Metadata = {
  title: "Refund Policy · Badminton Queue",
};

// A draft for the owner to review (see lib/legal.ts), not legal advice. The
// second section states what the code does on a refund (Phase 3c's
// apply_paddle_event), so it must change if that does.
export default function RefundsPage() {
  return (
    <LegalPage title="Refund Policy">
      <LegalSection title="Asking for a refund">
        <p>
          If Pro isn’t right for you, ask for a refund within{" "}
          <Blank>{LEGAL.refundDays}</Blank> days of buying it and you’ll get your
          money back in full. Paddle, our reseller and the merchant of record,
          handles every refund: reply to the receipt Paddle emailed you, or
          contact Paddle through paddle.net, or write to us at{" "}
          <Blank>{LEGAL.contactEmail}</Blank> and we’ll arrange it. Your rights
          under consumer law are not affected.
        </p>
      </LegalSection>

      <LegalSection title="What happens to your account">
        <p>
          Once a full refund goes through, your account returns to the free plan
          straight away. A partial refund leaves Pro in place.
        </p>
        <p>
          Nothing is taken away mid-session. A room that already uses more than
          the free plan allows, such as a third court, keeps it until someone
          changes it, and after that it follows the free limits. The same
          applies after a chargeback.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
