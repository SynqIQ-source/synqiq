"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

async function send(url: string, body: Record<string, unknown>): Promise<string | null> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
    return response.ok && result.success ? null : (result.error ?? "Couldn't save. Try again.");
  } catch {
    return "Couldn't reach SynqIQ. Try again.";
  }
}

// Fix one shift's times (or a missed clock-out), or remove it. Reason required.
export function EditShift({ id, clockIn, clockOut }: { id: string; clockIn: string; clockOut: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [inValue, setIn] = useState(clockIn);
  const [outValue, setOut] = useState(clockOut);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(remove: boolean) {
    setSaving(true);
    setError(null);
    const problem = await send(
      `/api/time-clock/punches/${id}`,
      remove ? { remove: true, reason } : { clockIn: inValue, clockOut: outValue, reason },
    );
    setSaving(false);
    if (problem) return setError(problem);
    setOpen(false);
    setReason("");
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Edit
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Input
        type="datetime-local"
        className="h-8 w-48"
        value={inValue}
        onChange={(event) => setIn(event.target.value)}
        aria-label="Clock in"
      />
      <Input
        type="datetime-local"
        className="h-8 w-48"
        value={outValue}
        onChange={(event) => setOut(event.target.value)}
        aria-label="Clock out"
      />
      <Input className="h-8 w-44" placeholder="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      <Button size="sm" disabled={saving || !reason.trim()} onClick={() => save(false)}>
        Save
      </Button>
      <Button size="sm" variant="destructive" disabled={saving || !reason.trim()} onClick={() => save(true)}>
        Remove
      </Button>
      <Button size="sm" variant="ghost" disabled={saving} onClick={() => setOpen(false)}>
        Close
      </Button>
      {error ? <p className="w-full text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

// Add a shift someone forgot to clock.
export function AddShift({ people }: { people: { id: string; name: string }[] }) {
  const router = useRouter();
  const [staffId, setStaffId] = useState("");
  const [inValue, setIn] = useState("");
  const [outValue, setOut] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    const problem = await send("/api/time-clock/punches", { staffId, clockIn: inValue, clockOut: outValue, reason });
    setSaving(false);
    if (problem) return setMessage({ ok: false, text: problem });
    setMessage({ ok: true, text: "Shift added." });
    setIn("");
    setOut("");
    setReason("");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Person"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={staffId}
          onChange={(event) => setStaffId(event.target.value)}
        >
          <option value="">Who</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        <Input
          type="datetime-local"
          className="h-9 w-48"
          value={inValue}
          onChange={(event) => setIn(event.target.value)}
          aria-label="Clock in"
        />
        <Input
          type="datetime-local"
          className="h-9 w-48"
          value={outValue}
          onChange={(event) => setOut(event.target.value)}
          aria-label="Clock out"
        />
        <Input
          className="h-9 w-56"
          placeholder="Reason (e.g. forgot to clock in)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button disabled={saving || !staffId || !inValue || !outValue || !reason.trim()} onClick={save}>
          Add shift
        </Button>
      </div>
      {message ? (
        <p className={`text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>{message.text}</p>
      ) : null}
    </div>
  );
}
