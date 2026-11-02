import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing-header";
import { CONTACT_EMAIL, SiteFooter } from "@/components/site-footer";
import { provisionCheckout } from "@/lib/billing/signup";
import { getOptionalEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Welcome | SynqIQ", robots: { index: false } };
export const dynamic = "force-dynamic";

// Stripe sends the owner here after paying. Creates the studio if the
// webhook hasn't already (provisionCheckout is safe to run twice).
export default async function SignupDonePage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id: sessionId } = await searchParams;
  let state: "ready" | "pending" | "error" = "error";
  let email: string | null = null;
  if (sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    try {
      const origin = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? "https://synqiq.co";
      const result = await provisionCheckout(sessionId, `${origin}/auth/confirm`);
      if (result.status === "provisioned") {
        state = "ready";
        email = result.ownerEmail;
      } else if (result.status === "unpaid") {
        state = "pending";
      }
    } catch (error) {
      console.error("[signup/done]", error);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        {state === "ready" ? (
          <>
            <h1 className="text-3xl font-semibold text-zinc-950">You&apos;re all set.</h1>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              Thanks for signing up. We&apos;ve sent an email to <span className="font-medium text-zinc-950">{email}</span>{" "}
              with a link to set your password. Once you&apos;re in, invite your staff from Staff Logins. We&apos;ll be in
              touch to connect your Mindbody site.
            </p>
          </>
        ) : state === "pending" ? (
          <>
            <h1 className="text-3xl font-semibold text-zinc-950">Almost there.</h1>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              Your payment is still processing. You&apos;ll get an email with your login as soon as it goes through.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-semibold text-zinc-950">Something went wrong.</h1>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              We couldn&apos;t confirm your signup. If you were charged, email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary hover:underline">
                {CONTACT_EMAIL}
              </a>{" "}
              and we&apos;ll sort it out right away.
            </p>
          </>
        )}
        <Link href="/login" className="mt-8 inline-block text-sm font-medium text-primary hover:underline">
          Go to log in
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
