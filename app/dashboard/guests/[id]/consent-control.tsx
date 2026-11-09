"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const METHODS = [
  { value: "in_person", label: "In person" },
  { value: "written", label: "Signed a written form" },
  { value: "email", label: "By email" },
  { value: "phone", label: "On a phone call" },
];

// Club admins: record that someone agreed to texts or email marketing outside
// the kiosk (e.g. a staff member), or that they withdrew. Saved as a note on
// the profile with who recorded it and how they agreed.
export function ConsentControl({
  contactId,
  channel,
  given,
  optedOut,
}: {
  contactId: string;
  channel: "sms" | "email";
  given: boolean;
  optedOut?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const what = channel === "sms" ? "texts" : "marketing emails";

  async function save(agreed: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: { channel, agreed, method, note } }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) throw new Error(result.error ?? "Something went wrong.");
      setOpen(false);
      setMethod("");
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (optedOut && channel === "sms") {
    return <p className="mt-1 text-xs text-muted-foreground">Replied STOP. They can text START to opt back in.</p>;
  }

  if (given) {
    return (
      <div className="mt-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(false)}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60"
        >
          {busy ? "Saving…" : `Record that they no longer want ${what}`}
        </button>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-xs font-medium text-primary hover:underline"
      >
        Record opt-in
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border p-3">
      <p className="text-xs text-muted-foreground">
        Only record this if they agreed to receive {what} from the studio. Note how they agreed.
      </p>
      <Select value={method} onValueChange={setMethod}>
        <SelectTrigger aria-label="How they agreed" className="h-8 w-full bg-card">
          <SelectValue placeholder="How did they agree?" />
        </SelectTrigger>
        <SelectContent>
          {METHODS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        placeholder="Details (optional), e.g. staff onboarding form"
        className="h-8 w-full rounded-md border bg-card px-2 text-sm"
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={!method || busy} onClick={() => void save(true)}>
          {busy ? "Saving…" : "Record opt-in"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
