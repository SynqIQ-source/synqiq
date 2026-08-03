"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SaveStatus = "idle" | "saving" | "error";

export function TrainerHealthSettingsForm({
  expectedRevenuePerSession,
}: {
  expectedRevenuePerSession: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(expectedRevenuePerSession));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setError(null);

    try {
      const response = await fetch("/api/organizations/trainer-health-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevenuePerSession: Number(value) }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Failed to save.");
      }

      setStatus("idle");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-8 flex flex-col gap-5 rounded-lg border border-zinc-200 bg-white p-6"
    >
      <div>
        <h2 className="text-sm font-semibold text-zinc-950">Trainer health benchmark</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Expected revenue per session serviced -- used on the Trainer Health page to flag
          trainers whose credited sales fall below this benchmark. Adjust this periodically as
          real pricing changes; it isn&apos;t a fixed constant.
        </p>
      </div>

      <label className="flex w-fit flex-col gap-2 text-sm font-medium text-zinc-700">
        Expected revenue per session ($)
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-40 rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={status === "saving"}
        className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {status === "saving" ? "Saving..." : "Save benchmark"}
      </button>
    </form>
  );
}
