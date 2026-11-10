"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Pulls this member's visits, bookings, purchases, services and contact
// details from Mindbody (read-only) and reloads the page.
export function RefreshFromMindbody({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/memberships/${encodeURIComponent(clientId)}/refresh`, { method: "POST" });
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        visits?: number;
        upcoming?: number;
        sales?: number;
        services?: number;
      };
      if (!response.ok || !result.success) {
        setMessage(result.error ?? "Couldn't reach Mindbody. Try again in a minute.");
        return;
      }
      setMessage(`Updated: ${result.visits} visits, ${result.upcoming} booked, ${result.sales} purchases, ${result.services} services.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={busy}>
        <RefreshCw className={busy ? "animate-spin" : undefined} /> {busy ? "Pulling from Mindbody…" : "Refresh from Mindbody"}
      </Button>
      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
