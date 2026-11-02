import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing-header";
import { SiteFooter } from "@/components/site-footer";
import { BUNDLE_PRICES, MODULES, TEXT_OVERAGE, TEXTS_INCLUDED } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Pricing | SynqIQ",
  description:
    "Pick the SynqIQ modules your studio needs: Group Fitness, Trainer and Sales CRM. Monthly, per location, no annual contract.",
  alternates: { canonical: "/pricing" },
};

const dollars = (amount: number) => `$${amount.toLocaleString("en-US")}`;

// Public pricing: three modules a la carte, with a price for any two and
// for all three. Figures come from lib/plans.ts, the same numbers the
// Studios page bills from.
export default function PricingPage() {
  const separately = MODULES.reduce((sum, module) => sum + module.price, 0);
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-primary uppercase">Pricing</p>
          <h1 className="mt-3 text-4xl font-semibold text-zinc-950 sm:text-5xl">Pay for the parts you use.</h1>
          <p className="mt-5 text-lg leading-8 text-zinc-600">
            SynqIQ comes in three modules. Start with one, add the others when you need them. Monthly, per location,
            no annual contract. Works with Mindbody.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {MODULES.map((module) => (
            <div key={module.key} className="flex flex-col rounded-lg border border-zinc-200 p-6">
              <h2 className="text-lg font-semibold text-zinc-950">{module.name}</h2>
              <p className="mt-1 text-sm text-zinc-600">{module.summary}</p>
              <p className="mt-5">
                <span className="text-4xl font-semibold text-zinc-950">{dollars(module.price)}</span>
                <span className="text-sm text-zinc-500"> / month</span>
              </p>
              <Link
                href={`/signup?modules=${module.key}`}
                className="mt-5 inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                Get started
              </Link>
              <ul className="mt-5 flex-1 space-y-2 text-sm text-zinc-700">
                {module.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    {feature}
                  </li>
                ))}
                {module.key === "crm" ? (
                  <li className="flex gap-2">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    {TEXTS_INCLUDED.toLocaleString("en-US")} texts a month included
                  </li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-6">
            <h2 className="text-lg font-semibold text-zinc-950">Any two modules</h2>
            <p className="mt-3">
              <span className="text-4xl font-semibold text-zinc-950">{dollars(BUNDLE_PRICES[2])}</span>
              <span className="text-sm text-zinc-500"> / month</span>
            </p>
            <p className="mt-3 text-sm text-zinc-600">Mix and match, for example Group Fitness and the Sales CRM.</p>
          </div>
          <div className="rounded-lg border-2 border-primary bg-primary/5 p-6">
            <h2 className="text-lg font-semibold text-zinc-950">All three</h2>
            <p className="mt-3">
              <span className="text-4xl font-semibold text-zinc-950">{dollars(BUNDLE_PRICES[3])}</span>
              <span className="text-sm text-zinc-500"> / month</span>
            </p>
            <p className="mt-3 text-sm text-zinc-600">
              Everything SynqIQ does, {dollars(separately - BUNDLE_PRICES[3])} less than buying each module separately.
            </p>
            <Link
              href="/signup?modules=group_fitness,trainer,crm"
              className="mt-5 inline-flex h-10 items-center rounded-md bg-brand-accent px-4 text-sm font-medium text-white hover:bg-brand-accent-hover"
            >
              Get all three
            </Link>
          </div>
        </div>

        <div className="mt-12 grid gap-8 border-t border-zinc-200 pt-10 text-sm leading-6 text-zinc-600 md:grid-cols-3">
          <div>
            <h3 className="font-semibold text-zinc-950">Per location</h3>
            <p className="mt-2">Prices are per studio location. Running several? Talk to us about multi-location pricing.</p>
          </div>
          <div>
            <h3 className="font-semibold text-zinc-950">Texting</h3>
            <p className="mt-2">
              The Sales CRM includes {TEXTS_INCLUDED.toLocaleString("en-US")} texts a month. Beyond that, texts are{" "}
              {Math.round(TEXT_OVERAGE * 100)}¢ each.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-zinc-950">No contract</h3>
            <p className="mt-2">Billed monthly. Add or remove a module any time; changes apply from your next bill.</p>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link
            href="/signup"
            className="inline-flex h-11 items-center rounded-md bg-brand-accent px-5 text-sm font-medium text-white hover:bg-brand-accent-hover"
          >
            Get started
          </Link>
          <Link
            href="/contact"
            className="inline-flex h-11 items-center rounded-md border border-zinc-200 px-5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Talk to us
          </Link>
          <p className="text-sm text-zinc-500">We&apos;ll help you connect Mindbody after you sign up.</p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
