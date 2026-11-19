"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Runs tonight's renewals now for this studio (the same run the 4 AM job does).
export function RunRenewals() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    const response = await fetch("/api/billing/renewals", { method: "POST" });
    const body = await response.json().catch(() => null);
    setBusy(false);
    if (!body?.success) {
      setResult(body?.error ?? "Couldn't run renewals.");
      return;
    }
    const s = body.summary as { due: number; paid: number; declined: number; frozen: number; pending: number; errors: number };
    setResult(
      s.due === 0
        ? "Nothing due to charge."
        : `${s.due} due: ${s.paid} paid, ${s.declined} declined, ${s.frozen} frozen${s.pending ? `, ${s.pending} processing` : ""}${s.errors ? `, ${s.errors} errors (will retry)` : ""}.`,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={run} disabled={busy}>
        {busy ? "Running…" : "Run renewals now"}
      </Button>
      {result ? <span className="text-sm text-muted-foreground">{result}</span> : null}
    </div>
  );
}
