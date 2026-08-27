"use client";

import { useState } from "react";

type Status = "idle" | "submitting" | "success" | "error";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LeadForm() {
  const [name, setName] = useState("");
  const [studioName, setStudioName] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!name.trim()) return "Name is required.";
    if (!studioName.trim()) return "Studio / Gym Name is required.";
    if (!email.trim()) return "Email is required.";
    if (!EMAIL_PATTERN.test(email.trim())) return "Enter a valid email address.";
    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const validationError = validate();
    if (validationError) {
      setStatus("error");
      setError(validationError);
      return;
    }

    setStatus("submitting");
    setError(null);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          studioName: studioName.trim(),
          website: website.trim() || null,
          phone: phone.trim() || null,
          email: email.trim(),
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result?.error ?? "Something went wrong. Please try again.");
      }

      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-lg border border-gold bg-gold-subtle p-6 text-sm text-zinc-800">
        Thanks — we&apos;ll be in touch if it&apos;s a good fit.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-zinc-700">
          Name
        </label>
        <input
          id="name"
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 block w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
        />
      </div>

      <div>
        <label htmlFor="studioName" className="block text-sm font-medium text-zinc-700">
          Studio / Gym Name
        </label>
        <input
          id="studioName"
          type="text"
          required
          value={studioName}
          onChange={(event) => setStudioName(event.target.value)}
          className="mt-1 block w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
        />
      </div>

      <div>
        <label htmlFor="website" className="block text-sm font-medium text-zinc-700">
          Website <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <input
          id="website"
          type="url"
          placeholder="https://"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          className="mt-1 block w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
        />
      </div>

      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-zinc-700">
          Phone Number <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className="mt-1 block w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-zinc-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 block w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-950"
        />
      </div>

      {status === "error" && error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="inline-flex h-11 items-center rounded-md bg-gold px-5 text-sm font-medium text-white hover:bg-gold-hover disabled:opacity-60"
      >
        {status === "submitting" ? "Submitting..." : "Request an Introduction"}
      </button>

      <p className="text-xs text-zinc-500">
        We review every submission personally — no automated onboarding. If it&apos;s a fit,
        we&apos;ll be in touch to talk next steps.
      </p>
    </form>
  );
}
