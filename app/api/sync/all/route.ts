import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncClasses } from "@/lib/sync/classes";
import { syncAppointments } from "@/lib/sync/appointments";
import { syncSales } from "@/lib/sync/sales";

// The actual target of both vercel.json cron entries. Runs all three
// MindBody syncs (classes, appointments, sales) in one invocation because
// this project is on Vercel's Hobby plan, which caps cron jobs at 2 total --
// already fully spent on classes' own two DST-safe daily firings (see
// lib/sync/classes.ts) before appointments/sales existed. Rather than adding
// two more cron entries (not possible on Hobby) or dropping classes down to
// one firing (losing its same-day-retry hedge), both existing entries now
// point here instead of directly at /api/sync/classes, so all three syncs
// share that same hedge for free.
//
// Sequential, not Promise.all -- appointments/sales look up staff_id via the
// `staff` table that syncClasses populates, so running classes first means a
// newly added instructor is resolvable the same run instead of one day late.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const classes = await syncClasses({});

  // syncClasses's own "already ran today" gate (keyed off
  // class_occurrences.sync_timestamp) doubles as the gate for this whole
  // combined run -- if today's classes sync already happened, appointments
  // and sales already ran alongside it too, so there's nothing left to do
  // until tomorrow.
  if (classes.success && classes.skipped) {
    return NextResponse.json({ success: true, skipped: true, reason: classes.reason });
  }

  // Classes failing outright shouldn't block appointments/sales -- they
  // don't depend on today's class import succeeding, only on staff/location
  // rows a prior run already populated.
  const appointments = await syncAppointments({});
  const sales = await syncSales({});

  const success = classes.success && appointments.success && sales.success;

  return NextResponse.json({ success, classes, appointments, sales }, { status: success ? 200 : 500 });
}
