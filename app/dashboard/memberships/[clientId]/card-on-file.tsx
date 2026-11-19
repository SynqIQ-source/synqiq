"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CardUpdate } from "@/components/billing/card-update";

export type ShownCard = { label: string; expires: string; state: "ok" | "expiring" | "expired"; via: string; updatedAt: string };

const PURPOSES = [
  { purpose: "dues", title: "Monthly dues card" },
  { purpose: "retail", title: "Retail & drinks card (optional)" },
] as const;

// The member's cards on file (profile "Card on file" card and the Billing
// tab): one for monthly dues and an optional one for POS purchases. Update
// either here with Stripe's card form, or email the member a one-time link
// (they pick which card). Either way the card goes straight to Stripe.
export function CardControls({
  clientId,
  cards,
  hasEmail,
}: {
  clientId: string;
  cards: { dues: ShownCard | null; retail: ShownCard | null };
  hasEmail: boolean;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function emailLink() {
    setSending(true);
    setSent(null);
    const response = await fetch(`/api/members/${encodeURIComponent(clientId)}/card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "email" }),
    });
    const body = await response.json().catch(() => null);
    setSending(false);
    setSent(body?.success ? `Link sent to ${body.email}. It works for 7 days.` : (body?.error ?? "Couldn't send the link."));
  }

  return (
    <div className="space-y-3">
      {PURPOSES.map(({ purpose, title }) => {
        const card = cards[purpose];
        const warn = card && card.state !== "ok";
        return (
          <div
            key={purpose}
            className={`space-y-2 rounded-md border px-3 py-2 text-sm ${
              warn ? "border-yellow-300 bg-yellow-50 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200" : ""
            }`}
          >
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
              {card ? (
                <>
                  <p className="font-medium">{card.label}</p>
                  <p className="text-xs opacity-80">
                    {card.state === "expired" ? "Expired" : "Expires"} {card.expires} · updated {card.updatedAt} {card.via}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  {purpose === "retail" ? "None. Purchases use the dues card if staff confirm." : "No card saved in SynqIQ yet."}
                </p>
              )}
            </div>
            <CardUpdate
              endpoint={`/api/members/${encodeURIComponent(clientId)}/card`}
              body={{ purpose }}
              label={card ? "Update card" : "Add card"}
              onSaved={() => router.refresh()}
            />
          </div>
        );
      })}
      <Button variant="outline" onClick={emailLink} disabled={sending || !hasEmail}>
        {sending ? "Sending…" : "Email member a link"}
      </Button>
      {sent ? <p className="text-xs text-muted-foreground">{sent}</p> : null}
      {!hasEmail ? <p className="text-xs text-muted-foreground">No email address on file, so a link can&apos;t be sent.</p> : null}
    </div>
  );
}
