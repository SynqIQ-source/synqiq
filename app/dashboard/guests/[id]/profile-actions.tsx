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

// --- Search picker (shared by referring member and merge) -------------------------

type SearchResult = { id: string; name: string; detail?: string };

function SearchPicker({
  endpoint,
  placeholder,
  onPick,
  mapResult,
}: {
  endpoint: string;
  placeholder: string;
  onPick: (result: SearchResult) => void;
  mapResult: (row: Record<string, unknown>) => SearchResult;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const result = await response.json().catch(() => ({}));
      setResults(result.success ? (result.results as Record<string, unknown>[]).map(mapResult) : []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={search} className="flex gap-2">
        <Input value={q} placeholder={placeholder} autoComplete="off" onChange={(event) => setQ(event.target.value)} />
        <Button type="submit" variant="outline" disabled={busy || q.trim().length < 2}>
          {busy ? "Searching…" : "Search"}
        </Button>
      </form>
      {results ? (
        results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches.</p>
        ) : (
          <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => onPick(result)}
                >
                  <span className="font-medium">{result.name}</span>
                  {result.detail ? <span className="text-xs text-muted-foreground">{result.detail}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

// --- Referring member (admins and sellers) ----------------------------------------

export function ReferrerButton({ contactId, hasReferrer }: { contactId: string; hasReferrer: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/crm/contacts/${contactId}`, "PATCH", body);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the referring member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
        setTyped("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="link" size="xs" className="h-auto px-0">
          {hasReferrer ? "Change" : "Add referring member"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Referring member</DialogTitle>
          <DialogDescription>
            Search active Mindbody members. The change is stamped with your name and the time.
          </DialogDescription>
        </DialogHeader>
        <SearchPicker
          endpoint="/api/crm/members/search"
          placeholder="Member's name"
          mapResult={(row) => ({ id: String(row.id), name: String(row.name), detail: `Mindbody #${row.mindbodyId}` })}
          onPick={(result) => void save({ referringClientId: result.id })}
        />
        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="referrer-typed">Can&apos;t find them? Save the name as typed</Label>
          <div className="flex gap-2">
            <Input id="referrer-typed" value={typed} maxLength={120} onChange={(event) => setTyped(event.target.value)} />
            <Button
              variant="outline"
              disabled={busy || typed.trim().length < 2}
              onClick={() => void save({ referrerNameTyped: typed })}
            >
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">A typed name is flagged as unresolved so someone can match it later.</p>
        </div>
        {hasReferrer ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={() => void save({ referrerNameTyped: "" })}
          >
            Remove referring member
          </Button>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

// --- Not interested / reopen (admins and sellers) -----------------------------------

export function InterestButton({ contactId, notInterested }: { contactId: string; notInterested: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/crm/contacts/${contactId}`, "PATCH", body);
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the status.");
    } finally {
      setBusy(false);
    }
  }

  if (notInterested) {
    return (
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void save({ status: "lead" })}>
        Reopen lead
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Not interested
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as not interested</DialogTitle>
          <DialogDescription>They&apos;ll drop off the main Guests list. You can reopen them any time.</DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          maxLength={1000}
          placeholder="Reason (optional), e.g. joined another gym"
          onChange={(event) => setReason(event.target.value)}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button disabled={busy} onClick={() => void save({ status: "not_interested", reason })}>
            {busy ? "Saving…" : "Mark not interested"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Mark sold / undo (admins and sellers) --------------------------------------------

export function SoldButton({ contactId, sold }: { contactId: string; sold: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function save(value: boolean) {
    setBusy(true);
    try {
      await send(`/api/crm/contacts/${contactId}`, "PATCH", { sold: value });
      setConfirming(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (sold) {
    return confirming ? (
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void save(false)}>
        Confirm undo
      </Button>
    ) : (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Undo sale
      </Button>
    );
  }
  return (
    <Button size="sm" disabled={busy} onClick={() => void save(true)}>
      Mark sold
    </Button>
  );
}

// --- Appointments (admins and sellers) ---------------------------------------------------

export type AppointmentRow = { id: string; at: string; status: string; staffName: string | null; upcoming: boolean };

const APPOINTMENT_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  showed: "Showed",
  no_show: "No-show",
  canceled: "Canceled",
};

export function Appointments({
  contactId,
  appointments,
  staffOptions,
  defaultStaffId,
}: {
  contactId: string;
  appointments: AppointmentRow[];
  staffOptions: { id: string; name: string }[];
  defaultStaffId: string | null;
}) {
  const router = useRouter();
  const [when, setWhen] = useState("");
  const [staffId, setStaffId] = useState(defaultStaffId ?? UNASSIGNED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function book(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await send(`/api/crm/contacts/${contactId}/appointments`, "POST", {
        scheduledAt: when,
        staffId: staffId === UNASSIGNED ? null : staffId,
      });
      setWhen("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't book the appointment.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/crm/appointments/${id}`, "PATCH", { status });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the appointment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {appointments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No appointments yet.</p>
      ) : (
        <ul className="divide-y">
          {appointments.map((appointment) => (
            <li key={appointment.id} className="flex flex-col gap-2 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{appointment.at}</p>
                <p className="text-xs text-muted-foreground">
                  {APPOINTMENT_LABELS[appointment.status] ?? appointment.status}
                  {appointment.staffName ? ` · with ${appointment.staffName}` : ""}
                </p>
              </div>
              {appointment.status === "scheduled" ? (
                <div className="flex flex-wrap gap-1.5">
                  <Button size="xs" variant="outline" disabled={busy} onClick={() => void setStatus(appointment.id, "showed")}>
                    Showed
                  </Button>
                  {!appointment.upcoming ? (
                    <Button size="xs" variant="outline" disabled={busy} onClick={() => void setStatus(appointment.id, "no_show")}>
                      No-show
                    </Button>
                  ) : null}
                  <Button size="xs" variant="ghost" disabled={busy} onClick={() => void setStatus(appointment.id, "canceled")}>
                    Cancel
                  </Button>
                </div>
              ) : appointment.status !== "showed" ? (
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => void setStatus(appointment.id, "scheduled")}>
                  Reopen
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={book} className="space-y-2 border-t pt-4">
        <Label htmlFor="appointment-when">Book an appointment</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="appointment-when"
            type="datetime-local"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
            className="sm:w-56"
          />
          <Select value={staffId} onValueChange={setStaffId}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>No one yet</SelectItem>
              {staffOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={busy || !when}>
            Book
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          If they check in at the kiosk that day, it&apos;s marked Showed automatically.
        </p>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </form>
    </div>
  );
}

// --- Merge / delete (admins only) -----------------------------------------------------

export function AdminGuestActions({ contactId, name }: { contactId: string; name: string }) {
  const router = useRouter();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [target, setTarget] = useState<SearchResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await send(`/api/crm/contacts/${contactId}/merge`, "POST", { intoId: target.id });
      router.push(`/dashboard/guests/${target.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't merge.");
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/crm/contacts/${contactId}/delete`, "POST");
      router.push("/dashboard/guests");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Dialog
          open={mergeOpen}
          onOpenChange={(next) => {
            setMergeOpen(next);
            setTarget(null);
            setError(null);
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Merge into…
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Merge {name} into another guest</DialogTitle>
              <DialogDescription>
                Use this for duplicates. Visits move to the guest you pick, their empty details are filled in from this
                one, and this record is closed. Waivers and notes stay on file and show on the kept guest.
              </DialogDescription>
            </DialogHeader>
            {target ? (
              <div className="space-y-3">
                <p className="text-sm">
                  Merge <span className="font-medium">{name}</span> into{" "}
                  <span className="font-medium">{target.name}</span>?
                </p>
                <div className="flex gap-2">
                  <Button disabled={busy} onClick={() => void merge()}>
                    {busy ? "Merging…" : "Merge"}
                  </Button>
                  <Button variant="ghost" onClick={() => setTarget(null)}>
                    Back
                  </Button>
                </div>
              </div>
            ) : (
              <SearchPicker
                endpoint="/api/crm/contacts/search"
                placeholder="Guest's name"
                mapResult={(row) => ({
                  id: String(row.id),
                  name: String(row.name),
                  detail: `added ${new Date(String(row.createdAt)).toLocaleDateString()}`,
                })}
                onPick={(result) => (result.id === contactId ? setError("That's this guest.") : setTarget(result))}
              />
            )}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </DialogContent>
        </Dialog>
        {confirmDelete ? (
          <>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>
              {busy ? "Deleting…" : "Confirm delete"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
            Delete guest
          </Button>
        )}
      </div>
      {confirmDelete ? (
        <p className="text-xs text-muted-foreground">
          Hides {name} from all lists and matching. Signed waivers are kept on file as required.
        </p>
      ) : null}
      {error && !mergeOpen ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
