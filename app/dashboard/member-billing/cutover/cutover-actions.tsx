"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/billing/cutover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown> & { success?: boolean; error?: string };
  if (!response.ok || !json.success) throw new Error(json.error ?? "Something went wrong.");
  return json;
}

export function CutoverActions({ snapshotTaken, locked, activated }: { snapshotTaken: boolean; locked: boolean; activated: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
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
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={snapshotTaken ? "outline" : "default"}
          disabled={busy || locked}
          onClick={() =>
            run(async () => {
              const result = await post({ action: "snapshot" });
              return `Snapshot saved: ${result.contracts} contracts${result.noLongerActive ? `, ${result.noLongerActive} no longer active in Mindbody` : ""}.`;
            })
          }
        >
          {snapshotTaken ? "Refresh snapshot" : "Take snapshot"}
        </Button>
        {snapshotTaken ? (
          <Button
            variant="outline"
            disabled={busy || (locked && activated > 0)}
            onClick={() =>
              run(async () => {
                await post({ action: locked ? "unlock" : "lock" });
                return locked ? "Unlocked." : "Locked. It's now safe to end the autopays in Mindbody.";
              })
            }
          >
            {locked ? "Unlock" : "Lock snapshot"}
          </Button>
        ) : null}
        {locked ? (
          confirmActivate ? (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setConfirmActivate(false);
                    const result = await post({ action: "activate" });
                    return `Created ${result.created} schedules. ${result.waiting} still need a card.`;
                  })
                }
              >
                Yes, create schedules
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmActivate(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button disabled={busy} onClick={() => setConfirmActivate(true)}>
              Create schedules for members with cards
            </Button>
          )
        ) : null}
      </div>
      {confirmActivate ? (
        <p className="text-sm text-amber-800">
          This creates SynqIQ billing schedules for every planned contract whose payer has a card in Stripe. They charge from each
          member&apos;s first bill on or after the cutover, once live billing is switched on. Make sure Mindbody&apos;s autopays are ended
          first.
        </p>
      ) : null}
      {message ? <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
    </div>
  );
}

export function RowToggle({ id, included }: { id: string; included: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={busy}
        className="text-xs underline underline-offset-2 disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await post({ action: included ? "exclude" : "include", id });
            router.refresh();
          } catch (problem) {
            setError(problem instanceof Error ? problem.message : "Didn't save.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {included ? "Leave out" : "Include"}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}

// Getting cards into Stripe: preview the Mindbody/Stripe card file, and email
// "add your card" links to payers who still need one (confirm the count first).
export function CardTools() {
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [links, setLinks] = useState<{ due: number; recentlySent: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await work();
      if (text) setMessage({ ok: true, text });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };
  const missing = (preview?.missingColumns as string[] | undefined) ?? [];
  const problems = (preview?.problems as string[] | undefined) ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2 rounded-lg border p-4">
        <h3 className="font-semibold">Cards from Mindbody</h3>
        <p className="text-sm text-muted-foreground">
          When Stripe finishes loading Mindbody&apos;s card export, it sends a file linking each member to their new Stripe card. Choose it
          here to see who it covers. This only previews; nothing is saved yet.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          className="text-sm"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            run(async () => {
              const csv = await file.text();
              setPreview(await post({ action: "import_preview", csv }));
            });
          }}
        />
        {preview ? (
          missing.length ? (
            <p className="text-sm text-amber-800">
              The file needs columns for the Mindbody client ID, Stripe customer and Stripe card. Missing: {missing.join(", ")}. Send it to
              me and I&apos;ll map its columns.
            </p>
          ) : (
            <div className="text-sm">
              <p>
                {String(preview.rows)} cards in the file; <strong>{String(preview.matched)}</strong> belong to people in the plan.{" "}
                {String(preview.payersWithoutCard)} payers in the plan aren&apos;t in the file.
              </p>
              {problems.length ? (
                <ul className="mt-1 list-disc pl-5 text-amber-800">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )
        ) : null}
      </div>
      <div className="space-y-2 rounded-lg border p-4">
        <h3 className="font-semibold">Ask members to add a card</h3>
        <p className="text-sm text-muted-foreground">
          Emails each payer who still needs a card a secure link (wording: Email &gt; Templates &gt; &quot;Add your card&quot;). At most
          once a week per person.
        </p>
        {links ? (
          links.due ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">
                Send to <strong>{links.due}</strong> people?
              </span>
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await post({ action: "card_links_send", count: links.due });
                    setLinks(null);
                    return `Sent ${result.sent}.${result.noEmail ? ` ${result.noEmail} have no email address.` : ""}`;
                  })
                }
              >
                Yes, send {links.due} emails
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setLinks(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <p className="text-sm">
              Nobody to email right now{links.recentlySent ? ` (${links.recentlySent} were emailed this week)` : ""}.
            </p>
          )
        ) : (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                setLinks((await post({ action: "card_links_preview" })) as unknown as { due: number; recentlySent: number });
              })
            }
          >
            Check who would get one
          </Button>
        )}
      </div>
      {message ? <p className={`text-sm lg:col-span-2 ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
    </div>
  );
}
