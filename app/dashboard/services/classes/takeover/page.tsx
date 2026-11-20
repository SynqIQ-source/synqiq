import type { Metadata } from "next";
import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { planTakeover } from "@/lib/classes/takeover";
import { TakeoverButton } from "./takeover-button";

export const metadata: Metadata = { title: "Take over the schedule" };
export const dynamic = "force-dynamic";

// The dry run for taking the class schedule over from Mindbody, and the
// button that does it (Club Admins). Nothing changes until it's pressed.
export default async function TakeoverPage() {
  const staff = await requireAccess(isClubAdmin);
  const plan = await planTakeover(staff.organizationId);
  const done = plan.takenOverAt;

  return (
    <DashboardShell
      title="Take over the schedule"
      description="Make SynqIQ the owner of your class schedule. This page is a dry run: nothing changes until you press the button."
    >
      <div className="max-w-3xl space-y-4">
        <Link href="/dashboard/services/classes" className="text-sm underline">
          Back to Classes
        </Link>
        {done ? (
          <Card>
            <CardHeader>
              <CardTitle>Done</CardTitle>
              <CardDescription>
                Taken over {DateTime.fromISO(done).toFormat("LLL d, yyyy 'at' h:mm a")}. Change classes on the Classes page; Mindbody&apos;s
                nightly import no longer touches them.
              </CardDescription>
            </CardHeader>
            {plan.series ? (
              <CardContent className="text-sm text-muted-foreground">
                {plan.series} Mindbody class time{plan.series === 1 ? " was" : "s were"} added in Mindbody after the takeover and{" "}
                {plan.series === 1 ? "isn't" : "aren't"} in SynqIQ&apos;s schedule.
              </CardContent>
            ) : null}
          </Card>
        ) : null}

        {done ? null : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>What will happen</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    <span className="font-medium">{plan.series}</span> running class times and{" "}
                    <span className="font-medium">{plan.classTypes}</span> classes become SynqIQ&apos;s, in place. Same names, same rooms,
                    same instructors: nothing is copied, so there won&apos;t be two of anything.
                  </li>
                  <li>
                    <span className="font-medium">{plan.endDatesRemoved}</span> end dates Mindbody forced on (a year out) are removed, so
                    those classes run until you end them.
                  </li>
                  <li>
                    Mindbody&apos;s nightly import stops changing categories, rooms, classes and class times. Appointment types still
                    import.
                  </li>
                  <li>
                    Bookings, check-ins and attendance from Mindbody keep flowing until Mindbody is switched off, with no double counting.
                  </li>
                  <li>{plan.notRunning} old Mindbody class times that no longer run stay as history.</li>
                </ul>
                <div>
                  <p className="font-medium">By category</p>
                  <p className="text-muted-foreground">{plan.byCategory.map((row) => `${row.name} ${row.series}`).join(" · ") || "—"}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Check before you press it</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {plan.endDatesKept.length ? (
                  <div>
                    <p className="font-medium">End dates kept (they look real: within 3 months)</p>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {plan.endDatesKept.map((row, index) => (
                        <li key={index}>
                          {row.className}: last class {DateTime.fromISO(row.endDate).toFormat("LLL d, yyyy")}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {plan.unmappedInstructors.length ? (
                  <p className="text-amber-800 dark:text-amber-300">
                    {plan.unmappedInstructors.reduce((sum, row) => sum + row.series, 0)} class times have an instructor who isn&apos;t in
                    SynqIQ&apos;s staff list (Mindbody ids {plan.unmappedInstructors.map((row) => row.mindbodyStaffId).join(", ")}).
                    They&apos;ll have no instructor until you pick one.
                  </p>
                ) : (
                  <p>Every instructor is matched to a SynqIQ staff member.</p>
                )}
                {plan.unmappedRooms.length ? (
                  <p className="text-amber-800 dark:text-amber-300">
                    {plan.unmappedRooms.reduce((sum, row) => sum + row.series, 0)} class times use a room SynqIQ doesn&apos;t have.
                  </p>
                ) : (
                  <p>Every room is matched.</p>
                )}
                {plan.sameNameClasses.length || plan.sameNameRooms.length ? (
                  <p className="text-amber-800 dark:text-amber-300">
                    Mindbody already has these names twice (left as they are; merge them afterwards if you like):{" "}
                    {[...plan.sameNameClasses, ...plan.sameNameRooms].join(", ")}.
                  </p>
                ) : (
                  <p>No duplicate class or room names.</p>
                )}
                <p className="text-muted-foreground">
                  Until Mindbody is switched off, members booking in the Mindbody app see Mindbody&apos;s schedule. If you move or add a
                  class in SynqIQ before then, make the same change in Mindbody.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Take over</CardTitle>
                <CardDescription>Planned for Dec 18, when staff start working in SynqIQ.</CardDescription>
              </CardHeader>
              <CardContent>
                <TakeoverButton />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
