"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Club Admins set this month's PT goals (they carry forward to later months
// until changed).
export function FitnessGoalsForm({
  month,
  monthLabel,
  sessions,
  salesDollars,
}: {
  month: string;
  monthLabel: string;
  sessions: number | null;
  salesDollars: number | null;
}) {
  const router = useRouter();
  const [sessionsGoal, setSessionsGoal] = useState(sessions == null ? "" : String(sessions));
  const [salesGoal, setSalesGoal] = useState(salesDollars == null ? "" : String(salesDollars));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage(null);
    const response = await fetch("/api/fitness/goals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, sessions: sessionsGoal, sales: salesGoal }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { success?: boolean; error?: string } | null;
    setSaving(false);
    if (!response?.ok || !result?.success) {
      setMessage(result?.error ?? "Couldn't save. Try again.");
      return;
    }
    setMessage("Saved.");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm">
        <span className="text-muted-foreground">Sessions serviced goal ({monthLabel})</span>
        <Input inputMode="numeric" value={sessionsGoal} onChange={(event) => setSessionsGoal(event.target.value)} className="w-40" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="text-muted-foreground">PT sales goal, $ ({monthLabel})</span>
        <Input inputMode="decimal" value={salesGoal} onChange={(event) => setSalesGoal(event.target.value)} className="w-40" />
      </label>
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save goals"}
      </Button>
      {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
    </form>
  );
}
