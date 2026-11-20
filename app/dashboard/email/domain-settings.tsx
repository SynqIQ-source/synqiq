"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Domain = { domain: string | null; verified: boolean };

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/email/domains", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; message?: string; ready?: boolean };
  if (!response.ok || !json.success) throw new Error(json.error ?? "Something went wrong.");
  return json;
}

function DomainRow({
  kind,
  label,
  help,
  placeholder,
  value,
}: {
  kind: "from" | "relay";
  label: string;
  help: string;
  placeholder: string;
  value: Domain;
}) {
  const router = useRouter();
  const [domain, setDomain] = useState(value.domain ?? "");
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
  return (
    <div className="space-y-2">
      <Label htmlFor={`domain-${kind}`} className="flex items-center gap-2">
        {label}
        {value.domain ? value.verified ? <Badge>In use</Badge> : <Badge variant="outline">Not verified yet</Badge> : null}
      </Label>
      <p className="text-xs text-muted-foreground">{help}</p>
      <div className="flex flex-wrap gap-2">
        <Input
          id={`domain-${kind}`}
          className="max-w-xs"
          value={domain}
          placeholder={placeholder}
          onChange={(event) => setDomain(event.target.value)}
        />
        <Button
          variant="outline"
          disabled={busy || domain.trim() === (value.domain ?? "")}
          onClick={() =>
            run(async () => {
              await post({ action: "save", kind, domain });
              return domain.trim() ? "Saved. Add it in Resend, then press Check." : "Removed. SynqIQ's address is used.";
            })
          }
        >
          Save
        </Button>
        {value.domain ? (
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await post({ action: "check", kind });
                return result.message ?? "";
              })
            }
          >
            Check with Resend
          </Button>
        ) : null}
      </div>
      {message ? <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
    </div>
  );
}

// Email > Templates: send from the studio's own domain instead of synqiq.co.
export function DomainSettings({ from, relay }: { from: Domain; relay: Domain }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your email domain</CardTitle>
        <CardDescription>
          Members see emails from your studio&apos;s domain instead of synqiq.co. Each domain is used only after Resend confirms it&apos;s
          set up. Until then, SynqIQ&apos;s address is used.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <DomainRow
          kind="from"
          label="Send from"
          help={`Studio emails come from notifications@${from.verified && from.domain ? from.domain : "synqiq.co"}.`}
          placeholder="thepreservehouston.com"
          value={from}
        />
        <DomainRow
          kind="relay"
          label="Private reply addresses"
          help="Follow-up and guest emails use private reply addresses here. Needs receiving in Resend, so use a subdomain (your mailboxes aren't affected)."
          placeholder="reply.thepreservehouston.com"
          value={relay}
        />
      </CardContent>
    </Card>
  );
}
