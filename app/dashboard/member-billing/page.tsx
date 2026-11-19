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

  const [{ data: schedules }, { data: charges }, { data: notices }] = await Promise.all([
    admin
      .from("member_billing_schedules")
      .select(
        "id, mindbody_client_id, client_name, name, first_bill_date, autopay_count, auto_renews, recurring_total_cents, billing_start, billing_state, stripe_payment_method_id, card_brand, card_last4, card_exp_month, card_exp_year",
      )
      .eq("organization_id", org)
      .eq("status", "active")
      .limit(5000),
    admin
      .from("membership_charges")
      .select("id, schedule_id, mindbody_client_id, due_date, total_cents, status, attempts, next_attempt_on, last_decline")
      .eq("organization_id", org)
      .in("status", ["declined", "failed"])
      .order("due_date", { ascending: false })
      .limit(500),
    admin.from("card_expiry_notices").select("schedule_id, card_exp_month, card_exp_year, notice, sent_at").eq("organization_id", org),
  ]);
  const scheduleBy = new Map((schedules ?? []).map((row) => [row.id as string, row]));

  const upcoming = (schedules ?? [])
    .flatMap((row) =>
      upcomingPaymentDates(row.first_bill_date as string, row.autopay_count as number | null, Boolean(row.auto_renews), today, 1)
        .filter((payment) => payment.date <= until)
        .map((payment) => ({ row, date: payment.date })),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const expiring = (schedules ?? [])
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
      description={`Monthly dues SynqIQ will charge on the studio's Stripe account. Declines retry ${RETRY_DAYS.join(", ")} days after the billing date, then booking is frozen (red). Cards expiring within a month show yellow. Renewals aren't being charged yet.`}
    >
      <div className="space-y-6">
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
                    <TableHead className="pr-6 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcoming.map(({ row, date: due }) => (
                    <TableRow key={`${row.id}-${due}`}>
                      <TableCell className="pl-6 whitespace-nowrap">{date(due)}</TableCell>
                      <TableCell>{member(row.mindbody_client_id as string, row.client_name as string | null)}</TableCell>
                      <TableCell>
                        {row.name as string}
                        {row.billing_start === "prorated" ? (
                          <span className="text-xs text-muted-foreground"> · drafts on the 1st</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{card(row) ?? <Badge variant="destructive">No card</Badge>}</TableCell>
                      <TableCell className="pr-6 text-right tabular-nums">{money(Number(row.recurring_total_cents))}</TableCell>
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
            {(charges ?? []).length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No declined payments.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Due</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Next try</TableHead>
                    <TableHead className="pr-6 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(charges ?? []).map((charge) => {
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
                        <TableCell>{charge.next_attempt_on ? date(charge.next_attempt_on as string) : "—"}</TableCell>
                        <TableCell className="pr-6 text-right tabular-nums">{money(Number(charge.total_cents))}</TableCell>
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
      </div>
    </DashboardShell>
  );
}
