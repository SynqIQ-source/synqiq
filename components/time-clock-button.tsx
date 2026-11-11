"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Clock in / out in the dashboard header. Shows how long you've been on the
// clock. Staff and Sales are signed out when they clock out.
export function TimeClockButton({ clockedInAt, signsOut }: { clockedInAt: string | null; signsOut: boolean }) {
  const router = useRouter();
  const [since, setSince] = useState(clockedInAt);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => setSince(clockedInAt), [clockedInAt]);
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [since]);

  async function act(action: "in" | "out") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/time-clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        clockedInAt?: string;
        signOut?: boolean;
      };
      if (!response.ok || !result.success) {
        setError(result.error ?? "Try again.");
        return;
      }
      setConfirming(false);
      if (action === "in") {
        setSince(result.clockedInAt ?? new Date().toISOString());
        setNow(Date.now());
        return;
      }
      setSince(null);
      if (result.signOut) {
        await createSupabaseBrowserClient().auth.signOut();
        router.push("/login");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const minutes = since ? Math.max(0, Math.floor((now - Date.parse(since)) / 60_000)) : 0;
  const elapsed = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
  const base =
    "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (since && confirming) {
    return (
      <div className="flex items-center gap-1">
        <button type="button" disabled={busy} onClick={() => act("out")} className={`${base} border-destructive/40 text-destructive`}>
          {signsOut ? "Clock out & sign out" : "Clock out"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="px-2 text-sm text-muted-foreground underline">
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      {since ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(true)}
          className={`${base} border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`}
          title="On the clock. Click to clock out."
        >
          <Clock className="size-4" /> <span className="tabular-nums">{elapsed}</span>
          <span className="hidden sm:inline">· Clock out</span>
        </button>
      ) : (
        <button type="button" disabled={busy} onClick={() => act("in")} className={`${base} bg-background hover:bg-muted`}>
          <Clock className="size-4" /> <span className="hidden sm:inline">Clock in</span>
          <span className="sm:hidden">In</span>
        </button>
      )}
      {error ? <p className="absolute top-10 right-0 w-48 text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
