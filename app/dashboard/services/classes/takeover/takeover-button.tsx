"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TakeoverButton() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/class-takeover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        adopted?: number;
        endDatesRemoved?: number;
      };
      if (!response.ok || !result.success) throw new Error(result.error ?? "Didn't finish. Press it again to pick up where it stopped.");
      setMessage({ ok: true, text: `Done: ${result.adopted} class times are SynqIQ's now; ${result.endDatesRemoved} end dates removed.` });
      router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Didn't work." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-sm">
        Type <span className="font-mono font-medium">TAKE OVER</span> to confirm.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        <Button variant="destructive" disabled={busy || confirm !== "TAKE OVER"} onClick={run}>
          {busy ? "Taking over…" : "Take over the schedule"}
        </Button>
      </div>
      {message ? <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
    </div>
  );
}
