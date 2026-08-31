import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing-header";
import { LeadForm } from "./lead-form";

export const metadata: Metadata = {
  title: "Contact | SynqIQ",
  description: "Interested in SynqIQ for your studio? Tell us a bit about it.",
};

export default function ContactPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <p className="text-sm font-semibold uppercase tracking-wide text-gold">Contact</p>
        <h1 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
          Interested in SynqIQ for your studio?
        </h1>
        <p className="mt-5 text-lg leading-8 text-zinc-600">
          We&apos;re building SynqIQ slowly and with intention. Rather than opening to everyone at
          once, we&apos;re working closely with a small number of studios at a time to make sure
          the platform actually fits how you operate. Tell us a bit about your studio below, and
          we&apos;ll follow up if it looks like a good fit.
        </p>

        <div className="mt-10 rounded-lg border border-zinc-200 bg-white p-6 sm:p-8">
          <LeadForm />
        </div>
      </main>
    </div>
  );
}
