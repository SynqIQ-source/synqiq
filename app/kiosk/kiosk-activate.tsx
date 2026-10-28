"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Shown on /kiosk until the iPad is paired. An admin gets the code from
// Settings -> CRM -> Kiosk devices.
export function KioskActivate() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const response = await fetch("/api/kiosk/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Couldn't pair this iPad.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't pair this iPad.");
      setStatus("idle");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Set up this check-in iPad</CardTitle>
          <CardDescription className="text-base">
            An admin can get a pairing code in SynqIQ under Settings &rarr; CRM &rarr; Kiosk devices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="activation-code" className="text-base">
                Pairing code
              </Label>
              <Input
                id="activation-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                className="h-14 text-center font-mono text-2xl tracking-[0.3em]"
                placeholder="ABCD2345"
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="h-14 w-full text-lg" disabled={status === "saving" || code.length < 8}>
              {status === "saving" ? "Pairing…" : "Pair this iPad"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
