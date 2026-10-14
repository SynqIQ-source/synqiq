import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { CONTACT_EMAIL } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Privacy Policy | SynqIQ",
  description: "How SynqIQ collects, uses, and protects information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 14, 2026">
      <p>
        SynqIQ is a staff scheduling and substitute-coverage tool used by fitness studios. This
        page explains what information we handle, why, and who we share it with. We keep it short
        and plain on purpose. If anything here is unclear, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Who this applies to</h2>
      <p>
        SynqIQ is used by studios (our customers) and their staff. Studios decide who gets an
        account and what data is connected. For studio member information, the studio is in
        charge of that data and we process it on the studio&apos;s behalf.
      </p>

      <h2>Information we handle</h2>
      <ul>
        <li>
          <strong>Staff accounts:</strong> name, email address, role, job title, profile photo
          (if provided), and a password, which is stored only as a secure hash by our
          authentication provider.
        </li>
        <li>
          <strong>Studio operations data:</strong> class schedules, instructor assignments,
          appointments, attendance, and sales records that a studio connects from its booking
          software.
        </li>
        <li>
          <strong>Studio member data:</strong> member names, membership status, email address,
          and class attendance, as connected by the studio, plus any follow-up messages exchanged
          between staff and members through SynqIQ.
        </li>
        <li>
          <strong>In-app activity:</strong> substitute requests, volunteer responses,
          announcements, and messages created by staff.
        </li>
        <li>
          <strong>Contact form:</strong> the name, studio name, email, phone, and website you
          submit if you ask us to get in touch.
        </li>
        <li>
          <strong>Push notifications:</strong> if you turn them on, a browser push subscription
          so we can send you alerts.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to run the service: showing schedules, routing substitute requests, sending the
        emails and notifications you or your studio asked for, producing studio reports, keeping
        accounts secure, and replying to people who contact us. We do not sell personal
        information, and we do not use it for advertising.
      </p>

      <h2>Cookies and tracking</h2>
      <p>
        We use cookies only to keep you signed in. SynqIQ does not use advertising cookies or
        third-party analytics trackers.
      </p>

      <h2>Service providers</h2>
      <p>
        We rely on a small number of providers to host and operate SynqIQ: Vercel (hosting),
        Supabase (database and sign-in), and Resend (email delivery). Studio data is read from
        the studio&apos;s own booking software with the studio&apos;s authorization. These
        providers only process data to provide their services to us.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        We keep data for as long as the studio uses SynqIQ. A studio can ask us to delete its
        data, and staff can ask their studio or us to remove their account, at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, access is limited to signed-in staff of the owning studio,
        and passwords are never stored in plain text. To report a security issue, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy we will update the date at the top of this page. Questions or
        requests: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
