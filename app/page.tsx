import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MarketingHeader } from "@/components/marketing-header";
import { CONTACT_EMAIL, SiteFooter } from "@/components/site-footer";
import { getCurrentStaff } from "@/lib/current-staff";

export const metadata: Metadata = {
  title: "SynqIQ | Staff scheduling and substitute coverage for fitness studios",
  description:
    "SynqIQ helps fitness studios manage instructor schedules, route substitute requests to qualified instructors, and keep classes covered.",
  alternates: { canonical: "/" },
};

const FEATURES = [
  {
    title: "Substitute coverage",
    body: "Instructors post a sub request and it goes to the people actually qualified to teach that class. Managers see who volunteered and approve in one place.",
  },
  {
    title: "Staff scheduling",
    body: "One view of every class, every instructor, and every gap in the schedule, kept in sync with your studio's booking system.",
  },
  {
    title: "Instructor insights",
    body: "Fill rates, attendance trends, and class performance so you can see what's working on the schedule.",
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
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            SynqIQ
          </p>
          <h1 className="mt-3 text-4xl font-semibold text-zinc-950 sm:text-5xl">
            Staff scheduling and substitute coverage for fitness studios.
          </h1>
          <p className="mt-5 text-lg leading-8 text-zinc-600">
            SynqIQ is an operations tool for boutique fitness studios. It keeps your
            instructor schedule organized, gets open classes covered by qualified subs, and
            gives managers a clear view of how classes are performing.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/login"
              className="inline-flex h-11 items-center rounded-md bg-brand-accent px-5 text-sm font-medium text-white hover:bg-brand-accent-hover"
            >
              Log in
            </Link>
            <Link
              href="/contact"
              className="inline-flex h-11 items-center rounded-md border border-zinc-200 px-5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Talk to us
            </Link>
          </div>
          <p className="mt-4 text-sm text-zinc-500">
            Staff accounts are created by your studio. Log in with the email address your
            studio invited.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-lg border border-zinc-200 p-6">
              <h2 className="text-base font-semibold text-zinc-950">{feature.title}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600">{feature.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 border-t border-zinc-200 pt-8 text-sm text-zinc-600">
          Questions? Email us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
