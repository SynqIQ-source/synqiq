import Link from "next/link";

export const CONTACT_EMAIL = "info@synqiq.co";

// Shared footer for every public page -- marketing (/, /about, /contact,
// /privacy, /terms) and pre-auth (/login, /forgot-password,
// /reset-password). Visible legal links + a real contact address on the
// pages in front of the login form are part of what lets security
// scanners (and people) tell this apart from a phishing-kit page.
export function SiteFooter() {
  return (
    <footer className="w-full border-t border-zinc-200">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-6 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <p>
          &copy; {new Date().getFullYear()} SynqIQ &middot;{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-zinc-950">
            {CONTACT_EMAIL}
          </a>
        </p>
        <nav className="flex items-center gap-5">
          <Link href="/privacy" className="hover:text-zinc-950">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-zinc-950">
            Terms
          </Link>
          <Link href="/contact" className="hover:text-zinc-950">
            Contact
          </Link>
        </nav>
      </div>
    </footer>
  );
}
