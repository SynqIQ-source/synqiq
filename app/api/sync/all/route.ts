import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncClasses } from "@/lib/sync/classes";
import { syncAppointments } from "@/lib/sync/appointments";
import { syncSales } from "@/lib/sync/sales";
import { syncClients } from "@/lib/sync/clients";
import { syncClassVisits } from "@/lib/sync/class-visits";
import { runGatedSync } from "@/lib/sync/sync-state";
import { combineSiteResults, sitesForRequest } from "@/lib/sync/sites";
import { sendSubstitutionReminders } from "@/lib/substitutions/reminders";

// Pro's ceiling. Each MindBody sync also has its own cron entry + its own
// route with a per-sync maxDuration; this combined route is the manual
// "run everything now" button and a belt-and-braces safety net if an
// individual cron entry is ever removed. Everything it calls is gated
// (classes by its own class_occurrences.sync_timestamp check, the other
// four by sync_state) so a second run in the same day is cheap.
export const maxDuration = 300;

// Sequential, not Promise.all -- appointments/sales/class-visits all depend
// on rows a prior sync in this list populates (staff via syncClasses,
// occurrences via syncClasses again for class-visits), so running classes
// first means a newly added instructor/class is resolvable the same run
// instead of one day late.
//
// History: this used to be the ONLY cron target, because Hobby capped cron
// jobs at 2 (both spent on classes' DST-safe firings). That packed all five
// syncs into one <=60s invocation, which started overrunning the limit when
// clients + class-visits were added -- and because classes ran first and
// satisfied the shared "already ran today" gate, every later firing then
// skipped the whole run without retrying the syncs that never finished.
// Trainer Health / heat-map data silently went stale for a week. On Pro now
// with a cron entry per sync and per-sync gates (sync_state), so that
// failure mode is gone; this route no longer early-returns when classes is
// skipped.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Every connected studio (or ?siteId= for one), one sync at a time.
  const sites = await sitesForRequest(request.nextUrl.searchParams);
  const each = async <T extends { success: boolean }>(run: (siteId: number) => Promise<T>) => {
    const results = [];
    for (const siteId of sites) results.push({ siteId, result: await run(siteId) });
    return combineSiteResults(results);
  };

  const classes = await each((siteId) => syncClasses({ siteId }));

  // Classes being skipped (already ran today) or failing outright no longer
  // blocks the rest -- each of these self-gates on sync_state and only
  // needs staff/location/occurrence rows a PRIOR run already populated, not
  // today's.
  const appointments = await each((siteId) =>
    runGatedSync("appointments", () => syncAppointments({ siteId }), { siteId }),
  );
  const sales = await each((siteId) => runGatedSync("sales", () => syncSales({ siteId }), { siteId }));
  const clients = await each((siteId) => runGatedSync("clients", () => syncClients({ siteId }), { siteId }));
  const classVisits = await each((siteId) =>
    runGatedSync("class-visits", () => syncClassVisits({ siteId }), { siteId }),
  );

  // Not a MindBody sync -- runs against this app's own substitution_requests
  // data, so it's cheap and independent. Last simply so a fresh class/staff
  // sync this same run is available to it.
  const substitutionReminders = await sendSubstitutionReminders();

  const success =
    classes.success &&
    appointments.success &&
    sales.success &&
    clients.success &&
    classVisits.success &&
    substitutionReminders.success;

  return NextResponse.json(
    {
      success,
      classes: classes.body,
      appointments: appointments.body,
      sales: sales.body,
      clients: clients.body,
      classVisits: classVisits.body,
      substitutionReminders,
    },
    { status: success ? 200 : 500 },
  );
}
