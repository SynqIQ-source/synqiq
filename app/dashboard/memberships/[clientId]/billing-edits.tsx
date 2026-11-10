"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ADJUSTMENT_KINDS, ADJUSTMENT_LABELS, dollarsToCents } from "@/lib/memberships/adjustments";
import type { AdjustmentKind } from "@/lib/memberships/shadow-billing";

const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm";

export function AddBillingEdit({
  mindbodyClientId,
  contracts,
  today,
}: {
  mindbodyClientId: string;
  contracts: { id: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<AdjustmentKind>("credit");
  const [contractId, setContractId] = useState("");
  const [unit, setUnit] = useState<"dollars" | "percent">("dollars");
  const [amount, setAmount] = useState("");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const isDiscount = kind === "discount_once" || kind === "discount_ongoing";
  const takesAmount = kind !== "freeze";
  const takesEnd = kind === "freeze" || kind === "discount_ongoing";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    let amountCents: number | null = null;
    let percent: number | null = null;
    if (takesAmount) {
      if (isDiscount && unit === "percent") {
        percent = Number(amount);
        if (!amount.trim() || !Number.isFinite(percent)) return setMessage({ ok: false, text: "Enter a percent." });
      } else {
        amountCents = dollarsToCents(amount);
        if (amountCents === null)
          return setMessage({
            ok: false,
            text: "Enter a dollar amount, like 25 or 25.50.",
          });
      }
    }
    setSaving(true);
    try {
      const response = await fetch("/api/memberships/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mindbodyClientId,
          kind,
          contractId: contractId || null,
          amountCents,
          percent,
          startsOn,
          endsOn: takesEnd ? endsOn || null : null,
          reason,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !result.success) {
        setMessage({
          ok: false,
          text: result.error ?? "Couldn't save. Try again.",
        });
        return;
      }
      setAmount("");
      setEndsOn("");
      setReason("");
      setMessage({
        ok: true,
        text: "Saved. Upcoming charges and Shadow Billing now include it.",
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1.5">
        <Label htmlFor="edit-kind">Change</Label>
        <select id="edit-kind" className={selectClass} value={kind} onChange={(event) => setKind(event.target.value as AdjustmentKind)}>
          {ADJUSTMENT_KINDS.map((option) => (
            <option key={option} value={option}>
              {ADJUSTMENT_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-contract">Applies to</Label>
        <select id="edit-contract" className={selectClass} value={contractId} onChange={(event) => setContractId(event.target.value)}>
          <option value="">All memberships</option>
          {contracts.map((contract) => (
            <option key={contract.id} value={contract.id}>
              {contract.name}
            </option>
          ))}
        </select>
      </div>
      {takesAmount ? (
        <div className="space-y-1.5">
          <Label htmlFor="edit-amount">{isDiscount && unit === "percent" ? "Percent off" : "Amount ($)"}</Label>
          <div className="flex gap-2">
            <Input
              id="edit-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={unit === "percent" && isDiscount ? "10" : "25.00"}
            />
            {isDiscount ? (
              <select
                aria-label="Dollars or percent"
                className={`${selectClass} w-20`}
                value={unit}
                onChange={(event) => setUnit(event.target.value as "dollars" | "percent")}
              >
                <option value="dollars">$</option>
                <option value="percent">%</option>
              </select>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="edit-start">{kind === "credit" || kind === "discount_once" ? "Starting with charges on/after" : "Starts"}</Label>
        <Input id="edit-start" type="date" min={today} value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
      </div>
      {takesEnd ? (
        <div className="space-y-1.5">
          <Label htmlFor="edit-end">{kind === "freeze" ? "Ends" : "Ends (optional)"}</Label>
          <Input id="edit-end" type="date" min={startsOn || today} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
          {kind === "freeze" ? (
            <p className="text-xs text-muted-foreground">Agreements allow 1–3 month freezes with 15 days&apos; notice.</p>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
        <Label htmlFor="edit-reason">Reason</Label>
        <Textarea
          id="edit-reason"
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why (kept in the history)"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : `Add ${ADJUSTMENT_LABELS[kind].toLowerCase()}`}
        </Button>
        {message ? (
          <p role="status" className={`text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>
            {message.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function CancelBillingEdit({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/memberships/adjustments/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!response.ok || !result.success) {
        setError(result.error ?? "Couldn't cancel. Try again.");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-w-56 flex-col items-end gap-2">
      <Input
        aria-label="Reason for cancelling"
        placeholder="Reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={500}
      />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>
          Keep
        </Button>
        <Button type="button" size="sm" onClick={confirm} disabled={saving || !reason.trim()}>
          {saving ? "Saving…" : label}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
