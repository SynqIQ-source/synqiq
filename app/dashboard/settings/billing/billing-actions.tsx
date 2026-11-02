"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

const REASONS = [
  { value: "too_expensive", label: "It's too expensive" },
  { value: "missing_features", label: "It's missing something we need" },
  { value: "switched_service", label: "We're switching to something else" },
  { value: "unused", label: "We're not using it enough" },
  { value: "other", label: "Something else" },
];

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/billing/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(result.error ?? "Something went wrong.");
  return result;
}

// Billing portal, cancel (at the end of the paid period, with an optional
// reason), and undo a pending cancellation.
export function BillingActions({
  canceling,
  canceled,
  periodEnd,
}: {
  canceling: boolean;
  canceled: boolean;
  periodEnd: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [comment, setComment] = useState("");

  async function run(action: string, body: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    try {
      const result = await post({ action, ...body });
      if (action === "portal") {
        window.location.href = result.url;
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
    setBusy(null);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Payment method and invoices</CardTitle>
          <CardDescription>Update your card, change your billing address, and download invoices.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled={busy !== null} onClick={() => void run("portal")}>
            {busy === "portal" ? "Opening…" : "Manage payment & invoices"}
          </Button>
        </CardContent>
      </Card>

      {canceled ? null : (
        <Card>
          <CardHeader>
            <CardTitle>{canceling ? "Cancellation scheduled" : "Cancel subscription"}</CardTitle>
            <CardDescription>
              {canceling
                ? "Changed your mind? Keep your subscription and nothing changes."
                : `Cancel any time. You keep full access until the end of your paid period${periodEnd ? ` (${periodEnd})` : ""}, and you won't be charged again. Your data is kept.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {canceling ? (
              <Button disabled={busy !== null} onClick={() => void run("resume")}>
                {busy === "resume" ? "Saving…" : "Keep my subscription"}
              </Button>
            ) : !confirming ? (
              <Button variant="outline" className="text-destructive" onClick={() => setConfirming(true)}>
                Cancel subscription
              </Button>
            ) : (
              <div className="space-y-3">
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">Why are you canceling? (optional)</legend>
                  {REASONS.map((reason) => (
                    <label key={reason.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="feedback"
                        value={reason.value}
                        checked={feedback === reason.value}
                        onChange={() => setFeedback(reason.value)}
                      />
                      {reason.label}
                    </label>
                  ))}
                </fieldset>
                <Textarea
                  placeholder="Anything we could have done better? (optional)"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  maxLength={500}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="destructive"
                    disabled={busy !== null}
                    onClick={() => void run("cancel", { feedback: feedback || undefined, comment })}
                  >
                    {busy === "cancel" ? "Canceling…" : `Cancel at end of period${periodEnd ? ` (${periodEnd})` : ""}`}
                  </Button>
                  <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirming(false)}>
                    Never mind
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
