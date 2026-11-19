"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_SOURCES, renderNewsletter, type NewsletterFilters } from "@/lib/email/newsletter-content";
import type { EmailKit } from "@/lib/email/studio-templates";

type Newsletter = {
  id: string;
  subject: string;
  body: string;
  filters: NewsletterFilters;
  status: string;
  scheduledFor: string | null;
  sentAt: string | null;
  recipients: number | null;
  sent: number;
  failed: number;
  unsubscribed: number;
};

const TYPES = [
  { value: "member", label: "Members" },
  { value: "lead", label: "Leads" },
  { value: "guest", label: "Guests" },
];
const MEMBER_STATUS = [
  { value: "active", label: "Active" },
  { value: "frozen", label: "Frozen / on hold" },
  { value: "cancelled", label: "Cancelled / expired" },
];

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/email/newsletters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; email?: string; count?: number };
  if (!response.ok || !json.success) throw new Error(json.error ?? "Something went wrong.");
  return json;
}

function Checks({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={value.includes(option.value)}
            onChange={(event) => onChange(event.target.checked ? [...value, option.value] : value.filter((item) => item !== option.value))}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

export function NewsletterComposer({
  kit,
  newsletter,
  defaultWhen,
  timezone,
  hasFooter,
}: {
  kit: EmailKit;
  newsletter: Newsletter;
  defaultWhen: string;
  timezone: string;
  hasFooter: boolean;
}) {
  const router = useRouter();
  const editable = newsletter.status === "draft";
  const [subject, setSubject] = useState(newsletter.subject);
  const [body, setBody] = useState(newsletter.body);
  const [filters, setFilters] = useState<NewsletterFilters>(newsletter.filters);
  const [when, setWhen] = useState(defaultWhen);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    if (!editable) return;
    let stale = false;
    setCount(null);
    const timer = setTimeout(() => {
      post({ action: "count", filters: JSON.parse(filterKey) })
        .then((result) => !stale && setCount(result.count ?? 0))
        .catch(() => !stale && setCount(-1));
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [filterKey, editable]);

  const update = (patch: Partial<NewsletterFilters>) => {
    setFilters((current) => {
      const next = { ...current, ...patch };
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0))
          delete next[key as keyof NewsletterFilters];
      }
      return next;
    });
    setDirty(true);
  };
  const run = async (work: () => Promise<string>, refresh = true) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await work() });
      if (refresh) router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    await post({ action: "save", id: newsletter.id, subject, body, filters });
    setDirty(false);
  };

  const preview = renderNewsletter(kit, subject || "(no subject)", body || "Your message shows here.", {
    firstName: "Sam",
    unsubscribeUrl: "#",
  });
  const types = filters.types ?? [];
  const showMemberStatus = types.length === 0 || types.includes("member");
  const showSource = types.length === 0 || types.some((type) => type !== "member");

  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link href="/dashboard/email/newsletters" className="text-muted-foreground underline underline-offset-4">
          All newsletters
        </Link>
      </p>

      {newsletter.status !== "draft" ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
            {newsletter.status === "sent" ? (
              <span>
                Sent {newsletter.sentAt} to <strong>{newsletter.sent}</strong> people
                {newsletter.failed ? ` (${newsletter.failed} failed)` : ""}. {newsletter.unsubscribed} unsubscribed.
              </span>
            ) : newsletter.status === "sending" ? (
              <span>Sending now to {newsletter.recipients} people.</span>
            ) : (
              <span>
                Scheduled for <strong>{newsletter.scheduledFor}</strong> to about <strong>{newsletter.recipients}</strong> people (the list
                is checked again when it sends).
              </span>
            )}
            {newsletter.status === "scheduled" ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await post({ action: "unschedule", id: newsletter.id });
                    return "Unscheduled. It's a draft again.";
                  })
                }
              >
                Unschedule to edit
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Message</CardTitle>
              <CardDescription>Uses your studio header and footer from Email &gt; Templates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={subject}
                  maxLength={200}
                  disabled={!editable}
                  onChange={(event) => {
                    setSubject(event.target.value);
                    setDirty(true);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="body">Message</Label>
                <Textarea
                  id="body"
                  rows={16}
                  value={body}
                  disabled={!editable}
                  onChange={(event) => {
                    setBody(event.target.value);
                    setDirty(true);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Blank line = new paragraph · <code>## Heading</code> · <code>**bold**</code> · <code>[link text](https://…)</code> · a
                  line with <code>![](https://…/photo.jpg)</code> = picture · <code>{"{{first_name}}"}</code>
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Who gets it</CardTitle>
              <CardDescription>
                Only people who agreed to receive emails and haven&apos;t unsubscribed. Leave a box empty for everyone.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <fieldset disabled={!editable} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Checks options={TYPES} value={types} onChange={(next) => update({ types: next })} />
                </div>
                {showMemberStatus ? (
                  <div className="space-y-1.5">
                    <Label>Member status</Label>
                    <Checks
                      options={MEMBER_STATUS}
                      value={filters.member_status ?? []}
                      onChange={(next) => update({ member_status: next })}
                    />
                  </div>
                ) : null}
                {showSource ? (
                  <div className="space-y-1.5">
                    <Label>Lead source</Label>
                    <Checks
                      options={Object.entries(LEAD_SOURCES).map(([value, label]) => ({ value, label }))}
                      value={filters.sources ?? []}
                      onChange={(next) => update({ sources: next })}
                    />
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Added from</Label>
                    <Input
                      type="date"
                      value={filters.created_from ?? ""}
                      onChange={(event) => update({ created_from: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Added to</Label>
                    <Input type="date" value={filters.created_to ?? ""} onChange={(event) => update({ created_to: event.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Last visit from</Label>
                    <Input
                      type="date"
                      value={filters.visited_from ?? ""}
                      onChange={(event) => update({ visited_from: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Last visit to</Label>
                    <Input type="date" value={filters.visited_to ?? ""} onChange={(event) => update({ visited_to: event.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="away">Hasn&apos;t visited in (days)</Label>
                  <Input
                    id="away"
                    type="number"
                    min={1}
                    max={3650}
                    className="w-32"
                    value={filters.not_visited_days ?? ""}
                    onChange={(event) => update({ not_visited_days: event.target.value ? Number(event.target.value) : undefined })}
                  />
                </div>
              </fieldset>
              {editable ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm" role="status">
                  {count === null ? (
                    "Counting…"
                  ) : count < 0 ? (
                    "Couldn't count right now."
                  ) : (
                    <>
                      <strong>{count.toLocaleString()}</strong> people match
                    </>
                  )}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {editable ? (
            <Card>
              <CardHeader>
                <CardTitle>Test &amp; schedule</CardTitle>
                <CardDescription>Times are studio time ({timezone}).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!hasFooter ? (
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Add your studio&apos;s mailing address to the footer in{" "}
                    <Link href="/dashboard/email" className="underline">
                      Email &gt; Templates
                    </Link>{" "}
                    before scheduling. Marketing emails must include it.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await save();
                        return "Draft saved.";
                      })
                    }
                  >
                    {dirty ? "Save draft" : "Saved"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await post({ action: "test", subject, body });
                        return `Test sent to ${result.email}.`;
                      }, false)
                    }
                  >
                    Send me a test
                  </Button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="when">Send at</Label>
                    <Input id="when" type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} />
                  </div>
                  <Button
                    disabled={busy || !hasFooter || !count}
                    onClick={() =>
                      run(async () => {
                        await save();
                        const result = await post({ action: "schedule", id: newsletter.id, when });
                        return `Scheduled to ${result.count} people.`;
                      })
                    }
                  >
                    Schedule
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await post({ action: "delete", id: newsletter.id });
                        router.push("/dashboard/email/newsletters");
                        return "Deleted.";
                      }, false)
                    }
                  >
                    Delete draft
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
          {message ? (
            <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
              {message.text}
            </p>
          ) : null}
        </div>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription className="truncate">Subject: {preview.subject}</CardDescription>
          </CardHeader>
          <CardContent>
            <iframe title="Newsletter preview" srcDoc={preview.html} sandbox="" className="h-[720px] w-full rounded-md border bg-white" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
