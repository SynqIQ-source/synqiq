"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Settings: the studio's Mindbody connection. Off = every Mindbody sync and
// call stops for this studio (docs/mindbody-integration.md); SynqIQ keeps the
// data it already copied.
export function MindbodyConnectionForm({ studioName, disconnectedAt }: { studioName: string; disconnectedAt: string | null }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = !disconnectedAt;
  const save = async (next: boolean) => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/mindbody/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connected: next, confirm }),
    });
    const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
    setBusy(false);
    if (!json.success) return setError(json.error ?? "Didn't save.");
    setConfirm("");
    router.refresh();
  };
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Mindbody connection
          {connected ? <Badge>Connected</Badge> : <Badge variant="outline">Off</Badge>}
        </CardTitle>
        <CardDescription>
          {connected
            ? "SynqIQ copies your Mindbody data every night and uses it for class bookings, check-in and members. Switch it off when your studio no longer uses Mindbody (after API access ends Jan 23): every Mindbody sync and call stops at once. Everything already copied into SynqIQ stays."
            : `Off since ${new Date(disconnectedAt!).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Nothing is read from or sent to Mindbody.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {connected ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="max-w-xs"
              placeholder={`Type "${studioName}" to switch off`}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
            <Button
              variant="destructive"
              disabled={busy || confirm.trim().toLowerCase() !== studioName.trim().toLowerCase()}
              onClick={() => save(false)}
            >
              Switch Mindbody off
            </Button>
          </div>
        ) : (
          <Button variant="outline" disabled={busy} onClick={() => save(true)}>
            Reconnect Mindbody
          </Button>
        )}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
