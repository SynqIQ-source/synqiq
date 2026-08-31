import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing-header";

export const metadata: Metadata = {
  title: "About | SynqIQ",
  description: "Built by someone who's run the floor, not just the dashboard.",
};

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <p className="text-sm font-semibold uppercase tracking-wide text-gold">About SynqIQ</p>
        <h1 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
          Built by someone who&apos;s run the floor, not just the dashboard.
        </h1>

        <div className="mt-8 space-y-6 text-lg leading-8 text-zinc-600">
          <p>
            SynqIQ started with a simple frustration: managing instructor substitutions,
            schedules, and performance across a boutique fitness studio shouldn&apos;t mean
            juggling group texts, spreadsheets, and a half-dozen tools that don&apos;t talk to
            each other.
          </p>
          <p>
            We built SynqIQ on top of Mindbody — not to replace it, but to give studios the
            staffing and analytics layer it was never designed to provide. Substitution requests
            that actually route to the right qualified instructor. Fill-rate and heat-map data
            that shows you where your programming is working. Instructor performance and trainer
            health metrics pulled directly from real class and appointment data — not guesswork.
          </p>
          <p>
            SynqIQ is built and tested inside a real, operating studio, not designed in a vacuum.
            Every feature exists because it solved a real problem for real staff, first.
          </p>
          <p>
            We&apos;re a small team building deliberately — not chasing every studio at once, but
            getting this right for the ones we work with.
          </p>
        </div>

        <div className="mt-12 border-t border-zinc-200 pt-8">
          <Link
            href="/contact"
            className="inline-flex h-11 items-center rounded-md bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Get in touch
          </Link>
        </div>
      </main>
    </div>
  );
}
