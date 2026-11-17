"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CADENCE_LIMITS, DEFAULT_CADENCE, cadenceDays, type FollowUpCadence } from "@/lib/crm/follow-ups";

const FIELDS: { key: keyof FollowUpCadence; label: string; hint: string }[] = [
  { key: "attempts", label: "Contact attempts", hint: "texts, emails or logged calls before the warm pool" },
  { key: "dailyAttempts", label: "Daily at first", hint: "the first attempts are a day apart" },
  { key: "everyDays", label: "Then every (days)", hint: "spacing after that" },
  { key: "poolAfterDays", label: "Warm pool after (days)", hint: "days after the last attempt with no reply" },
];

// Club Admins: the studio's lead follow-up cadence, with a preview of the
// days each attempt falls on.
export function FollowUpCadenceCard({ cadence, isDefault }: { cadence: FollowUpCadence; isDefault: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<keyof FollowUpCadence, string>>({
    attempts: String(cadence.attempts),
    dailyAttempts: String(cadence.dailyAttempts),
    everyDays: String(cadence.everyDays),
    poolAfterDays: String(cadence.poolAfterDays),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const parsed = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)])) as FollowUpCadence;
  const valid = FIELDS.every(({ key }) => {
    const [min, max] = CADENCE_LIMITS[key];
    return Number.isInteger(parsed[key]) && parsed[key] >= min && parsed[key] <= max;
  });
  const days = valid ? cadenceDays({ ...parsed, dailyAttempts: Math.min(parsed.dailyAttempts, parsed.attempts) }) : [];

  const save = async (body: unknown) => {
    setBusy(true);
    const response = await fetch("/api/crm/follow-up-cadence", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
    setBusy(false);
    setMessage(
      response.ok && result.success
        ? { ok: true, text: "Saved. Follow-up lists use it right away." }
        : { ok: false, text: result.error ?? "Couldn't save." },
    );
    if (response.ok) router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Follow-up timing</CardTitle>
        <CardDescription>
          The same for every lead. Each text, email or logged call is an attempt; a reply, visit or missed appointment starts the attempts
          over. With no reply after the last attempt, the lead moves to the warm lead pool (Lead Status → Warm pool) and leaves the
          follow-up lists. A follow-up date a salesperson sets always wins.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map(({ key, label, hint }) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`cadence-${key}`}>{label}</Label>
              <Input
                id={`cadence-${key}`}
                inputMode="numeric"
                value={values[key]}
                onChange={(event) => setValues({ ...values, [key]: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
          ))}
        </div>
        {valid ? (
          <p className="text-sm">
            Attempts on day {days.join(", ")} after they come in · warm pool on day {days[days.length - 1] + parsed.poolAfterDays} with no
            reply.
          </p>
        ) : (
          <p className="text-sm text-destructive">Enter whole numbers in range.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || !valid} onClick={() => save(parsed)}>
            Save
          </Button>
          {!isDefault ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setValues({
                  attempts: String(DEFAULT_CADENCE.attempts),
                  dailyAttempts: String(DEFAULT_CADENCE.dailyAttempts),
                  everyDays: String(DEFAULT_CADENCE.everyDays),
                  poolAfterDays: String(DEFAULT_CADENCE.poolAfterDays),
                });
                void save({ reset: true });
              }}
            >
              Back to SynqIQ default
            </Button>
          ) : null}
          {message ? (
            <span className={`text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>{message.text}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
