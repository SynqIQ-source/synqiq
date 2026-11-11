"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MemberSearch, type MemberSuggestion } from "../../memberships/member-search";

// Book someone into this class (search by name), then the server decides
// booked vs waitlist and what covers it.
export function BookSomeone({ sessionId, open }: { sessionId: string; open: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<MemberSuggestion | null>(null);
  const [needsReason, setNeedsReason] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function book(person: MemberSuggestion, reason = "") {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, mindbodyClientId: person.id, note: reason }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        status?: string;
        coverage?: string | null;
        needsReason?: boolean;
        standing?: string;
      };
      if (!response.ok || !result.success) {
        setPicked(person);
        setNeedsReason(Boolean(result.needsReason));
        setMessage({ ok: false, text: result.error ?? "Couldn't book. Try again." });
        return;
      }
      setPicked(null);
      setNeedsReason(false);
      setNote("");
      setMessage({
        ok: true,
        text: `${person.name} ${result.status === "waitlisted" ? "added to the waitlist" : "booked"}${result.coverage ? ` (${result.coverage})` : ""}.${
          result.standing === "attention" ? " Note: their billing needs attention." : ""
        }`,
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return <p className="text-sm text-muted-foreground">Booking is closed for this class.</p>;
  return (
    <div className="space-y-3">
      <MemberSearch
        initialQuery=""
        endpoint="/api/check-in/search"
        onPick={(person) => book(person)}
        placeholder="Book someone: name or email"
      />
      {saving ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Booking…
        </p>
      ) : null}
      {message ? (
        <p className={`flex items-center gap-2 text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
          {message.ok ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />} {message.text}
        </p>
      ) : null}
      {picked && needsReason ? (
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-md"
            placeholder="Reason to book anyway (e.g. paying at the desk)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button type="button" onClick={() => book(picked, note)} disabled={saving || !note.trim()}>
            Book anyway
          </Button>
          <Button type="button" variant="ghost" onClick={() => setPicked(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// Per-booking actions: check in, no-show, move in from waitlist, cancel.
export function BookingRowActions({
  id,
  status,
  started,
  canWaive,
  spotOpen,
}: {
  id: string;
  status: string;
  started: boolean;
  canWaive: boolean;
  spotOpen: boolean;
}) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [waive, setWaive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/bookings/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        setError(result.error ?? "Couldn't save. Try again.");
        return;
      }
      setCancelling(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (cancelling) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Input className="h-8 w-44" placeholder="Why cancel" value={reason} onChange={(event) => setReason(event.target.value)} />
        {canWaive ? (
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={waive} onChange={(event) => setWaive(event.target.checked)} /> Waive late cancel
          </label>
        ) : null}
        <Button
          size="sm"
          variant="destructive"
          disabled={saving || !reason.trim()}
          onClick={() => act("cancel", { reason, waiveLateCancel: waive })}
        >
          Cancel booking
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setCancelling(false)} disabled={saving}>
          Keep
        </Button>
        {error ? <p className="w-full text-right text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {status === "booked" || status === "no_show" ? (
        <Button size="sm" variant="outline" disabled={saving} onClick={() => act("check_in")}>
          Check in
        </Button>
      ) : null}
      {status === "booked" && started ? (
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => act("no_show")}>
          No-show
        </Button>
      ) : null}
      {status === "waitlisted" && spotOpen ? (
        <Button size="sm" variant="outline" disabled={saving} onClick={() => act("move_in")}>
          Move into class
        </Button>
      ) : null}
      {["booked", "waitlisted", "checked_in"].includes(status) ? (
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setCancelling(true)}>
          Cancel
        </Button>
      ) : null}
      {error ? <p className="w-full text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
