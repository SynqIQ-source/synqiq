import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireCrmStaff } from "@/lib/crm/module";
import { getCrmOrg } from "@/lib/crm/org";
import { signedPhotoUrls } from "@/lib/crm/photos";
import { MATCH_REASON_LABELS, SOURCE_LABELS, VISIT_TYPE_LABELS, nextAction } from "@/lib/crm/labels";
import { getScopedClient } from "@/lib/supabase/scoped";
import { cn } from "@/lib/utils";
import { AddLeadButton } from "./add-lead-button";
import { GuestAvatar } from "./guest-avatar";
import { GuestFilters } from "./guest-filters";
import { PendingMatchActions } from "./pending-match-actions";
import { OnDutySelect } from "./on-duty-select";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const RANGES = ["today", "7", "month", "custom", "all"] as const;
type Range = (typeof RANGES)[number];
const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

const ROW_LIMIT = 500;

type ContactSummary = {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  source: string;
  photo_path: string | null;
  assigned_staff_id: string | null;
  referrer_name_typed: string | null;
  referrer_unresolved: boolean;
  email_check_status: string;
  closed_at: string | null;
  referring_client: { first_name: string; last_name: string } | null;
  created_at: string;
};

const CONTACT_COLUMNS =
  "id, first_name, last_name, status, source, photo_path, assigned_staff_id, referrer_name_typed, referrer_unresolved, email_check_status, closed_at, created_at, referring_client:clients!crm_contacts_referring_client_id_fkey ( first_name, last_name )";

type Row = {
  key: string;
  contact: ContactSummary;
  // Latest kiosk visit in the window (or ever, for "All"), if any.
  signedInAt: string | null;
  // When the row sorts: that visit, else when the contact was added.
  activityAt: string;
  type: string;
};

type PendingRow = {
  id: string;
  reason: string;
  created_at: string;
  submitted: { id: string; first_name: string; last_name: string } | null;
  candidate: { id: string; first_name: string; last_name: string } | null;
};

type Visit = { contact_id: string; visit_at: string; visit_type: string };

// Guests (requirement 12). Everything is read through the staff member's
// own session, so RLS (same org; admin or seller) is the access boundary.
//
// Filters (all in the URL, none of them personal data): date range (today,
// last 7 days, this month, picked dates, all), salesperson, and status. A
// date range shows guests who checked in OR were added in it, so phone-in
// leads appear too.
export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; start?: string; end?: string; seller?: string; status?: string }>;
}) {
  const staff = await requireCrmStaff();
  const params = await searchParams;

  const supabase = await getScopedClient(staff);
  const org = await getCrmOrg(staff.organizationId);
  const now = DateTime.now().setZone(org.timezone);

  let range: Range = RANGES.includes(params.range as Range) ? (params.range as Range) : "today";
  const startParam = params.start && DATE_PARAM.test(params.start) ? params.start : now.toISODate()!;
  const endParam = params.end && DATE_PARAM.test(params.end) ? params.end : now.toISODate()!;
  let from = now.startOf("day");
  let to = now.endOf("day");
  if (range === "7") from = now.minus({ days: 6 }).startOf("day");
  if (range === "month") from = now.startOf("month");
  if (range === "custom") {
    const customFrom = DateTime.fromISO(startParam, { zone: org.timezone }).startOf("day");
    const customTo = DateTime.fromISO(endParam, { zone: org.timezone }).endOf("day");
    if (customFrom.isValid && customTo.isValid && customFrom <= customTo) {
      from = customFrom;
      to = customTo;
    } else {
      range = "today";
    }
  }
  const fromIso = from.toUTC().toISO()!;
  const toIso = to.toUTC().toISO()!;

  const seller = params.seller ?? "all";
  const status = params.status === "not_interested" || params.status === "all" ? params.status : "open";

  // Contacts that pass the salesperson/status filters (deleted and merged
  // guests never show).
  const filtered = () => {
    let query = supabase.from("crm_contacts").select(CONTACT_COLUMNS).is("merged_into_id", null).is("deleted_at", null);
    if (seller === "unassigned") query = query.is("assigned_staff_id", null);
    else if (seller !== "all") query = query.eq("assigned_staff_id", seller);
    if (status === "open") query = query.neq("status", "not_interested");
    else if (status === "not_interested") query = query.eq("status", "not_interested");
    return query;
  };

  let contacts: ContactSummary[];
  const latestVisit = new Map<string, Visit>();

  if (range === "all") {
    const { data, error } = await filtered()
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT)
      .returns<ContactSummary[]>();
    if (error) throw new Error("Failed to load guests.");
    contacts = data ?? [];
    if (contacts.length > 0) {
      const { data: visits, error: visitsError } = await supabase
        .from("guest_visits")
        .select("contact_id, visit_at, visit_type")
        .in(
          "contact_id",
          contacts.map((contact) => contact.id),
        )
        .order("visit_at", { ascending: false })
        .returns<Visit[]>();
      if (visitsError) throw new Error("Failed to load visits.");
      for (const visit of visits ?? []) if (!latestVisit.has(visit.contact_id)) latestVisit.set(visit.contact_id, visit);
    }
  } else {
    const [visitsResult, addedResult] = await Promise.all([
      supabase
        .from("guest_visits")
        .select("contact_id, visit_at, visit_type")
        .gte("visit_at", fromIso)
        .lte("visit_at", toIso)
        .order("visit_at", { ascending: false })
        .limit(2000)
        .returns<Visit[]>(),
      supabase.from("crm_contacts").select("id").gte("created_at", fromIso).lte("created_at", toIso).limit(2000),
    ]);
    if (visitsResult.error || addedResult.error) throw new Error("Failed to load guests.");
    for (const visit of visitsResult.data ?? []) if (!latestVisit.has(visit.contact_id)) latestVisit.set(visit.contact_id, visit);
    const ids = [...new Set([...latestVisit.keys(), ...(addedResult.data ?? []).map((row) => row.id)])];
    if (ids.length === 0) {
      contacts = [];
    } else {
      const { data, error } = await filtered().in("id", ids).limit(2000).returns<ContactSummary[]>();
      if (error) throw new Error("Failed to load guests.");
      contacts = data ?? [];
    }
  }

  const rows: Row[] = contacts
    .map((contact) => {
      const visit = latestVisit.get(contact.id);
      return {
        key: contact.id,
        contact,
        signedInAt: visit?.visit_at ?? null,
        activityAt: visit?.visit_at ?? contact.created_at,
        type: visit
          ? (VISIT_TYPE_LABELS[visit.visit_type] ?? visit.visit_type)
          : contact.status === "lead"
            ? "Lead added"
            : "No visit yet",
      };
    })
    .sort((a, b) => b.activityAt.localeCompare(a.activityAt))
    .slice(0, ROW_LIMIT);

  const contactIds = [...new Set(rows.map((row) => row.contact.id))];
  const [signaturesResult, pendingResult, staffResult, photoUrls, sourcesResult, unreadResult] = await Promise.all([
    contactIds.length
      ? supabase.from("waiver_signatures").select("contact_id").in("contact_id", contactIds)
      : Promise.resolve({ data: [] as { contact_id: string }[], error: null }),
    supabase
      .from("crm_pending_matches")
      .select(
        `id, reason, created_at,
         submitted:crm_contacts!crm_pending_matches_submitted_contact_id_fkey ( id, first_name, last_name ),
         candidate:crm_contacts!crm_pending_matches_candidate_contact_id_fkey ( id, first_name, last_name )`,
      )
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .returns<PendingRow[]>(),
    supabase.from("staff").select("id, display_name, can_sell, role, archived_at").order("display_name"),
    signedPhotoUrls(
      supabase,
      rows.map((row) => row.contact.photo_path),
    ),
    supabase.from("crm_marketing_sources").select("label").eq("active", true).order("sort_order"),
    contactIds.length
      ? supabase
          .from("crm_messages")
          .select("contact_id")
          .in("contact_id", contactIds)
          .eq("direction", "inbound")
          .is("read_at", null)
      : Promise.resolve({ data: [] as { contact_id: string }[], error: null }),
  ]);
  if (signaturesResult.error || pendingResult.error || staffResult.error) {
    throw new Error("Failed to load guest details.");
  }

  const signed = new Set((signaturesResult.data ?? []).map((row) => row.contact_id));
  const unread = new Set((unreadResult.data ?? []).map((row) => row.contact_id));
  const pending = pendingResult.data ?? [];
  const openMatchContacts = new Set(pending.flatMap((match) => [match.submitted?.id, match.candidate?.id]));
  // Paired kiosks and who's on duty on each. kiosk_devices is admin-only
  // under RLS, so this small, non-personal read uses the service client,
  // scoped to the staff member's own org.
  const { data: kioskRows } = await createSupabaseAdminClient()
    .from("kiosk_devices")
    .select("id, name, on_duty_staff_id")
    .eq("organization_id", staff.organizationId)
    .is("revoked_at", null)
    .not("activated_at", "is", null)
    .order("created_at");
  const kiosks = (kioskRows ?? []).map((row) => ({ id: row.id, name: row.name, onDutyStaffId: row.on_duty_staff_id }));

  const staffRows = staffResult.data ?? [];
  const staffNames = new Map(staffRows.map((member) => [member.id, member.display_name as string]));
  const salespeople = staffRows
    .filter((member) => (!member.archived_at && (member.can_sell || member.role === "admin")) || member.id === seller)
    .map((member) => ({ id: member.id, name: member.display_name as string }));

  const formatTime = (iso: string) => {
    const time = DateTime.fromISO(iso).setZone(org.timezone);
    return range === "today" ? time.toFormat("h:mm a") : time.toFormat("LLL d, h:mm a");
  };

  return (
    <DashboardShell
      title="Guests"
      description="Guests who checked in at the kiosk, and leads your team added."
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {kiosks.length > 0 ? (
            <OnDutySelect
              devices={kiosks}
              salespeople={staffRows
                .filter((member) => !member.archived_at && (member.can_sell || member.role === "admin"))
                .map((member) => ({ id: member.id, name: member.display_name as string }))}
            />
          ) : null}
          <AddLeadButton sources={(sourcesResult.data ?? []).map((row) => row.label)} />
        </div>
      }
    >
      <div className="space-y-6">
        {pending.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Possible duplicates ({pending.length})</CardTitle>
              <CardDescription>
                These guests overlap an existing contact. Merge them into the existing contact, or keep them separate.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {pending.map((match) => (
                <div
                  key={match.id}
                  className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">
                      {match.submitted ? (
                        <Link href={`/dashboard/guests/${match.submitted.id}`} className="hover:underline">
                          {match.submitted.first_name} {match.submitted.last_name}
                        </Link>
                      ) : (
                        "Unknown"
                      )}{" "}
                      <span className="font-normal text-muted-foreground">(new)</span>
                      <span className="mx-2 text-muted-foreground">vs</span>
                      {match.candidate ? (
                        <Link href={`/dashboard/guests/${match.candidate.id}`} className="hover:underline">
                          {match.candidate.first_name} {match.candidate.last_name}
                        </Link>
                      ) : (
                        "Unknown"
                      )}{" "}
                      <span className="font-normal text-muted-foreground">(existing)</span>
                    </p>
                    <p className="text-muted-foreground">
                      {MATCH_REASON_LABELS[match.reason] ?? match.reason} · {formatTimeLong(match.created_at, org.timezone)}
                    </p>
                  </div>
                  <PendingMatchActions matchId={match.id} canMerge={staff.role === "admin"} />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <GuestFilters
            range={range}
            start={range === "custom" ? startParam : now.toISODate()!}
            end={range === "custom" ? endParam : now.toISODate()!}
            seller={seller}
            status={status}
            salespeople={salespeople}
          />
          <span className="text-sm text-muted-foreground">
            {rows.length === 1 ? "1 guest" : `${rows.length} guests`}
          </span>
        </div>

        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14" />
                <TableHead>Name</TableHead>
                <TableHead>Signed in</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Referring member</TableHead>
                <TableHead>Salesperson</TableHead>
                <TableHead>Waiver</TableHead>
                <TableHead>Next action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                    {range === "today" ? "No guests have checked in today yet." : "No guests in this period."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const contact = row.contact;
                  const referrer = contact.referring_client
                    ? `${contact.referring_client.first_name} ${contact.referring_client.last_name}`
                    : contact.referrer_name_typed;
                  const waiverSigned = signed.has(contact.id);
                  const action = nextAction({
                    hasUnreadMessage: unread.has(contact.id),
                    enrolled: Boolean(contact.closed_at),
                    hasOpenMatch: openMatchContacts.has(contact.id),
                    emailUndeliverable: contact.email_check_status === "undeliverable",
                    referrerUnresolved: contact.referrer_unresolved,
                    waiverSigned,
                    assigned: Boolean(contact.assigned_staff_id),
                  });
                  return (
                    <TableRow key={row.key}>
                      <TableCell>
                        <GuestAvatar
                          url={contact.photo_path ? (photoUrls.get(contact.photo_path) ?? null) : null}
                          firstName={contact.first_name}
                          lastName={contact.last_name}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {unread.has(contact.id) ? (
                          <span
                            className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary align-middle"
                            title="New message"
                          />
                        ) : null}
                        <Link href={`/dashboard/guests/${contact.id}`} className="hover:underline">
                          {contact.first_name} {contact.last_name}
                        </Link>
                        {contact.status === "lead" ? (
                          <Badge variant="outline" className="ml-2">
                            Lead
                          </Badge>
                        ) : contact.status === "not_interested" ? (
                          <Badge variant="secondary" className="ml-2">
                            Not interested
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {row.signedInAt ? formatTime(row.signedInAt) : "—"}
                      </TableCell>
                      <TableCell>{row.type}</TableCell>
                      <TableCell>{SOURCE_LABELS[contact.source] ?? contact.source}</TableCell>
                      <TableCell>
                        {referrer ?? "—"}
                        {contact.referrer_unresolved ? (
                          <Badge variant="destructive" className="ml-2">
                            Unresolved
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{contact.assigned_staff_id ? (staffNames.get(contact.assigned_staff_id) ?? "—") : "Unassigned"}</TableCell>
                      <TableCell>
                        <Badge variant={waiverSigned ? "secondary" : "outline"}>{waiverSigned ? "Signed" : "Not signed"}</Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "whitespace-nowrap",
                          action === "Follow up" ? "text-muted-foreground" : "font-medium text-foreground",
                        )}
                      >
                        {action}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
        {rows.length === ROW_LIMIT ? (
          <p className="text-sm text-muted-foreground">Showing the most recent {ROW_LIMIT}.</p>
        ) : null}
      </div>
    </DashboardShell>
  );
}

function formatTimeLong(iso: string, timezone: string) {
  return DateTime.fromISO(iso).setZone(timezone).toFormat("LLL d, h:mm a");
}
