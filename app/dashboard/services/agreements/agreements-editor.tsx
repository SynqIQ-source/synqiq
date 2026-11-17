"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Template = { id: string; name: string; body: string; version: number; updatedAt: string; items: { id: string; name: string }[] };

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/agreements/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const result = (await response?.json().catch(() => null)) as { success?: boolean; error?: string } | null;
  return response?.ok && result?.success ? null : (result?.error ?? "Couldn't save. Try again.");
}

export function AgreementsEditor({
  legalName,
  placeholders,
  templates,
  signedCount,
}: {
  legalName: string;
  placeholders: { key: string; label: string }[];
  templates: Template[];
  signedCount: number;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(legalName);
  const [nameMessage, setNameMessage] = useState<string | null>(null);

  async function saveName() {
    const error = await post({ action: "legalName", legalName: name });
    setNameMessage(error ?? "Saved.");
    if (!error) router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Business name on agreements</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} className="w-72" />
        </label>
        <Button variant="outline" onClick={saveName}>
          Save name
        </Button>
        {nameMessage ? <span className="text-sm text-muted-foreground">{nameMessage}</span> : null}
        <span className="ml-auto text-sm text-muted-foreground">{signedCount.toLocaleString()} signed so far</span>
      </div>

      <div className="rounded-xl border bg-card p-4 text-sm">
        <p className="font-medium">How it works</p>
        <p className="mt-1 text-muted-foreground">
          When an item with an agreement is sold, checkout opens a full-screen page for the member: they read the agreement, type their name
          and sign with a finger (or type their name and agree). The signed PDF is saved on their profile and in their Receipts. These fill
          in automatically with what&apos;s being bought:
        </p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {placeholders.map((placeholder) => (
            <li key={placeholder.key}>
              <code className="rounded bg-muted px-1">{`{{${placeholder.key}}}`}</code>{" "}
              <span className="text-muted-foreground">{placeholder.label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-muted-foreground">
          Pick an item&apos;s agreement in{" "}
          <Link href="/dashboard/services/products" className="underline">
            Products &amp; Inventory
          </Link>{" "}
          (open the item → Agreement).
        </p>
      </div>

      <div className="space-y-3">
        {templates.map((template) =>
          openId === template.id ? (
            <TemplateForm key={template.id} template={template} onClose={() => setOpenId(null)} />
          ) : (
            <div key={template.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{template.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Version {template.version} · {template.body.length.toLocaleString()} characters
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setOpenId(template.id)}>
                  Edit
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {template.items.length ? (
                  template.items.map((item) => (
                    <Badge key={item.id} variant="outline">
                      {item.name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">Not used by any item yet.</span>
                )}
              </div>
            </div>
          ),
        )}
        {adding ? (
          <TemplateForm template={null} onClose={() => setAdding(false)} />
        ) : (
          <Button variant="outline" onClick={() => setAdding(true)}>
            Add an agreement
          </Button>
        )}
      </div>
    </div>
  );
}

function TemplateForm({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 400_000) return setError("That file is too big. Upload a plain-text (.txt) file, or paste the text.");
    if (!/\.(txt|md|text)$/i.test(file.name) && file.type && !file.type.startsWith("text/"))
      return setError("Upload a plain-text (.txt) file. For Word or PDF, copy the text and paste it in.");
    setBody(await file.text());
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const problem = await post({ action: "save", id: template?.id, name, body });
    setBusy(false);
    if (problem) return setError(problem);
    onClose();
    router.refresh();
  }

  async function archive() {
    if (!template) return;
    setBusy(true);
    const problem = await post({ action: "archive", id: template.id });
    setBusy(false);
    if (problem) return setError(problem);
    onClose();
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-xl border border-primary bg-card p-4">
      <label className="grid gap-1 text-sm">
        <span className="text-muted-foreground">Agreement name (staff only; members see the item&apos;s name)</span>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="text-muted-foreground">Text</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={18}
          className="w-full rounded-md border bg-background p-2 font-mono text-xs leading-relaxed"
        />
      </label>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Or upload the text (.txt):</span>
        <input type="file" accept=".txt,.md,text/plain" onChange={(event) => upload(event.target.files?.[0])} className="text-sm" />
      </label>
      {template ? (
        <p className="text-xs text-muted-foreground">
          Saving changed text makes version {template.version + 1}. Agreements already signed keep the exact text that was signed.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {template ? (
          <Button variant="ghost" className="ml-auto text-red-700" onClick={archive} disabled={busy}>
            Stop using this agreement
          </Button>
        ) : null}
      </div>
    </div>
  );
}
