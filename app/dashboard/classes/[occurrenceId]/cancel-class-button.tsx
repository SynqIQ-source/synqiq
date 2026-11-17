"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Club Admins and Sales Leads: cancel this class date, with a reason that
// goes in the members' email.
export function CancelClassButton({ sessionId, booked }: { sessionId: string; booked: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!open) {
    return (
      <div className="space-y-1">
        <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
          Cancel class
        </Button>
        {message ? (
          <p className={`text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>{message.text}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
      <p className="font-medium">Cancel this class?</p>
      <p className="text-muted-foreground">
        It stops being bookable.{" "}
        {booked > 0 ? `The ${booked} ${booked === 1 ? "person" : "people"} booked or waitlisted in SynqIQ` : "Anyone booked in SynqIQ"}{" "}
        {booked === 1 ? "is" : "are"} released with no late cancel or fee and emailed a short apology (the reason is not included; it is kept
        for staff). People booked in Mindbody are handled in Mindbody until the switch.
      </p>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (staff only), e.g. Instructor out sick"
        maxLength={300}
      />
      <div className="flex gap-2">
        <Button
          variant="destructive"
          disabled={busy || !reason.trim()}
          onClick={async () => {
            setBusy(true);
            const response = await fetch(`/api/class-sessions/${sessionId}/cancel`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason }),
            });
            const result = (await response.json().catch(() => ({}))) as {
              success?: boolean;
              error?: string;
              cancelledBookings?: number;
              emailed?: number;
            };
            setBusy(false);
            if (!response.ok || !result.success) return setMessage({ ok: false, text: result.error ?? "Couldn't cancel. Try again." });
            setOpen(false);
            setMessage({
              ok: true,
              text: `Class cancelled. ${result.cancelledBookings ?? 0} released, ${result.emailed ?? 0} emailed.`,
            });
            router.refresh();
          }}
        >
          {busy ? "Cancelling…" : "Cancel class"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
