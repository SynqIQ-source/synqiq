// What can be edited on each class-catalog item, validation, and how edits
// combine with Mindbody's copy. Pure; unit-tested in
// tests/catalog-edits.test.ts. Edits live in each row's `edits` jsonb and
// win over the imported columns; resetting a field removes the edit.

export type CatalogEntity = "class_type" | "class_schedule" | "room" | "program" | "session_type" | "class_session";
export type FieldKind =
  "text" | "textarea" | "int" | "money" | "time" | "date" | "days" | "boolean" | "room" | "instructor" | "program" | "class_type";
export type FieldSpec = { label: string; kind: FieldKind; required?: boolean; min?: number; max?: number; help?: string };
export type CatalogValue = string | number | boolean | number[] | null;

export const CATALOG_TABLES: Record<CatalogEntity, string> = {
  class_type: "class_types",
  class_schedule: "class_schedules",
  room: "rooms",
  program: "departments",
  session_type: "session_types",
  class_session: "class_sessions",
};

export const CATALOG_FIELDS: Record<CatalogEntity, Record<string, FieldSpec>> = {
  class_type: {
    name: { label: "Name", kind: "text", required: true },
    description_text: { label: "Description", kind: "textarea", help: "Shown to members when they book." },
    level: { label: "Level", kind: "text" },
    category: { label: "Category", kind: "text" },
    active: { label: "Offered", kind: "boolean" },
  },
  class_schedule: {
    days: { label: "Days", kind: "days", required: true },
    start_time: { label: "Starts", kind: "time", required: true },
    end_time: { label: "Ends", kind: "time", required: true },
    mindbody_resource_id: { label: "Room", kind: "room" },
    capacity: { label: "Spots", kind: "int", min: 1, max: 500 },
    staff_mindbody_id: { label: "Instructor", kind: "instructor" },
    end_date: { label: "Last date (optional)", kind: "date", help: "Classes stop after this date." },
    active: { label: "On the schedule", kind: "boolean", help: "Off removes this class time from the schedule." },
  },
  room: {
    name: { label: "Name", kind: "text", required: true },
    active: { label: "In use", kind: "boolean" },
  },
  program: {
    included_in_membership: { label: "Included in membership", kind: "boolean", help: "Members book without paying extra." },
    booking_opens_days: { label: "Booking opens (days ahead)", kind: "int", min: 0, max: 365 },
    booking_closes_minutes: { label: "Online booking closes / notice (minutes before)", kind: "int", min: 0, max: 20160 },
    cancel_window_minutes: { label: "Late-cancel window (minutes)", kind: "int", min: 0, max: 20160 },
    late_cancel_fee_cents: { label: "Late-cancel fee", kind: "money", min: 0, max: 50000 },
    no_show_fee_cents: { label: "No-show fee", kind: "money", min: 0, max: 50000 },
  },
  session_type: {
    name: { label: "Name", kind: "text", required: true },
    default_minutes: { label: "Length (minutes)", kind: "int", min: 5, max: 480 },
    available_online: { label: "Members can book online", kind: "boolean" },
    online_description: { label: "Online description", kind: "textarea" },
  },
  // One date of a class (SynqIQ's calendar); the weekly pattern is unchanged.
  class_session: {
    start_time: { label: "Starts", kind: "time", required: true },
    end_time: { label: "Ends", kind: "time", required: true },
    mindbody_resource_id: { label: "Room", kind: "room" },
    capacity: { label: "Spots", kind: "int", min: 1, max: 500 },
    staff_mindbody_id: { label: "Instructor (sub)", kind: "instructor" },
    active: { label: "Happening", kind: "boolean", help: "Off cancels this date only." },
    note: { label: "Note", kind: "text", help: "e.g. why it's cancelled or changed." },
  },
};

// Fields for creating a class type or class time in SynqIQ.
export const NEW_FIELDS: Record<"class_type" | "class_schedule", Record<string, FieldSpec>> = {
  class_type: {
    name: { label: "Name", kind: "text", required: true },
    mindbody_program_id: {
      label: "Program",
      kind: "program",
      required: true,
      help: "Sets booking rules and whether membership covers it.",
    },
    description_text: { label: "Description", kind: "textarea", help: "Shown to members when they book." },
    level: { label: "Level", kind: "text" },
    category: { label: "Category", kind: "text" },
  },
  class_schedule: {
    class_type_id: { label: "Class", kind: "class_type", required: true },
    days: { label: "Days", kind: "days", required: true },
    start_time: { label: "Starts", kind: "time", required: true },
    end_time: { label: "Ends", kind: "time", required: true },
    mindbody_resource_id: { label: "Room", kind: "room" },
    capacity: { label: "Spots", kind: "int", min: 1, max: 500, required: true },
    staff_mindbody_id: { label: "Instructor", kind: "instructor" },
    start_date: { label: "First date", kind: "date", required: true },
    end_date: { label: "Last date (optional)", kind: "date" },
  },
};

// Values a field has when neither Mindbody nor an edit sets it.
const DEFAULTS: Partial<Record<CatalogEntity, Record<string, CatalogValue>>> = {
  class_schedule: { active: true },
  class_session: { active: true, note: null },
  program: { included_in_membership: true, late_cancel_fee_cents: 0, no_show_fee_cents: 0 },
};

export const isCatalogEntity = (value: unknown): value is CatalogEntity =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(CATALOG_TABLES, value);

// Mindbody's copy with SynqIQ edits on top, plus which fields are edited.
export function effective<T extends Record<string, unknown>>(
  entity: CatalogEntity,
  row: T & { edits?: Record<string, CatalogValue> | null },
): T & Record<string, unknown> & { edited: string[] } {
  const edits = row.edits ?? {};
  const merged: Record<string, unknown> = { ...(DEFAULTS[entity] ?? {}), ...row };
  for (const field of Object.keys(DEFAULTS[entity] ?? {}))
    if (row[field] === null || row[field] === undefined) merged[field] = DEFAULTS[entity]![field];
  const edited: string[] = [];
  for (const field of Object.keys(CATALOG_FIELDS[entity])) {
    if (Object.prototype.hasOwnProperty.call(edits, field)) {
      merged[field] = edits[field];
      // SynqIQ-only settings (Mindbody has no value) aren't "edits" of Mindbody.
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS[entity] ?? {}, field)) edited.push(field);
    }
  }
  return { ...(merged as T), edited };
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

function clean(spec: FieldSpec, value: unknown): { ok: true; value: CatalogValue } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (value === null || value === "" || value === undefined) {
    return spec.required ? bad(`${spec.label} is required.`) : { ok: true, value: null };
  }
  switch (spec.kind) {
    case "text":
    case "textarea": {
      if (typeof value !== "string") return bad(`${spec.label} isn't valid.`);
      const text = value.trim();
      if (!text) return spec.required ? bad(`${spec.label} is required.`) : { ok: true, value: null };
      if (text.length > (spec.kind === "text" ? 120 : 4000)) return bad(`${spec.label} is too long.`);
      return { ok: true, value: text };
    }
    case "int":
    case "money":
    case "room":
    case "instructor": {
      const number = typeof value === "string" ? Number(value) : value;
      if (typeof number !== "number" || !Number.isInteger(number)) return bad(`${spec.label} must be a whole number.`);
      if (spec.min !== undefined && number < spec.min)
        return bad(`${spec.label} must be at least ${spec.kind === "money" ? `$${spec.min / 100}` : spec.min}.`);
      if (spec.max !== undefined && number > spec.max)
        return bad(`${spec.label} must be at most ${spec.kind === "money" ? `$${spec.max / 100}` : spec.max}.`);
      if ((spec.kind === "room" || spec.kind === "instructor") && number <= 0) return bad(`Pick a ${spec.label.toLowerCase()}.`);
      return { ok: true, value: number };
    }
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
        return bad(`${spec.label} must be a date.`);
      }
      return { ok: true, value };
    }
    case "program":
    case "class_type": {
      if (spec.kind === "class_type") {
        return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)
          ? { ok: true, value }
          : bad(`Pick a ${spec.label.toLowerCase()}.`);
      }
      const number = typeof value === "string" ? Number(value) : value;
      return typeof number === "number" && Number.isInteger(number) && number > 0 ? { ok: true, value: number } : bad("Pick a program.");
    }
    case "time": {
      if (typeof value !== "string" || !TIME.test(value)) return bad(`${spec.label} must be a time.`);
      return { ok: true, value: value.length === 5 ? `${value}:00` : value };
    }
    case "days": {
      if (!Array.isArray(value) || value.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return bad("Pick valid days.");
      const days = [...new Set(value as number[])].sort();
      return days.length ? { ok: true, value: days } : bad("Pick at least one day.");
    }
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : bad(`${spec.label} isn't valid.`);
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Applies a form submission: `set` changes fields, `reset` goes back to
// Mindbody's value. Returns the new edits and the change log entry.
export function applyCatalogEdit(
  entity: CatalogEntity,
  row: Record<string, unknown> & { edits?: Record<string, CatalogValue> | null },
  input: { set?: Record<string, unknown>; reset?: string[] },
):
  | { ok: true; edits: Record<string, CatalogValue>; changes: Record<string, { from: unknown; to: unknown }> }
  | { ok: false; error: string } {
  const specs = CATALOG_FIELDS[entity];
  const current = effective(entity, row);
  const edits: Record<string, CatalogValue> = { ...(row.edits ?? {}) };
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of input.reset ?? []) {
    if (!specs[field]) return { ok: false, error: "Unknown field." };
    if (!Object.prototype.hasOwnProperty.call(edits, field)) continue;
    delete edits[field];
    if (field === "staff_mindbody_id") delete edits.sub_source;
    changes[field] = { from: current[field], to: "(Mindbody)" };
  }
  for (const [field, raw] of Object.entries(input.set ?? {})) {
    const spec = specs[field];
    if (!spec) return { ok: false, error: "Unknown field." };
    const result = clean(spec, raw);
    if (!result.ok) return result;
    if (same(result.value, current[field])) continue;
    edits[field] = result.value;
    // A manual instructor change takes over from a sub.
    if (field === "staff_mindbody_id") delete edits.sub_source;
    changes[field] = { from: current[field], to: result.value };
  }

  if (entity === "class_schedule" || entity === "class_session") {
    const next = effective(entity, { ...row, edits });
    if (typeof next.start_time === "string" && typeof next.end_time === "string" && next.end_time <= next.start_time) {
      return { ok: false, error: "The class has to end after it starts." };
    }
  }
  return { ok: true, edits, changes };
}

// Validates a new class type or class time; returns the columns to insert.
export function validateNew(
  entity: "class_type" | "class_schedule",
  input: Record<string, unknown>,
  today: string,
): { ok: true; values: Record<string, CatalogValue> } | { ok: false; error: string } {
  const values: Record<string, CatalogValue> = {};
  for (const [field, spec] of Object.entries(NEW_FIELDS[entity])) {
    const result = clean(spec, input[field]);
    if (!result.ok) return result;
    values[field] = result.value;
  }
  if (entity === "class_schedule") {
    if ((values.end_time as string) <= (values.start_time as string)) return { ok: false, error: "The class has to end after it starts." };
    if ((values.start_date as string) < today) return { ok: false, error: "The first date can't be in the past." };
    if (values.end_date && (values.end_date as string) < (values.start_date as string)) {
      return { ok: false, error: "The last date must be on or after the first date." };
    }
  }
  return { ok: true, values };
}
