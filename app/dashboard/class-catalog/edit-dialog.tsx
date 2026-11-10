"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CATALOG_FIELDS, type CatalogEntity, type CatalogValue } from "@/lib/classes/catalog-edits";
import { DAY_NAMES } from "@/lib/classes/catalog";

type Option = { value: number; label: string };

// Edit one class-catalog item. Changes save to SynqIQ (not Mindbody) and
// show as "edited"; "Use Mindbody's" drops an edit.
export function CatalogEditDialog({
  entity,
  id,
  title,
  values,
  edited,
  rooms = [],
  instructors = [],
  triggerLabel = "Edit",
  compact = false,
}: {
  entity: CatalogEntity;
  id: string;
  title: string;
  values: Record<string, CatalogValue>;
  edited: string[];
  rooms?: Option[];
  instructors?: Option[];
  triggerLabel?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const specs = CATALOG_FIELDS[entity];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, CatalogValue>>(values);
  const [reset, setReset] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change(field: string, value: CatalogValue) {
    setDraft((current) => ({ ...current, [field]: value }));
    setReset((current) => current.filter((item) => item !== field));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const set: Record<string, CatalogValue> = {};
    for (const field of Object.keys(specs)) {
      if (reset.includes(field)) continue;
      if (JSON.stringify(draft[field] ?? null) !== JSON.stringify(values[field] ?? null)) set[field] = draft[field] ?? null;
    }
    try {
      const response = await fetch(`/api/class-catalog/${entity}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set, reset }),
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
          setDraft(values);
          setReset([]);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant={compact ? "ghost" : "outline"} size="sm" className={compact ? "h-7 px-2" : undefined}>
          <Pencil /> {compact ? <span className="sr-only">{triggerLabel}</span> : triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Saved in SynqIQ and kept through the nightly Mindbody import. Mindbody isn&apos;t changed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {Object.entries(specs).map(([field, spec]) => {
            const value = draft[field];
            const isEdited = edited.includes(field) && !reset.includes(field);
            const fieldId = `catalog-${entity}-${field}`;
            return (
              <div key={field} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={fieldId}>{spec.label}</Label>
                  {isEdited ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setReset((current) => [...current, field])}
                    >
                      <RotateCcw className="size-3" /> Use Mindbody&apos;s
                    </button>
                  ) : reset.includes(field) ? (
                    <span className="text-xs text-muted-foreground">Back to Mindbody&apos;s on save</span>
                  ) : null}
                </div>
                {spec.kind === "textarea" ? (
                  <Textarea
                    id={fieldId}
                    rows={5}
                    value={(value as string | null) ?? ""}
                    onChange={(event) => change(field, event.target.value)}
                  />
                ) : spec.kind === "boolean" ? (
                  <Switch id={fieldId} checked={value === true} onCheckedChange={(checked) => change(field, checked)} />
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
                          onClick={() => change(field, on ? days.filter((item) => item !== day) : [...days, day])}
                        >
                          {DAY_NAMES[day]}
                        </Button>
                      );
                    })}
                  </div>
                ) : spec.kind === "room" || spec.kind === "instructor" ? (
                  <select
                    id={fieldId}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    value={value === null || value === undefined ? "" : String(value)}
                    onChange={(event) => change(field, event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">—</option>
                    {(spec.kind === "room" ? rooms : instructors).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : spec.kind === "money" ? (
                  <Input
                    id={fieldId}
                    inputMode="decimal"
                    value={value === null || value === undefined ? "" : String(Number(value) / 100)}
                    onChange={(event) => {
                      const dollars = event.target.value.replace(/[$,\s]/g, "");
                      change(field, dollars === "" ? null : Math.round(Number(dollars) * 100));
                    }}
                  />
                ) : (
                  <Input
                    id={fieldId}
                    type={spec.kind === "time" ? "time" : spec.kind === "date" ? "date" : spec.kind === "int" ? "number" : "text"}
                    value={value === null || value === undefined ? "" : spec.kind === "time" ? String(value).slice(0, 5) : String(value)}
                    onChange={(event) =>
                      change(
                        field,
                        spec.kind === "int" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value,
                      )
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
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
