"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberSearch } from "../memberships/member-search";

type Tester = { id: string; name: string };

// The website schedule widget: the code to paste into the studio's site
// (where the Mindbody widget is today), a live preview, and member online
// booking (testers only during the parallel run).
export function WidgetTab({
  siteUrl,
  siteId,
  portalMode,
  testers,
}: {
  siteUrl: string;
  siteId: number | null;
  portalMode: string;
  testers: Tester[];
}) {
  const [copied, setCopied] = useState(false);
  if (!siteId) return <p className="text-sm text-muted-foreground">Connect Mindbody first; the widget uses the studio&apos;s site ID.</p>;
  const url = `${siteUrl}/widget/schedule?studio=${siteId}`;
  const snippet = `<iframe id="synqiq-schedule" src="${url}" title="Class schedule" loading="lazy" style="width:100%;min-height:640px;border:0;"></iframe>
<script>
  window.addEventListener("message", function (event) {
    if (event.origin !== "${siteUrl}" || !event.data || event.data.type !== "synqiq-widget-height") return;
    document.getElementById("synqiq-schedule").style.height = event.data.height + "px";
  });
</script>`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Website schedule widget</CardTitle>
          <CardDescription>
            Paste this where the Mindbody schedule widget is on your website. It shows the next 21 days of SynqIQ&apos;s calendar with spots
            left and class descriptions, and resizes itself. Book buttons appear once online booking opens to everyone at the switch.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">{snippet}</pre>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={copy}>
              <Copy /> {copied ? "Copied" : "Copy code"}
            </Button>
            <Button asChild variant="outline">
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink /> Open the widget
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <MemberBookingCard siteUrl={siteUrl} siteId={siteId} portalMode={portalMode} testers={testers} />

      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <iframe src={url} title="Schedule widget preview" className="h-[720px] w-full border-0 border-t" />
      </Card>
    </div>
  );
}

function MemberBookingCard({
  siteUrl,
  siteId,
  portalMode,
  testers,
}: {
  siteUrl: string;
  siteId: number;
  portalMode: string;
  testers: Tester[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const bookingUrl = `${siteUrl}/m/${siteId}`;

  async function change(id: string, remove: boolean) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/member-portal/testers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mindbodyClientId: id, remove }),
      });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) setError(result.error ?? "Couldn't save.");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Member online booking</CardTitle>
        <CardDescription>
          Members sign in with their email and a password they choose, then book, join waitlists and cancel. Bookings go into SynqIQ only;
          Mindbody isn&apos;t changed.{" "}
          {portalMode === "testers"
            ? "For now only the testers below can create a password (they get the email) and book. Nobody else is emailed."
            : portalMode === "open"
              ? "Open to every member."
              : "Turned off."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={bookingUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> Member booking page
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={`${siteUrl}/widget/schedule?studio=${siteId}&booking=1`} target="_blank" rel="noreferrer">
              <ExternalLink /> Widget with Book buttons (test)
            </a>
          </Button>
        </div>
        {portalMode === "testers" ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Testers</p>
            <MemberSearch
              initialQuery=""
              endpoint="/api/check-in/search"
              onPick={(person) => change(person.id, false)}
              placeholder="Add a tester: name or email"
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {testers.length ? (
              <ul className="divide-y rounded-md border">
                {testers.map((tester) => (
                  <li key={tester.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    {tester.name}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => change(tester.id, true)}
                      aria-label={`Remove ${tester.name}`}
                    >
                      <X /> Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No testers yet. Add yourself to try it.</p>
            )}
            <p className="text-xs text-muted-foreground">
              To test: add yourself, open the member booking page, choose &quot;First time? Create your password&quot;, and use the email
              the studio has for you.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
