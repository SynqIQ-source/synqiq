import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DateTime } from "luxon";
import { ArrowLeft, Download } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { isUuid } from "@/lib/crm/http";
import {
  EMAIL_CHECK_LABELS,
  MATCH_REASON_LABELS,
  MINDBODY_SYNC_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  VISIT_TYPE_LABELS,
} from "@/lib/crm/labels";
import { requireCrmStaff } from "@/lib/crm/module";
import { formatPhoneForDisplay } from "@/lib/crm/normalize";
import { getCrmOrg } from "@/lib/crm/org";
import { signedPhotoUrls } from "@/lib/crm/photos";
import { getScopedClient } from "@/lib/supabase/scoped";
import { GuestAvatar } from "../guest-avatar";
import { PendingMatchActions } from "../pending-match-actions";

export const dynamic = "force-dynamic";

type Contact = {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  email: string | null;
  phone_e164: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  status: string;
  source: string;
  how_heard: string[];
  referrer_name_typed: string | null;
  referrer_unresolved: boolean;
  photo_path: string | null;
  assigned_staff_id: string | null;
  email_consent: boolean;
  email_consent_at: string | null;
  sms_consent: boolean;
  sms_consent_at: string | null;
  photo_consent: boolean;
  photo_consent_at: string | null;
  email_check_status: string;
  email_check_result: { provider?: string; did_you_mean?: string | null; is_disposable?: boolean | null } | null;
  mindbody_client_id: string | null;
  mindbody_sync_status: string;
  merged_into_id: string | null;
  created_at: string;
  referring_client: { first_name: string; last_name: string; mindbody_unique_id: number; status: string } | null;
};

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

// Guest profile (requirement 11). Read through the staff session; RLS
// returns nothing for another org's contact, which becomes a 404.
export default async function GuestProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireCrmStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await getScopedClient(staff);
  const { data: contact, error } = await supabase
    .from("crm_contacts")
    .select(
      `id, first_name, last_name, date_of_birth, email, phone_e164, address_line1, city, state, postal_code,
       status, source, how_heard, referrer_name_typed, referrer_unresolved, photo_path, assigned_staff_id,
       email_consent, email_consent_at, sms_consent, sms_consent_at, photo_consent, photo_consent_at,
       email_check_status, email_check_result, mindbody_client_id, mindbody_sync_status, merged_into_id, created_at,
       referring_client:clients!crm_contacts_referring_client_id_fkey ( first_name, last_name, mindbody_unique_id, status )`,
    )
    .eq("id", id)
    .maybeSingle<Contact>();
  if (error) throw new Error("Failed to load guest.");
  if (!contact) notFound();
  if (contact.merged_into_id) redirect(`/dashboard/guests/${contact.merged_into_id}`);

  const org = await getCrmOrg(staff.organizationId);

  // Contacts merged into this one: their signed waivers stay attached to
  // them (signatures are immutable), so they're gathered here.
  const { data: mergedRows } = await supabase.from("crm_contacts").select("id").eq("merged_into_id", contact.id);
  const contactIds = [contact.id, ...(mergedRows ?? []).map((row) => row.id)];

  const [visitsResult, signaturesResult, staffResult, matchesResult, photoUrls] = await Promise.all([
    supabase
      .from("guest_visits")
      .select("id, visit_at, visit_type, assigned_staff_id")
      .in("contact_id", contactIds)
      .order("visit_at", { ascending: false }),
    supabase
      .from("waiver_signatures")
      .select("id, signed_at, template_version, is_minor, guardian_name")
      .in("contact_id", contactIds)
      .order("signed_at", { ascending: false }),
    supabase.from("staff").select("id, display_name"),
    supabase
      .from("crm_pending_matches")
      .select(
        `id, reason, submitted_contact_id,
         submitted:crm_contacts!crm_pending_matches_submitted_contact_id_fkey ( id, first_name, last_name ),
         candidate:crm_contacts!crm_pending_matches_candidate_contact_id_fkey ( id, first_name, last_name )`,
      )
      .eq("status", "open")
      .or(`submitted_contact_id.eq.${contact.id},candidate_contact_id.eq.${contact.id}`)
      .returns<
        {
          id: string;
          reason: string;
          submitted_contact_id: string;
          submitted: { id: string; first_name: string; last_name: string } | null;
          candidate: { id: string; first_name: string; last_name: string } | null;
        }[]
      >(),
    signedPhotoUrls(supabase, [contact.photo_path]),
  ]);

  const staffNames = new Map((staffResult.data ?? []).map((member) => [member.id, member.display_name as string]));
  const visits = visitsResult.data ?? [];
  const signatures = signaturesResult.data ?? [];
  const matches = matchesResult.data ?? [];
  const photoUrl = contact.photo_path ? (photoUrls.get(contact.photo_path) ?? null) : null;

  const local = (iso: string | null, format = "LLL d, yyyy, h:mm a") =>
    iso ? DateTime.fromISO(iso).setZone(org.timezone).toFormat(format) : "—";
  const consent = (given: boolean, at: string | null) => (given ? `Yes · ${local(at, "LLL d, yyyy")}` : "No");
  const address = [contact.address_line1, contact.city, [contact.state, contact.postal_code].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const referrer = contact.referring_client
    ? `${contact.referring_client.first_name} ${contact.referring_client.last_name}`
    : contact.referrer_name_typed;

  return (
    <DashboardShell
      title={`${contact.first_name} ${contact.last_name}`}
      description={`${STATUS_LABELS[contact.status] ?? contact.status} · added ${local(contact.created_at, "LLL d, yyyy")}`}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/guests">
            <ArrowLeft /> Guests
          </Link>
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {matches.length > 0 ? (
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle>Possible duplicate</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {matches.map((match) => {
                  const other = match.submitted_contact_id === contact.id ? match.candidate : match.submitted;
                  return (
                    <div key={match.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm">
                        {MATCH_REASON_LABELS[match.reason] ?? match.reason}:{" "}
                        {other ? (
                          <Link href={`/dashboard/guests/${other.id}`} className="font-medium underline">
                            {other.first_name} {other.last_name}
                          </Link>
                        ) : (
                          "unknown"
                        )}
                      </p>
                      <PendingMatchActions matchId={match.id} />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Personal information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <GuestAvatar
                  url={photoUrl}
                  firstName={contact.first_name}
                  lastName={contact.last_name}
                  className="h-24 w-24 text-2xl"
                />
                <div>
                  <p className="text-lg font-semibold">
                    {contact.first_name} {contact.last_name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {contact.date_of_birth
                      ? `Born ${DateTime.fromISO(contact.date_of_birth).toFormat("LLL d, yyyy")}`
                      : "No date of birth"}
                  </p>
                </div>
              </div>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Item label="Phone">{formatPhoneForDisplay(contact.phone_e164) || "—"}</Item>
                <Item label="Email">
                  {contact.email ?? "—"}
                  {contact.email ? (
                    <Badge
                      variant={
                        contact.email_check_status === "undeliverable"
                          ? "destructive"
                          : contact.email_check_status === "deliverable"
                            ? "secondary"
                            : "outline"
                      }
                      className="ml-2"
                    >
                      {contact.email_check_result?.provider === "dns" && contact.email_check_status === "unknown"
                        ? "Domain accepts mail"
                        : (EMAIL_CHECK_LABELS[contact.email_check_status] ?? contact.email_check_status)}
                    </Badge>
                  ) : null}
                  {contact.email_check_result?.did_you_mean ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Did they mean {contact.email_check_result.did_you_mean}?
                    </span>
                  ) : null}
                  {contact.email_check_result?.is_disposable ? (
                    <span className="mt-1 block text-xs text-muted-foreground">Disposable email address.</span>
                  ) : null}
                </Item>
                <Item label="Address">{address || "—"}</Item>
                <Item label="Source">{SOURCE_LABELS[contact.source] ?? contact.source}</Item>
                <Item label="How they heard">{contact.how_heard.length ? contact.how_heard.join(", ") : "—"}</Item>
                <Item label="Referring member">
                  {referrer ?? "—"}
                  {contact.referring_client ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      Mindbody #{contact.referring_client.mindbody_unique_id} · {contact.referring_client.status}
                    </span>
                  ) : null}
                  {contact.referrer_unresolved ? (
                    <Badge variant="destructive" className="ml-2">
                      Unresolved
                    </Badge>
                  ) : null}
                </Item>
                <Item label="Salesperson">
                  {contact.assigned_staff_id ? (staffNames.get(contact.assigned_staff_id) ?? "—") : "Unassigned"}
                </Item>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Visits</CardTitle>
            </CardHeader>
            <CardContent>
              {visits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No visits yet.</p>
              ) : (
                <ul className="divide-y">
                  {visits.map((visit) => (
                    <li key={visit.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                      <span className="font-medium">{VISIT_TYPE_LABELS[visit.visit_type] ?? visit.visit_type}</span>
                      <span className="text-muted-foreground">
                        {local(visit.visit_at)}
                        {visit.assigned_staff_id ? ` · with ${staffNames.get(visit.assigned_staff_id) ?? "—"}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Waiver</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {signatures.length === 0 ? (
                <p className="text-sm text-muted-foreground">No waiver signed.</p>
              ) : (
                signatures.map((signature) => (
                  <div key={signature.id} className="flex items-center justify-between gap-3">
                    <div className="text-sm">
                      <p className="font-medium">Signed {local(signature.signed_at, "LLL d, yyyy")}</p>
                      <p className="text-muted-foreground">
                        Version {signature.template_version}
                        {signature.is_minor ? ` · guardian: ${signature.guardian_name}` : ""}
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      {/* Plain link (not next/link): the route answers with a redirect to a 60-second signed URL. */}
                      <a href={`/api/crm/waivers/${signature.id}`} target="_blank" rel="noopener">
                        <Download /> PDF
                      </a>
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Consent</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Item label="Email marketing">{consent(contact.email_consent, contact.email_consent_at)}</Item>
                <Item label="SMS">{consent(contact.sms_consent, contact.sms_consent_at)}</Item>
                <Item label="Photo">{consent(contact.photo_consent, contact.photo_consent_at)}</Item>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mindbody</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Item label="Client ID">{contact.mindbody_client_id ?? "—"}</Item>
                <Item label="Sync status">
                  {MINDBODY_SYNC_LABELS[contact.mindbody_sync_status] ?? contact.mindbody_sync_status}
                </Item>
              </dl>
              <Separator className="my-4" />
              <p className="text-xs text-muted-foreground">Sending guests to Mindbody is coming in a later update.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
