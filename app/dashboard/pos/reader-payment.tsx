"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/terminal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return ((await response.json().catch(() => ({}))) ?? {}) as {
    success?: boolean;
    error?: string;
    paid?: boolean;
    failure?: string | null;
  };
}

// Waiting for the member to tap, insert or swipe on the desk reader. Checks
// with Stripe every 2 seconds; when paid, hands back to checkout, which saves
// the sale only after the server re-checks the payment.
export function ReaderPayment({
  paymentId,
  readerLabel,
  amountCents,
  testMode,
  onPaid,
  onCancel,
}: {
  paymentId: string;
  readerLabel: string;
  amountCents: number;
  testMode: boolean;
  onPaid: () => Promise<void>;
  onCancel: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped) return;
      const status = await post({ action: "status", paymentId });
      if (stopped) return;
      if (status.paid) {
        stopped = true;
        clearInterval(timer);
        setPaid(true);
        await onPaid();
      } else if (status.failure) setMessage(`${status.failure} Ask for another card; the reader is still waiting.`);
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [paymentId, onPaid]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg">
        <h2 className="text-lg font-semibold">{paid ? "Paid. Saving the sale…" : `Tap, insert or swipe: ${money(amountCents)}`}</h2>
        <p className="text-sm text-muted-foreground">
          Sent to <strong>{readerLabel}</strong>. The member pays on the reader; this updates by itself.
        </p>
        {message ? <p className="text-sm text-destructive">{message}</p> : null}
        <div className="flex flex-wrap gap-2">
          {testMode && !paid ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const result = await post({ action: "simulate", paymentId });
                setBusy(false);
                if (!result.success) setMessage(result.error ?? "Couldn't simulate a tap.");
              }}
            >
              Simulate a tap (test mode)
            </Button>
          ) : null}
          <Button
            variant="ghost"
            disabled={paid || busy}
            onClick={async () => {
              setBusy(true);
              await post({ action: "cancel", paymentId });
              setBusy(false);
              onCancel();
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
