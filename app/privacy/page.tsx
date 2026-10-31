import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { CONTACT_EMAIL } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Privacy Policy | SynqIQ",
  description: "How SynqIQ collects, uses, shares, and protects information, including text messaging.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 30, 2026">
      <p>
        SynqIQ is software for fitness studios. It handles staff scheduling and substitute coverage, guest check-in, a
        sales and follow-up CRM, and reporting. It is operated by SynqIQ LLC, a Texas limited liability company
        (&quot;SynqIQ,&quot; &quot;we,&quot; or &quot;us&quot;). This page explains what information we handle, why,
        and who we share it with. We keep it short and plain on purpose. If anything here is unclear, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Who this applies to</h2>
      <p>
        SynqIQ is used by studios (our customers), their staff, and the guests and members who visit those studios.
        Studios decide who gets an account and what data is connected. For information about a studio&apos;s guests
        and members, the studio is in charge of that data and we process it on the studio&apos;s behalf, following
        its instructions. If you are a guest or member, the studio&apos;s own privacy policy also applies, and the
        studio is usually the best place to send requests about your information.
      </p>

      <h2>Information we handle</h2>
      <ul>
        <li>
          <strong>Staff accounts:</strong> name, email address, role, job title, profile photo (if provided), and a
          password, which is stored only as a secure hash by our authentication provider.
        </li>
        <li>
          <strong>Studio operations data:</strong> class schedules, instructor assignments, appointments, attendance,
          and sales records that a studio connects from its booking software.
        </li>
        <li>
          <strong>Guest and lead information:</strong> what a guest enters when checking in on a studio&apos;s kiosk,
          or what studio staff enter for them: name, email address, mobile number, date of birth, address, how they
          heard about the studio, and the member who referred them. It also includes a photo taken at check-in so
          staff can greet them, visit history, appointments, and notes staff add.
        </li>
        <li>
          <strong>Waivers:</strong> the waiver a guest signs at check-in, their signature, and for a guest under 18 the
          parent or guardian who signs for them.
        </li>
        <li>
          <strong>Consent choices:</strong> whether a guest agreed to emails and texts, when, and any later opt-out
          (for example, replying STOP).
        </li>
        <li>
          <strong>Messages:</strong> texts and emails sent between studio staff and guests or members through
          SynqIQ, and calls that staff log.
        </li>
        <li>
          <strong>Studio member information:</strong> member names, membership status, email address, and class
          attendance, as connected by the studio.
        </li>
        <li>
          <strong>Contact form:</strong> the name, studio name, email, phone, and website you submit if you ask us to
          get in touch.
        </li>
        <li>
          <strong>Push notifications:</strong> if you turn them on, a browser push subscription so we can send you
          alerts.
        </li>
        <li>
          <strong>Studio billing:</strong> the business contact and billing details for studios that subscribe to
          SynqIQ. Card and bank details are handled by our payment processor and never stored by us.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to run the service for the studio: checking guests in, keeping waivers on file, showing schedules,
        routing substitute requests, delivering the texts, emails, and notifications the studio sends, producing
        studio reports, keeping accounts secure, billing studios, and replying to people who contact us. We do not
        sell personal information, and we do not use it for advertising.
      </p>

      <h2>Text messaging (SMS)</h2>
      <p>
        Studios use SynqIQ to text guests and members who have agreed to receive texts, for example by checking the
        text-message box when they check in at the studio&apos;s kiosk. Texts come from the studio, under its name,
        and are about the guest&apos;s visit, appointments, membership, and follow-up from the studio&apos;s team.
        They may include offers from the studio.
      </p>
      <ul>
        <li>Message frequency varies.</li>
        <li>Message and data rates may apply, depending on your mobile plan.</li>
        <li>
          Reply <strong>STOP</strong> to any text to opt out. You will receive one message confirming you are opted
          out, and the studio will not be able to text you again unless you opt back in (reply <strong>START</strong>
          ).
        </li>
        <li>
          Reply <strong>HELP</strong> for help, or contact the studio directly, or email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </li>
        <li>Carriers are not liable for delayed or undelivered messages.</li>
      </ul>
      <p>
        <strong>
          We do not sell, rent, or share mobile phone numbers or text-messaging opt-in data and consent with third
          parties or affiliates for their marketing or promotional purposes.
        </strong>{" "}
        Text-messaging originator opt-in data and consent are not shared with any third parties, other than the
        messaging providers that deliver the texts for us (see Service providers below).
      </p>

      <h2>Cookies and tracking</h2>
      <p>
        We use cookies only to keep you signed in. To understand how the site is used, we use Vercel Web Analytics,
        which counts page views without cookies and without identifying you. SynqIQ does not use advertising cookies
        or advertising trackers.
      </p>

      <h2>Service providers</h2>
      <p>
        We rely on a small number of providers to host and operate SynqIQ. They only process data to provide their
        services to us:
      </p>
      <ul>
        <li>Vercel: hosting and privacy-friendly site analytics.</li>
        <li>Supabase: database, file storage (such as check-in photos and signed waivers), and sign-in.</li>
        <li>Twilio: sending and receiving text messages.</li>
        <li>Resend: sending and receiving email.</li>
        <li>Mailgun: checking that an email address can receive mail.</li>
        <li>Stripe: billing studios that subscribe to SynqIQ.</li>
      </ul>
      <p>
        Studio data is read from, and with the studio&apos;s authorization sent to, the studio&apos;s own booking
        software (for example Mindbody), such as creating a client profile there for a new guest.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        We keep data for as long as the studio uses SynqIQ. A studio can ask us to delete its data, and staff can ask
        their studio or us to remove their account. Guests and members can ask the studio, or us at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, to access, correct, or delete their information.
        Signed waivers may be kept as long as the studio needs them for its records, even after a guest is removed.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, access is limited to signed-in staff of the owning studio, and passwords are
        never stored in plain text. To report a security issue, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy we will update the date at the top of this page. Questions or requests:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
