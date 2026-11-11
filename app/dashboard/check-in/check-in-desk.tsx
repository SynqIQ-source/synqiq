"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MemberSearch, type MemberSuggestion } from "../memberships/member-search";
import type { CheckInStatus } from "@/lib/checkin/status";

const TONE = {
  good: "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40",
  attention: "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/40",
  none: "border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/30",
} as const;

// Front desk: scan a key card (checks good-standing members straight in) or
// look someone up by name, see what covers the visit, check them in.
const SEARCH_LABEL = "Scan a card or search";

export function CheckInDesk() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<CheckInStatus | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string; photo?: string | null } | null>(null);

  // Keep the search box ready for the next scan whenever nobody is open.
  useEffect(() => {
    if (!status) document.querySelector<HTMLInputElement>(`input[aria-label="${SEARCH_LABEL}"]`)?.focus();
  }, [status, flash]);
  useEffect(() => {
    if (!flash?.ok) return;
    const timer = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(timer);
  }, [flash]);

  async function lookup(url: string) {
    setLoading(true);
    setStatus(null);
    setNote("");
    setFlash(null);
    try {
      const response = await fetch(url);
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; status?: CheckInStatus; error?: string };
      if (!response.ok || !result.status) {
        setFlash({ ok: false, text: result.error ?? "Couldn't look them up. Try again." });
        return null;
      }
      return result.status;
    } finally {
      setLoading(false);
    }
  }

  async function post(found: CheckInStatus, method: "scan" | "front_desk") {
    const response = await fetch("/api/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mindbodyClientId: found.client.mindbodyClientId, note, method }),
    });
    return (await response.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      coverage?: string | null;
      needsStaff?: boolean;
    };
  }

  // Enter without picking from the list: a key-card scan (or a typed card
  // number) checks a covered, good-standing member straight in.
  async function onEnter(value: string) {
    const code = value.trim();
    if (!/^\d{5,}$/.test(code.replace(/^[;%]+|[?]+$/g, ""))) {
      setFlash({ ok: false, text: "Pick someone from the list, or scan their key card." });
      return;
    }
    const found = await lookup(`/api/check-in/scan?code=${encodeURIComponent(code)}`);
    if (!found) return;
    const ready = found.decision.standing === "good" && !found.decision.warnings.includes("Already checked in today.");
    if (!ready) {
      setStatus(found);
      return;
    }
    setSaving(true);
    try {
      const result = await post(found, "scan");
      if (result.success) {
        setFlash({
          ok: true,
          text: `Welcome, ${found.client.name.split(" ")[0]}! Checked in (${result.coverage}).`,
          photo: found.client.photoUrl,
        });
        router.refresh();
      } else setStatus(found);
    } finally {
      setSaving(false);
    }
  }

  async function choose(suggestion: MemberSuggestion) {
    const found = await lookup(`/api/check-in/status/${encodeURIComponent(suggestion.id)}`);
    if (found) setStatus(found);
  }

  async function checkIn() {
    if (!status) return;
    setSaving(true);
    try {
      const result = await post(status, "front_desk");
      if (!result.success) {
        setFlash({ ok: false, text: result.error ?? "Couldn't check in. Try again." });
        return;
      }
      setFlash({
        ok: true,
        text: `${status.client.name} checked in${result.coverage ? ` (${result.coverage})` : ""}.`,
        photo: status.client.photoUrl,
      });
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
      <div className="flex items-start gap-2">
        <ScanLine className="mt-2 size-5 shrink-0 text-muted-foreground" />
        <div className="w-full max-w-xl">
          <MemberSearch
            initialQuery=""
            endpoint="/api/check-in/search"
            onPick={choose}
            onSubmitQuery={onEnter}
            placeholder="Scan a key card, or search name, phone, email or card number"
            ariaLabel={SEARCH_LABEL}
            autoFocus
            compact
          />
        </div>
      </div>

      {loading || saving ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {saving ? "Checking in…" : "Checking with Mindbody…"}
        </p>
      ) : null}
      {flash ? (
        <div
          role="status"
          className={`flex items-center gap-3 rounded-md border px-4 py-3 text-base font-medium ${flash.ok ? TONE.good : TONE.attention}`}
        >
          {flash.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- Mindbody-hosted photo
            <img src={flash.photo} alt="" className="h-12 w-12 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : flash.ok ? (
            <CheckCircle2 className="size-6 text-emerald-600" />
          ) : (
            <CircleAlert className="size-6 text-red-600" />
          )}
          {flash.text}
        </div>
      ) : null}

      {status && decision ? (
        <Card className={`border-2 ${TONE[decision.standing]}`}>
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
                  {decision.standing === "attention" ? (
                    decision.standingReasons.map((reason) => (
                      <Badge key={reason} variant="destructive">
                        {reason}
                      </Badge>
                    ))
                  ) : decision.standing === "good" ? (
                    <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Good standing</Badge>
                  ) : null}
                  {status.client.status ? <Badge variant="outline">{status.client.status}</Badge> : null}
                  {status.lastCheckIn ? (
                    <Badge variant="outline">
                      Last in {new Date(status.lastCheckIn).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="rounded-md bg-background/70 px-3 py-2 text-sm">
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
                <ul className="mt-1 list-disc pl-5 text-red-800 dark:text-red-200">
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
              <Button
                type="button"
                variant={decision.standing === "attention" ? "destructive" : "default"}
                onClick={checkIn}
                disabled={saving || (!decision.covered && !note.trim())}
              >
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
