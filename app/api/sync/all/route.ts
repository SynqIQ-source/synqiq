import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncClasses } from "@/lib/sync/classes";
import { syncAppointments } from "@/lib/sync/appointments";
import { syncSales } from "@/lib/sync/sales";
import { syncClients } from "@/lib/sync/clients";
import { syncClassVisits } from "@/lib/sync/class-visits";
import { sendSubstitutionReminders } from "@/lib/substitutions/reminders";

// Hobby's function-duration ceiling -- class-visits sync is one MindBody
// API call per occurrence (no bulk form), so it's the one piece of this
// combined run whose time cost scales with how much happened recently
// rather than being a handful of paginated list calls. Kept to Hobby's max
// rather than the unconfigured default so a busier-than-usual night (more
// classes in the 2-day lookback) has headroom instead of getting cut off
// mid-run.
export const maxDuration = 60;

// The actual target of both vercel.json cron entries. Runs all five
// MindBody syncs (classes, appointments, sales, clients, class visits) in
// one invocation because this project is on Vercel's Hobby plan, which caps
// cron jobs at 2 total -- already fully spent on classes' own two DST-safe
// daily firings (see lib/sync/classes.ts) before appointments/sales/
// clients/class-visits existed. Rather than adding more cron entries (not
// possible on Hobby) or dropping classes down to one firing (losing its
// same-day-retry hedge), both existing entries now point here instead of
// directly at /api/sync/classes, so every sync shares that same hedge for
// free.
//
// Sequential, not Promise.all -- appointments/sales/class-visits all depend
// on rows a prior sync in this same list populates (staff via syncClasses,
// occurrences via syncClasses again for class-visits), so running classes
// first means a newly added instructor/class is resolvable the same run
// instead of one day late.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const classes = await syncClasses({});

  // syncClasses's own "already ran today" gate (keyed off
  // class_occurrences.sync_timestamp) doubles as the gate for this whole
  // combined run -- if today's classes sync already happened, everything
  // else already ran alongside it too, so there's nothing left to do until
  // tomorrow.
  if (classes.success && classes.skipped) {
    return NextResponse.json({ success: true, skipped: true, reason: classes.reason });
  }

  // Classes failing outright shouldn't block the rest -- none of them
  // depend on today's class import succeeding, only on staff/location/
  // occurrence rows a prior run already populated (class-visits does need
  // *some* prior occurrence sync to have rows to look at, but not today's).
  const appointments = await syncAppointments({});
  const sales = await syncSales({});
  const clients = await syncClients();
  const classVisits = await syncClassVisits({});

  // Not a MindBody sync -- runs against this app's own substitution_requests
  // data, so it's cheap and has no reason to depend on any of the syncs
  // above succeeding. Placed last simply so a fresh class/staff sync this
  // same run is available to it (an eligibility change from today already
  // applies to today's reminder pass).
  const substitutionReminders = await sendSubstitutionReminders();

  const success =
    classes.success &&
    appointments.success &&
    sales.success &&
    clients.success &&
    classVisits.success &&
    substitutionReminders.success;

  return NextResponse.json(
    { success, classes, appointments, sales, clients, classVisits, substitutionReminders },
    { status: success ? 200 : 500 },
  );
}
