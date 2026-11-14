"use client";

import { useState } from "react";

async function send(body: Record<string, unknown>) {
  try {
    const response = await fetch("/api/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json().catch(() => ({ success: false }))) as { success?: boolean; error?: string };
  } catch {
    return { success: false, error: "Couldn't reach the studio. Check your connection." };
  }
}

export function RatingForm({ token, color, initialStars }: { token: string; color: string; initialStars: number }) {
  const [stars, setStars] = useState(initialStars);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) return <p className="text-base">Thank you! Your rating helps us keep classes great.</p>;
  return (
    <div className="space-y-4">
      <div className="flex gap-1" role="radiogroup" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => setStars(n)}
            className="text-4xl leading-none"
            style={{ color: n <= stars ? "#f59e0b" : "#d4d4d4" }}
          >
            ★
          </button>
        ))}
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Anything you&apos;d like to share? (optional)</span>
        <textarea
          className="min-h-28 w-full rounded-md border border-neutral-300 p-3 text-base outline-none focus:border-neutral-500"
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="What stood out? What could be better?"
        />
      </label>
      <p className="text-xs text-neutral-500">Your name isn&apos;t shown to the instructor.</p>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        disabled={!stars || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await send({ token, stars, comment });
          setBusy(false);
          if (result.success) setDone(true);
          else setError(result.error ?? "Couldn't save. Try again.");
        }}
        className="h-11 w-full rounded-md text-base font-medium text-white disabled:opacity-50"
        style={{ background: color }}
      >
        {busy ? "Sending…" : stars ? "Submit" : "Tap a star"}
      </button>
    </div>
  );
}

export function StopForm({ token, color }: { token: string; color: string }) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (done) return <p className="text-base">Done. You won&apos;t get class rating emails anymore.</p>;
  return (
    <div className="space-y-3">
      <p className="text-base">Stop getting emails asking you to rate classes?</p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const result = await send({ token, stop: true });
          setBusy(false);
          if (result.success) setDone(true);
        }}
        className="h-11 w-full rounded-md text-base font-medium text-white disabled:opacity-50"
        style={{ background: color }}
      >
        Stop rating emails
      </button>
    </div>
  );
}
