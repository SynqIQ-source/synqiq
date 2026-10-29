"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

const EMPTY = { firstName: "", lastName: "", phone: "", email: "" };
const SOURCES = [
  { value: "phone_in", label: "Phone In" },
  { value: "web", label: "Web" },
  { value: "walk_in", label: "Walk In" },
  { value: "guest_of_member", label: "Guest of Member" },
  { value: "other", label: "Other" },
];

// "Add lead" for leads staff take by hand (a phone-in, for example). The
// staff member adding it becomes the salesperson. Duplicates are checked
// against this studio's own contacts.
export function AddLeadButton({ sources }: { sources: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [source, setSource] = useState("phone_in");
  const [howHeard, setHowHeard] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);

  function reset() {
    setForm(EMPTY);
    setSource("phone_in");
    setHowHeard([]);
    setError(null);
    setDuplicate(null);
    setBusy(false);
  }

  async function save(allowDuplicate: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, source, howHeard, allowDuplicate }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 409 && result.duplicate) {
        setDuplicate(result.duplicate);
        setBusy(false);
        return;
      }
      if (!response.ok || !result.success) throw new Error(result.error ?? "Couldn't add the lead.");
      setOpen(false);
      reset();
      router.push(`/dashboard/guests/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the lead.");
      setBusy(false);
    }
  }

  const ready = form.firstName.trim() && form.lastName.trim() && (form.phone.trim() || form.email.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Add lead
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add lead</DialogTitle>
          <DialogDescription>You&apos;ll be the salesperson for this lead.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["firstName", "First name", "text"],
                ["lastName", "Last name", "text"],
                ["phone", "Phone", "tel"],
                ["email", "Email", "email"],
              ] as const
            ).map(([key, label, type]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`lead-${key}`}>{label}</Label>
                <Input
                  id={`lead-${key}`}
                  type={type}
                  value={form[key]}
                  autoComplete="off"
                  onChange={(event) => {
                    setDuplicate(null);
                    setForm((previous) => ({ ...previous, [key]: event.target.value }));
                  }}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label>Lead source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {sources.length > 0 ? (
            <div className="space-y-2">
              <Label>How did they hear about us?</Label>
              <div className="grid grid-cols-2 gap-2">
                {sources.map((label, index) => (
                  <label key={label} htmlFor={`lead-heard-${index}`} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`lead-heard-${index}`}
                      checked={howHeard.includes(label)}
                      onCheckedChange={(checked) =>
                        setHowHeard((previous) =>
                          checked === true ? [...previous, label] : previous.filter((value) => value !== label),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {duplicate ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p>
                <Link href={`/dashboard/guests/${duplicate.id}`} className="font-medium underline">
                  {duplicate.name}
                </Link>{" "}
                already has this email or phone number.
              </p>
              <p className="mt-1 text-muted-foreground">
                Open that contact, or add this lead anyway and it will be flagged as a possible duplicate.
              </p>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            {duplicate ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void save(true)}>
                Add anyway
              </Button>
            ) : (
              <Button type="submit" disabled={!ready || busy}>
                {busy ? "Adding…" : "Add lead"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
