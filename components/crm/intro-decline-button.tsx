"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Marks a new member as having declined the intro workout (with an optional
// reason), or undoes it. Used on the member profile, Sales → New Members and
// Follow Up → New members. The trainer assigned to the member and CRM staff
// can use it (app/api/crm/contacts/[id]/intro).
export function IntroDeclineButton({
  contactId,
  declined,
  size = "sm",
}: {
  contactId: string;
  declined: boolean;
  size?: "sm" | "xs";
}) {
  const buttonSize = size === "xs" ? "xs" : "sm";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/contacts/${contactId}/intro`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ declined: next, reason }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) throw new Error(result.error ?? "Something went wrong.");
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (declined) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <Button type="button" variant="outline" size={buttonSize} disabled={busy} onClick={() => void save(false)}>
          {busy ? "Saving…" : "Undo declined"}
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </span>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size={buttonSize} onClick={() => setOpen(true)}>
        Declined intro
      </Button>
    );
  }

  return (
    <span className="flex w-full max-w-xs flex-col gap-2 rounded-md border bg-card p-2 text-left">
      <label htmlFor={`intro-decline-${contactId}`} className="text-xs text-muted-foreground">
        Why did they decline? (optional)
      </label>
      <input
        id={`intro-decline-${contactId}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={500}
        placeholder="e.g. Already trains on their own"
        className="h-8 w-full rounded-md border bg-background px-2 text-sm"
      />
      <span className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save(true)}>
          {busy ? "Saving…" : "Mark declined"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </span>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
