import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";
import { CONTACT_EMAIL } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Terms of Service | SynqIQ",
  description: "The terms for using SynqIQ.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="October 14, 2026">
      <p>
        These terms are an agreement between you and SynqIQ LLC (&quot;SynqIQ,&quot;
        &quot;we,&quot; or &quot;us&quot;) and cover your use of SynqIQ, a staff scheduling and
        substitute-coverage tool for fitness studios. By using SynqIQ you agree to them. If your studio has a separate written
        agreement with us, that agreement takes priority where the two differ.
      </p>

      <h2>Accounts</h2>
      <p>
        Accounts are created by your studio. Keep your password private and do not share your
        account. You are responsible for what happens under your account. Tell your studio or
        us right away if you think someone else has accessed it.
      </p>

      <h2>Acceptable use</h2>
      <p>Use SynqIQ only for your studio&apos;s legitimate operations. Do not:</p>
      <ul>
        <li>try to access data or accounts you are not authorized to use;</li>
        <li>interfere with, overload, or try to break the service or its security;</li>
        <li>use the messaging features to send spam or harassing content.</li>
      </ul>

      <h2>Your data</h2>
      <p>
        Studios own the data they bring into SynqIQ. We use it only to provide the service, as
        described in our <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep SynqIQ running reliably, but the service is provided &quot;as is&quot;
        without guarantees of uninterrupted availability. Schedules and data shown in SynqIQ come
        partly from your studio&apos;s booking software, so confirm critical details there.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent allowed by law, SynqIQ is not liable for indirect or consequential losses
        arising from use of the service.
      </p>

      <h2>Ending use</h2>
      <p>
        Your studio can stop using SynqIQ at any time. We may suspend accounts that break these
        terms.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Texas, without regard to its
        conflict-of-law rules.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If we update these terms we will change the date at the top of this page. Questions:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
