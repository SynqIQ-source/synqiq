import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { upcomingPaymentDates } from "@/lib/pos/packages";
import { cardExpiry, RETRY_DAYS } from "@/lib/billing/renewals";
import { RunRenewals } from "./run-renewals";
import { ChargeControls } from "./charge-controls";
import { getStudioStripeAccount, stripeLivemode } from "@/lib/payments/connect";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const UPCOMING_DAYS = 7;

// Monthly membership billing (Club Admins): who is due in the next week,
// declined and frozen payments, and cards expiring within a month. SynqIQ
// doesn't charge renewals yet; this is the list the nightly run will use.
export default async function MemberBillingPage() {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const { data: orgRow } = await admin.from("organizations").select("timezone").eq("id", org).maybeSingle();
  const zone = (orgRow?.timezone as string | null) ?? "America/Chicago";
  const today = DateTime.now().setZone(zone).toISODate()!;
  const until = DateTime.fromISO(today).plus({ days: UPCOMING_DAYS }).toISODate()!;

  const [{ data: scheduleRows }, { data: charges }, { data: notices }] = await Promise.all([
    admin
      .from("member_billing_schedules")
      .select(
        "id, status, mindbody_client_id, client_name, name, first_bill_date, autopay_count, auto_renews, recurring_total_cents, billing_start, billing_state, stripe_payment_method_id, card_brand, card_last4, card_exp_month, card_exp_year",
      )
      .eq("organization_id", org)
      // Test mode (local/sandbox): also the schedules test-card sales made.
      .in("status", stripeLivemode() ? ["active"] : ["active", "practice"])
      .limit(5000),
    admin
      .from("membership_charges")
      .select("id, schedule_id, mindbody_client_id, due_date, total_cents, status, attempts, next_attempt_on, last_decline, moved_at")
      .eq("organization_id", org)
      .in("status", ["declined", "failed", "scheduled"])
      .order("due_date", { ascending: false })
      .limit(500),
    admin.from("card_expiry_notices").select("schedule_id, card_exp_month, card_exp_year, notice, sent_at").eq("organization_id", org),
  ]);
  const [{ data: disputes }, account] = await Promise.all([
    admin
      .from("payment_disputes")
      .select("id, mindbody_client_id, sale_id, amount_cents, reason, status, evidence_due_by, created_at")
      .eq("organization_id", org)
      .eq("livemode", stripeLivemode())
      .order("created_at", { ascending: false })
      .limit(100),
    getStudioStripeAccount(admin, org),
  ]);
  // Going live: what SynqIQ can check itself, then what people sign off.
  const checks = [
    { label: "Live Stripe key on the server", done: stripeLivemode() },
    {
      label: "Live publishable key (STRIPE_PUBLISHABLE_KEY pk_live_…) in Vercel",
      done: Boolean(process.env.STRIPE_PUBLISHABLE_KEY?.startsWith("pk_live_")),
    },
    { label: "The Preserve's live Stripe account is ready for card payments", done: Boolean(account?.ready && account.livemode) },
    { label: "Payments webhook secret set", done: Boolean(process.env.STRIPE_CONNECT_PAYMENTS_WEBHOOK_SECRET) },
    { label: "Live card payments switched on (STRIPE_CONNECT_LIVE=true)", done: process.env.STRIPE_CONNECT_LIVE === "true" },
    { label: "Renewals switched on (SYNQIQ_RENEWALS_LIVE=true)", done: process.env.SYNQIQ_RENEWALS_LIVE === "true" },
  ];
  const signOffs = [
    "Stripe (Neel) confirms the Connect setup",
    "Revenue-share agreement signed",
    "Independent payments-security review done",
    "setup_intent.succeeded added to the SynqIQ Studio Payments webhook events",
    "Pilot members: Mindbody autopay turned off before SynqIQ's first charge",
  ];
  // Practice schedules count only when a test card is on them.
  const schedules = (scheduleRows ?? []).filter((row) => row.status === "active" || row.stripe_payment_method_id);
  const scheduleBy = new Map(schedules.map((row) => [row.id as string, row]));
  const declined = (charges ?? []).filter((charge) => charge.status !== "scheduled");
  // Upcoming payments a Club Admin moved to another day.
  const movedBy = new Map(
    (charges ?? []).filter((charge) => charge.status === "scheduled").map((charge) => [`${charge.schedule_id}|${charge.due_date}`, charge]),
  );

  const upcoming = schedules
    .flatMap((row) =>
      upcomingPaymentDates(row.first_bill_date as string, row.autopay_count as number | null, Boolean(row.auto_renews), today, 1)
        .map((payment) => {
          const moved = movedBy.get(`${row.id}|${payment.date}`);
          return { row, due: payment.date, date: (moved?.next_attempt_on as string | null) ?? payment.date, moved: Boolean(moved) };
        })
        .filter((payment) => payment.date <= until || payment.due <= until),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const expiring = schedules
    .filter((row) => row.card_exp_month && row.card_exp_year)
    .map((row) => ({ row, card: cardExpiry(Number(row.card_exp_month), Number(row.card_exp_year), today) }))
    .filter(({ card }) => card.state !== "ok")
    .sort((a, b) => a.card.expiresOn.localeCompare(b.card.expiresOn));
  const sent = (scheduleId: string, month: number, year: number, notice: "first" | "second") =>
    (notices ?? []).find(
      (row) => row.schedule_id === scheduleId && row.card_exp_month === month && row.card_exp_year === year && row.notice === notice,
    );

  const member = (clientId: string | null, name: string | null) =>
    clientId ? (
      <Link href={`/dashboard/memberships/${encodeURIComponent(clientId)}`} className="underline-offset-4 hover:underline">
        {name ?? clientId}
      </Link>
    ) : (
      (name ?? "—")
    );
  const card = (row: Record<string, unknown>) =>
    row.card_last4
      ? `${String(row.card_brand ?? "card").toUpperCase()} ••${row.card_last4}`
      : row.stripe_payment_method_id
        ? "On file"
        : null;
  const date = (iso: string) => DateTime.fromISO(iso).toFormat("ccc LLL d");

  return (
    <DashboardShell
      title="Member Billing"
      actions={<RunRenewals />}
      description={`Monthly dues SynqIQ will charge on the studio's Stripe account. A decline pauses booking (red) and emails the member; it retries ${RETRY_DAYS.join(", ")} days after the billing date, then the membership is frozen. Move any single payment date or retry a decline below. Cards expiring within a month show yellow. Renewals run nightly at 4 AM; live charging isn't switched on yet (test cards only).`}
    >
      <div className="space-y-6">
        <Link
          href="/dashboard/member-billing/cutover"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary-subtle px-4 py-3 text-sm hover:bg-accent"
        >
          <span>
            <strong>Jan 1 cutover:</strong> moving every Mindbody autopay to SynqIQ, each member on their own billing day.
          </span>
          <span className="font-medium underline underline-offset-4">Open the dry run</span>
        </Link>
        <Card className="py-0">
          <CardHeader className="pt-4">
            <CardTitle className="text-base">Due in the next {UPCOMING_DAYS} days</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {upcoming.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">Nobody is due.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Date</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Membership</TableHead>
                    <TableHead>Card</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="pr-6">Move this payment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcoming.map(({ row, due, date: on, moved }) => (
                    <TableRow key={`${row.id}-${due}`}>
                      <TableCell className="pl-6 whitespace-nowrap">
                        {date(on)}
                        {moved ? <span className="block text-xs text-muted-foreground">moved from {date(due)}</span> : null}
                      </TableCell>
                      <TableCell>{member(row.mindbody_client_id as string, row.client_name as string | null)}</TableCell>
                      <TableCell>
                        {row.name as string}
                        {row.billing_start === "prorated" ? (
                          <span className="text-xs text-muted-foreground"> · drafts on the 1st</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{card(row) ?? <Badge variant="destructive">No card</Badge>}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(Number(row.recurring_total_cents))}</TableCell>
                      <TableCell className="pr-6">
                        <ChargeControls scheduleId={row.id as string} dueDate={due} date={on} min={today} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="pt-4">
            <CardTitle className="text-base">Declined and frozen</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {declined.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No declined payments.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Due</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="pr-6">Next try (move or retry now)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {declined.map((charge) => {
                    const schedule = scheduleBy.get(charge.schedule_id as string);
                    return (
                      <TableRow key={charge.id as string}>
                        <TableCell className="pl-6 whitespace-nowrap">{date(charge.due_date as string)}</TableCell>
                        <TableCell>
                          {member(charge.mindbody_client_id as string | null, (schedule?.client_name as string | null) ?? null)}
                        </TableCell>
                        <TableCell>
                          {charge.status === "failed" ? (
                            <Badge className="bg-red-600 text-white hover:bg-red-600">Frozen</Badge>
                          ) : (
                            <Badge variant="destructive">Declined ×{Number(charge.attempts)}</Badge>
                          )}
                          {charge.last_decline ? (
                            <span className="ml-2 text-xs text-muted-foreground">{charge.last_decline as string}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(Number(charge.total_cents))}</TableCell>
                        <TableCell className="pr-6">
                          <ChargeControls
                            chargeId={charge.id as string}
                            date={(charge.next_attempt_on as string | null) ?? null}
                            min={today}
                            canRetry
                          />
                          {charge.moved_at ? <span className="text-xs text-muted-foreground">Date moved by a Club Admin</span> : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="pt-4">
            <CardTitle className="text-base">Expiring cards</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {expiring.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No cards expire in the next month.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Member</TableHead>
                    <TableHead>Card</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="pr-6">Emails</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiring.map(({ row, card: expiry }) => {
                    const month = Number(row.card_exp_month);
                    const year = Number(row.card_exp_year);
                    const first = sent(row.id as string, month, year, "first");
                    const second = sent(row.id as string, month, year, "second");
                    return (
                      <TableRow key={row.id as string}>
                        <TableCell className="pl-6">{member(row.mindbody_client_id as string, row.client_name as string | null)}</TableCell>
                        <TableCell>{card(row)}</TableCell>
                        <TableCell>
                          <Badge className="bg-yellow-400 text-yellow-950 hover:bg-yellow-400">
                            {expiry.state === "expired" ? "Expired" : "Expires"} {DateTime.fromISO(expiry.expiresOn).toFormat("LLL yyyy")}
                          </Badge>
                        </TableCell>
                        <TableCell className="pr-6 text-sm text-muted-foreground">
                          {first ? `1st sent ${date((first.sent_at as string).slice(0, 10))}` : "1st not sent"}
                          {" · "}
                          {second ? `2nd sent ${date((second.sent_at as string).slice(0, 10))}` : "2nd not sent"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="pt-4">
            <CardTitle className="text-base">Disputes (chargebacks)</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {(disputes ?? []).length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">
                No disputes. If a member disputes a charge with their bank, it shows here.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Opened</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Respond by</TableHead>
                    <TableHead className="pr-6 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(disputes ?? []).map((dispute) => (
                    <TableRow key={dispute.id as string}>
                      <TableCell className="pl-6 whitespace-nowrap">{date((dispute.created_at as string).slice(0, 10))}</TableCell>
                      <TableCell>{member(dispute.mindbody_client_id as string | null, null)}</TableCell>
                      <TableCell>{String(dispute.reason ?? "—").replaceAll("_", " ")}</TableCell>
                      <TableCell>
                        <Badge variant={dispute.status === "won" ? "secondary" : dispute.status === "lost" ? "destructive" : "outline"}>
                          {String(dispute.status).replaceAll("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>{dispute.evidence_due_by ? date((dispute.evidence_due_by as string).slice(0, 10)) : "—"}</TableCell>
                      <TableCell className="pr-6 text-right tabular-nums">{money(Number(dispute.amount_cents))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {(disputes ?? []).length ? (
              <p className="px-6 pb-4 text-xs text-muted-foreground">
                Answer disputes in the studio&apos;s Stripe dashboard before the respond-by date.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Going live checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {checks.map((check) => (
              <p key={check.label}>
                <span className={check.done ? "text-emerald-600" : "text-muted-foreground"}>{check.done ? "✓" : "○"}</span> {check.label}
              </p>
            ))}
            <p className="pt-2 text-xs font-medium text-muted-foreground">Sign-offs (not checked by SynqIQ)</p>
            {signOffs.map((item) => (
              <p key={item} className="text-muted-foreground">
                ○ {item}
              </p>
            ))}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
