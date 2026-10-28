"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

async function send(url: string, method: "POST" | "PATCH", body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(result.error ?? "Something went wrong.");
}

// --- Edit contact --------------------------------------------------------------

export type EditableContact = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
};

const FIELDS: { key: keyof EditableContact; label: string; type?: string; span: string; max: number }[] = [
  { key: "firstName", label: "First name", span: "sm:col-span-3", max: 60 },
  { key: "lastName", label: "Last name", span: "sm:col-span-3", max: 60 },
  { key: "email", label: "Email", type: "email", span: "sm:col-span-3", max: 254 },
  { key: "phone", label: "Phone", type: "tel", span: "sm:col-span-3", max: 30 },
  { key: "dateOfBirth", label: "Date of birth", type: "date", span: "sm:col-span-6", max: 10 },
  { key: "addressLine1", label: "Street address", span: "sm:col-span-6", max: 120 },
  { key: "city", label: "City", span: "sm:col-span-3", max: 60 },
  { key: "state", label: "State", span: "sm:col-span-1", max: 2 },
  { key: "postalCode", label: "ZIP", span: "sm:col-span-2", max: 10 },
];

export function EditContactButton({ contactId, initial }: { contactId: string; initial: EditableContact }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // Only send what changed.
    const changed = Object.fromEntries(
      (Object.keys(form) as (keyof EditableContact)[])
        .filter((key) => form[key].trim() !== initial[key])
        .map((key) => [key, form[key].trim()]),
    );
    try {
      if (Object.keys(changed).length > 0) await send(`/api/crm/contacts/${contactId}`, "PATCH", changed);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the changes.");
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
          setForm(initial);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit guest</DialogTitle>
          <DialogDescription>
            A changed email is checked again. Changes aren&apos;t sent to a guest who&apos;s already linked in Mindbody.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-6">
            {FIELDS.map((field) => (
              <div key={field.key} className={`space-y-1.5 ${field.span}`}>
                <Label htmlFor={`edit-${field.key}`}>{field.label}</Label>
                <Input
                  id={`edit-${field.key}`}
                  type={field.type ?? "text"}
                  value={form[field.key]}
                  maxLength={field.max}
                  autoComplete="off"
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      [field.key]: field.key === "state" ? event.target.value.toUpperCase() : event.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Salesperson (admins) ----------------------------------------------------------

const UNASSIGNED = "unassigned";

export function SalespersonSelect({
  contactId,
  current,
  options,
}: {
  contactId: string;
  current: string | null;
  options: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? UNASSIGNED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      await send(`/api/crm/contacts/${contactId}`, "PATCH", { assignedStaffId: next === UNASSIGNED ? null : next });
      router.refresh();
    } catch (err) {
      setValue(previous);
      setError(err instanceof Error ? err.message : "Couldn't change the salesperson.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={(next) => void change(next)} disabled={busy}>
        <SelectTrigger size="sm" className="w-full max-w-60">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

// --- Notes ------------------------------------------------------------------------

export function AddNoteForm({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await send(`/api/crm/contacts/${contactId}/notes`, "POST", { body: text });
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-2">
      <Textarea
        value={text}
        maxLength={5000}
        placeholder="Add a note…"
        className="min-h-20"
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex items-center justify-between gap-3">
        {error ? <p className="text-xs text-destructive">{error}</p> : <span />}
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {busy ? "Saving…" : "Add note"}
        </Button>
      </div>
    </form>
  );
}

// --- Mindbody ------------------------------------------------------------------------

export function SendToMindbodyButton({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/crm/contacts/${contactId}/mindbody`, "POST");
      // The push runs in the background; give it a moment, then reload.
      setTimeout(() => router.refresh(), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send to Mindbody.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
        <Send /> {busy ? "Sending…" : "Send to Mindbody"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
