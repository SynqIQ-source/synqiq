"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { OnlineItem } from "@/lib/online/buy";

type Agreement = { lineIndex: number; title: string; body: string; sha256: string };
type Quote = { buyerName: string; totalCents: number; recurring: boolean; agreements: Agreement[] };
type Session = {
  paymentId: string;
  clientSecret: string;
  publishableKey: string;
  stripeAccountId: string;
  amountCents: number;
  practice: boolean;
};

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const input = "h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base outline-none focus:border-neutral-500";

async function call(body: Record<string, unknown>) {
  const response = await fetch("/api/member/buy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    success?: boolean;
    error?: string;
    signIn?: boolean;
  };
  if (!response.ok || !json.success)
    throw Object.assign(new Error(json.error ?? "Something went wrong."), { signIn: json.signIn === true });
  return json;
}

// Checkout for one item: who it's for -> review and sign -> pay (Stripe's
// Payment Element on the studio's account) -> done. Big touch targets so it
// also works on an iPad at the front desk.
export function BuyFlow({
  studio,
  color,
  item,
  memberName,
  signInHref,
  doneHref,
}: {
  studio: number;
  color: string;
  item: OnlineItem;
  memberName: string | null;
  signInHref: string;
  doneHref: string;
}) {
  const [buyer, setBuyer] = useState({ firstName: "", lastName: "", email: "", phone: "", emailConsent: false });
  const [billingStart, setBillingStart] = useState<"signup" | "prorated">("signup");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [done, setDone] = useState<{ saleNumber: number; practice: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; signIn: boolean } | null>(null);
  const base = { studio, itemId: item.id, billingStart, buyer: memberName ? undefined : buyer };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (problem) {
      setError({
        text: problem instanceof Error ? problem.message : "Something went wrong.",
        signIn: Boolean((problem as { signIn?: boolean }).signIn),
      });
    } finally {
      setBusy(false);
    }
  };
  const button = "h-12 w-full rounded-xl text-base font-semibold text-white disabled:opacity-50";

  if (done)
    return (
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
        <p className="text-4xl">🎉</p>
        <h2 className="mt-2 text-2xl font-semibold">You&apos;re all set!</h2>
        <p className="mt-2 text-neutral-600">
          {item.name} is on {quote?.buyerName ? `${quote.buyerName}'s` : "your"} account. Receipt #{done.saleNumber}.
        </p>
        {done.practice ? <p className="mt-2 text-sm text-amber-700">Test mode: no real card was charged.</p> : null}
        <Link href={doneHref} className={`${button} mt-6 inline-flex items-center justify-center`} style={{ background: color }}>
          Done
        </Link>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">{item.name}</h2>
        <p className="text-neutral-600">
          {money(item.priceCents)}
          {item.monthly ? " / month" : ""} before tax
        </p>
      </div>

      {!quote ? (
        <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
          {memberName ? (
            <p>
              For <strong>{memberName}</strong>
            </p>
          ) : (
            <>
              <p className="text-sm text-neutral-600">
                Already a member or been here before?{" "}
                <Link href={signInHref} className="font-semibold underline">
                  Sign in
                </Link>{" "}
                so it goes on your account. New? Enter your details.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <input
                  className={input}
                  placeholder="First name"
                  autoComplete="given-name"
                  value={buyer.firstName}
                  onChange={(e) => setBuyer({ ...buyer, firstName: e.target.value })}
                />
                <input
                  className={input}
                  placeholder="Last name"
                  autoComplete="family-name"
                  value={buyer.lastName}
                  onChange={(e) => setBuyer({ ...buyer, lastName: e.target.value })}
                />
              </div>
              <input
                className={input}
                type="email"
                placeholder="Email"
                autoComplete="email"
                value={buyer.email}
                onChange={(e) => setBuyer({ ...buyer, email: e.target.value })}
              />
              <input
                className={input}
                type="tel"
                placeholder="Mobile number"
                autoComplete="tel"
                value={buyer.phone}
                onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })}
              />
              <label className="flex items-start gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={buyer.emailConsent}
                  onChange={(e) => setBuyer({ ...buyer, emailConsent: e.target.checked })}
                />
                Send me news and offers by email (optional)
              </label>
            </>
          )}
          {item.monthly ? (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">Monthly billing</legend>
              {[
                { value: "signup" as const, label: "Bill on the same day each month as today" },
                { value: "prorated" as const, label: "Pay for the rest of this month now, then bill on the 1st" },
              ].map((option) => (
                <label key={option.value} className="flex items-center gap-2 rounded-xl border p-3 text-sm">
                  <input
                    type="radio"
                    name="billing"
                    checked={billingStart === option.value}
                    onChange={() => setBillingStart(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          ) : null}
          <button
            type="button"
            className={button}
            style={{ background: color }}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = (await call({ ...base, action: "quote" })) as unknown as Quote;
                setQuote(result);
                setSignerName(result.buyerName);
              })
            }
          >
            {busy ? "One moment…" : "Continue"}
          </button>
        </div>
      ) : !session ? (
        <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-neutral-600">For {quote.buyerName}</span>
            <button type="button" className="text-sm underline" onClick={() => setQuote(null)}>
              Change
            </button>
          </div>
          <p className="text-lg">
            Total today: <strong>{money(quote.totalCents)}</strong>
          </p>
          {quote.recurring ? (
            <p className="text-sm text-neutral-600">
              {billingStart === "prorated" ? "Then billed on the 1st of each month." : "Then billed on this day each month."} The card you
              use is saved for your monthly payments.
            </p>
          ) : null}
          {quote.agreements.map((agreement) => (
            <div key={agreement.lineIndex} className="space-y-2">
              <h3 className="font-semibold">{agreement.title}</h3>
              <div className="max-h-64 overflow-y-auto rounded-xl border bg-neutral-50 p-3 text-sm whitespace-pre-wrap">
                {agreement.body}
              </div>
            </div>
          ))}
          {quote.agreements.length ? (
            <>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />I have read
                and agree to the {quote.agreements.map((agreement) => agreement.title).join(" and ")}.
              </label>
              <input
                className={input}
                placeholder="Type your full name to sign"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
              />
            </>
          ) : null}
          <button
            type="button"
            className={button}
            style={{ background: color }}
            disabled={busy || (quote.agreements.length > 0 && (!agreed || signerName.trim().length < 2))}
            onClick={() =>
              run(async () => {
                const result = (await call({
                  ...base,
                  action: "pay",
                  signerName,
                  agreements: quote.agreements.map((agreement) => ({ lineIndex: agreement.lineIndex, sha256: agreement.sha256, agreed })),
                })) as unknown as Session;
                setSession(result);
              })
            }
          >
            {busy ? "One moment…" : quote.agreements.length ? "Sign and continue to payment" : "Continue to payment"}
          </button>
        </div>
      ) : (
        <PaySection
          session={session}
          color={color}
          onPaid={async () => {
            for (let attempt = 0; attempt < 5; attempt++) {
              try {
                const result = (await call({ studio, action: "finish", paymentId: session.paymentId })) as unknown as {
                  saleNumber: number;
                  practice: boolean;
                };
                setDone(result);
                return;
              } catch (problem) {
                if (attempt === 4) throw problem;
                await new Promise((resolve) => setTimeout(resolve, 1500));
              }
            }
          }}
        />
      )}

      {error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error.text}{" "}
          {error.signIn ? (
            <Link href={signInHref} className="font-semibold underline">
              Sign in
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function PaySection({ session, color, onPaid }: { session: Session; color: string; onPaid: () => Promise<void> }) {
  const stripePromise = useMemo(
    () => loadStripe(session.publishableKey, { stripeAccount: session.stripeAccountId }),
    [session.publishableKey, session.stripeAccountId],
  );
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      {session.practice ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Test mode: use a Stripe test card.</p>
      ) : null}
      <Elements stripe={stripePromise} options={{ clientSecret: session.clientSecret, appearance: { theme: "stripe" } }}>
        <PayForm amountCents={session.amountCents} color={color} onPaid={onPaid} />
      </Elements>
    </div>
  );
}

function PayForm({ amountCents, color, onPaid }: { amountCents: number; color: string; onPaid: () => Promise<void> }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [charged, setCharged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        className="h-12 w-full rounded-xl text-base font-semibold text-white disabled:opacity-50"
        style={{ background: color }}
        disabled={!stripe || busy || charged}
        onClick={async () => {
          if (!stripe || !elements) return;
          setBusy(true);
          setError(null);
          const { error: stripeError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
          if (stripeError || (paymentIntent && paymentIntent.status !== "succeeded" && paymentIntent.status !== "processing")) {
            setBusy(false);
            setError(stripeError?.message ?? "The card wasn't charged. Try again or use another card.");
            return;
          }
          setCharged(true);
          try {
            await onPaid();
          } catch {
            setError("Your payment went through, but we couldn't finish saving it. Please show this screen at the front desk.");
          }
          setBusy(false);
        }}
      >
        {busy ? "Paying…" : `Pay ${money(amountCents)}`}
      </button>
    </div>
  );
}
