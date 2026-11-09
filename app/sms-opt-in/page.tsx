import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { CONTACT_EMAIL } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Text Message Opt-In | SynqIQ",
  description: "How guests opt in to text messages from their studio when they check in on a SynqIQ kiosk.",
  alternates: { canonical: "/sms-opt-in" },
};

// Public record of the SMS opt-in a guest sees on the check-in kiosk, for
// carrier (A2P 10DLC) review: the kiosk itself sits behind device pairing.
// Keep the checkbox wording in sync with the "consent" step in
// app/kiosk/kiosk-flow.tsx.
const EXAMPLE_STUDIO = "The Preserve";

export default function SmsOptInPage() {
  return (
    <LegalPage title="Text message opt-in" updated="November 8, 2026">
      <p>
        Studios that use SynqIQ text guests and members only after they opt in. The main way guests opt in is the
        check-in kiosk: an iPad at the studio&apos;s front desk, running SynqIQ, where every new guest enters their
        name, email address and mobile number and signs the studio&apos;s waiver. This page shows exactly what the
        guest sees, using {EXAMPLE_STUDIO} (Houston, TX) as the example. The studio&apos;s name appears in place of{" "}
        {EXAMPLE_STUDIO} for other studios.
      </p>

      <h2>The opt-in step on the kiosk</h2>
      <p>
        After entering their details, the guest reaches a &quot;Staying in touch&quot; step with two optional
        checkboxes. Both start <strong>unchecked</strong>. Checking either one is not required to check in, use the
        studio, or buy anything.
      </p>

      <figure className="not-prose rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-2xl font-semibold tracking-tight text-zinc-950">Staying in touch</p>
        <div className="mt-4 space-y-3">
          <div className="flex items-start gap-4 rounded-xl border-2 px-5 py-4 text-zinc-900">
            <span aria-hidden className="mt-1 size-5 shrink-0 rounded border-2 border-zinc-400" />
            <span>Email me news and offers from {EXAMPLE_STUDIO}.</span>
          </div>
          <div className="flex items-start gap-4 rounded-xl border-2 px-5 py-4 text-zinc-900">
            <span aria-hidden className="mt-1 size-5 shrink-0 rounded border-2 border-zinc-400" />
            <span>
              Text me from {EXAMPLE_STUDIO} about my visit, appointments and membership, including offers. Not
              required to buy anything. Message frequency varies. Message and data rates may apply. Reply HELP for help
              or STOP to opt out.
            </span>
          </div>
          <p className="px-1 text-sm text-zinc-500">
            Terms: synqiq.co/terms · Privacy: synqiq.co/privacy. We never share your mobile number or text consent with
            third parties for marketing.
          </p>
        </div>
        <div className="mt-4 rounded-lg bg-zinc-900 py-3 text-center font-medium text-white">Continue</div>
        <figcaption className="mt-4 text-sm text-zinc-500">
          The kiosk&apos;s &quot;Staying in touch&quot; step as a guest sees it, with both boxes unchecked.
        </figcaption>
      </figure>

      <h2>What happens after opting in</h2>
      <ul>
        <li>
          Only guests who check the text box are texted. The date and time they opted in is saved with their record.
        </li>
        <li>
          Texts come from the studio under its own name. They cover the guest&apos;s visit, appointments, membership,
          follow-up from the studio&apos;s team, and occasional offers.
        </li>
        <li>Message frequency varies. Message and data rates may apply.</li>
        <li>
          Reply <strong>STOP</strong> at any time to opt out (one confirmation is sent, then no more texts), or{" "}
          <strong>HELP</strong> for help. Reply <strong>START</strong> to opt back in.
        </li>
        <li>
          Texts the studio starts are only sent between 8 AM and 9 PM in the studio&apos;s time zone (replies to a text
          the guest just sent may go out from 6 AM).
        </li>
      </ul>

      <h2>Example messages</h2>
      <ul>
        <li>
          &quot;Hi Jane, it&apos;s Roy from {EXAMPLE_STUDIO}. Great meeting you today! Want to book a session with one
          of our trainers this week? Reply STOP to opt out.&quot;
        </li>
        <li>
          &quot;Hi Jane, reminder from {EXAMPLE_STUDIO}: your tour is tomorrow at 6:00 PM. Reply here if you need to
          reschedule. Reply STOP to opt out.&quot;
        </li>
      </ul>

      <h2>Policies</h2>
      <p>
        Mobile numbers and text-message opt-in data are never sold or shared with third parties for marketing. See the{" "}
        <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms of Service</Link>. Questions:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
