"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MILESTONE_FIELDS, milestoneLabel, ordinal, type Milestone } from "@/lib/email/milestone-content";

export type TemplateRow = {
  milestone: Milestone;
  subject: string;
  body: string;
  enabled: boolean;
  disabledByAdmin: boolean;
  saved: boolean;
};
export type PendingEmail = {
  id: string;
  name: string;
  count: number;
  className: string;
  when: string;
  subject: string;
  body: string;
  status: string;
  decided: string;
};

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/email/milestones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; email?: string };
  if (!response.ok || !json.success) throw new Error(json.error ?? "Something went wrong.");
  return json;
}

function useRun() {
  const router = useRouter();
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
  const note = message ? (
    <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
      {message.text}
    </p>
  ) : null;
  return { busy, run, note };
}

function PendingCard({ item, ownerId }: { item: PendingEmail; ownerId: string }) {
  const [subject, setSubject] = useState(item.subject);
  const [body, setBody] = useState(item.body);
  const { busy, run, note } = useRun();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {item.name} · {ordinal(item.count)} class
        </CardTitle>
        <CardDescription>
          {item.className} on {item.when}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} aria-label="Subject" />
        <Textarea
          value={body}
          rows={8}
          className="min-h-48 [field-sizing:fixed]"
          onChange={(event) => setBody(event.target.value)}
          aria-label="Message"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await post({ action: "send", id: item.id, staffId: ownerId, subject, body });
                return `Sent to ${result.email}.`;
              })
            }
          >
            Approve &amp; send
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await post({ action: "skip", id: item.id, staffId: ownerId });
                return "Skipped.";
              })
            }
          >
            Skip
          </Button>
        </div>
        {note}
      </CardContent>
    </Card>
  );
}

function TemplateCard({ row, ownerId, isAdmin }: { row: TemplateRow; ownerId: string; isAdmin: boolean }) {
  const [subject, setSubject] = useState(row.subject);
  const [body, setBody] = useState(row.body);
  const [enabled, setEnabled] = useState(row.enabled);
  const { busy, run, note } = useRun();
  const live = enabled && !row.disabledByAdmin;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {milestoneLabel(row.milestone)}
          {live ? <Badge>On</Badge> : <Badge variant="outline">Off</Badge>}
          {row.disabledByAdmin ? <Badge variant="secondary">Turned off by a Club Admin</Badge> : null}
          {!row.saved ? <span className="text-xs font-normal text-muted-foreground">Suggested wording</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Subject</Label>
          <Input value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Message</Label>
          <Textarea value={body} rows={8} className="min-h-48 [field-sizing:fixed]" onChange={(event) => setBody(event.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Put this on my Follow Up page when a member reaches it (you still send each one yourself)
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await post({ action: "save_template", staffId: ownerId, milestone: row.milestone, subject, body, enabled });
                return "Saved.";
              })
            }
          >
            Save
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await post({ action: "test", staffId: ownerId, subject, body });
                return `Test sent to ${result.email}.`;
              })
            }
          >
            Send me a test
          </Button>
          {isAdmin ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await post({ action: "admin_disable", staffId: ownerId, milestone: row.milestone, disabled: !row.disabledByAdmin });
                  return row.disabledByAdmin ? "Allowed again." : "Turned off for this instructor.";
                })
              }
            >
              {row.disabledByAdmin ? "Allow again" : "Turn off (Club Admin)"}
            </Button>
          ) : null}
        </div>
        {note}
      </CardContent>
    </Card>
  );
}

export function MilestonesEditor({
  isAdmin,
  ownerId,
  mine,
  instructors,
  templates,
  pending,
  history,
}: {
  isAdmin: boolean;
  ownerId: string;
  mine: boolean;
  instructors: { id: string; name: string }[];
  templates: TemplateRow[];
  pending: PendingEmail[];
  history: PendingEmail[];
}) {
  const router = useRouter();
  return (
    <div className="space-y-8">
      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="who">Instructor</Label>
          <select
            id="who"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={ownerId}
            onChange={(event) => router.push(`/dashboard/email/milestones?staff=${event.target.value}`)}
          >
            {!instructors.some((row) => row.id === ownerId) ? <option value={ownerId}>Me</option> : null}
            {instructors.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Waiting for {mine ? "your" : "an"} OK ({pending.length})
        </h2>
        {pending.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {pending.map((item) => (
              <PendingCard key={item.id} item={item} ownerId={ownerId} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing waiting. When a member reaches a milestone in this instructor&apos;s class and that email is on, it shows up here the
            next morning. Not approved within 14 days = not sent.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{mine ? "Your" : "Their"} milestone emails</h2>
        <p className="text-sm text-muted-foreground">
          Counts every class the member has taken at the studio (history from January 2024). Fields you can use:{" "}
          {Object.entries(MILESTONE_FIELDS).map(([name, label], index) => (
            <span key={name} title={label}>
              {index ? ", " : ""}
              <code>{`{{${name}}}`}</code>
            </span>
          ))}
          .
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {templates.map((row) => (
            <TemplateCard key={`${ownerId}-${row.milestone}`} row={row} ownerId={ownerId} isAdmin={isAdmin} />
          ))}
        </div>
      </section>

      {history.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Recent</h2>
          <Card>
            <CardContent className="divide-y p-0">
              {history.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span>
                    {item.name} · {ordinal(item.count)} class · {item.className}
                  </span>
                  <span className="text-muted-foreground">
                    {item.status === "sent"
                      ? "Sent"
                      : item.status === "skipped"
                        ? "Skipped"
                        : item.status === "expired"
                          ? "Expired"
                          : "Didn't send"}{" "}
                    {item.decided}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
