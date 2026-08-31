import Link from "next/link";
import { MarketingHeader } from "@/components/marketing-header";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            SynqIQ
          </p>
          <h1 className="mt-3 text-4xl font-semibold text-zinc-950 sm:text-5xl">
            Your studio&apos;s staff, finally in sync.
          </h1>
          <p className="mt-5 text-lg leading-8 text-zinc-600">
            Substitutions, scheduling, and instructor analytics — built on your
            Mindbody data.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/dashboard"
              className="inline-flex h-11 items-center rounded-md bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Open dashboard
            </Link>
            <Link
              href="/about"
              className="inline-flex h-11 items-center rounded-md border border-zinc-200 px-5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Learn more
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
