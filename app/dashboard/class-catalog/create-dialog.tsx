"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NEW_FIELDS, type CatalogValue } from "@/lib/classes/catalog-edits";
import { DAY_NAMES } from "@/lib/classes/catalog";

type Option = { value: number | string; label: string };

// Create a class type or a class time in SynqIQ. It goes on SynqIQ's
// calendar right away; until the switch it isn't in Mindbody.
export function CatalogCreateDialog({
  entity,
  label,
  today,
  programs = [],
  classTypes = [],
  rooms = [],
  instructors = [],
}: {
  entity: "class_type" | "class_schedule";
  label: string;
  today: string;
  programs?: Option[];
  classTypes?: Option[];
  rooms?: Option[];
  instructors?: Option[];
}) {
  const router = useRouter();
  const specs = NEW_FIELDS[entity];
  const blank = (): Record<string, CatalogValue> => (entity === "class_schedule" ? { days: [], start_date: today } : {});
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, CatalogValue>>(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (field: string, value: CatalogValue) => setDraft((current) => ({ ...current, [field]: value }));
  const optionsFor = (kind: string) =>
    kind === "program" ? programs : kind === "class_type" ? classTypes : kind === "room" ? rooms : kind === "instructor" ? instructors : [];

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/class-catalog/${entity}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = (await response.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        setError(result.error ?? "Couldn't save. Try again.");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(blank());
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Added to SynqIQ&apos;s schedule now. Until the switch it isn&apos;t in Mindbody, so add it there too if members should book it
            before then.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {Object.entries(specs).map(([field, spec]) => {
            const value = draft[field];
            const fieldId = `new-${entity}-${field}`;
            return (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={fieldId}>
                  {spec.label}
                  {spec.required ? <span className="text-destructive"> *</span> : null}
                </Label>
                {spec.kind === "textarea" ? (
                  <Textarea
                    id={fieldId}
                    rows={4}
                    value={(value as string | null) ?? ""}
                    onChange={(event) => set(field, event.target.value)}
                  />
                ) : spec.kind === "days" ? (
                  <div className="flex flex-wrap gap-1">
                    {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                      const days = (value as number[] | null) ?? [];
                      const on = days.includes(day);
                      return (
                        <Button
                          key={day}
                          type="button"
                          size="sm"
                          variant={on ? "default" : "outline"}
                          onClick={() => set(field, on ? days.filter((item) => item !== day) : [...days, day])}
                        >
                          {DAY_NAMES[day]}
                        </Button>
                      );
                    })}
                  </div>
                ) : ["program", "class_type", "room", "instructor"].includes(spec.kind) ? (
                  <select
                    id={fieldId}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    value={value === null || value === undefined ? "" : String(value)}
                    onChange={(event) =>
                      set(field, event.target.value ? (spec.kind === "class_type" ? event.target.value : Number(event.target.value)) : null)
                    }
                  >
                    <option value="">{spec.required ? "Pick one" : "—"}</option>
                    {optionsFor(spec.kind).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={fieldId}
                    type={spec.kind === "time" ? "time" : spec.kind === "date" ? "date" : spec.kind === "int" ? "number" : "text"}
                    min={spec.kind === "date" ? today : undefined}
                    value={value === null || value === undefined ? "" : String(value)}
                    onChange={(event) =>
                      set(field, spec.kind === "int" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value)
                    }
                  />
                )}
                {spec.help ? <p className="text-xs text-muted-foreground">{spec.help}</p> : null}
              </div>
            );
          })}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
