"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CardUpdate } from "@/components/billing/card-update";

// Member profile: the card on file for monthly payments. Staff can update it
// here, or email the member a secure link; members can also do it in the app
// (where Apple Pay / Google Pay fill it in). Every route saves the card
// straight to Stripe.
export function CardOnFile(props: {
  clientId: string;
  card: { label: string; expires: string; state: "ok" | "expiring" | "expired"; via: string; updatedAt: string } | null;
  hasEmail: boolean;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function emailLink() {
    setSending(true);
    setSent(null);
    const response = await fetch(`/api/members/${encodeURIComponent(props.clientId)}/card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "email" }),
    });
    const body = await response.json().catch(() => null);
    setSending(false);
    setSent(body?.success ? `Link sent to ${body.email}. It works for 7 days.` : (body?.error ?? "Couldn't send the link."));
  }

  const tone =
    props.card?.state === "expired" || props.card?.state === "expiring"
      ? "border-yellow-300 bg-yellow-50 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200"
      : "bg-muted/40";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Card on file</CardTitle>
        <CardDescription>Used for monthly membership payments. The card is kept by Stripe on the studio&apos;s account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`rounded-md border px-3 py-2 text-sm ${tone}`}>
          {props.card ? (
            <>
              <span className="font-medium">{props.card.label}</span> · {props.card.state === "expired" ? "expired" : "expires"}{" "}
              {props.card.expires}
              <span className="block text-xs opacity-80">
                Updated {props.card.updatedAt} ({props.card.via})
              </span>
            </>
          ) : (
            "No card on file in SynqIQ yet."
          )}
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <CardUpdate
            endpoint={`/api/members/${encodeURIComponent(props.clientId)}/card`}
            body={{}}
            label={props.card ? "Update card here" : "Add card here"}
            onSaved={() => router.refresh()}
          />
          <Button variant="outline" onClick={emailLink} disabled={sending || !props.hasEmail}>
            {sending ? "Sending…" : "Email the member a link"}
          </Button>
        </div>
        {sent ? <p className="text-sm text-muted-foreground">{sent}</p> : null}
        {!props.hasEmail ? <p className="text-xs text-muted-foreground">No email address on file, so a link can&apos;t be sent.</p> : null}
        <p className="text-xs text-muted-foreground">
          Members can also update it themselves in the app under Payment card. Tapping a card at the desk needs a Stripe card reader.
        </p>
      </CardContent>
    </Card>
  );
}
