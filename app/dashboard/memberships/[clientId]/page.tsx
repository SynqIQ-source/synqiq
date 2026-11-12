import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { expectedCharges, type BillingAdjustment, type ContractSchedule } from "@/lib/memberships/shadow-billing";
import { describeAdjustment } from "@/lib/memberships/adjustments";
import { loadScheduledIncreases } from "@/lib/memberships/price-increase-data";
import { contractTaxRate, formatTaxRate, taxOn } from "@/lib/memberships/tax";
import { isUnlimited } from "@/lib/memberships/profile";
import { mergePersonal, type MemberPersonal, type PersonalField } from "@/lib/memberships/personal";
import { AddBillingEdit, CancelBillingEdit, type EditContract } from "./billing-edits";
import { RefreshFromMindbody } from "./refresh-button";
import { FREEZE_NOTICE, isInForce } from "@/lib/memberships/freeze-check";
import { PersonalCard } from "./personal-card";
import { MemberSearch } from "../member-search";
import { scheduleTerms, upcomingPaymentDates } from "@/lib/pos/packages";
import {
  PurchasesList,
  ServicesCard,
  VisitSummary,
  VisitsTable,
  type SaleItemRow,
  type SaleRow,
  type ServiceRow,
  type VisitRow,
} from "./profile-sections";

type Params = Promise<{ clientId: string }>;

const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? "—"
    : (cents / 100).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      });
const day = (iso: string | null | undefined) => (iso ? DateTime.fromISO(iso).toFormat("LLL d, yyyy") : "—");

const STATUS_LABEL: Record<string, string> = {
  success: "Charged",
  scheduled: "Scheduled",
  suspended: "Frozen",
  declined: "Declined",
  other: "Other",
};

// One member's profile (Club Admin only), laid out like the guest profile:
// memberships and packs, billing with SynqIQ's edits, visits, schedule,
// purchases with receipts, and personal details from Mindbody. Keyed by Mindbody client id because most members have no
// CRM contact record.
export default async function MemberBillingPage({ params }: { params: Params }) {
  const staff = await requireAccess(isClubAdmin);
  const { clientId: rawClientId } = await params;
  const clientId = decodeURIComponent(rawClientId);
  if (!/^[\w-]{1,40}$/.test(clientId)) notFound();
  const supabase = await getScopedClient(staff);
  const orgId = staff.organizationId;

  type ContractRow = {
    id: string;
    mindbody_client_id: string;
    payer_mindbody_client_id: string | null;
    contract_name: string;
    start_date: string | null;
    end_date: string | null;
    termination_date: string | null;
    original_start_date: string | null;
    autopay_status: string | null;
    auto_renewing: boolean | null;
    is_month_to_month: boolean | null;
    normal_autopay_cents: number | null;
    next_bill_date: string | null;
    next_bill_subtotal_cents: number | null;
    next_bill_tax_cents: number | null;
    next_bill_total_cents: number | null;
    upcoming_autopays: ContractSchedule["autopays"];
    synced_at: string;
  };
  type AdjustmentRow = {
    id: string;
    member_contract_id: string | null;
    kind: BillingAdjustment["kind"];
    amount_cents: number | null;
    percent: number | null;
    starts_on: string;
    ends_on: string | null;
    reason: string;
    created_at: string;
    created_by_staff_id: string;
    cancelled_at: string | null;
    cancelled_by_staff_id: string | null;
    cancel_reason: string | null;
    reason_category: string | null;
  };
  type AutopayRow = {
    id: string;
    charge_date: string;
    item: string;
    amount_cents: number;
    status: string;
    status_detail: string | null;
    card_brand: string | null;
    card_last4: string | null;
    card_exp_month: number | null;
    card_exp_year: number | null;
  };

  const contractColumns =
    "id, mindbody_client_id, payer_mindbody_client_id, contract_name, start_date, end_date, termination_date, original_start_date, autopay_status, auto_renewing, is_month_to_month, normal_autopay_cents, next_bill_date, next_bill_subtotal_cents, next_bill_tax_cents, next_bill_total_cents, upcoming_autopays, synced_at";
  const [{ data: client }, { data: org }, { data: own }, { data: paysFor }, { data: adjustmentRows }, { data: autopays }] =
    await Promise.all([
      supabase
        .from("clients")
        .select("first_name, last_name, email, status")
        .eq("organization_id", orgId)
        .eq("mindbody_client_id", clientId)
        .maybeSingle(),
      supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle(),
      supabase
        .from("member_contracts")
        .select(contractColumns)
        .eq("organization_id", orgId)
        .eq("mindbody_client_id", clientId)
        .returns<ContractRow[]>(),
      supabase
        .from("member_contracts")
        .select(contractColumns)
        .eq("organization_id", orgId)
        .eq("payer_mindbody_client_id", clientId)
        .returns<ContractRow[]>(),
      supabase
        .from("billing_adjustments")
        .select(
          "id, member_contract_id, kind, amount_cents, percent, starts_on, ends_on, reason, created_at, created_by_staff_id, cancelled_at, cancelled_by_staff_id, cancel_reason, reason_category",
        )
        .eq("organization_id", orgId)
        .eq("mindbody_client_id", clientId)
        .order("created_at", { ascending: false })
        .returns<AdjustmentRow[]>(),
      supabase
        .from("mbo_autopay_rows")
        .select("id, charge_date, item, amount_cents, status, status_detail, card_brand, card_last4, card_exp_month, card_exp_year")
        .eq("organization_id", orgId)
        .eq("mindbody_client_id", clientId)
        .order("charge_date")
        .returns<AutopayRow[]>(),
    ]);
  if (!client && !own?.length) notFound();

  const timezone = (org?.timezone as string | undefined) ?? "America/Chicago";
  const today = DateTime.now().setZone(timezone).toISODate()!;
  const contracts = (own ?? []).sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""));
  const isCurrent = (contract: ContractRow) => !contract.end_date || contract.end_date >= today;
  const current = contracts.filter(isCurrent);
  const past = contracts.filter((contract) => !isCurrent(contract));
  const othersPaidFor = (paysFor ?? []).filter((contract) => contract.mindbody_client_id !== clientId && isCurrent(contract));

  // Names: payers of this member's contracts, people this member pays for,
  // and staff who made or cancelled edits.
  const otherClientIds = [
    ...new Set([
      ...contracts.map((contract) => contract.payer_mindbody_client_id).filter((id): id is string => Boolean(id) && id !== clientId),
      ...othersPaidFor.map((contract) => contract.mindbody_client_id),
    ]),
  ];
  const staffIds = [
    ...new Set(
      (adjustmentRows ?? [])
        .flatMap((row) => [row.created_by_staff_id, row.cancelled_by_staff_id])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [{ data: otherClients }, { data: staffRows }] = await Promise.all([
    otherClientIds.length
      ? supabase
          .from("clients")
          .select("mindbody_client_id, first_name, last_name")
          .eq("organization_id", orgId)
          .in("mindbody_client_id", otherClientIds)
      : Promise.resolve({
          data: [] as {
            mindbody_client_id: string;
            first_name: string;
            last_name: string;
          }[],
        }),
    staffIds.length
      ? supabase.from("staff").select("id, display_name").in("id", staffIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  const clientName = new Map(
    (otherClients ?? []).map((row) => [row.mindbody_client_id as string, `${row.first_name} ${row.last_name}`.trim()]),
  );
  const staffName = new Map((staffRows ?? []).map((row) => [row.id as string, row.display_name as string]));
  const contractName = new Map(contracts.map((contract) => [contract.id, contract.contract_name]));

  const adjustments = (adjustmentRows ?? []).map((row) => ({
    ...row,
    percent: row.percent === null ? null : Number(row.percent),
  }));
  const active: BillingAdjustment[] = adjustments
    .filter((row) => !row.cancelled_at)
    .map((row) => ({
      id: row.id,
      mindbodyClientId: clientId,
      contractId: row.member_contract_id,
      kind: row.kind,
      amountCents: row.amount_cents,
      percent: row.percent,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      reason: row.reason,
    }));

  // Upcoming charges for this member's own memberships over the next year,
  // before and after SynqIQ's edits. (Mindbody lists a contract's autopays
  // from its last refresh on.)
  const schedules: ContractSchedule[] = current.map((contract) => ({
    contractId: contract.id,
    mindbodyClientId: contract.mindbody_client_id,
    payerClientId: contract.payer_mindbody_client_id,
    contractName: contract.contract_name,
    autopayStatus: contract.autopay_status,
    autopays: contract.upcoming_autopays ?? [],
  }));
  const window = {
    from: DateTime.fromISO(today).plus({ days: 1 }).toISODate()!,
    to: DateTime.fromISO(today).plus({ months: 12 }).toISODate()!,
  };
  const increases = await loadScheduledIncreases(supabase, orgId, clientId);
  const upcoming = expectedCharges(schedules, active, window, increases);
  const increasesByContract = new Map<string, typeof increases>();
  for (const increase of increases)
    increasesByContract.set(increase.contractId, [...(increasesByContract.get(increase.contractId) ?? []), increase]);

  const card = [...(autopays ?? [])].reverse().find((row) => row.card_last4);
  const history = [...(autopays ?? [])].reverse();
  const name = client ? `${client.first_name} ${client.last_name}`.trim() : `Mindbody client ${clientId}`;
  const contractOptions: EditContract[] = current.map((contract) => ({
    id: contract.id,
    name: contract.contract_name,
    endDate: contract.end_date,
    monthToMonth: contract.is_month_to_month === true,
    autopays: (contract.upcoming_autopays ?? []).map((autopay) => ({
      date: autopay.date,
      subtotalCents: autopay.subtotalCents ?? autopay.totalCents ?? null,
    })),
  }));

  // Mindbody profile data (visits, bookings, purchases, packs, contact
  // details), pulled per member with "Refresh from Mindbody".
  const nowLocal = DateTime.now().setZone(timezone).toFormat("yyyy-LL-dd'T'HH:mm:ss");
  const visitColumns =
    "id, kind, name, start_local, end_local, service_name, staff_mindbody_id, appointment_status, signed_in, late_cancelled, missed";
  const [
    { data: profileSync },
    { data: services },
    { data: pastVisits, count: pastVisitCount },
    { data: upcomingVisits },
    { data: sales },
    { data: contact },
    { data: personalRow },
    { data: posSchedules },
  ] = await Promise.all([
    supabase.from("member_profile_sync").select("synced_at").eq("organization_id", orgId).eq("mindbody_client_id", clientId).maybeSingle(),
    supabase
      .from("member_services")
      .select("id, name, program, count, remaining, is_current, active_date, expiration_date, payment_date")
      .eq("organization_id", orgId)
      .eq("mindbody_client_id", clientId)
      .order("payment_date", { ascending: false })
      .returns<ServiceRow[]>(),
    supabase
      .from("member_visits")
      .select(visitColumns, { count: "exact" })
      .eq("organization_id", orgId)
      .eq("mindbody_client_id", clientId)
      .lte("start_local", nowLocal)
      .order("start_local", { ascending: false })
      .limit(300)
      .returns<VisitRow[]>(),
    supabase
      .from("member_visits")
      .select(visitColumns)
      .eq("organization_id", orgId)
      .eq("mindbody_client_id", clientId)
      .gt("start_local", nowLocal)
      .order("start_local")
      .limit(200)
      .returns<VisitRow[]>(),
    supabase
      .from("member_sales")
      .select("mindbody_sale_id, sale_at, total_cents, sales_rep_mindbody_id, payments")
      .eq("organization_id", orgId)
      .eq("mindbody_client_id", clientId)
      .order("sale_at", { ascending: false })
      .limit(150)
      .returns<SaleRow[]>(),
    supabase
      .from("crm_contacts")
      .select("id")
      .eq("organization_id", orgId)
      .eq("mindbody_client_id", clientId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("member_personal")
      .select("mindbody, mindbody_synced_at, edits, edited_at, edited_by_staff_id")
      .eq("organization_id", orgId)
      .eq("mindbody_client_id", clientId)
      .maybeSingle(),
    // Payment schedules from memberships sold at SynqIQ's POS.
    supabase
      .from("member_billing_schedules")
      .select(
        "id, sale_id, name, status, start_date, first_bill_date, recurring_lines, recurring_subtotal_cents, recurring_tax_cents, recurring_total_cents, autopay_count, auto_renews, created_at",
      )
      .eq("organization_id", orgId)
      .eq("mindbody_client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const saleIds = (sales ?? []).map((sale) => sale.mindbody_sale_id);
  const mindbodyStaffIds = [
    ...new Set(
      [...(pastVisits ?? []), ...(upcomingVisits ?? [])]
        .map((visit) => visit.staff_mindbody_id)
        .concat((sales ?? []).map((sale) => sale.sales_rep_mindbody_id))
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
  const [{ data: saleItems }, { data: mindbodyStaff }] = await Promise.all([
    saleIds.length
      ? supabase
          .from("member_sale_items")
          .select(
            "mindbody_sale_id, mindbody_sale_detail_id, description, quantity, unit_price_cents, discount_cents, tax_cents, total_cents, returned",
          )
          .eq("organization_id", orgId)
          .in("mindbody_sale_id", saleIds)
          .returns<SaleItemRow[]>()
      : Promise.resolve({ data: [] as SaleItemRow[] }),
    mindbodyStaffIds.length
      ? supabase
          .from("staff")
          .select("mindbody_staff_id, display_name")
          .eq("organization_id", orgId)
          .in("mindbody_staff_id", mindbodyStaffIds)
      : Promise.resolve({ data: [] as { mindbody_staff_id: number; display_name: string }[] }),
  ]);
  const staffByMindbodyId = new Map((mindbodyStaff ?? []).map((row) => [Number(row.mindbody_staff_id), row.display_name as string]));
  const pulled = Boolean(profileSync);
  const pulledAt = profileSync
    ? DateTime.fromISO(profileSync.synced_at as string)
        .setZone(timezone)
        .toFormat("LLL d, h:mm a")
    : null;
  const memberSince = contracts.reduce<string | null>((earliest, contract) => {
    const since = contract.original_start_date ?? contract.start_date;
    return since && (!earliest || since < earliest) ? since : earliest;
  }, null);

  // Personal information: SynqIQ edits over Mindbody's copy.
  const personal = mergePersonal(
    {
      firstName: client?.first_name ?? null,
      lastName: client?.last_name ?? null,
      email: client?.email ?? null,
      ...((personalRow?.mindbody as Partial<MemberPersonal> | undefined) ?? {}),
    },
    (personalRow?.edits as Partial<Record<PersonalField, string | null>> | undefined) ?? {},
  );
  const displayName = `${personal.firstName ?? ""} ${personal.lastName ?? ""}`.trim() || name;
  let editedNote: string | null = null;
  if (personalRow?.edited_at) {
    const { data: editor } = personalRow.edited_by_staff_id
      ? await supabase.from("staff").select("display_name").eq("id", personalRow.edited_by_staff_id).maybeSingle()
      : { data: null };
    editedNote = `Edited in SynqIQ ${DateTime.fromISO(personalRow.edited_at as string)
      .setZone(timezone)
      .toFormat("LLL d")}${editor?.display_name ? ` by ${editor.display_name}` : ""}; other fields from Mindbody.`;
  }
  const personalPulledAt = personalRow?.mindbody_synced_at
    ? DateTime.fromISO(personalRow.mindbody_synced_at as string)
        .setZone(timezone)
        .toFormat("LLL d")
    : null;

  // At a glance.
  let monthlyCents = 0;
  for (const contract of current) {
    const base = contract.normal_autopay_cents ?? 0;
    const rate = contractTaxRate({
      nextBillSubtotalCents: contract.next_bill_subtotal_cents,
      nextBillTaxCents: contract.next_bill_tax_cents,
      autopays: contract.upcoming_autopays,
    });
    monthlyCents += base + (taxOn(base, rate) ?? 0);
  }
  const nextBill = current
    .filter((contract) => contract.next_bill_date && contract.next_bill_date >= today)
    .sort((a, b) => (a.next_bill_date as string).localeCompare(b.next_bill_date as string))[0];
  const nextBillCents = nextBill
    ? current
        .filter((contract) => contract.next_bill_date === nextBill.next_bill_date)
        .reduce((sum, contract) => sum + (contract.next_bill_total_cents ?? 0), 0)
    : null;
  const since30 = DateTime.now().setZone(timezone).minus({ days: 30 }).toFormat("yyyy-LL-dd'T'HH:mm:ss");
  const visits30 = (pastVisits ?? []).filter((visit) => visit.start_local >= since30 && !visit.late_cancelled && !visit.missed).length;
  const packs = (services ?? []).filter((service) => service.is_current && !isUnlimited(service.count));
  const sessionsLeft = packs.reduce((sum, service) => sum + (service.remaining ?? 0), 0);
  const lastVisit = (pastVisits ?? [])[0]?.start_local ?? null;

  return (
    <DashboardShell
      title={displayName}
      description={
        client
          ? [client.status, memberSince ? `member since ${day(memberSince)}` : null].filter(Boolean).join(" · ")
          : "Not in the synced client list"
      }
      actions={
        <div className="flex flex-wrap items-start justify-end gap-2">
          <MemberSearch initialQuery="" compact />
          {contact ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/guests/${contact.id}`}>Guest profile</Link>
            </Button>
          ) : null}
          <RefreshFromMindbody clientId={clientId} />
        </div>
      }
    >
      <div className="space-y-6">
        {current.some((contract) => contract.autopay_status === "Suspended" && isInForce(contract, today)) ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <span className="font-medium">On freeze.</span> {FREEZE_NOTICE}
          </div>
        ) : null}
        <Card className="py-4">
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Glance
              label="Monthly dues"
              value={current.length ? money(monthlyCents) : "—"}
              sub={current.length ? "incl. tax" : "No current membership"}
            />
            <Glance
              label="Next bill"
              value={nextBill ? DateTime.fromISO(nextBill.next_bill_date as string).toFormat("LLL d") : "—"}
              sub={nextBillCents !== null ? money(nextBillCents) : undefined}
            />
            <Glance
              label="Visits (30 days)"
              value={pulled ? String(visits30) : "—"}
              sub={lastVisit ? `Last ${DateTime.fromISO(lastVisit).toFormat("LLL d")}` : undefined}
            />
            <Glance
              label="Sessions left"
              value={pulled ? (packs.length ? String(sessionsLeft) : "—") : "—"}
              sub={
                packs.length
                  ? packs
                      .map((pack) => pack.name)
                      .slice(0, 2)
                      .join(", ")
                  : pulled
                    ? "No packs"
                    : undefined
              }
            />
            <Glance
              label="Card on file"
              value={card ? `${card.card_brand ?? "Card"} ••${card.card_last4}` : "—"}
              sub={
                card?.card_exp_month && card.card_exp_year
                  ? `Exp ${String(card.card_exp_month).padStart(2, "0")}/${String(card.card_exp_year).slice(-2)}`
                  : undefined
              }
            />
          </CardContent>
        </Card>
        <p className="-mt-3 text-xs text-muted-foreground">
          From Mindbody: memberships{" "}
          {contracts[0] ? DateTime.fromISO(contracts[0].synced_at).setZone(timezone).toFormat("LLL d, h:mm a") : "not pulled"} · visits,
          purchases and packs {pulledAt ?? "not pulled yet"}
        </p>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <Tabs defaultValue="memberships">
              <TabsList className="flex-wrap">
                <TabsTrigger value="memberships">Memberships</TabsTrigger>
                <TabsTrigger value="billing">Billing</TabsTrigger>
                <TabsTrigger value="visits">Visits</TabsTrigger>
                <TabsTrigger value="schedule">Schedule{upcomingVisits?.length ? ` (${upcomingVisits.length})` : ""}</TabsTrigger>
                <TabsTrigger value="purchases">Purchases</TabsTrigger>
              </TabsList>

              <TabsContent value="memberships" className="space-y-6">
                <Card className="py-0">
                  <CardHeader className="pt-6">
                    <CardTitle>Current memberships</CardTitle>
                  </CardHeader>
                  {current.length === 0 ? (
                    <p className="px-6 pb-6 text-sm text-muted-foreground">No current memberships.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Plan</TableHead>
                            <TableHead className="text-right">Base rate</TableHead>
                            <TableHead className="text-right">Tax</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Next bill</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {current.map((contract) => {
                            const rate = contractTaxRate({
                              nextBillSubtotalCents: contract.next_bill_subtotal_cents,
                              nextBillTaxCents: contract.next_bill_tax_cents,
                              autopays: contract.upcoming_autopays,
                            });
                            const base = contract.normal_autopay_cents;
                            const tax = base === null ? null : taxOn(base, rate);
                            return (
                              <TableRow key={contract.id}>
                                <TableCell>
                                  <span className="font-medium">{contract.contract_name}</span>
                                  <span className="mt-1 flex flex-wrap gap-1">
                                    {contract.autopay_status ? (
                                      <Badge variant={contract.autopay_status === "Active" ? "secondary" : "outline"}>
                                        {contract.autopay_status === "Suspended" ? "Frozen" : contract.autopay_status}
                                      </Badge>
                                    ) : null}
                                    {contract.is_month_to_month ? <Badge variant="outline">Month to month</Badge> : null}
                                    {contract.auto_renewing ? <Badge variant="outline">Renews</Badge> : null}
                                  </span>
                                  <span className="mt-1 block text-xs text-muted-foreground">
                                    Since {day(contract.original_start_date ?? contract.start_date)} · term {day(contract.start_date)} –{" "}
                                    {contract.end_date ? day(contract.end_date) : "open"}
                                  </span>
                                  {contract.payer_mindbody_client_id && contract.payer_mindbody_client_id !== clientId ? (
                                    <span className="mt-1 block text-xs text-muted-foreground">
                                      Paid by{" "}
                                      <Link
                                        href={`/dashboard/memberships/${contract.payer_mindbody_client_id}`}
                                        className="underline underline-offset-4"
                                      >
                                        {clientName.get(contract.payer_mindbody_client_id) ?? `client ${contract.payer_mindbody_client_id}`}
                                      </Link>
                                    </span>
                                  ) : null}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {money(contract.normal_autopay_cents)}
                                  {(increasesByContract.get(contract.id) ?? []).map((increase) => (
                                    <Link
                                      key={increase.increaseId}
                                      href={`/dashboard/memberships/price-increases/${increase.increaseId}`}
                                      className="block text-xs text-muted-foreground underline-offset-4 hover:underline"
                                    >
                                      {money(increase.newCents)} from {day(increase.effectiveOn)}
                                    </Link>
                                  ))}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-muted-foreground">
                                  {money(tax)}
                                  <span className="block text-xs">{formatTaxRate(rate)}</span>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {base !== null && tax !== null ? money(base + tax) : "—"}
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  {contract.next_bill_date ? (
                                    <>
                                      {day(contract.next_bill_date)}
                                      <span className="block text-xs text-muted-foreground">{money(contract.next_bill_total_cents)}</span>
                                    </>
                                  ) : (
                                    "—"
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      <p className="px-6 pb-4 text-xs text-muted-foreground">
                        Edits and price increases change the base rate; tax is recalculated at the membership&apos;s rate and can&apos;t be
                        edited. Next bill includes tax.
                      </p>
                    </div>
                  )}
                </Card>
                <ServicesCard services={services ?? []} pulled={pulled} />
                {past.length ? (
                  <Card className="py-0">
                    <CardHeader className="pt-6">
                      <CardTitle>Past memberships</CardTitle>
                    </CardHeader>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Plan</TableHead>
                            <TableHead>Dates</TableHead>
                            <TableHead className="text-right">Base rate</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {past.map((contract) => (
                            <TableRow key={contract.id}>
                              <TableCell>{contract.contract_name}</TableCell>
                              <TableCell className="whitespace-nowrap">
                                {day(contract.start_date)} – {day(contract.termination_date ?? contract.end_date)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{money(contract.normal_autopay_cents)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Card>
                ) : null}
              </TabsContent>

              <TabsContent value="billing" className="space-y-6">
                <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                  Mindbody still charges until the switch; these edits don&apos;t change charges yet.
                </div>
                {posSchedules?.length ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Payment schedules from SynqIQ sales</CardTitle>
                      <CardDescription>
                        Monthly payments set up when a membership was sold at SynqIQ&apos;s POS. Practice schedules are never charged.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {posSchedules.map((schedule) => {
                        const autopayCount = schedule.autopay_count == null ? null : Number(schedule.autopay_count);
                        const live = schedule.status === "practice" || schedule.status === "active";
                        const next = live
                          ? upcomingPaymentDates(schedule.first_bill_date as string, autopayCount, Boolean(schedule.auto_renews), today)
                          : [];
                        const lines =
                          (schedule.recurring_lines as { label: string; revenueCategory?: string | null; amountCents: number }[]) ?? [];
                        return (
                          <div
                            key={schedule.id as string}
                            className={`space-y-2 rounded-md border px-4 py-3 text-sm ${live ? "" : "opacity-60"}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-medium">
                                {schedule.name as string}{" "}
                                <Badge variant={schedule.status === "active" ? "default" : "secondary"}>
                                  {schedule.status === "practice"
                                    ? "Practice"
                                    : String(schedule.status).replace(/^./, (c) => c.toUpperCase())}
                                </Badge>
                              </p>
                              <Link href={`/dashboard/pos/sales/${schedule.sale_id as string}`} className="text-xs text-primary underline">
                                Sold {day(schedule.start_date as string)}
                              </Link>
                            </div>
                            <p className="text-muted-foreground">
                              {lines.map((line) => `${line.label} ${money(line.amountCents)}`).join(" + ")} +{" "}
                              {money(Number(schedule.recurring_tax_cents))} tax ={" "}
                              <span className="font-medium text-foreground">{money(Number(schedule.recurring_total_cents))}</span> a month
                              from {day(schedule.first_bill_date as string)}, {scheduleTerms(autopayCount, Boolean(schedule.auto_renews))}.
                            </p>
                            {next.length ? (
                              <div className="flex flex-wrap gap-2">
                                {next.map((payment, i) => (
                                  <span
                                    key={payment.date}
                                    className={`rounded-md px-2 py-1 text-xs ${i === 0 ? "bg-primary/10 font-medium" : "bg-muted"}`}
                                  >
                                    {i === 0 ? "Next: " : ""}
                                    {day(payment.date)} · {money(Number(schedule.recurring_total_cents))}
                                    {payment.renewal ? " · month to month" : ""}
                                  </span>
                                ))}
                              </div>
                            ) : live ? (
                              <p className="text-xs text-muted-foreground">All payments made.</p>
                            ) : null}
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                ) : null}
                <Card className="py-0">
                  <CardHeader className="pt-6">
                    <CardTitle>Upcoming charges</CardTitle>
                    <CardDescription>
                      What SynqIQ would charge for these memberships over the next year, with SynqIQ&apos;s edits and scheduled price
                      increases applied to the base rate.
                    </CardDescription>
                  </CardHeader>
                  {upcoming.length === 0 ? (
                    <p className="px-6 pb-6 text-sm text-muted-foreground">Nothing scheduled.</p>
                  ) : (
                    <div className="max-h-[24rem] overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Base rate</TableHead>
                            <TableHead className="text-right">Tax</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">Mindbody has scheduled</TableHead>
                            <TableHead>Charged to</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {upcoming.map((charge) => (
                            <TableRow key={`${charge.mindbodyClientId}|${charge.date}`}>
                              <TableCell className="whitespace-nowrap">{day(charge.date)}</TableCell>
                              <TableCell className="text-right tabular-nums">{money(charge.subtotalCents)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{money(charge.taxCents)}</TableCell>
                              <TableCell className={`text-right tabular-nums ${charge.cents !== charge.baseCents ? "font-semibold" : ""}`}>
                                {money(charge.cents)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{money(charge.baseCents)}</TableCell>
                              <TableCell>
                                {charge.mindbodyClientId === clientId
                                  ? "This member"
                                  : (clientName.get(charge.mindbodyClientId) ?? "Payer")}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Billing edits</CardTitle>
                    <CardDescription>
                      Dues credits, discounts, freezes and cancellations. Each keeps who made it, when and why. Undoing one (also how a
                      freeze is lifted) keeps it in the history.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {current.length ? (
                      <AddBillingEdit mindbodyClientId={clientId} contracts={contractOptions} today={today} />
                    ) : (
                      <p className="text-sm text-muted-foreground">Billing edits need a current membership.</p>
                    )}
                    {adjustments.length ? (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Change</TableHead>
                              <TableHead>Dates</TableHead>
                              <TableHead>Reason</TableHead>
                              <TableHead>Made by</TableHead>
                              <TableHead />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {adjustments.map((row) => (
                              <TableRow key={row.id} className={row.cancelled_at ? "text-muted-foreground" : undefined}>
                                <TableCell>
                                  <span className={row.cancelled_at ? "line-through" : "font-medium"}>
                                    {describeAdjustment({
                                      kind: row.kind,
                                      amountCents: row.amount_cents,
                                      percent: row.percent,
                                      reasonCategory: row.reason_category,
                                    })}
                                  </span>
                                  <span className="block text-xs text-muted-foreground">
                                    {row.member_contract_id
                                      ? (contractName.get(row.member_contract_id) ?? "One membership")
                                      : "All memberships"}
                                  </span>
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  {day(row.starts_on)}
                                  {row.ends_on
                                    ? ` – ${day(row.ends_on)}`
                                    : row.kind === "discount_ongoing"
                                      ? " onward"
                                      : row.kind === "cancel"
                                        ? " (billing stops)"
                                        : ""}
                                </TableCell>
                                <TableCell className="max-w-xs">
                                  {row.reason}
                                  {row.cancelled_at ? (
                                    <span className="block text-xs">
                                      Cancelled {DateTime.fromISO(row.cancelled_at).setZone(timezone).toFormat("LLL d, h:mm a")} by{" "}
                                      {staffName.get(row.cancelled_by_staff_id ?? "") ?? "staff"}: {row.cancel_reason}
                                    </span>
                                  ) : null}
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  {staffName.get(row.created_by_staff_id) ?? "staff"}
                                  <span className="block text-xs text-muted-foreground">
                                    {DateTime.fromISO(row.created_at).setZone(timezone).toFormat("LLL d, h:mm a")}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.cancelled_at ? null : (
                                    <CancelBillingEdit
                                      id={row.id}
                                      label={row.kind === "freeze" ? "Unfreeze" : row.kind === "cancel" ? "Undo cancellation" : "Cancel"}
                                    />
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
                <Card className="py-0">
                  <CardHeader className="pt-6">
                    <CardTitle>Mindbody charges</CardTitle>
                    <CardDescription>From the uploaded AutoPay Detail report (charged and scheduled). Includes tax.</CardDescription>
                  </CardHeader>
                  {history.length === 0 ? (
                    <p className="px-6 pb-6 text-sm text-muted-foreground">Not in the uploaded report.</p>
                  ) : (
                    <div className="max-h-[24rem] overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Item</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {history.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="whitespace-nowrap">{day(row.charge_date)}</TableCell>
                              <TableCell>{row.item}</TableCell>
                              <TableCell className="text-right tabular-nums">{money(row.amount_cents)}</TableCell>
                              <TableCell>
                                <Badge variant={row.status === "declined" ? "destructive" : "outline"}>
                                  {STATUS_LABEL[row.status] ?? row.status}
                                </Badge>
                                {row.status === "declined" && row.status_detail ? (
                                  <span className="block text-xs text-muted-foreground">{row.status_detail}</span>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="visits">
                <Card className="py-0">
                  <CardHeader className="pt-6">
                    <CardTitle>Visits</CardTitle>
                    <CardDescription>Gym check-ins, classes and appointments (PT, Pilates) from Mindbody.</CardDescription>
                  </CardHeader>
                  {pulled && (pastVisits ?? []).length ? <VisitSummary visits={pastVisits ?? []} /> : null}
                  <VisitsTable
                    visits={pastVisits ?? []}
                    staffNames={staffByMindbodyId}
                    upcoming={false}
                    pulled={pulled}
                    totalCount={pastVisitCount ?? undefined}
                  />
                </Card>
              </TabsContent>

              <TabsContent value="schedule">
                <Card className="py-0">
                  <CardHeader className="pt-6">
                    <CardTitle>Schedule</CardTitle>
                    <CardDescription>Classes and appointments booked in Mindbody (next 21 days, the booking window).</CardDescription>
                  </CardHeader>
                  <VisitsTable visits={upcomingVisits ?? []} staffNames={staffByMindbodyId} upcoming pulled={pulled} />
                </Card>
              </TabsContent>

              <TabsContent value="purchases">
                <Card className="py-0">
                  <CardHeader className="pt-6">
                    <CardTitle>Purchases</CardTitle>
                    <CardDescription>Everything bought in Mindbody. Open one for its receipt.</CardDescription>
                  </CardHeader>
                  <PurchasesList
                    sales={sales ?? []}
                    items={saleItems ?? []}
                    staffNames={staffByMindbodyId}
                    timezone={timezone}
                    pulled={pulled}
                  />
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-6">
            <PersonalCard
              clientId={clientId}
              status={client?.status ?? null}
              memberSince={memberSince}
              personal={personal}
              edited={personal.edited}
              pulledAt={personalPulledAt}
              editedNote={editedNote}
            />
            <Card>
              <CardHeader>
                <CardTitle>Card on file</CardTitle>
                <CardDescription>From Mindbody&apos;s AutoPay Detail report.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm">
                {card ? (
                  <>
                    <p className="font-medium">
                      {card.card_brand ?? "Card"} ending {card.card_last4}
                    </p>
                    {card.card_exp_month && card.card_exp_year ? (
                      <p className="text-muted-foreground">
                        Expires {String(card.card_exp_month).padStart(2, "0")}/{String(card.card_exp_year).slice(-2)}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted-foreground">Not in the uploaded report.</p>
                )}
                {othersPaidFor.length ? (
                  <div className="mt-4">
                    <p className="font-medium">Also pays for</p>
                    <ul className="mt-1 space-y-1">
                      {othersPaidFor.map((contract) => (
                        <li key={contract.id}>
                          <Link href={`/dashboard/memberships/${contract.mindbody_client_id}`} className="underline underline-offset-4">
                            {clientName.get(contract.mindbody_client_id) ?? `client ${contract.mindbody_client_id}`}
                          </Link>{" "}
                          <span className="text-muted-foreground">· {contract.contract_name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

function Glance({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</p>
      {sub ? <p className="truncate text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
