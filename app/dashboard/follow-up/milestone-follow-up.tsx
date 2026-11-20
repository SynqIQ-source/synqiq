"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ordinal } from "@/lib/email/milestone-content";

export type MilestoneFollowUpItem = {
  id: string;
  name: string;
  count: number;
  className: string;
  when: string;
  subject: string;
  body: string;
};

// One member who reached a milestone in the instructor's class: the note is
// already filled in from the instructor's milestone email. Send or skip takes
// it off the list.
export function MilestoneFollowUp({ item, staffId }: { item: MilestoneFollowUpItem; staffId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(item.subject);
  const [body, setBody] = useState(item.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/email/milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, id: item.id, staffId }),
      });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) throw new Error(result.error ?? "That didn't work. Try again.");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That didn't work. Try again.");
      setBusy(false);
    }
  };

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{item.name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {ordinal(item.count)} class · {item.className}
            {item.when ? ` on ${item.when}` : ""}
          </p>
        </div>
        {open ? null : (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setOpen(true)}>
              Follow up
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => post({ action: "skip" })}>
              Skip
            </Button>
          </div>
        )}
      </div>
      {open ? (
        <div className="space-y-2">
          <Input value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} aria-label="Subject" />
          <Textarea value={body} rows={7} onChange={(event) => setBody(event.target.value)} aria-label="Message" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !subject.trim() || !body.trim()} onClick={() => post({ action: "send", subject, body })}>
              {busy ? "Sending…" : "Send"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">They see your name and the studio, and can reply straight back to you.</p>
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </li>
  );
}
