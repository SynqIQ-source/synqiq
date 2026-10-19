import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { Mails, Percent, Reply, UserCheck } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { getExcludedDepartmentIds } from "@/lib/excluded-departments";
import { cn } from "@/lib/utils";
import { FollowUpRangeSelect } from "./range-select";

const PAGE_SIZE = 1000;
const RANGE_DAYS: Record<string, number> = { "7": 7, "30": 30, "90": 90 };

type VisitRow = {
  client_mindbody_unique_id: number;
  occurrence: { staff_id: string | null; substitute_staff_id: string | null; department_id: string | null } | null;
};

type MessageRow = {
  conversation_id: string;
  direction: "outbound" | "inbound";
  created_at: string;
  body_text: string;
  conversation: {
    instructor_id: string;
    client: { mindbody_unique_id: number; first_name: string; last_name: string } | null;
  } | null;
};

type InstructorFollowUpStat = {
  staffId: string;
  name: string;
  membersTaught: number;
  membersFollowedUp: number;
  rate: number | null;
  emailsSent: number;
  replies: number;
};

async function getOrgTimezone(supabase: ScopedSupabaseClient) {
  const { data } = await supabase.from("organizations").select("timezone").limit(1).maybeSingle();
  return data?.timezone ?? "utc";
}

// Paged: PostgREST caps an unranged select at 1000 rows.
async function getVisits(supabase: ScopedSupabaseClient, startIso: string, endIso: string): Promise<VisitRow[]> {
  const rows: VisitRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("class_visits")
      .select(
        "client_mindbody_unique_id, occurrence:class_occurrences!inner ( staff_id, substitute_staff_id, department_id, start_datetime )",
      )
      .eq("signed_in", true)
      .gte("occurrence.start_datetime", startIso)
      .lte("occurrence.start_datetime", endIso)
      .range(from, from + PAGE_SIZE - 1)
      .returns<VisitRow[]>();

    if (error) {
      throw new Error(`Failed to load class attendance: ${error.message}`);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) {
      return rows;
    }
  }
}

async function getMessages(supabase: ScopedSupabaseClient, startIso: string, endIso: string): Promise<MessageRow[]> {
  const rows: MessageRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("followup_messages")
      .select(
        `conversation_id, direction, created_at, body_text,
         conversation:followup_conversations!followup_messages_conversation_id_fkey (
           instructor_id,
           client:clients!followup_conversations_client_id_fkey ( mindbody_unique_id, first_name, last_name )
         )`,
      )
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
      .returns<MessageRow[]>();

    if (error) {
      throw new Error(`Failed to load follow-up messages: ${error.message}`);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) {
      return rows;
    }
  }
}

export default async function FollowUpActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; instructor?: string }>;
}) {
  const currentStaff = await getCurrentStaff();

  // Admin-only: this page exposes every instructor's messages to members.
  if (!currentStaff || currentStaff.role !== "admin") {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const range = params.range && RANGE_DAYS[params.range] ? params.range : "30";
  const supabase = await getScopedClient(currentStaff);
  const timezone = await getOrgTimezone(supabase);

  const now = DateTime.now().setZone(timezone);
  const start = now.minus({ days: RANGE_DAYS[range] }).startOf("day");
  const startIso = start.toUTC().toISO() ?? "";
  const endIso = now.toUTC().toISO() ?? "";

  const [visits, messages, hiddenDepartmentIds, staffResult] = await Promise.all([
    getVisits(supabase, startIso, endIso),
    getMessages(supabase, startIso, endIso),
    getExcludedDepartmentIds(supabase),
    supabase.from("staff").select("id, display_name").is("archived_at", null),
  ]);

  if (staffResult.error) {
    throw new Error(`Failed to load staff: ${staffResult.error.message}`);
  }
  const nameById = new Map((staffResult.data ?? []).map((member) => [member.id, member.display_name as string]));

  // Members each instructor taught (checked in) in the window. The class's
  // teacher is the approved sub when there was one.
  const taughtByStaff = new Map<string, Set<number>>();
  for (const visit of visits) {
    const occurrence = visit.occurrence;
    if (!occurrence || (occurrence.department_id && hiddenDepartmentIds.has(occurrence.department_id))) {
      continue;
    }
    const teacherId = occurrence.substitute_staff_id ?? occurrence.staff_id;
    if (!teacherId) {
      continue;
    }
    const set = taughtByStaff.get(teacherId) ?? new Set<number>();
    set.add(visit.client_mindbody_unique_id);
    taughtByStaff.set(teacherId, set);
  }

  const emailedByStaff = new Map<string, Set<number>>();
  const sentByStaff = new Map<string, number>();
  const repliesByStaff = new Map<string, number>();
  for (const message of messages) {
    const instructorId = message.conversation?.instructor_id;
    if (!instructorId) {
      continue;
    }
    if (message.direction === "outbound") {
      sentByStaff.set(instructorId, (sentByStaff.get(instructorId) ?? 0) + 1);
      const uid = message.conversation?.client?.mindbody_unique_id;
      if (uid != null) {
        const set = emailedByStaff.get(instructorId) ?? new Set<number>();
        set.add(uid);
        emailedByStaff.set(instructorId, set);
      }
    } else {
      repliesByStaff.set(instructorId, (repliesByStaff.get(instructorId) ?? 0) + 1);
    }
  }

  const instructorIds = new Set([...taughtByStaff.keys(), ...sentByStaff.keys()]);
  const stats: InstructorFollowUpStat[] = [...instructorIds]
    .filter((staffId) => nameById.has(staffId))
    .map((staffId) => {
      const taught = taughtByStaff.get(staffId) ?? new Set<number>();
      const emailed = emailedByStaff.get(staffId) ?? new Set<number>();
      // Rate only counts members the instructor actually taught in the
      // window, so emailing someone from an older class can't push it past 100%.
      const followedUpTaught = [...emailed].filter((uid) => taught.has(uid)).length;
      return {
        staffId,
        name: nameById.get(staffId) as string,
        membersTaught: taught.size,
        membersFollowedUp: emailed.size,
        rate: taught.size > 0 ? (followedUpTaught / taught.size) * 100 : null,
        emailsSent: sentByStaff.get(staffId) ?? 0,
        replies: repliesByStaff.get(staffId) ?? 0,
      };
    })
    .sort((a, b) => b.emailsSent - a.emailsSent || (b.rate ?? -1) - (a.rate ?? -1) || a.name.localeCompare(b.name));

  const totalTaught = new Set(stats.flatMap((stat) => [...(taughtByStaff.get(stat.staffId) ?? [])])).size;
  const totalFollowedUp = new Set(stats.flatMap((stat) => [...(emailedByStaff.get(stat.staffId) ?? [])])).size;
  const totalSent = stats.reduce((sum, stat) => sum + stat.emailsSent, 0);
  const totalReplies = stats.reduce((sum, stat) => sum + stat.replies, 0);

  // Selected instructor's conversations in the window, newest first.
  const selectedId = params.instructor && nameById.has(params.instructor) ? params.instructor : null;
  const selectedThreads = new Map<
    string,
    { conversationId: string; member: string; lastAt: string; lastText: string; sent: number; replies: number }
  >();
  if (selectedId) {
    for (const message of messages) {
      if (message.conversation?.instructor_id !== selectedId) {
        continue;
      }
      const thread = selectedThreads.get(message.conversation_id) ?? {
        conversationId: message.conversation_id,
        member: message.conversation.client
          ? `${message.conversation.client.first_name} ${message.conversation.client.last_name}`.trim()
          : "Member",
        lastAt: message.created_at,
        lastText: message.body_text,
        sent: 0,
        replies: 0,
      };
      if (message.direction === "outbound") {
        thread.sent += 1;
      } else {
        thread.replies += 1;
      }
      selectedThreads.set(message.conversation_id, thread);
    }
  }

  const rangeLabel = `Last ${RANGE_DAYS[range]} days`;
  const hrefFor = (instructor: string | null) => {
    const query = new URLSearchParams({ range });
    if (instructor) {
      query.set("instructor", instructor);
    }
    return `/dashboard/follow-up-activity?${query.toString()}`;
  };

  return (
    <DashboardShell
      title="Follow-ups"
      description="How many of their members each instructor follows up with after class, and what they sent."
      actions={<FollowUpRangeSelect range={range} />}
    >
      <div className="flex flex-col gap-6">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard icon={UserCheck} label="Members in class" value={totalTaught.toLocaleString()} detail={rangeLabel} />
          <KpiCard icon={Mails} label="Members followed up" value={totalFollowedUp.toLocaleString()} detail={`${totalSent.toLocaleString()} emails sent`} />
          <KpiCard
            icon={Percent}
            label="Follow-up rate"
            value={totalTaught > 0 ? `${((totalFollowedUp / totalTaught) * 100).toFixed(1)}%` : "—"}
            detail="of members in class got a follow-up"
          />
          <KpiCard icon={Reply} label="Member replies" value={totalReplies.toLocaleString()} detail="replies to follow-ups" />
        </section>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle>By instructor</CardTitle>
            <CardDescription>{rangeLabel}. Select an instructor to see the messages they sent.</CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-4">Instructor</TableHead>
                <TableHead className="text-right">Members in class</TableHead>
                <TableHead className="text-right">Followed up</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Emails sent</TableHead>
                <TableHead className="pr-4 text-right">Replies</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-8 text-center text-muted-foreground">
                    No classes or follow-ups in this time frame.
                  </TableCell>
                </TableRow>
              ) : (
                stats.map((stat) => (
                  <TableRow key={stat.staffId} className={cn(stat.staffId === selectedId && "bg-primary-subtle hover:bg-primary-subtle")}>
                    <TableCell className="pl-4 font-medium">
                      <Link href={hrefFor(stat.staffId === selectedId ? null : stat.staffId)} className="hover:text-primary hover:underline">
                        {stat.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{stat.membersTaught}</TableCell>
                    <TableCell className="text-right tabular-nums">{stat.membersFollowedUp}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, stat.rate ?? 0)}%` }} />
                        </span>
                        <span className="w-12 tabular-nums">{stat.rate !== null ? `${stat.rate.toFixed(0)}%` : "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{stat.emailsSent || <span className="text-muted-foreground">0</span>}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{stat.replies || <span className="text-muted-foreground">0</span>}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>

        {selectedId ? (
          <Card className="gap-0 py-0">
            <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-4">
              <div>
                <CardTitle>{nameById.get(selectedId)}&apos;s follow-ups</CardTitle>
                <CardDescription>{rangeLabel} · newest first · read-only</CardDescription>
              </div>
              <Link href={hrefFor(null)} className="text-sm text-muted-foreground hover:text-foreground">
                Close
              </Link>
            </CardHeader>
            {selectedThreads.size === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No follow-ups sent in this time frame.</p>
            ) : (
              <ul className="divide-y">
                {[...selectedThreads.values()].map((thread) => (
                  <li key={thread.conversationId}>
                    <Link
                      href={`/dashboard/follow-up/${thread.conversationId}?from=admin`}
                      className="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-accent"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{thread.member}</span>
                          {thread.replies > 0 ? (
                            <Badge variant="secondary">
                              {thread.replies} repl{thread.replies === 1 ? "y" : "ies"}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{thread.lastText}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {DateTime.fromISO(thread.lastAt, { zone: "utc" }).setZone(timezone).toFormat("LLL d, h:mm a")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>
    </DashboardShell>
  );
}
