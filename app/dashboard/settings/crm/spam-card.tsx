"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type HeldSubmission = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  reasons: string[];
  createdAt: string;
  released: boolean;
};

// Website form submissions held as spam. "Not spam" turns one into a lead.
export function SpamCard({ items, timezone }: { items: HeldSubmission[]; timezone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Website form spam</CardTitle>
        <CardDescription>
          Submissions that look like bots (random-letter names and messages, dot-padded Gmail addresses) are held here instead of becoming
          leads, so nobody is notified. If a real person was caught, tap Not spam to add them as a lead. Last 30 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing held.</p> : null}
        {items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">
                {item.name || "No name"} <span className="font-normal text-muted-foreground">· {when(item.createdAt)}</span>
              </p>
              <p className="truncate text-muted-foreground">{[item.email, item.phone].filter(Boolean).join(" · ")}</p>
              {item.message ? <p className="truncate text-muted-foreground">“{item.message}”</p> : null}
              <div className="flex flex-wrap gap-1">
                {item.reasons.map((reason) => (
                  <Badge key={reason} variant="outline">
                    {reason}
                  </Badge>
                ))}
              </div>
            </div>
            {item.released ? (
              <Badge variant="secondary">Added as a lead</Badge>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy === item.id}
                onClick={async () => {
                  setBusy(item.id);
                  setError(null);
                  const response = await fetch(`/api/crm/spam/${item.id}/release`, { method: "POST" });
                  const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
                  setBusy(null);
                  if (!response.ok || !result.success) setError(result.error ?? "Couldn't add them. Try again.");
                  router.refresh();
                }}
              >
                {busy === item.id ? "Adding…" : "Not spam"}
              </Button>
            )}
          </div>
        ))}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
