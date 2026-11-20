"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Settings: PT session rules and when SynqIQ's session balances take over.
export function PtRulesForm({ noShow, lateCancel, balancesFrom }: { noShow: boolean; lateCancel: boolean; balancesFrom: string }) {
  const router = useRouter();
  const [ns, setNs] = useState(noShow);
  const [lc, setLc] = useState(lateCancel);
  const [from, setFrom] = useState(balancesFrom);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>PT sessions</CardTitle>
        <CardDescription>
          Completing a session always uses one from the client&apos;s pack; an on-time cancel never does. Until the switch date, each
          pack&apos;s balance follows Mindbody every night; from then on SynqIQ&apos;s count is the only one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ns} onChange={(event) => setNs(event.target.checked)} />A no-show uses a session
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={lc} onChange={(event) => setLc(event.target.checked)} />A late cancel uses a session
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="balances-from">SynqIQ takes over session balances on</Label>
          <Input id="balances-from" type="date" className="w-44" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <Button
          disabled={busy || (ns === noShow && lc === lateCancel && from === balancesFrom)}
          onClick={async () => {
            setBusy(true);
            setMessage(null);
            const response = await fetch("/api/sessions/rules", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ noShow: ns, lateCancel: lc, balancesFrom: from }),
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
