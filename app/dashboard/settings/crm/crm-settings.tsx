"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

async function send(url: string, method: "POST" | "PATCH", body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(result.error ?? "Something went wrong.");
  return result;
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      router.refresh();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

// --- Kiosk devices ----------------------------------------------------------

type Device = {
  id: string;
  name: string;
  activated_at: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
  activation_expires_at: string | null;
};

export function KioskDevicesCard({ devices, timezone }: { devices: Device[]; timezone: string }) {
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const [code, setCode] = useState<{ deviceName: string; code: string; expiresAt: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const local = (iso: string) => DateTime.fromISO(iso).setZone(timezone).toFormat("LLL d, h:mm a");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const result = await run(() => send("/api/crm/kiosk-devices", "POST", { name }));
    if (result) {
      setCode({ deviceName: name, code: result.activationCode, expiresAt: result.expiresAt });
      setName("");
    }
  }

  async function newCode(device: Device) {
    const result = await run(() => send(`/api/crm/kiosk-devices/${device.id}`, "PATCH", { action: "new_code" }));
    if (result) setCode({ deviceName: device.name, code: result.activationCode, expiresAt: result.expiresAt });
  }

  async function revoke(device: Device) {
    await run(() => send(`/api/crm/kiosk-devices/${device.id}`, "PATCH", { action: "revoke" }));
    setConfirmRevoke(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kiosk devices</CardTitle>
        <CardDescription>
          Open <span className="font-mono">synqiq.co/kiosk</span> in Safari on the iPad and enter a pairing code. Codes
          work once and expire after 15 minutes. The kiosk never uses a staff login.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {code ? (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
            <p className="text-sm">Pairing code for {code.deviceName}:</p>
            <p className="my-2 font-mono text-3xl font-semibold tracking-[0.3em]">{code.code}</p>
            <p className="text-xs text-muted-foreground">Expires at {local(code.expiresAt)}. It won&apos;t be shown again.</p>
          </div>
        ) : null}

        {devices.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {devices.map((device) => {
              const status = device.revoked_at
                ? "Revoked"
                : device.activated_at
                  ? "Paired"
                  : "Waiting for code";
              return (
                <li key={device.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <p className="font-medium">
                      {device.name}{" "}
                      <Badge variant={status === "Paired" ? "secondary" : "outline"} className="ml-1">
                        {status}
                      </Badge>
                    </p>
                    <p className="text-muted-foreground">
                      {device.last_seen_at ? `Last used ${local(device.last_seen_at)}` : "Not used yet"}
                    </p>
                  </div>
                  {device.revoked_at ? null : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void newCode(device)}>
                        New code
                      </Button>
                      {confirmRevoke === device.id ? (
                        <>
                          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void revoke(device)}>
                            Confirm revoke
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRevoke(device.id)}>
                          Revoke
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="device-name">Add a device</Label>
            <Input
              id="device-name"
              placeholder="Front desk iPad"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy || !name.trim()}>
            Get pairing code
          </Button>
        </form>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

// --- Waiver -------------------------------------------------------------------

type Waiver = { id: string; version: number; body: string; is_active: boolean; published_at: string };

export function WaiverCard({ waivers, timezone }: { waivers: Waiver[]; timezone: string }) {
  const { busy, error, run } = useAction();
  const active = waivers.find((waiver) => waiver.is_active) ?? null;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(active?.body ?? "");
  const [confirming, setConfirming] = useState(false);

  async function publish() {
    const result = await run(() => send("/api/crm/waiver-templates", "POST", { body: text }));
    if (result) {
      setEditing(false);
      setConfirming(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Waiver</CardTitle>
        <CardDescription>
          {active
            ? `Version ${active.version} is live, published ${DateTime.fromISO(active.published_at).setZone(timezone).toFormat("LLL d, yyyy")}.`
            : "No waiver is published, so the kiosk can't check guests in."}{" "}
          A published version can&apos;t be edited. Changing the text publishes a new version; guests who signed an
          earlier version stay signed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <>
            <Textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setConfirming(false);
              }}
              className="min-h-80 font-mono text-xs"
            />
            {confirming ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
                <span className="flex-1">
                  Publish this as version {(waivers[0]?.version ?? 0) + 1}? The kiosk switches to it right away.
                </span>
                <Button size="sm" disabled={busy} onClick={() => void publish()}>
                  Publish
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button disabled={busy || text.trim().length < 50} onClick={() => setConfirming(true)}>
                  Publish new version
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setText(active?.body ?? "");
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            {active ? (
              <div className="max-h-64 overflow-y-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed whitespace-pre-wrap">
                {active.body}
              </div>
            ) : null}
            <Button variant="outline" onClick={() => setEditing(true)}>
              {active ? "Change waiver text" : "Add waiver"}
            </Button>
          </>
        )}
        {waivers.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            Earlier versions: {waivers.filter((waiver) => !waiver.is_active).map((waiver) => `v${waiver.version}`).join(", ")}
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

// --- Marketing sources --------------------------------------------------------

type Source = { id: string; label: string; active: boolean };

export function MarketingSourcesCard({ sources }: { sources: Source[] }) {
  const { busy, error, run } = useAction();
  const [label, setLabel] = useState("");

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const result = await run(() => send("/api/crm/marketing-sources", "POST", { label }));
    if (result) setLabel("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>How did you hear about us?</CardTitle>
        <CardDescription>Options guests can pick on the kiosk. Hidden options stay on past guests&apos; profiles.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="grid gap-2 sm:grid-cols-2">
          {sources.map((source) => (
            <li key={source.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <span className={source.active ? "" : "text-muted-foreground line-through"}>{source.label}</span>
              <Switch
                checked={source.active}
                disabled={busy}
                aria-label={`Show ${source.label} on the kiosk`}
                onCheckedChange={(active) =>
                  void run(() => send(`/api/crm/marketing-sources/${source.id}`, "PATCH", { active }))
                }
              />
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="flex gap-2">
          <Input placeholder="Add an option" value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} />
          <Button type="submit" disabled={busy || !label.trim()}>
            Add
          </Button>
        </form>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

// --- Sellers -------------------------------------------------------------------

type StaffRow = { id: string; display_name: string; role: string; can_sell: boolean };

export function SellersCard({ staff }: { staff: StaffRow[] }) {
  const { busy, error, run } = useAction();
  const [filter, setFilter] = useState("");
  const shown = staff.filter(
    (member) => member.can_sell || member.display_name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales team</CardTitle>
        <CardDescription>
          Sellers appear in the kiosk&apos;s &ldquo;Who are you meeting?&rdquo; list and can see the Guests pages.
          Admins can always see Guests.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input placeholder="Find staff…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
          {(filter.trim() ? shown : staff.filter((member) => member.can_sell)).map((member) => (
            <li key={member.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                {member.display_name}
                {member.role === "admin" ? (
                  <Badge variant="outline" className="ml-2">
                    Admin
                  </Badge>
                ) : null}
              </span>
              <Switch
                checked={member.can_sell}
                disabled={busy}
                aria-label={`${member.display_name} sells memberships`}
                onCheckedChange={(canSell) => void run(() => send(`/api/crm/sellers/${member.id}`, "PATCH", { canSell }))}
              />
            </li>
          ))}
          {!filter.trim() && staff.every((member) => !member.can_sell) ? (
            <li className="px-3 py-4 text-sm text-muted-foreground">No sellers yet. Search for a staff member to add one.</li>
          ) : null}
        </ul>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
