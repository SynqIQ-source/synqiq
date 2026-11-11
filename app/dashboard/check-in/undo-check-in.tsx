"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UndoCheckIn({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Undo
      </Button>
    );
  }

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/check-in/${id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        setError(result.error ?? "Couldn't undo. Try again.");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Input
        className="h-8 w-48"
        aria-label="Why undo"
        placeholder="Why (e.g. wrong person)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <Button type="button" size="sm" onClick={confirm} disabled={saving || !reason.trim()}>
        {saving ? "…" : "Undo"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
        Keep
      </Button>
      {error ? <p className="w-full text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
