import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { canCheckIn, isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCalendar } from "@/lib/trainer/sessions";
import { TrainerCalendar, type SessionTypeOption } from "./trainer-calendar";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ trainer?: string; date?: string; view?: string }> };

// Trainer calendar: book clients with trainers inside their available hours,
// then the trainer completes the session, which records its pay for that day.
// SynqIQ only (Mindbody's appointments show as busy; nothing goes back).
export default async function TrainerCalendarPage({ searchParams }: Props) {
  const staff = await requireAccess(canCheckIn);
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const params = await searchParams;
  const [{ data: orgRow }, { data: trainerRows }, { data: typeRows }] = await Promise.all([
    admin.from("organizations").select("timezone, trainer_availability_synced_at").eq("id", org).maybeSingle(),
    admin
      .from("staff")
      .select("id, display_name, is_trainer")
      .eq("organization_id", org)
      .eq("is_trainer", true)
      .is("archived_at", null)
      .order("display_name"),
    admin
      .from("session_types")
      .select("mindbody_session_type_id, name, default_minutes, mindbody_program_id")
      .eq("organization_id", org)
      .eq("kind", "Appointment")
      .in("mindbody_program_id", [2, 4, 5])
      .order("name"),
  ]);
  const zone = (orgRow?.timezone as string | null) ?? "America/Chicago";
  const trainers = (trainerRows ?? []).map((row) => ({ id: row.id as string, name: (row.display_name as string | null) ?? "Trainer" }));
  const view = params.view === "day" ? "day" : "week";
  const today = DateTime.now().setZone(zone).startOf("day");
  const picked = params.date ? DateTime.fromISO(params.date, { zone }) : today;
  const date = picked.isValid ? picked.startOf("day") : today;
  const trainerId =
    trainers.find((t) => t.id === params.trainer)?.id ?? (trainers.some((t) => t.id === staff.id) ? staff.id : (trainers[0]?.id ?? null));
  // Week: Monday to Sunday for one trainer. Day: every trainer.
  const from = view === "week" ? date.minus({ days: date.weekday - 1 }) : date;
  const to = view === "week" ? from.plus({ days: 7 }) : from.plus({ days: 1 });
  const ids = view === "week" ? (trainerId ? [trainerId] : []) : trainers.map((t) => t.id);
  const data = await loadCalendar(admin, org, ids, from.toUTC().toISO()!, to.toUTC().toISO()!);
  const sessionTypes: SessionTypeOption[] = (typeRows ?? []).map((row) => ({
    id: Number(row.mindbody_session_type_id),
    name: row.name as string,
    minutes: Number(row.default_minutes ?? 50),
  }));

  return (
    <DashboardShell
      title="Trainer Calendar"
      description="Book clients with trainers in their available hours. Completing a session records the trainer's pay for that day. Nothing here changes Mindbody."
      fullWidth
    >
      <TrainerCalendar
        timezone={zone}
        view={view}
        from={from.toISODate()!}
        date={date.toISODate()!}
        today={today.toISODate()!}
        trainers={trainers}
        trainerId={trainerId}
        sessionTypes={sessionTypes}
        me={{ id: staff.id, role: staff.role, isTrainer: staff.isTrainer, isAdmin: isClubAdmin(staff) }}
        syncedAt={(orgRow?.trainer_availability_synced_at as string | null) ?? null}
        {...data}
      />
    </DashboardShell>
  );
}
