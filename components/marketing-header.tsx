import Link from "next/link";

// Shared across the public marketing pages (/, /about, /contact) -- none of
// these render for an authenticated session (no per-org branding in
// context), so this is Synq's own fixed brand identity, not the
// per-org-customizable header used inside /dashboard.
export function MarketingHeader() {
  return (
    <header className="border-b border-zinc-200">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/icons/icon-192.png" alt="Synq" className="h-8 w-8 rounded-md" />
          <span className="text-lg font-semibold text-zinc-950">Synq</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium text-zinc-600">
          <Link href="/about" className="hover:text-zinc-950">
            About
          </Link>
          <Link href="/contact" className="hover:text-zinc-950">
            Contact
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md bg-accent px-4 py-2 text-white hover:bg-accent-hover"
          >
            Log in
          </Link>
        </nav>
      </div>
    </header>
  );
}
