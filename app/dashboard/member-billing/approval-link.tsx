"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Club Admins: a fresh "approve your payment" link for a renewal the member's
// bank held (3D Secure), to text or email them. Copied, never shown in full
// to anyone else.
export function ApprovalLink({ chargeId }: { chargeId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/billing/charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approvalLink", chargeId }),
      });
      const body = (await response.json().catch(() => null)) as { success?: boolean; error?: string; url?: string } | null;
      if (!body?.success || !body.url) return setMessage(body?.error ?? "Couldn't make a link.");
      try {
        await navigator.clipboard.writeText(body.url);
        setMessage("Link copied. Text or email it to the member (works for 7 days, once).");
      } catch {
        setMessage(body.url);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 space-y-1">
      <Button size="sm" variant="outline" onClick={make} disabled={busy}>
        {busy ? "Making link…" : "Copy approval link"}
      </Button>
      {message ? <p className="max-w-64 text-xs break-all text-muted-foreground">{message}</p> : null}
    </div>
  );
}
