"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ADJUSTMENT_KINDS,
  ADJUSTMENT_LABELS,
  CANCEL_REASONS,
  FREEZE_MONTHS,
  dollarsToCents,
  freezeEndDate,
  type CancelReason,
} from "@/lib/memberships/adjustments";
import type { AdjustmentKind } from "@/lib/memberships/shadow-billing";

const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm";

export type EditContract = {
  id: string;
  name: string;
  endDate: string | null;
  monthToMonth: boolean;
  // Scheduled dues before tax, for the early-termination estimate.
  autopays: { date: string; subtotalCents: number | null }[];
};

const plusDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const longDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const CANCEL_NOTICE_DAYS = 15;

export function AddBillingEdit({
  mindbodyClientId,
  contracts,
  today,
}: {
  mindbodyClientId: string;
  contracts: EditContract[];
  today: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<AdjustmentKind>("credit");
  const [contractId, setContractId] = useState("");
  const [unit, setUnit] = useState<"dollars" | "percent">("dollars");
  const [amount, setAmount] = useState("");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState("");
  const [freezeLength, setFreezeLength] = useState<string>("1");
  const [reasonCategory, setReasonCategory] = useState<CancelReason | "">("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const isDiscount = kind === "discount_once" || kind === "discount_ongoing";
  const isFreeze = kind === "freeze";
  const isCancel = kind === "cancel";
  const takesAmount = !isFreeze && !isCancel;
  const freezeEnd = isFreeze ? (freezeLength === "custom" ? endsOn : startsOn ? freezeEndDate(startsOn, Number(freezeLength)) : "") : "";

  function changeKind(next: AdjustmentKind) {
    setKind(next);
    setMessage(null);
    // Cancellations default to the agreements' 15 days' notice.
    if (next === "cancel") setStartsOn(plusDays(today, CANCEL_NOTICE_DAYS));
    else if (kind === "cancel") setStartsOn(today);
  }

  // 12-month agreements: 50% of the remaining dues if cancelled early.
  const chosen = contractId ? contracts.filter((contract) => contract.id === contractId) : contracts;
  const earlyTermination = isCancel
    ? chosen
        .filter((contract) => !contract.monthToMonth && contract.endDate && contract.endDate >= startsOn)
        .map((contract) => {
          const remaining = contract.autopays
            .filter((autopay) => autopay.date >= startsOn && autopay.date <= (contract.endDate as string))
            .reduce((sum, autopay) => sum + (autopay.subtotalCents ?? 0), 0);
          return { name: contract.name, endDate: contract.endDate as string, remaining, fee: Math.round(remaining / 2) };
        })
        .filter((row) => row.remaining > 0)
    : [];

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
        if (amountCents === null) return setMessage({ ok: false, text: "Enter a dollar amount, like 25 or 25.50." });
      }
    }
    if (isFreeze && !freezeEnd) return setMessage({ ok: false, text: "Pick how long the freeze lasts." });
    if (isCancel && !reasonCategory) return setMessage({ ok: false, text: "Pick why they're cancelling." });
    if (isCancel && reasonCategory === "other" && !reason.trim()) return setMessage({ ok: false, text: "Say why they're cancelling." });
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
          endsOn: isFreeze ? freezeEnd : kind === "discount_ongoing" ? endsOn || null : null,
          reason,
          reasonCategory: isCancel ? reasonCategory : null,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        setMessage({ ok: false, text: result.error ?? "Couldn't save. Try again." });
        return;
      }
      setAmount("");
      setEndsOn("");
      setReason("");
      setReasonCategory("");
      setMessage({ ok: true, text: "Saved. Upcoming charges and Shadow Billing now include it." });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1.5">
        <Label htmlFor="edit-kind">Change</Label>
        <select id="edit-kind" className={selectClass} value={kind} onChange={(event) => changeKind(event.target.value as AdjustmentKind)}>
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
          <Label htmlFor="edit-amount">{isDiscount && unit === "percent" ? "Percent off" : "Amount ($, before tax)"}</Label>
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
        <Label htmlFor="edit-start">
          {kind === "credit" || kind === "discount_once" ? "Starting with charges on/after" : isCancel ? "Stop billing from" : "Starts"}
        </Label>
        <Input id="edit-start" type="date" min={today} value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
        {isCancel ? (
          <p className="text-xs text-muted-foreground">
            Agreements need {CANCEL_NOTICE_DAYS} days&apos; notice before a billing date. No charges on or after this date.
          </p>
        ) : null}
      </div>
      {isFreeze ? (
        <div className="space-y-1.5">
          <Label htmlFor="edit-freeze-length">How long</Label>
          <select
            id="edit-freeze-length"
            className={selectClass}
            value={freezeLength}
            onChange={(event) => setFreezeLength(event.target.value)}
          >
            {FREEZE_MONTHS.map((months) => (
              <option key={months} value={String(months)}>
                {months} month{months === 1 ? "" : "s"}
              </option>
            ))}
            <option value="custom">Custom end date</option>
          </select>
          {freezeLength === "custom" ? (
            <Input
              aria-label="Freeze end date"
              type="date"
              min={startsOn || today}
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
            />
          ) : null}
          <p className="text-xs text-muted-foreground">
            {freezeEnd ? `Frozen ${longDay(startsOn)} – ${longDay(freezeEnd)}. ` : ""}Agreements allow 1–3 months with 15 days&apos; notice.
          </p>
        </div>
      ) : null}
      {kind === "discount_ongoing" ? (
        <div className="space-y-1.5">
          <Label htmlFor="edit-end">Ends (optional)</Label>
          <Input id="edit-end" type="date" min={startsOn || today} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
        </div>
      ) : null}
      {isCancel ? (
        <fieldset className="space-y-2 sm:col-span-2 lg:col-span-4">
          <legend className="text-sm font-medium">Why are they cancelling?</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {(Object.keys(CANCEL_REASONS) as CancelReason[]).map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="cancel-reason"
                  value={option}
                  checked={reasonCategory === option}
                  onChange={() => setReasonCategory(option)}
                />
                {CANCEL_REASONS[option]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {earlyTermination.length ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-2 lg:col-span-4 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {earlyTermination.map((row) => (
            <p key={row.name}>
              {row.name} runs to {longDay(row.endDate)}: early termination is 50% of the remaining {money(row.remaining)} ={" "}
              <strong>{money(row.fee)}</strong> (before tax). SynqIQ doesn&apos;t charge it yet.
            </p>
          ))}
        </div>
      ) : null}
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
        <Label htmlFor="edit-reason">{isCancel ? (reasonCategory === "other" ? "Details" : "Details (optional)") : "Reason"}</Label>
        <Textarea
          id="edit-reason"
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={isCancel ? "What they told us (kept for reports)" : "Why (kept in the history)"}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant={isCancel ? "destructive" : "default"} disabled={saving}>
          {saving ? "Saving…" : isCancel ? "Record cancellation" : `Add ${ADJUSTMENT_LABELS[kind].toLowerCase()}`}
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
