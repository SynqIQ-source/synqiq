"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CancelIncrease({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Cancel this increase
      </Button>
    );
  }

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/memberships/price-increases/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !result.success) {
        setError(result.error ?? "Couldn't cancel. Try again.");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-wrap items-center gap-2">
      <Input
        aria-label="Reason for cancelling"
        placeholder="Reason for cancelling"
        value={reason}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
        className="min-w-64 flex-1"
      />
      <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
        Keep it
      </Button>
      <Button type="button" onClick={confirm} disabled={saving || !reason.trim()}>
        {saving ? "Cancelling…" : "Cancel increase"}
      </Button>
      {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
