"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MemberSearch, type MemberSuggestion } from "../memberships/member-search";
import type { CheckInStatus } from "@/lib/checkin/status";

// Front desk: find someone, see what covers the visit, check them in.
export function CheckInDesk() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<CheckInStatus | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function choose(suggestion: MemberSuggestion) {
    setLoading(true);
    setStatus(null);
    setNote("");
    setMessage(null);
    try {
      const response = await fetch(`/api/check-in/status/${encodeURIComponent(suggestion.id)}`);
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; status?: CheckInStatus; error?: string };
      if (!response.ok || !result.status) setMessage({ ok: false, text: result.error ?? "Couldn't look them up. Try again." });
      else setStatus(result.status);
    } finally {
      setLoading(false);
    }
  }

  async function checkIn() {
    if (!status) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mindbodyClientId: status.client.mindbodyClientId, note }),
      });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; coverage?: string | null };
      if (!response.ok || !result.success) {
        setMessage({ ok: false, text: result.error ?? "Couldn't check in. Try again." });
        return;
      }
      setMessage({ ok: true, text: `${status.client.name} checked in${result.coverage ? ` (${result.coverage})` : ""}.` });
      setStatus(null);
      setNote("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const decision = status?.decision;
  return (
    <div className="space-y-4">
      <MemberSearch initialQuery="" endpoint="/api/check-in/search" onPick={choose} placeholder="Name or email to check in" />
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Checking with Mindbody…
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className={`flex items-center gap-2 text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
        >
          {message.ok ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />} {message.text}
        </p>
      ) : null}
      {status && decision ? (
        <Card className={decision.covered ? "border-emerald-300 dark:border-emerald-800" : "border-amber-300 dark:border-amber-700"}>
          <CardContent className="space-y-4 py-2">
            <div className="flex items-center gap-4">
              {status.client.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Mindbody-hosted photo
                <img src={status.client.photoUrl} alt="" className="h-16 w-16 rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
                  {status.client.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-lg font-semibold">{status.client.name}</p>
                <div className="flex flex-wrap gap-1">
                  {status.client.status ? (
                    <Badge variant={status.client.status === "Active" ? "secondary" : "outline"}>{status.client.status}</Badge>
                  ) : null}
                  {status.lastCheckIn ? (
                    <Badge variant="outline">
                      Last in {new Date(status.lastCheckIn).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
              {decision.covered ? (
                <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" /> Covered by {decision.coverageName}
                  <span className="font-normal text-muted-foreground">
                    ({decision.kind === "membership" ? "membership" : "pass"}
                    {decision.remaining !== null ? `, ${decision.remaining} left` : ""})
                  </span>
                </p>
              ) : (
                <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-300">
                  <CircleAlert className="size-4" /> No active membership or pass
                </p>
              )}
              {decision.warnings.length ? (
                <ul className="mt-1 list-disc pl-5 text-amber-800 dark:text-amber-200">
                  {decision.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              {status.servicesFrom === "synqiq" ? (
                <p className="mt-1 text-xs text-muted-foreground">Mindbody couldn&apos;t be reached; this uses SynqIQ&apos;s last copy.</p>
              ) : null}
            </div>
            {!decision.covered ? (
              <Input
                aria-label="Reason to check in anyway"
                placeholder="Reason to check in anyway (e.g. buying a day pass now)"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
              />
            ) : null}
            <div className="flex gap-2">
              <Button type="button" onClick={checkIn} disabled={saving || (!decision.covered && !note.trim())}>
                {saving ? "Checking in…" : decision.covered ? "Check in" : "Check in anyway"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStatus(null)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
