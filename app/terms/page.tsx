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
    <LegalPage title="Terms of Service" updated="October 30, 2026">
      <p>
        These terms are an agreement between you and SynqIQ LLC, a Texas limited liability company (&quot;SynqIQ,&quot;
        &quot;we,&quot; or &quot;us&quot;). They cover your use of SynqIQ, software for fitness studios that handles
        staff scheduling and substitute coverage, guest check-in, a sales and follow-up CRM with texting and email, and
        reporting. &quot;Studio&quot; means the business that subscribes to SynqIQ; &quot;you&quot; means the studio
        and the staff it gives accounts to. By using SynqIQ you agree to these terms. If your studio has a separate
        written agreement with us, that agreement takes priority where the two differ.
      </p>

      <h2>Accounts</h2>
      <p>
        Accounts are created by your studio. Keep your password private and do not share your account. You are
        responsible for what happens under your account. Tell your studio or us right away if you think someone else
        has accessed it. The studio is responsible for who it gives access to and for removing staff who leave.
      </p>

      <h2>Acceptable use</h2>
      <p>Use SynqIQ only for your studio&apos;s legitimate operations. Do not:</p>
      <ul>
        <li>try to access data or accounts you are not authorized to use;</li>
        <li>interfere with, overload, or try to break the service or its security;</li>
        <li>use the messaging features to send spam, harassing, misleading, or unlawful content;</li>
        <li>upload content you do not have the right to use.</li>
      </ul>

      <h2>Texting and email</h2>
      <p>
        Texts and emails a studio sends through SynqIQ are sent by the studio, under its name. The studio is
        responsible for them and agrees to:
      </p>
      <ul>
        <li>
          text only people who have given the consent the law requires (for example, by checking the text-message box
          at check-in), and keep that consent on record in SynqIQ;
        </li>
        <li>
          honor opt-outs right away. SynqIQ blocks texts to anyone who replies STOP, and the studio must not try to
          work around that;
        </li>
        <li>
          follow the laws and carrier rules that apply to texting and calling, including the Telephone Consumer
          Protection Act, the CAN-SPAM Act, and wireless carrier messaging guidelines, and send only content those
          rules allow;
        </li>
        <li>
          give us accurate business information for registering the studio&apos;s texting with mobile carriers, and
          keep its own website&apos;s privacy policy and texting terms current.
        </li>
      </ul>
      <p>
        We may pause a studio&apos;s texting if a carrier or messaging provider requires it, or if we reasonably believe
        texts are being sent without consent. Delivery of texts and emails depends on carriers and providers and is not
        guaranteed.
      </p>

      <h2>Guest check-in and waivers</h2>
      <p>
        The studio decides what its kiosk asks and writes the waiver guests sign. The studio is responsible for the
        waiver&apos;s wording and for whether it fits the studio&apos;s needs and the law. SynqIQ stores the signed
        copy and the details of when and how it was signed, but does not give legal advice. Guests who check in have
        their relationship with the studio, not with SynqIQ.
      </p>

      <h2>Your data</h2>
      <p>
        Studios own the data they bring into SynqIQ, including their guests&apos; and members&apos; information. We use
        it only to provide the service, as described in our <Link href="/privacy">Privacy Policy</Link>. The studio is
        responsible for having the right to collect that information and to connect it to SynqIQ, and for answering its
        guests&apos; and members&apos; privacy requests. We will help where we can.
      </p>

      <h2>Connected services</h2>
      <p>
        SynqIQ works with services the studio uses or that we use to run SynqIQ, such as the studio&apos;s booking
        software (for example Mindbody) and our messaging and payment providers. Those services have their own terms,
        and we are not responsible for their outages, changes, or the accuracy of data they provide. Schedules and data
        shown in SynqIQ come partly from the studio&apos;s booking software, so confirm critical details there.
      </p>

      <h2>Fees and billing</h2>
      <p>
        Studios pay the subscription fees for the plan they choose, billed monthly in advance unless agreed otherwise,
        plus any applicable taxes. Invoices are handled by our payment processor. If an invoice goes unpaid, we may
        suspend the account after giving notice. We may change prices with at least 30 days&apos; notice, effective at
        the next billing period. Fees already paid are not refunded, except where the law requires.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep SynqIQ running reliably, but the service is provided &quot;as is&quot; and &quot;as
        available,&quot; without warranties of any kind and without guarantees of uninterrupted availability, to the
        extent the law allows.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent allowed by law, SynqIQ is not liable for indirect, incidental, special, or consequential losses,
        or for lost profits or data, arising from use of the service. Our total liability for any claim is limited to
        the fees the studio paid us in the 12 months before the claim.
      </p>

      <h2>Indemnity</h2>
      <p>
        The studio will cover SynqIQ&apos;s reasonable losses and costs from third-party claims arising from the
        studio&apos;s texts, emails, or calls, its waivers, or the data it collects and connects, except to the extent
        the claim is caused by SynqIQ&apos;s own breach of these terms.
      </p>

      <h2>Ending use</h2>
      <p>
        Your studio can stop using SynqIQ at the end of any billing period. We may suspend or close accounts that break
        these terms. When a studio leaves, it can ask us for an export of its data within 30 days, after which we may
        delete it.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Texas, without regard to its conflict-of-law rules.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If we update these terms we will change the date at the top of this page, and tell studios about important
        changes. Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
