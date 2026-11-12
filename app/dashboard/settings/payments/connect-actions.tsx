"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ConnectActions({ connected, ready }: { connected: boolean; ready: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"onboard" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "onboard" | "refresh") {
    setBusy(action);
    setError(null);
    const response = await fetch("/api/payments/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; url?: string };
    setBusy(null);
    if (!response.ok || !result.success) return setError(result.error ?? "Something went wrong. Try again.");
    if (result.url) {
      window.location.href = result.url; // Stripe's hosted onboarding
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {!ready ? (
          <Button disabled={busy !== null} onClick={() => run("onboard")}>
            {busy === "onboard" ? "Opening Stripe…" : connected ? "Continue setup with Stripe" : "Connect Stripe"}
          </Button>
        ) : null}
        {connected ? (
          <Button variant="outline" disabled={busy !== null} onClick={() => run("refresh")}>
            {busy === "refresh" ? "Checking…" : "Check status"}
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
