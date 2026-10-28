import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { PendingMatchActions } from "./pending-match-actions";

export const dynamic = "force-dynamic";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "all", label: "All" },
] as const;
type Range = (typeof RANGES)[number]["value"];

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
  referring_client: { first_name: string; last_name: string } | null;
  created_at: string;
};

const CONTACT_COLUMNS =
  "id, first_name, last_name, status, source, photo_path, assigned_staff_id, referrer_name_typed, referrer_unresolved, created_at, referring_client:clients!crm_contacts_referring_client_id_fkey ( first_name, last_name )";

type Row = {
  key: string;
  contact: ContactSummary;
  signedInAt: string | null;
  type: string;
  salespersonId: string | null;
};

type PendingRow = {
  id: string;
  reason: string;
  created_at: string;
  submitted: { id: string; first_name: string; last_name: string } | null;
  candidate: { id: string; first_name: string; last_name: string } | null;
};

// Guests (requirement 12). Everything is read through the staff member's
// own session, so RLS (same org; admin or seller) is the access boundary.
export default async function GuestsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const staff = await requireCrmStaff();
  const params = await searchParams;
  const range: Range = RANGES.some((option) => option.value === params.range) ? (params.range as Range) : "today";

  const supabase = await getScopedClient(staff);
  const org = await getCrmOrg(staff.organizationId);
  const now = DateTime.now().setZone(org.timezone);
  const since = range === "today" ? now.startOf("day") : now.minus({ days: 6 }).startOf("day");

  let rows: Row[];
  if (range === "all") {
    const { data, error } = await supabase
      .from("crm_contacts")
      .select(CONTACT_COLUMNS)
      .is("merged_into_id", null)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT)
      .returns<ContactSummary[]>();
    if (error) throw new Error("Failed to load guests.");
    const contacts = data ?? [];

    // Latest visit per contact.
    const latest = new Map<string, { visit_at: string; visit_type: string; assigned_staff_id: string | null }>();
    if (contacts.length > 0) {
      const { data: visits, error: visitsError } = await supabase
        .from("guest_visits")
        .select("contact_id, visit_at, visit_type, assigned_staff_id")
        .in(
          "contact_id",
          contacts.map((contact) => contact.id),
        )
        .order("visit_at", { ascending: false });
      if (visitsError) throw new Error("Failed to load visits.");
      for (const visit of visits ?? []) {
        if (!latest.has(visit.contact_id)) latest.set(visit.contact_id, visit);
      }
    }
    rows = contacts.map((contact) => {
      const visit = latest.get(contact.id);
      return {
        key: contact.id,
        contact,
        signedInAt: visit?.visit_at ?? null,
        type: visit ? (VISIT_TYPE_LABELS[visit.visit_type] ?? visit.visit_type) : "No visit yet",
        salespersonId: visit?.assigned_staff_id ?? contact.assigned_staff_id,
      };
    });
  } else {
    const { data, error } = await supabase
      .from("guest_visits")
      .select(`id, visit_at, visit_type, assigned_staff_id, contact:crm_contacts!guest_visits_contact_id_fkey ( ${CONTACT_COLUMNS} )`)
      .gte("visit_at", since.toUTC().toISO()!)
      .order("visit_at", { ascending: false })
      .limit(ROW_LIMIT)
      .returns<{ id: string; visit_at: string; visit_type: string; assigned_staff_id: string | null; contact: ContactSummary | null }[]>();
    if (error) throw new Error("Failed to load guests.");
    rows = (data ?? [])
      .filter((visit) => visit.contact)
      .map((visit) => ({
        key: visit.id,
        contact: visit.contact!,
        signedInAt: visit.visit_at,
        type: VISIT_TYPE_LABELS[visit.visit_type] ?? visit.visit_type,
        salespersonId: visit.assigned_staff_id ?? visit.contact!.assigned_staff_id,
      }));
  }

  const contactIds = [...new Set(rows.map((row) => row.contact.id))];
  const [signaturesResult, pendingResult, staffResult, photoUrls, sourcesResult] = await Promise.all([
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
    supabase.from("staff").select("id, display_name"),
    signedPhotoUrls(
      supabase,
      rows.map((row) => row.contact.photo_path),
    ),
    supabase.from("crm_marketing_sources").select("label").eq("active", true).order("sort_order"),
  ]);
  if (signaturesResult.error || pendingResult.error || staffResult.error) {
    throw new Error("Failed to load guest details.");
  }

  const signed = new Set((signaturesResult.data ?? []).map((row) => row.contact_id));
  const pending = pendingResult.data ?? [];
  const openMatchContacts = new Set(pending.flatMap((match) => [match.submitted?.id, match.candidate?.id]));
  const staffNames = new Map((staffResult.data ?? []).map((member) => [member.id, member.display_name as string]));

  const formatTime = (iso: string) => {
    const time = DateTime.fromISO(iso).setZone(org.timezone);
    return range === "today" ? time.toFormat("h:mm a") : time.toFormat("LLL d, h:mm a");
  };

  return (
    <DashboardShell
      title="Guests"
      description="Guests who checked in at the kiosk, and leads your team added."
      actions={<AddLeadButton sources={(sourcesResult.data ?? []).map((row) => row.label)} />}
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
                  <PendingMatchActions matchId={match.id} />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {RANGES.map((option) => (
            <Button key={option.value} asChild variant={option.value === range ? "default" : "outline"} size="sm">
              <Link href={option.value === "today" ? "/dashboard/guests" : `/dashboard/guests?range=${option.value}`}>
                {option.label}
              </Link>
            </Button>
          ))}
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
                    hasOpenMatch: openMatchContacts.has(contact.id),
                    referrerUnresolved: contact.referrer_unresolved,
                    waiverSigned,
                    assigned: Boolean(row.salespersonId),
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
                        <Link href={`/dashboard/guests/${contact.id}`} className="hover:underline">
                          {contact.first_name} {contact.last_name}
                        </Link>
                        {contact.status === "lead" ? (
                          <Badge variant="outline" className="ml-2">
                            Lead
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
                      <TableCell>{row.salespersonId ? (staffNames.get(row.salespersonId) ?? "—") : "Unassigned"}</TableCell>
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
