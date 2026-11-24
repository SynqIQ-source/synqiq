"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PtRules = {
  pilot: boolean;
  noShow: boolean;
  lateCancel: boolean;
  noShowPayPercent: number;
  lateCancelPayPercent: number;
  balancesFrom: string;
};

// Settings: the trainer sessions pilot switch, what a no-show / late cancel
// does (uses a session? what share of the trainer's pay?), and when SynqIQ's
// session balances take over from Mindbody.
export function PtRulesForm(initial: PtRules) {
  const router = useRouter();
  const [rules, setRules] = useState<PtRules>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<PtRules>) => setRules((current) => ({ ...current, ...patch }));
  const changed = JSON.stringify(rules) !== JSON.stringify(initial);
  const percentInput = (id: string, value: number, onChange: (value: number) => void) => (
    <Input
      id={id}
      type="number"
      min={0}
      max={100}
      step={5}
      className="h-9 w-24"
      value={value}
      onChange={(event) => onChange(Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))))}
    />
  );
  return (
    <Card className="mt-6" id="pt-sessions">
      <CardHeader>
        <CardTitle>PT sessions</CardTitle>
        <CardDescription>
          Completing a session always uses one from the client&apos;s pack and pays the trainer; an on-time cancel does neither. Until the
          switch date, each pack&apos;s balance follows Mindbody every night; from then on SynqIQ&apos;s count is the only one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={rules.pilot} onChange={(event) => set({ pilot: event.target.checked })} />
          <span>
            <span className="flex items-center gap-2 font-medium">
              Trainer sessions pilot <Badge variant="outline">Pilot</Badge>
            </span>
            <span className="block text-muted-foreground">
              Turns on the Trainer Calendar, Trainer Session Pay and Session Reconciliation. Nothing is written to
              Mindbody; trainer pay stays practice (not in the payroll export).
            </span>
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={rules.noShow} onChange={(event) => set({ noShow: event.target.checked })} />A no-show uses a
              session
            </label>
            <div className="flex items-center gap-2 text-sm">
              <Label htmlFor="no-show-pay">Trainer is paid</Label>
              {percentInput("no-show-pay", rules.noShowPayPercent, (value) => set({ noShowPayPercent: value }))}
              <span>% of the session pay</span>
            </div>
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={rules.lateCancel} onChange={(event) => set({ lateCancel: event.target.checked })} />A late
              cancel uses a session
            </label>
            <div className="flex items-center gap-2 text-sm">
              <Label htmlFor="late-cancel-pay">Trainer is paid</Label>
              {percentInput("late-cancel-pay", rules.lateCancelPayPercent, (value) => set({ lateCancelPayPercent: value }))}
              <span>% of the session pay</span>
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="balances-from">SynqIQ takes over session balances on</Label>
          <Input
            id="balances-from"
            type="date"
            className="w-44"
            value={rules.balancesFrom}
            onChange={(event) => set({ balancesFrom: event.target.value })}
          />
        </div>
        <Button
          disabled={busy || !changed}
          onClick={async () => {
            setBusy(true);
            setMessage(null);
            const response = await fetch("/api/sessions/rules", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(rules),
            });
            const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
            setBusy(false);
            setMessage(json.success ? { ok: true, text: "Saved." } : { ok: false, text: json.error ?? "Didn't save." });
            if (json.success) router.refresh();
          }}
        >
          Save
        </Button>
        {message ? <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
      </CardContent>
    </Card>
  );
}
