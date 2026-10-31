"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMPTY = { name: "", timezone: "America/Chicago", mindbodySiteId: "", firstName: "", lastName: "", email: "" };

// Add a studio: the studio, its owner (invited by email to set a password),
// and optionally its Mindbody site ID and the CRM.
export function AddStudioButton({ timezones }: { timezones: { value: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [crm, setCrm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (key: keyof typeof EMPTY) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/studios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          timezone: form.timezone,
          mindbodySiteId: form.mindbodySiteId,
          crm,
          owner: { firstName: form.firstName, lastName: form.lastName, email: form.email },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error ?? "Couldn't add the studio.");
      setDone(
        result.invited
          ? `${form.name} was added, and ${form.email} was emailed an invite to set a password.`
          : `${form.name} was added, but the invite wasn't sent: ${result.inviteError}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the studio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(EMPTY);
          setCrm(true);
          setError(null);
          setDone(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add studio
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a studio</DialogTitle>
          <DialogDescription>
            Creates the studio and emails its owner an invite. Connect Mindbody afterwards from this page.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-4">
            <p className="text-sm">{done}</p>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="studio-name">Studio name</Label>
                <Input id="studio-name" value={form.name} onChange={set("name")} required />
              </div>
              <div className="space-y-1.5">
                <Label>Time zone</Label>
                <Select value={form.timezone} onValueChange={(timezone) => setForm((current) => ({ ...current, timezone }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timezones.map((zone) => (
                      <SelectItem key={zone.value} value={zone.value}>
                        {zone.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="studio-site">Mindbody site ID (optional)</Label>
                <Input
                  id="studio-site"
                  inputMode="numeric"
                  placeholder="e.g. 561843"
                  value={form.mindbodySiteId}
                  onChange={set("mindbodySiteId")}
                />
              </div>
            </div>
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Owner</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="owner-first">First name</Label>
                  <Input id="owner-first" value={form.firstName} onChange={set("firstName")} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="owner-last">Last name</Label>
                  <Input id="owner-last" value={form.lastName} onChange={set("lastName")} required />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="owner-email">Email</Label>
                  <Input id="owner-email" type="email" value={form.email} onChange={set("email")} required />
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={crm} onChange={(event) => setCrm(event.target.checked)} />
              Turn on the sales CRM (kiosk, guests, follow-ups)
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add studio and invite owner"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
