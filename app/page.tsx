import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-16">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          Synq
        </p>
        <h1 className="mt-3 text-4xl font-semibold text-zinc-950 sm:text-5xl">
          Studio operations, ready to connect.
        </h1>
        <p className="mt-5 text-lg leading-8 text-zinc-600">
          A production-ready Next.js foundation for Mindbody-connected class,
          instructor, and substitution workflows.
        </p>
        <Link
          href="/dashboard"
          className="mt-8 inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-medium text-white hover:bg-primary-hover"
        >
          Open dashboard
        </Link>
      </div>
    </main>
  );
}
