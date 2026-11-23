"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

// Club Admin: add a trainer session rate from a start date.
export function RateForm({
  trainers,
  types,
  today,
}: {
  trainers: { id: string; name: string }[];
  types: { id: number; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const [staffId, setStaffId] = useState(trainers[0]?.id ?? "");
  const [typeId, setTypeId] = useState("");
  const [method, setMethod] = useState<"percent" | "flat">("percent");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/trainer-sessions/rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        staffId,
        sessionTypeId: typeId === "" ? null : Number(typeId),
        method,
        percent: method === "percent" ? amount : undefined,
        flatDollars: method === "flat" ? amount : undefined,
        effectiveFrom: from,
        note,
      }),
    });
    const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
    setBusy(false);
    if (!json.success) return setMessage({ ok: false, text: json.error ?? "Didn't save." });
    setMessage({ ok: true, text: "Saved." });
    setAmount("");
    setNote("");
    router.refresh();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a rate</CardTitle>
        <CardDescription>
          Percent of the session&apos;s value (the pack price divided by its sessions) or a flat amount per session. Sessions on or after the
          start date use it; pay already recorded doesn&apos;t change.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">Trainer</span>
          <select className={selectClass} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {trainers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">Session type</span>
          <select className={selectClass} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">Any (default)</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">Paid</span>
          <select className={selectClass} value={method} onChange={(e) => setMethod(e.target.value as "percent" | "flat")}>
            <option value="percent">% of session value</option>
            <option value="flat">$ per session</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">{method === "percent" ? "Percent" : "Dollars"}</span>
          <Input
            inputMode="decimal"
            className="h-9 w-24"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={method === "percent" ? "65" : "20.00"}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">Starts</span>
          <Input type="date" className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex-1 space-y-1 text-sm">
          <span className="block text-muted-foreground">Note (optional)</span>
          <Input className="h-9" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <Button disabled={busy || !staffId || !amount.trim()} onClick={save}>
          {busy ? <Loader2 className="animate-spin" /> : null} Add rate
        </Button>
        {message ? <p className={`w-full text-sm ${message.ok ? "text-emerald-700" : "text-destructive"}`}>{message.text}</p> : null}
      </CardContent>
    </Card>
  );
}
