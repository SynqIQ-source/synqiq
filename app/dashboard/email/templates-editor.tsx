"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DEFAULT_SIGNATURE,
  EMAIL_TEMPLATES,
  emailButton,
  renderStudioEmail,
  sampleVars,
  type EmailKit,
  type TemplateKey,
} from "@/lib/email/studio-templates";

type Row = { key: TemplateKey; label: string; audience: string; when: string; customized: boolean };

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/email/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string; email?: string };
  if (!response.ok || !json.success) throw new Error(json.error ?? "Something went wrong.");
  return json;
}

export function TemplatesEditor({ kit, templates }: { kit: EmailKit; templates: Row[] }) {
  const router = useRouter();
  const [signature, setSignature] = useState(kit.branding.signature ?? DEFAULT_SIGNATURE);
  const [footer, setFooter] = useState(kit.branding.footer ?? "");
  const [showLogo, setShowLogo] = useState(kit.branding.showLogo);
  const [selected, setSelected] = useState<TemplateKey>(templates[0].key);
  const def = EMAIL_TEMPLATES[selected];
  const saved = kit.overrides[selected];
  const [drafts, setDrafts] = useState<Partial<Record<TemplateKey, { subject: string; body: string }>>>({});
  const draft = drafts[selected] ?? { subject: saved?.subject ?? def.subject, body: saved?.body ?? def.body };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const previewKit: EmailKit = {
    branding: { ...kit.branding, signature, footer, showLogo },
    overrides: { ...kit.overrides, [selected]: draft },
  };
  const preview = renderStudioEmail(selected, sampleVars(selected), previewKit, {
    action:
      selected === "rating_request"
        ? `<p style="margin:20px 0;font-size:32px;color:#f59e0b">&#9733;&#9733;&#9733;&#9733;&#9733;</p>`
        : emailButton("#", selected === "class_followup_reminder" ? "Open Follow Up" : "Update your card", kit.branding.color),
  });

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
  const setDraft = (patch: Partial<{ subject: string; body: string }>) =>
    setDrafts((all) => ({ ...all, [selected]: { ...draft, ...patch } }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Header &amp; footer</CardTitle>
          <CardDescription>
            On every email. The header uses your studio logo and main color from Settings. Use {"{{studio}}"} for your studio name.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="signature">Sign-off</Label>
            <Textarea id="signature" rows={3} value={signature} onChange={(event) => setSignature(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="footer">Footer (address, phone, hours)</Label>
            <Textarea id="footer" rows={3} value={footer} onChange={(event) => setFooter(event.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showLogo} onChange={(event) => setShowLogo(event.target.checked)} />
            Show the studio logo in the header (otherwise the studio name)
          </label>
          <div className="md:text-right">
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await post({ action: "save_branding", signature: signature === DEFAULT_SIGNATURE ? "" : signature, footer, showLogo });
                  return "Header and footer saved.";
                })
              }
            >
              Save header &amp; footer
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Emails">
          {templates.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => {
                setSelected(row.key);
                setMessage(null);
              }}
              className={`shrink-0 rounded-md border px-3 py-2 text-left text-sm ${row.key === selected ? "border-primary bg-primary-subtle" : "hover:bg-accent"}`}
            >
              <span className="block font-medium">{row.label}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {row.audience}
                {row.customized ? <Badge variant="secondary">Edited</Badge> : null}
              </span>
            </button>
          ))}
        </nav>

        <div className="grid min-w-0 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{def.label}</CardTitle>
              <CardDescription>
                To: {def.audience.toLowerCase()}. Sent when: {def.when}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" value={draft.subject} maxLength={200} onChange={(event) => setDraft({ subject: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="body">Message</Label>
                <Textarea
                  id="body"
                  rows={14}
                  className="min-h-72 [field-sizing:fixed]"
                  value={draft.body}
                  onChange={(event) => setDraft({ body: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Blank line = new paragraph. **text** = bold. Put <code>[button]</code> on its own line where the button goes.
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium">Fields you can use</p>
                <ul className="flex flex-wrap gap-1.5">
                  {Object.entries(def.fields).map(([name, field]) => (
                    <li key={name}>
                      <button
                        type="button"
                        title={field.label}
                        onClick={() => setDraft({ body: `${draft.body}{{${name}}}` })}
                        className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
                      >
                        {`{{${name}}}`}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await post({ action: "save_template", key: selected, ...draft });
                      return "Saved. This wording is used from the next email on.";
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
                      const result = await post({ action: "test", key: selected });
                      return `Test sent to ${result.email} (uses the saved wording and sample values).`;
                    })
                  }
                >
                  Send me a test
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await post({ action: "reset_template", key: selected });
                      setDrafts((all) => ({ ...all, [selected]: { subject: def.subject, body: def.body } }));
                      return "Back to the original wording.";
                    })
                  }
                >
                  Reset to original
                </Button>
              </div>
              {message ? (
                <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
                  {message.text}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription className="truncate">Subject: {preview.subject}</CardDescription>
            </CardHeader>
            <CardContent>
              <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="h-[560px] w-full rounded-md border bg-white" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
