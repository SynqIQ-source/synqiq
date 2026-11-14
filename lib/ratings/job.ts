import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOptionalEnv } from "@/lib/env";
import { newToken } from "@/lib/member/password";
import { sendEmailToRecipients } from "@/lib/email/send";
import { LINK_DAYS, QUEUE_DAYS, firstVisitsByQuarter, pickToSend, type Visit } from "@/lib/ratings/rules";

// Nightly, after the class-visit sync: find each member's first class with
// each instructor this quarter, queue a rating request, and email the ones
// allowed today (2 a week per member). During the parallel run only
// member-portal testers are emailed (organizations.ratings_mode).

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}
const chunks = <T>(list: T[], size = 200) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export async function runRatings(organizationId: string, now = new Date()) {
  const admin = createSupabaseAdminClient();
  const { data: org } = await admin.from("organizations").select("name, timezone, ratings_mode").eq("id", organizationId).maybeSingle();
  const mode = (org?.ratings_mode as string | null) ?? "testers";
  if (!org || mode === "off") return { skipped: "off" };
  const zone = (org.timezone as string | null) ?? "America/Chicago";
  const queued = await queueRequests(admin, organizationId, zone, now);
  const tidied = await expireOld(admin, organizationId, now);
  const sent = await sendDue(admin, organizationId, org.name as string, zone, mode, now);
  return { queued, ...tidied, ...sent };
}

async function queueRequests(admin: Admin, organizationId: string, zone: string, now: Date) {
  // The whole quarter (of two weeks ago, so a new quarter still sees last
  // quarter's final classes) to know each member's first class per instructor.
  const windowStart = DateTime.fromJSDate(now).setZone(zone).minus({ days: QUEUE_DAYS });
  const from = windowStart.startOf("quarter").toUTC().toISO()!;
  const occurrences = await all((a, b) =>
    admin
      .from("class_occurrences")
      .select("id, class_name, mindbody_class_schedule_id, staff_id, substitute_staff_id, start_datetime, end_datetime")
      .eq("organization_id", organizationId)
      .gte("start_datetime", from)
      .lte("end_datetime", now.toISOString())
      .order("start_datetime")
      .range(a, b),
  );
  const classes = occurrences.filter(
    (row) => (row.substitute_staff_id ?? row.staff_id) && !/pool lane/i.test(String(row.class_name ?? "")),
  );
  if (!classes.length) return 0;
  const occBy = new Map(classes.map((row) => [row.id as string, row]));
  const visitRows = (
    await Promise.all(
      chunks(classes.map((row) => row.id as string)).map((ids) =>
        all((a, b) =>
          admin
            .from("class_visits")
            .select("occurrence_id, client_mindbody_unique_id")
            .eq("organization_id", organizationId)
            .in("occurrence_id", ids)
            .order("id")
            .range(a, b),
        ),
      ),
    )
  ).flat();
  const visits: Visit[] = visitRows.map((row) => {
    const occ = occBy.get(row.occurrence_id as string)!;
    return {
      clientId: String(row.client_mindbody_unique_id),
      staffId: (occ.substitute_staff_id ?? occ.staff_id) as string,
      start: occ.start_datetime as string,
      occurrenceId: occ.id as string,
    };
  });
  const recentFrom = windowStart.toUTC().toISO()!;
  const firsts = firstVisitsByQuarter(visits, zone).filter((visit) => visit.start >= recentFrom);
  if (!firsts.length) return 0;

  // Class style: the class type's name (via the schedule), else the class name.
  const scheduleIds = [...new Set(classes.map((row) => row.mindbody_class_schedule_id).filter((id) => id != null))] as number[];
  const [{ data: schedules }, { data: types }] = await Promise.all([
    admin
      .from("class_schedules")
      .select("mindbody_class_schedule_id, mindbody_class_description_id")
      .eq("organization_id", organizationId)
      .in("mindbody_class_schedule_id", scheduleIds.length ? scheduleIds : [-1]),
    admin.from("class_types").select("mindbody_class_description_id, name, edits").eq("organization_id", organizationId),
  ]);
  const typeName = new Map(
    (types ?? []).map((row) => [
      Number(row.mindbody_class_description_id),
      ((row.edits as { name?: string } | null)?.name ?? row.name) as string,
    ]),
  );
  const descBySchedule = new Map(
    (schedules ?? []).map((row) => [Number(row.mindbody_class_schedule_id), Number(row.mindbody_class_description_id)]),
  );

  // Members by Mindbody unique id.
  const uniqueIds = [...new Set(firsts.map((visit) => Number(visit.clientId)))].filter((id) => Number.isInteger(id) && id < 2_147_483_647);
  const clients = (
    await Promise.all(
      chunks(uniqueIds).map((ids) =>
        admin
          .from("clients")
          .select("mindbody_unique_id, mindbody_client_id, first_name, last_name")
          .eq("organization_id", organizationId)
          .in("mindbody_unique_id", ids),
      ),
    )
  ).flatMap((result) => result.data ?? []);
  const clientBy = new Map(clients.map((row) => [String(row.mindbody_unique_id), row]));

  const rows = firsts.flatMap((visit) => {
    const client = clientBy.get(visit.clientId);
    const occ = occBy.get(visit.occurrenceId)!;
    if (!client?.mindbody_client_id) return [];
    const desc = occ.mindbody_class_schedule_id == null ? undefined : descBySchedule.get(Number(occ.mindbody_class_schedule_id));
    const className = String(occ.class_name ?? "Class").trim();
    return [
      {
        organization_id: organizationId,
        mindbody_client_id: client.mindbody_client_id as string,
        client_name: `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim() || null,
        staff_id: visit.staffId,
        class_occurrence_id: occ.id as string,
        class_name: className,
        class_style: (desc != null ? typeName.get(desc) : undefined) ?? className,
        class_start: occ.start_datetime as string,
        quarter: visit.quarter,
      },
    ];
  });
  let created = 0;
  for (const part of chunks(rows, 500)) {
    const { data, error } = await admin
      .from("rating_requests")
      .upsert(part, { onConflict: "organization_id,mindbody_client_id,staff_id,quarter", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    created += data?.length ?? 0;
  }
  return created;
}

async function expireOld(admin: Admin, organizationId: string, now: Date) {
  const { data: expired } = await admin
    .from("rating_requests")
    .update({ status: "expired", token_hash: null })
    .eq("organization_id", organizationId)
    .eq("status", "sent")
    .lt("expires_at", now.toISOString())
    .select("id");
  const { data: dropped } = await admin
    .from("rating_requests")
    .update({ status: "skipped", skip_reason: "Not sent within two weeks (weekly limit)" })
    .eq("organization_id", organizationId)
    .eq("status", "queued")
    .lt("class_start", new Date(now.getTime() - QUEUE_DAYS * 86_400_000).toISOString())
    .select("id");
  return { expired: expired?.length ?? 0, dropped: dropped?.length ?? 0 };
}

async function sendDue(admin: Admin, organizationId: string, studioName: string, zone: string, mode: string, now: Date) {
  const queued = await all((a, b) =>
    admin
      .from("rating_requests")
      .select("id, mindbody_client_id, staff_id, class_name, class_start")
      .eq("organization_id", organizationId)
      .eq("status", "queued")
      .order("class_start")
      .range(a, b),
  );
  if (!queued.length) return { sent: 0, waiting: 0 };
  const clientIds = [...new Set(queued.map((row) => row.mindbody_client_id as string))];
  const [testers, optOuts, recent, clients, personal, staff] = await Promise.all([
    mode === "testers"
      ? admin.from("member_portal_testers").select("mindbody_client_id").eq("organization_id", organizationId)
      : Promise.resolve({ data: null }),
    admin.from("rating_opt_outs").select("mindbody_client_id").eq("organization_id", organizationId),
    admin
      .from("rating_requests")
      .select("mindbody_client_id")
      .eq("organization_id", organizationId)
      .gte("sent_at", new Date(now.getTime() - 7 * 86_400_000).toISOString()),
    Promise.all(
      chunks(clientIds).map((ids) =>
        admin
          .from("clients")
          .select("mindbody_client_id, first_name, email")
          .eq("organization_id", organizationId)
          .in("mindbody_client_id", ids),
      ),
    ).then((results) => results.flatMap((result) => result.data ?? [])),
    Promise.all(
      chunks(clientIds).map((ids) =>
        admin
          .from("member_personal")
          .select("mindbody_client_id, edits")
          .eq("organization_id", organizationId)
          .in("mindbody_client_id", ids),
      ),
    ).then((results) => results.flatMap((result) => result.data ?? [])),
    admin.from("staff").select("id, display_name").eq("organization_id", organizationId),
  ]);
  const allowed = testers.data ? new Set(testers.data.map((row) => row.mindbody_client_id as string)) : null;
  const optedOut = new Set((optOuts.data ?? []).map((row) => row.mindbody_client_id as string));
  const editedEmail = new Map(
    personal
      .filter((row) => (row.edits as { email?: string | null } | null)?.email !== undefined)
      .map((row) => [row.mindbody_client_id as string, (row.edits as { email?: string | null }).email ?? null]),
  );
  const clientBy = new Map(
    clients.map((row) => [
      row.mindbody_client_id as string,
      {
        firstName: (row.first_name as string | null) ?? "",
        email: editedEmail.has(row.mindbody_client_id as string)
          ? editedEmail.get(row.mindbody_client_id as string)
          : (row.email as string | null),
      },
    ]),
  );
  const sentThisWeek = new Map<string, number>();
  for (const row of recent.data ?? [])
    sentThisWeek.set(row.mindbody_client_id as string, (sentThisWeek.get(row.mindbody_client_id as string) ?? 0) + 1);
  const staffName = new Map((staff.data ?? []).map((row) => [row.id as string, (row.display_name as string | null) ?? "your instructor"]));

  // Skip those who can't be emailed (not a tester yet, opted out, no email):
  // they stay queued (testers can be added) until the two-week cutoff.
  const eligible = queued.filter((row) => {
    const id = row.mindbody_client_id as string;
    return (!allowed || allowed.has(id)) && !optedOut.has(id) && Boolean(clientBy.get(id)?.email);
  });
  const toSend = pickToSend(
    eligible.map((row) => ({ ...row, clientId: row.mindbody_client_id as string, classStart: row.class_start as string })),
    sentThisWeek,
  );
  const siteUrl = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? "https://synqiq.co";
  const from = `${studioName.replace(/[<>"]/g, "")} <notifications@synqiq.co>`;
  let sent = 0;
  for (const request of toSend) {
    const client = clientBy.get(request.clientId)!;
    const { token, hash } = newToken();
    const { data: claimed } = await admin
      .from("rating_requests")
      .update({
        status: "sent",
        token_hash: hash,
        sent_at: now.toISOString(),
        expires_at: new Date(now.getTime() + LINK_DAYS * 86_400_000).toISOString(),
      })
      .eq("id", request.id)
      .eq("status", "queued")
      .select("id");
    if (!claimed?.length) continue;
    const instructor = staffName.get(request.staff_id as string) ?? "your instructor";
    const when = DateTime.fromISO(request.class_start as string)
      .setZone(zone)
      .toFormat("cccc");
    await sendEmailToRecipients([{ email: client.email as string }], {
      from,
      ...ratingEmail({
        studioName,
        firstName: client.firstName,
        className: request.class_name as string,
        instructor: instructor.split(" ")[0],
        when,
        link: `${siteUrl}/r/${encodeURIComponent(token)}`,
      }),
    });
    sent += 1;
  }
  return { sent, waiting: queued.length - sent };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function ratingEmail(input: {
  studioName: string;
  firstName: string;
  className: string;
  instructor: string;
  when: string;
  link: string;
}) {
  const stars = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<a href="${escapeHtml(`${input.link}?stars=${n}`)}" style="display:inline-block;margin:0 4px;font-size:32px;line-height:1;color:#f59e0b;text-decoration:none" aria-label="${n} star${n === 1 ? "" : "s"}">&#9733;</a>`,
    )
    .join("");
  return {
    subject: `How was ${input.className} with ${input.instructor}?`,
    html: `
      <p>Hi ${escapeHtml(input.firstName || "there")},</p>
      <p>Thanks for coming to <strong>${escapeHtml(input.className)}</strong> with ${escapeHtml(input.instructor)} on ${escapeHtml(input.when)}. How was it?</p>
      <p style="margin:20px 0">${stars}</p>
      <p>Tap a star to rate it. You can add a comment on the next page if you like.</p>
      <p style="color:#666;font-size:13px">Your feedback is anonymous to the instructor. The link works once and expires in ${LINK_DAYS} days.
      Don't want these emails? <a href="${escapeHtml(`${input.link}?stop=1`)}">Stop rating emails</a>.</p>
      <p style="color:#666;font-size:13px">${escapeHtml(input.studioName)}</p>
    `,
  };
}
