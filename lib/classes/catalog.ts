import { toDate } from "@/lib/memberships/contracts";

// Pure conversion of Mindbody's class catalog (programs, class
// descriptions, class schedules, session types) into SynqIQ rows. No I/O;
// unit-tested in tests/class-catalog.test.ts. Used by
// lib/sync/class-catalog.ts.

type Named = { Id?: number | null; Name?: string | null };

export type MindbodyProgram = {
  Id: number;
  Name?: string | null;
  ScheduleType?: string | null;
  CancelOffset?: number | null;
  ScheduleOffset?: number | null;
  ScheduleOffsetEnd?: number | null;
  PricingRelationships?: { PaysFor?: Named[] | null; PaidBy?: Named[] | null } | null;
};

export type MindbodyClassDescription = {
  Id: number;
  Active?: boolean | null;
  Name?: string | null;
  Description?: string | null;
  ImageURL?: string | null;
  LastUpdated?: string | null;
  Level?: Named | string | null;
  Notes?: string | null;
  Prereq?: string | null;
  Program?: { Id?: number | null } | null;
  SessionType?: { Id?: number | null } | null;
  Category?: string | null;
  Subcategory?: string | null;
};

export type MindbodyClassSchedule = {
  Id: number;
  ClassDescription?: { Id?: number | null; Name?: string | null } | null;
  DaySunday?: boolean | null;
  DayMonday?: boolean | null;
  DayTuesday?: boolean | null;
  DayWednesday?: boolean | null;
  DayThursday?: boolean | null;
  DayFriday?: boolean | null;
  DaySaturday?: boolean | null;
  StartTime?: string | null;
  EndTime?: string | null;
  StartDate?: string | null;
  EndDate?: string | null;
  Staff?: { Id?: number | null } | null;
  Location?: { Id?: number | null } | null;
  FrequencyType?: string | null;
  FrequencyInterval?: number | null;
  IsAvailable?: boolean | null;
};

export type MindbodySessionType = {
  Id: number;
  Name?: string | null;
  Type?: string | null;
  DefaultTimeLength?: number | null;
  ProgramId?: number | null;
  NumDeducted?: number | null;
  OnlineDescription?: string | null;
  AvailableForAddOn?: boolean | null;
  ResourceRequired?: boolean | null;
};

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&ndash;": "–",
  "&mdash;": "—",
};

// Mindbody stores descriptions as HTML; SynqIQ shows plain text (paragraphs
// kept), never the raw HTML.
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(
      /&[a-z#0-9]+;/gi,
      (entity) => ENTITIES[entity.toLowerCase()] ?? (/^&#\d+;$/.test(entity) ? String.fromCharCode(Number(entity.slice(2, -1))) : " "),
    )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

const positive = (value: number | null | undefined) => (typeof value === "number" && value > 0 ? value : null);
// "1899-12-30T05:00:00" -> "05:00:00"
const toTime = (value: string | null | undefined) => (value && /T\d{2}:\d{2}/.test(value) ? value.slice(11, 19) : null);
const named = (list: Named[] | null | undefined) =>
  (list ?? []).filter((item) => item.Id != null).map((item) => ({ id: item.Id, name: item.Name ?? null }));

export function toProgramUpdate(program: MindbodyProgram) {
  return {
    name: (program.Name ?? "").trim() || `Program ${program.Id}`,
    schedule_type: program.ScheduleType ?? null,
    cancel_window_minutes: typeof program.CancelOffset === "number" ? program.CancelOffset : null,
    // Mindbody: ScheduleOffset = minutes before start that online booking
    // closes (appointments: minimum notice); ScheduleOffsetEnd = days ahead
    // booking opens (classes).
    booking_closes_minutes: typeof program.ScheduleOffset === "number" ? program.ScheduleOffset : null,
    booking_opens_days: positive(program.ScheduleOffsetEnd),
    paid_by: named(program.PricingRelationships?.PaidBy),
    pays_for: named(program.PricingRelationships?.PaysFor),
  };
}

export function toClassTypeRow(organizationId: string, description: MindbodyClassDescription) {
  const level = typeof description.Level === "string" ? description.Level : (description.Level?.Name ?? null);
  return {
    organization_id: organizationId,
    mindbody_class_description_id: description.Id,
    name: (description.Name ?? "").trim() || `Class ${description.Id}`,
    description_html: description.Description ?? null,
    description_text: htmlToText(description.Description),
    image_url: description.ImageURL ?? null,
    level,
    notes: htmlToText(description.Notes),
    prerequisites: htmlToText(description.Prereq),
    mindbody_program_id: positive(description.Program?.Id),
    mindbody_session_type_id: positive(description.SessionType?.Id),
    category: description.Category ?? null,
    subcategory: description.Subcategory ?? null,
    active: description.Active !== false,
    mindbody_updated_at: description.LastUpdated ? description.LastUpdated.slice(0, 19) : null,
  };
}

const DAY_FLAGS = ["DaySunday", "DayMonday", "DayTuesday", "DayWednesday", "DayThursday", "DayFriday", "DaySaturday"] as const;

export function toScheduleRow(organizationId: string, schedule: MindbodyClassSchedule) {
  return {
    organization_id: organizationId,
    mindbody_class_schedule_id: schedule.Id,
    mindbody_class_description_id: positive(schedule.ClassDescription?.Id),
    class_name: schedule.ClassDescription?.Name ?? null,
    days: DAY_FLAGS.flatMap((flag, index) => (schedule[flag] ? [index] : [])),
    start_time: toTime(schedule.StartTime),
    end_time: toTime(schedule.EndTime),
    start_date: toDate(schedule.StartDate),
    end_date: toDate(schedule.EndDate),
    staff_mindbody_id: positive(schedule.Staff?.Id),
    mindbody_location_id: positive(schedule.Location?.Id),
    frequency_type: schedule.FrequencyType ?? null,
    frequency_interval: positive(schedule.FrequencyInterval),
    is_available: schedule.IsAvailable ?? null,
  };
}

export function toSessionTypeRow(organizationId: string, sessionType: MindbodySessionType) {
  return {
    organization_id: organizationId,
    mindbody_session_type_id: sessionType.Id,
    name: (sessionType.Name ?? "").trim() || `Session type ${sessionType.Id}`,
    kind: sessionType.Type ?? null,
    default_minutes: positive(sessionType.DefaultTimeLength),
    mindbody_program_id: positive(sessionType.ProgramId),
    sessions_deducted: typeof sessionType.NumDeducted === "number" ? sessionType.NumDeducted : null,
    online_description: htmlToText(sessionType.OnlineDescription),
    available_online: sessionType.AvailableForAddOn ?? null,
    resource_required: sessionType.ResourceRequired ?? null,
  };
}

// A schedule still running on `today` (YYYY-MM-DD).
export const isCurrentSchedule = (schedule: { start_date: string | null; end_date: string | null }, today: string) =>
  (!schedule.start_date || schedule.start_date <= today) && (!schedule.end_date || schedule.end_date >= today);

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
