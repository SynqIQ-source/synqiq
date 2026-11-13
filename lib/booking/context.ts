import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { effective, type CatalogValue } from "@/lib/classes/catalog-edits";
import type { ProgramRules, SessionInfo } from "@/lib/booking/rules";
import { toInstant } from "@/lib/classes/calendar";
import { parseLayout, type RoomLayout } from "@/lib/rooms/layout";

// Everything about one class on SynqIQ's calendar that booking needs: the
// class (with single-date edits), its program's rules (with SynqIQ edits),
// and how many spots are taken (Mindbody's bookings from its class sync +
// SynqIQ's). Service role; callers check the role.

export type BookingRow = {
  id: string;
  mindbody_client_id: string;
  client_name: string;
  status: "booked" | "waitlisted" | "cancelled" | "late_cancelled" | "checked_in" | "no_show";
  waitlisted_at: string | null;
  coverage_kind: "membership" | "pack" | "none";
  coverage_name: string | null;
  note: string | null;
  late_cancel_fee_cents: number | null;
  booked_at: string;
  booked_by_staff_id: string | null;
  booked_by_member_account_id: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  checked_in_at: string | null;
  spot_id: string | null;
  spot_label: string | null;
};

export type SessionContext = {
  session: SessionInfo & {
    id: string;
    className: string;
    localDate: string;
    startTime: string;
    endTime: string;
    roomId: number | null;
    staffMindbodyId: number | null;
    mindbodyClassScheduleId: number | null;
    note: string | null;
  };
  rules: ProgramRules;
  mindbodyBooked: number | null; // null when Mindbody has no matching class
  bookings: BookingRow[];
  taken: number; // spots in use (Mindbody + SynqIQ booked/checked in)
  timezone: string;
  layout: RoomLayout | null; // the room's pick-a-spot layout, if it has one
  takenSpots: Set<string>; // spot ids held by booked / checked-in people
};

const ACTIVE = new Set(["booked", "checked_in"]);
const DEFAULT_RULES = (name: string): ProgramRules => ({
  name,
  includedInMembership: true,
  bookingOpensDays: 21,
  bookingClosesMinutes: 30,
  cancelWindowMinutes: 60,
  lateCancelFeeCents: 0,
});

export async function loadSessionContext(organizationId: string, sessionId: string): Promise<SessionContext | null> {
  const admin = createSupabaseAdminClient();
  const [{ data: row }, { data: org }] = await Promise.all([
    admin.from("class_sessions").select("*").eq("organization_id", organizationId).eq("id", sessionId).maybeSingle(),
    admin.from("organizations").select("timezone").eq("id", organizationId).maybeSingle(),
  ]);
  if (!row) return null;
  const timezone = (org?.timezone as string | null) ?? "America/Chicago";
  const merged = effective("class_session", row as Record<string, unknown> & { edits: Record<string, CatalogValue> | null });

  // Times: a single-date time change moves the class.
  const startTime = String(merged.start_time);
  const endTime = String(merged.end_time);
  const startsAt = startTime === row.start_time ? (row.starts_at as string) : toInstant(row.local_date as string, startTime, timezone);
  const endsAt = endTime === row.end_time ? (row.ends_at as string) : toInstant(row.local_date as string, endTime, timezone);

  // Program rules through the class type.
  let rules = DEFAULT_RULES("Class");
  if (row.class_type_id) {
    const { data: type } = await admin.from("class_types").select("mindbody_program_id").eq("id", row.class_type_id).maybeSingle();
    if (type?.mindbody_program_id) {
      const { data: program } = await admin
        .from("departments")
        .select("name, cancel_window_minutes, booking_opens_days, booking_closes_minutes, edits")
        .eq("organization_id", organizationId)
        .eq("mindbody_program_id", type.mindbody_program_id)
        .maybeSingle();
      if (program) {
        const p = effective("program", program as Record<string, unknown> & { edits: Record<string, CatalogValue> | null });
        rules = {
          name: program.name as string,
          includedInMembership: p.included_in_membership !== false,
          bookingOpensDays: (p.booking_opens_days as number | null) ?? null,
          bookingClosesMinutes: (p.booking_closes_minutes as number | null) ?? null,
          cancelWindowMinutes: (p.cancel_window_minutes as number | null) ?? null,
          lateCancelFeeCents: (p.late_cancel_fee_cents as number | null) ?? 0,
        };
      }
    }
  }

  // Mindbody's bookings for the same class (from its class sync).
  let mindbodyBooked: number | null = null;
  if (row.mindbody_class_schedule_id) {
    const { data: occurrence } = await admin
      .from("class_occurrences")
      .select("total_booked")
      .eq("organization_id", organizationId)
      .eq("mindbody_class_schedule_id", row.mindbody_class_schedule_id)
      .eq("start_datetime", row.starts_at)
      .maybeSingle();
    if (occurrence) mindbodyBooked = (occurrence.total_booked as number | null) ?? 0;
  }

  const { data: bookings } = await admin
    .from("class_bookings")
    .select(
      "id, mindbody_client_id, client_name, status, waitlisted_at, coverage_kind, coverage_name, note, late_cancel_fee_cents, booked_at, booked_by_staff_id, booked_by_member_account_id, cancelled_at, cancel_reason, checked_in_at, spot_id, spot_label",
    )
    .eq("class_session_id", sessionId)
    .order("booked_at")
    .returns<BookingRow[]>();
  const synqiqTaken = (bookings ?? []).filter((booking) => ACTIVE.has(booking.status)).length;
  const layout = await loadRoomLayout(organizationId, (merged.mindbody_resource_id as number | null) ?? null);
  const takenSpots = new Set(
    (bookings ?? []).filter((booking) => ACTIVE.has(booking.status) && booking.spot_id).map((booking) => booking.spot_id as string),
  );

  return {
    session: {
      id: row.id as string,
      className: row.class_name as string,
      localDate: row.local_date as string,
      startTime,
      endTime,
      startsAt,
      endsAt,
      capacity: (merged.capacity as number | null) ?? null,
      active: merged.active !== false && !row.removed_from_schedule_at,
      roomId: (merged.mindbody_resource_id as number | null) ?? null,
      staffMindbodyId: (merged.staff_mindbody_id as number | null) ?? null,
      mindbodyClassScheduleId: (row.mindbody_class_schedule_id as number | null) ?? null,
      note: (merged.note as string | null) ?? null,
    },
    rules,
    mindbodyBooked,
    bookings: bookings ?? [],
    taken: (mindbodyBooked ?? 0) + synqiqTaken,
    timezone,
    layout,
    takenSpots,
  };
}

// The pick-a-spot layout of a room (by Mindbody resource id), if it has one.
export async function loadRoomLayout(organizationId: string, mindbodyResourceId: number | null): Promise<RoomLayout | null> {
  if (mindbodyResourceId == null) return null;
  const admin = createSupabaseAdminClient();
  const { data: room } = await admin
    .from("rooms")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("mindbody_resource_id", mindbodyResourceId)
    .maybeSingle();
  if (!room) return null;
  const { data: row } = await admin
    .from("room_layouts")
    .select("columns, rows, items, spot_noun, active")
    .eq("room_id", room.id)
    .eq("active", true)
    .maybeSingle();
  return parseLayout(row);
}
