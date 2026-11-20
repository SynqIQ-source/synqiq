"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Reader = { id: string; label: string; deviceType: string | null };

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/terminal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!response.ok || !json.success) throw new Error(json.error ?? "Something went wrong.");
}

// Settings > Payments: the desk card readers (Stripe smart readers such as the
// WisePOS E or S700). Tap, chip, swipe, Apple Pay and Google Pay; they work
// with any browser, iPads included.
export function ReadersCard({ readers, testMode, needsAddress }: { readers: Reader[]; testMode: boolean; needsAddress: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("Front desk");
  const [address, setAddress] = useState({ line1: "", city: "", state: "TX", postalCode: "" });
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
  const register = (registrationCode: string, name: string) =>
    run(async () => {
      await post({ action: "register", code: registrationCode, label: name, address: needsAddress ? address : null });
      setCode("");
      return `${name} is ready. It shows up as "Tap / insert card" at checkout.`;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Card readers</CardTitle>
        <CardDescription>
          Stripe smart readers (WisePOS E or S700, ordered from your Stripe Dashboard) take tap, chip, swipe, Apple Pay and Google Pay. They
          connect over Wi-Fi, so they work with any computer or iPad at the desk.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {readers.length ? (
          <ul className="divide-y rounded-md border">
            {readers.map((reader) => (
              <li key={reader.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  <span className="font-medium">{reader.label}</span>
                  {reader.deviceType ? (
                    <span className="block text-xs text-muted-foreground">{reader.deviceType.replace(/_/g, " ")}</span>
                  ) : null}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await post({ action: "remove", id: reader.id });
                      return "Removed.";
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No readers yet.</p>
        )}
        <div className="space-y-2">
          <p className="font-medium">Add a reader</p>
          <p className="text-xs text-muted-foreground">On the reader: Settings → Generate pairing code. Type the three words it shows.</p>
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-56"
              placeholder="Pairing code (e.g. apple-grape-fig)"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <Input className="max-w-44" placeholder="Name" value={label} onChange={(event) => setLabel(event.target.value)} />
          </div>
          {needsAddress ? (
            <div className="grid gap-2 sm:grid-cols-4">
              <Input
                className="sm:col-span-2"
                placeholder="Studio street address"
                value={address.line1}
                onChange={(event) => setAddress({ ...address, line1: event.target.value })}
              />
              <Input placeholder="City" value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })} />
              <div className="flex gap-2">
                <Input
                  className="w-16"
                  placeholder="State"
                  value={address.state}
                  onChange={(event) => setAddress({ ...address, state: event.target.value })}
                />
                <Input
                  placeholder="ZIP"
                  value={address.postalCode}
                  onChange={(event) => setAddress({ ...address, postalCode: event.target.value })}
                />
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !code.trim() || !label.trim()} onClick={() => register(code.trim(), label.trim())}>
              Add reader
            </Button>
            {testMode ? (
              <Button variant="outline" disabled={busy} onClick={() => register("simulated-wpe", "Test reader")}>
                Add a simulated reader (test mode)
              </Button>
            ) : null}
          </div>
        </div>
        {message ? <p className={message.ok ? "text-emerald-700" : "text-red-700"}>{message.text}</p> : null}
      </CardContent>
    </Card>
  );
}
