"use client";

import { useState } from "react";
import Link from "next/link";
import { listPrice, MODULES, TEXTS_INCLUDED, type ModuleKey } from "@/lib/plans";

const FIELD =
  "mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-950 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

// The signup form: modules (with the running price), studio, owner, terms.
// Submitting sends the browser to Stripe Checkout.
export function SignupForm({
  timezones,
  preselected,
}: {
  timezones: { value: string; label: string }[];
  preselected: ModuleKey[];
}) {
  const [modules, setModules] = useState<ModuleKey[]>(preselected);
  const [form, setForm] = useState({ name: "", timezone: "America/Chicago", mindbodySiteId: "", firstName: "", lastName: "", email: "" });
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const price = listPrice(modules);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          timezone: form.timezone,
          mindbodySiteId: form.mindbodySiteId,
          modules,
          owner: { firstName: form.firstName, lastName: form.lastName, email: form.email },
          acceptTerms: accept,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Couldn't start the signup.");
      window.location.href = result.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the signup.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-10 space-y-8">
      <fieldset>
        <legend className="text-sm font-semibold text-zinc-950">Modules</legend>
        <div className="mt-3 space-y-2">
          {MODULES.map((module) => (
            <label
              key={module.key}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={modules.includes(module.key)}
                onChange={(event) =>
                  setModules((current) =>
                    event.target.checked ? [...current, module.key] : current.filter((key) => key !== module.key),
                  )
                }
              />
              <span className="flex-1">
                <span className="flex justify-between gap-3 text-sm font-medium text-zinc-950">
                  {module.name}
                  <span className="text-zinc-500">${module.price}/mo</span>
                </span>
                <span className="mt-0.5 block text-sm text-zinc-600">
                  {module.summary}
                  {module.key === "crm" ? ` ${TEXTS_INCLUDED.toLocaleString("en-US")} texts a month included.` : ""}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-sm text-zinc-700">
          {modules.length === 0 ? (
            "Pick at least one module."
          ) : (
            <>
              Your plan: <span className="font-semibold text-zinc-950">${price}/month</span>
              {modules.length > 1 ? ` (${modules.length === 2 ? "any two" : "all three"} price)` : ""}, plus sales tax
              where it applies.
            </>
          )}
        </p>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold text-zinc-950">Studio</legend>
        <label className="text-sm text-zinc-700 sm:col-span-2">
          Studio name
          <input className={FIELD} value={form.name} onChange={set("name")} required maxLength={120} />
        </label>
        <label className="text-sm text-zinc-700">
          Time zone
          <select className={FIELD} value={form.timezone} onChange={set("timezone")}>
            {timezones.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-zinc-700">
          Mindbody site ID <span className="text-zinc-400">(optional)</span>
          <input className={FIELD} inputMode="numeric" value={form.mindbodySiteId} onChange={set("mindbodySiteId")} />
        </label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold text-zinc-950">Owner (your SynqIQ login)</legend>
        <label className="text-sm text-zinc-700">
          First name
          <input className={FIELD} value={form.firstName} onChange={set("firstName")} required autoComplete="given-name" />
        </label>
        <label className="text-sm text-zinc-700">
          Last name
          <input className={FIELD} value={form.lastName} onChange={set("lastName")} required autoComplete="family-name" />
        </label>
        <label className="text-sm text-zinc-700 sm:col-span-2">
          Email
          <input className={FIELD} type="email" value={form.email} onChange={set("email")} required autoComplete="email" />
        </label>
      </fieldset>

      <label className="flex items-start gap-3 text-sm text-zinc-700">
        <input type="checkbox" className="mt-1" checked={accept} onChange={(event) => setAccept(event.target.checked)} />
        <span>
          I agree to the{" "}
          <Link href="/terms" className="font-medium text-primary hover:underline" target="_blank">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-medium text-primary hover:underline" target="_blank">
            Privacy Policy
          </Link>
          , and authorize SynqIQ to charge this plan monthly until I cancel.
        </span>
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={busy || modules.length === 0 || !accept}
        className="inline-flex h-11 items-center rounded-md bg-brand-accent px-6 text-sm font-medium text-white hover:bg-brand-accent-hover disabled:opacity-50"
      >
        {busy ? "Opening checkout…" : `Continue to payment · $${price}/mo`}
      </button>
    </form>
  );
}
