import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MarketingHeader } from "@/components/marketing-header";
import { CONTACT_EMAIL, SiteFooter } from "@/components/site-footer";
import { getCurrentStaff } from "@/lib/current-staff";
import { BUNDLE_PRICES, MODULES, TEXTS_INCLUDED } from "@/lib/plans";

export const metadata: Metadata = {
  title: "SynqIQ | Classes, trainers and sales for fitness studios on Mindbody",
  description:
    "SynqIQ adds what Mindbody doesn't: sub coverage and member follow-up for group classes, trainer productivity, and a sales CRM with a check-in kiosk. Pick the modules you need.",
  alternates: { canonical: "/" },
};

const STEPS = [
  {
    title: "Connect Mindbody",
    body: "Approve SynqIQ in Mindbody once. Your schedule, staff, clients, sales and appointments sync every night.",
  },
  {
    title: "Pick your modules",
    body: "Group Fitness, Trainer, Sales CRM, or any mix. Add or drop one any time, billed monthly.",
  },
  {
    title: "Invite your team",
    body: "Instructors, trainers and salespeople each see the tools for their job. Admins see everything.",
  },
];

export default async function HomePage() {
  // Signed-in staff skip the public page entirely. getCurrentStaff() is
  // React-cache()d and the root layout already resolves it for this same
  // request, so this adds no extra Supabase round trip.
  const currentStaff = await getCurrentStaff();
  if (currentStaff) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-primary uppercase">For fitness studios on Mindbody</p>
          <h1 className="mt-3 text-4xl font-semibold text-zinc-950 sm:text-5xl">
            Your classes, trainers and sales, run from one place.
          </h1>
          <p className="mt-5 text-lg leading-8 text-zinc-600">
            SynqIQ adds what your booking software doesn&apos;t: subs that get covered, members who hear from their
            instructor, trainers you can measure, and guests who get followed up. It runs on your Mindbody data, so
            there&apos;s nothing to re-enter.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center rounded-md bg-brand-accent px-5 text-sm font-medium text-white hover:bg-brand-accent-hover"
            >
              Get started
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-11 items-center rounded-md border border-zinc-200 px-5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              See pricing
            </Link>
          </div>
          <p className="mt-4 text-sm text-zinc-500">
            Already on SynqIQ?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Log in
            </Link>{" "}
            with the email your studio invited.
          </p>
        </div>

        <section className="mt-20">
          <h2 className="text-2xl font-semibold text-zinc-950">Three modules. Use one, or all three.</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {MODULES.map((module) => (
              <div key={module.key} className="flex flex-col rounded-lg border border-zinc-200 p-6">
                <h3 className="text-lg font-semibold text-zinc-950">{module.name}</h3>
                <p className="mt-1 text-sm text-zinc-600">{module.summary}</p>
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
                <p className="mt-6 text-sm text-zinc-500">
                  <span className="text-lg font-semibold text-zinc-950">${module.price}</span> / month
                </p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-zinc-600">
            Any two modules for ${BUNDLE_PRICES[2]} a month, all three for ${BUNDLE_PRICES[3]}.{" "}
            <Link href="/pricing" className="font-medium text-primary hover:underline">
              Compare plans
            </Link>
          </p>
        </section>

        <section className="mt-20 grid gap-10 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <div key={step.title}>
              <p className="text-sm font-semibold text-primary">{index + 1}</p>
              <h3 className="mt-1 text-base font-semibold text-zinc-950">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600">{step.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-20 rounded-lg border border-zinc-200 bg-zinc-50 p-8">
          <h2 className="text-xl font-semibold text-zinc-950">Built inside a working studio</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
            Every feature in SynqIQ was built for, and is used every day by, the staff of a real multi-program club:
            group fitness, personal training, a pool and a sales team. If it didn&apos;t solve a problem on the floor,
            it isn&apos;t in here.{" "}
            <Link href="/about" className="font-medium text-primary hover:underline">
              About SynqIQ
            </Link>
          </p>
        </section>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-zinc-200 pt-8 text-sm text-zinc-600">
          <p>
            Questions? Email us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary hover:underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
          <Link
            href="/signup"
            className="inline-flex h-10 items-center rounded-md bg-brand-accent px-4 text-sm font-medium text-white hover:bg-brand-accent-hover"
          >
            Get started
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
