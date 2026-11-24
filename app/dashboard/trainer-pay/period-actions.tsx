"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

// Club Admin: approve / unapprove / lock a pay period, and the CSV download.
export function PeriodActions({ start, status }: { start: string; status: "open" | "approved" | "locked" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmLock, setConfirmLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "approve" | "unapprove" | "lock") {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/trainer-sessions/pay-periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, start }),
    });
    const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
    setBusy(false);
    setConfirmLock(false);
    if (!json.success) return setError(json.error ?? "Didn't save.");
    router.refresh();
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/trainer-sessions/pay-periods?start=${start}`}>
            <Download /> Download CSV
          </a>
        </Button>
        {status === "open" ? (
          <Button size="sm" disabled={busy} onClick={() => act("approve")}>
            {busy ? <Loader2 className="animate-spin" /> : null} Approve period
          </Button>
        ) : null}
        {status === "approved" ? (
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("unapprove")}>
              Undo approval
            </Button>
            {confirmLock ? (
              <>
                <span className="text-sm">Lock for good? Nothing in it can change afterwards.</span>
                <Button size="sm" disabled={busy} onClick={() => act("lock")}>
                  {busy ? <Loader2 className="animate-spin" /> : <Lock />} Yes, lock it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmLock(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => setConfirmLock(true)}>
                <Lock /> Lock period
              </Button>
            )}
          </>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
