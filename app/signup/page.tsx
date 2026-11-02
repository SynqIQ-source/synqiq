import type { Metadata } from "next";
import { MarketingHeader } from "@/components/marketing-header";
import { SiteFooter } from "@/components/site-footer";
import { STUDIO_TIMEZONES } from "@/lib/platform/studios";
import { isModuleKey, type ModuleKey } from "@/lib/plans";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Get started | SynqIQ",
  description: "Sign your studio up for SynqIQ: pick your modules and pay monthly, no contract.",
  alternates: { canonical: "/signup" },
};

// Self-serve signup: pick modules, enter the studio and owner, then pay on
// Stripe Checkout. ?modules=crm,trainer preselects from the pricing page.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ modules?: string; canceled?: string }>;
}) {
  const params = await searchParams;
  const preselected = (params.modules ?? "group_fitness").split(",").filter(isModuleKey) as ModuleKey[];
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <p className="text-sm font-semibold tracking-wide text-primary uppercase">Get started</p>
        <h1 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">Set up SynqIQ for your studio</h1>
        <p className="mt-4 text-base leading-7 text-zinc-600">
          Pick your modules and tell us about your studio. You&apos;ll pay securely with Stripe, then get an email to
          set your password. Monthly, no contract.
        </p>
        {params.canceled ? (
          <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Checkout was canceled, so nothing was charged. Your details are below if you&apos;d like to try again.
          </p>
        ) : null}
        <SignupForm timezones={[...STUDIO_TIMEZONES]} preselected={preselected.length ? preselected : ["group_fitness"]} />
      </main>
      <SiteFooter />
    </div>
  );
}
