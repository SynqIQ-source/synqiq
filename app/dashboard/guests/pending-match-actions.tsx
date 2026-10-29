"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function PendingMatchActions({ matchId, canMerge }: { matchId: string; canMerge: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(action: "merge" | "keep_separate") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/pending-matches/${matchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Couldn't resolve the match.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't resolve the match.");
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void resolve("keep_separate")}>
          Keep separate
        </Button>
        {canMerge ? (
          <Button size="sm" disabled={busy} onClick={() => void resolve("merge")}>
            Merge
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
