"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2, X } from "lucide-react";
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

// Per-booking controls on the roster (classes and pool lanes):
//   check box  -- checked in (untick to undo a mistake)
//   X          -- remove / early cancel (no fee)
//   Late       -- late cancel (the program's late-cancel fee is recorded)
//   No show    -- after the start (the program's no-show fee is recorded)
// Fees aren't charged here; they go to the No-shows & Late Cancels report.
// X, Late and No show ask once more before saving.
export function BookingRowActions({
  id,
  status,
  started,
  canWaive,
  spotOpen,
  feeLabel,
  noShowFeeLabel,
}: {
  id: string;
  status: string;
  started: boolean;
  canWaive: boolean;
  spotOpen: boolean;
  lateNow?: boolean;
  feeLabel: string | null;
  noShowFeeLabel?: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<"early" | "late" | "no_show" | null>(null);
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
      setConfirming(null);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (confirming) {
    const label =
      confirming === "early"
        ? "Remove (early cancel, no fee)?"
        : confirming === "late"
          ? `Late cancel${feeLabel ? ` (${feeLabel} fee)` : ""}?`
          : `No show${noShowFeeLabel ? ` (${noShowFeeLabel} fee)` : ""}?`;
    const save = () =>
      confirming === "no_show"
        ? act("no_show")
        : act("cancel", {
            kind: confirming === "late" ? "late" : "on_time",
            reason: confirming === "late" ? "Late cancel at the roster" : "Removed at the roster (early cancel)",
          });
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs">{label}</span>
        <Button size="sm" variant="destructive" disabled={saving} onClick={save}>
          Yes
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setConfirming(null)}>
          No
        </Button>
        {error ? <p className="w-full text-right text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  const attending = status === "booked" || status === "checked_in" || status === "no_show";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {attending ? (
        <label className="mr-1 flex cursor-pointer items-center gap-1.5 text-xs" title="Checked in">
          <input
            type="checkbox"
            className="size-5 cursor-pointer accent-emerald-600"
            checked={status === "checked_in"}
            disabled={saving}
            onChange={(event) => act(event.target.checked ? "check_in" : "undo_check_in")}
            aria-label="Checked in"
          />
          In
        </label>
      ) : null}
      {status === "waitlisted" && spotOpen ? (
        <Button size="sm" variant="outline" disabled={saving} onClick={() => act("move_in")}>
          Move into class
        </Button>
      ) : null}
      {status === "waitlisted" && !spotOpen && canWaive ? (
        <Button size="sm" variant="outline" disabled={saving} onClick={() => act("move_in", { overCapacity: true })}>
          Move in (over capacity)
        </Button>
      ) : null}
      {["booked", "waitlisted", "checked_in"].includes(status) ? (
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={saving}
          onClick={() => setConfirming("early")}
          aria-label="Remove / early cancel"
          title="Remove / early cancel"
        >
          <X className="size-4" />
        </Button>
      ) : null}
      {status === "booked" || status === "checked_in" ? (
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setConfirming("late")} title="Late cancel">
          Late
        </Button>
      ) : null}
      {status === "booked" || status === "checked_in" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={saving || !started}
          onClick={() => setConfirming("no_show")}
          title={started ? "No show" : "Available once it starts"}
        >
          No show
        </Button>
      ) : null}
      {error ? <p className="w-full text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
