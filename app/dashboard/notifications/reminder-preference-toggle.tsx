"use client";

import { useState } from "react";

type SaveStatus = "idle" | "saving" | "error";

// Server-backed (staff.substitution_reminder_opt_out), unlike
// NotificationsForm's device-local push subscription above it -- this
// preference follows the instructor to any device they log into, which is
// the right behavior for an email preference.
export function ReminderPreferenceToggle({ initialOptOut }: { initialOptOut: boolean }) {
  const [optOut, setOptOut] = useState(initialOptOut);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleChange(nextOptOut: boolean) {
    const previous = optOut;
    setOptOut(nextOptOut);
    setStatus("saving");
    setError(null);

    try {
      const response = await fetch("/api/staff/me/substitution-reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optOut: nextOptOut }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result?.error ?? "Failed to save.");
      }

      setStatus("idle");
    } catch (err) {
      setOptOut(previous);
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to save.");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-zinc-950">Substitution reminder emails</h2>
      <p className="text-sm text-zinc-500">
        You&apos;ll always get an email the moment a class you&apos;re eligible to cover needs a
        substitute. If it&apos;s still open after 4 days, a reminder goes out too -- unless you
        opt out here.
      </p>

      <label className="inline-flex w-fit items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={!optOut}
          disabled={status === "saving"}
          onChange={(event) => handleChange(!event.target.checked)}
          className="h-4 w-4 rounded border-zinc-300"
        />
        Send me reminder emails for open requests I haven&apos;t responded to
      </label>

      {status === "saving" && <p className="text-xs text-zinc-500">Saving...</p>}
      {status === "error" && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
