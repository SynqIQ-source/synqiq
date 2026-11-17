"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const ROLES = [
  { value: "staff", label: "Staff", hint: "front desk and general staff" },
  { value: "sales", label: "Sales", hint: "their own leads and sales numbers" },
  { value: "sales_lead", label: "Sales Lead", hint: "the whole sales team" },
  { value: "admin", label: "Club Admin", hint: "everything, including staff and pay" },
];

// Club Admins: add an employee in SynqIQ. They're emailed a link to set
// their password as soon as they're added.
export function AddEmployeeDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", role: "staff", hireDate: "" });
  const [canSell, setCanSell] = useState(false);
  const [isTrainer, setIsTrainer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });

  const save = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, canSell, isTrainer }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      invited?: boolean;
      inviteError?: string | null;
    };
    setBusy(false);
    if (!response.ok || !result.success) return setError(result.error ?? "Couldn't add them.");
    setDone(
      result.invited
        ? `${form.firstName} was added and emailed a link to set their SynqIQ password.`
        : `${form.firstName} was added, but the invite didn't send: ${result.inviteError}. Use Send invite on their row.`,
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reload so the new person shows in the list with their own row.
        if (!next && done) window.location.reload();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add employee
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add employee</DialogTitle>
          <DialogDescription>
            They&apos;ll get an email to log in to SynqIQ and set their password. Set their pay next on Pay Rates. Instructors who teach
            classes are added at the Mindbody switch.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <p className="text-sm">{done}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name">
              <Input value={form.firstName} onChange={set("firstName")} autoComplete="off" />
            </Field>
            <Field label="Last name">
              <Input value={form.lastName} onChange={set("lastName")} autoComplete="off" />
            </Field>
            <Field label="Email (login invite)">
              <Input type="email" value={form.email} onChange={set("email")} autoComplete="off" />
            </Field>
            <Field label="Mobile">
              <Input type="tel" value={form.phone} onChange={set("phone")} placeholder="(713) 555-0100" autoComplete="off" />
            </Field>
            <Field label="Role">
              <select
                className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value })}
              >
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label} ({role.hint})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start date (optional)">
              <Input type="date" value={form.hireDate} onChange={set("hireDate")} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isTrainer} onCheckedChange={setIsTrainer} /> Trainer
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={canSell} onCheckedChange={setCanSell} /> Sells (kiosk + leads)
            </label>
          </div>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          {done ? (
            <Button onClick={() => window.location.reload()}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || !form.phone.trim()}
                onClick={save}
              >
                {busy ? "Adding…" : "Add and send invite"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
