"use client";

import { useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// The website schedule widget: the code to paste into the studio's site
// (where the Mindbody widget is today) and a live preview.
export function WidgetTab({ siteUrl, siteId }: { siteUrl: string; siteId: number | null }) {
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
            left and class descriptions, and resizes itself. View-only for now; member booking comes next.
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
      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <iframe src={url} title="Schedule widget preview" className="h-[720px] w-full border-0 border-t" />
      </Card>
    </div>
  );
}
