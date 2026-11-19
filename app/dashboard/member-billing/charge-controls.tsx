"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Club Admins: move one billing date (a declined charge's next try, or an
// upcoming payment) to another day, and/or try a declined charge right now.
export function ChargeControls(props: {
  chargeId?: string;
  scheduleId?: string;
  dueDate?: string;
  date: string | null; // the date it's set to now
  canRetry?: boolean;
  min: string; // today
}) {
  const router = useRouter();
  const [date, setDate] = useState(props.date ?? "");
  const [busy, setBusy] = useState<"move" | "retry" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function send(action: "move" | "retry") {
    setBusy(action);
    setMessage(null);
    const response = await fetch("/api/billing/charges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, chargeId: props.chargeId, scheduleId: props.scheduleId, dueDate: props.dueDate, date }),
    });
    const body = await response.json().catch(() => null);
    setBusy(null);
    if (!body?.success) {
      setMessage(body?.error ?? "Something went wrong.");
      return;
    }
    setMessage(
      action === "move"
        ? "Date moved."
        : body.outcome === "paid"
          ? "Paid."
          : body.outcome === "pending"
            ? "Processing; it will update shortly."
            : body.outcome === "error"
              ? "Stripe didn't respond; it will try again tomorrow."
              : "Declined again.",
    );
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        type="date"
        aria-label="Billing date"
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value={date}
        min={props.min}
        onChange={(event) => setDate(event.target.value)}
      />
      <Button size="sm" variant="outline" disabled={busy !== null || !date || date === props.date} onClick={() => send("move")}>
        {busy === "move" ? "Moving…" : "Move"}
      </Button>
      {props.canRetry ? (
        <Button size="sm" disabled={busy !== null} onClick={() => send("retry")}>
          {busy === "retry" ? "Charging…" : "Retry now"}
        </Button>
      ) : null}
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </div>
  );
}
