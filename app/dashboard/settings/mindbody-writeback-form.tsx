"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Problem = { id: string; name: string; className: string; when: string; error: string };

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/booking/writeback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown> & { success?: boolean; error?: string };
  if (!response.ok || !json.success) throw new Error(json.error ?? "Something went wrong.");
  return json;
}

// Settings: copy SynqIQ class bookings into Mindbody during the Dec 10
// transition, so Mindbody's class capacity stays right.
export function MindbodyWritebackForm({
  enabled,
  until,
  waiting,
  problems,
}: {
  enabled: boolean;
  until: string;
  waiting: number;
  problems: Problem[];
}) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [last, setLast] = useState(until);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await work() });
      router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Copy SynqIQ bookings into Mindbody
          {enabled ? <Badge>On</Badge> : <Badge variant="outline">Off</Badge>}
        </CardTitle>
        <CardDescription>
          While members can still book in the Mindbody app, every class booking, waitlist spot and cancellation made in SynqIQ is copied
          into Mindbody within about 5 minutes, so Mindbody doesn&apos;t overbook. Mindbody doesn&apos;t email the member. SynqIQ also
          re-reads Mindbody&apos;s bookings every 15 minutes during the day. It stops by itself after the last day below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={on} onChange={(event) => setOn(event.target.checked)} />
            Copy bookings into Mindbody
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="writeback-until">Last day</Label>
            <Input id="writeback-until" type="date" value={last} onChange={(event) => setLast(event.target.value)} className="w-44" />
          </div>
          <Button
            disabled={busy || (on === enabled && last === until)}
            onClick={() =>
              run(async () => {
                await post({ action: "save", enabled: on, until: last });
                return on ? "On. Bookings are copied into Mindbody from now on." : "Off. Nothing is copied into Mindbody.";
              })
            }
          >
            Save
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {waiting ? `${waiting} booking change${waiting === 1 ? "" : "s"} waiting to be copied.` : "Nothing waiting."}{" "}
          {enabled && waiting ? (
            <button
              type="button"
              className="underline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await post({ action: "push_now" });
                  return `Copied ${result.pushed ?? 0}; ${result.failed ?? 0} didn't go through; ${result.skipped ?? 0} not needed.`;
                })
              }
            >
              Copy now
            </button>
          ) : null}
        </p>
        {problems.length ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">Mindbody didn&apos;t accept these (fix them in Mindbody by hand):</p>
            <ul className="divide-y rounded-md border text-sm">
              {problems.map((problem) => (
                <li key={problem.id} className="px-3 py-2">
                  <span className="font-medium">{problem.name}</span> · {problem.className} · {problem.when}
                  <span className="block text-xs text-red-700">{problem.error}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {message ? <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
      </CardContent>
    </Card>
  );
}
