import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { renderNotice, type IncreaseFilters } from "@/lib/memberships/price-increase";
import { loadClientNames } from "@/lib/memberships/price-increase-data";
import { formatTaxRate, taxOn } from "@/lib/memberships/tax";
import { ContractTermsWarning } from "../contract-terms-warning";
import { CancelIncrease } from "./cancel-increase";

type Params = Promise<{ id: string }>;

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
const day = (iso: string | null) => (iso ? DateTime.fromISO(iso).toFormat("LLL d, yyyy") : "—");

export default async function PriceIncreasePage({ params }: { params: Params }) {
  const staff = await requireAccess(isClubAdmin);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await getScopedClient(staff);
  const orgId = staff.organizationId;

  type Increase = {
    id: string;
    name: string;
    percent: number;
    round_to_dollar: boolean;
    effective_on: string;
    filters: IncreaseFilters;
    notice_subject: string | null;
    notice_body: string | null;
    member_count: number;
    created_by_staff_id: string;
    created_at: string;
    cancelled_at: string | null;
    cancelled_by_staff_id: string | null;
    cancel_reason: string | null;
  };
  type Item = {
    id: string;
    mindbody_client_id: string;
    contract_name: string;
    original_start_date: string | null;
    old_cents: number;
    new_cents: number;
    tax_rate: number | null;
  };
  const [{ data: increase }, { data: org }] = await Promise.all([
    supabase.from("price_increases").select("*").eq("organization_id", orgId).eq("id", id).maybeSingle<Increase>(),
    supabase.from("organizations").select("name, timezone").eq("id", orgId).maybeSingle(),
  ]);
  if (!increase) notFound();

  const items: Item[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await supabase
      .from("price_increase_items")
      .select("id, mindbody_client_id, contract_name, original_start_date, old_cents, new_cents, tax_rate")
      .eq("price_increase_id", id)
      .order("original_start_date")
      .range(offset, offset + 999)
      .returns<Item[]>();
    items.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const staffIds = [increase.created_by_staff_id, increase.cancelled_by_staff_id].filter((value): value is string => Boolean(value));
  const [names, { data: staffRows }] = await Promise.all([
    loadClientNames(
      supabase,
      orgId,
      items.map((item) => item.mindbody_client_id),
    ),
    supabase.from("staff").select("id, display_name").in("id", staffIds),
  ]);
  const staffName = new Map((staffRows ?? []).map((row) => [row.id as string, row.display_name as string]));
  const timezone = (org?.timezone as string | undefined) ?? "America/Chicago";
  const today = DateTime.now().setZone(timezone).toISODate()!;
  const at = (iso: string) => DateTime.fromISO(iso).setZone(timezone).toFormat("LLL d, yyyy h:mm a");
  const monthlyOld = items.reduce((sum, item) => sum + item.old_cents, 0);
  const monthlyNew = items.reduce((sum, item) => sum + item.new_cents, 0);
  const rateOf = (item: Item) => (item.tax_rate === null ? null : Number(item.tax_rate));
  const monthlyNewTax = items.reduce((sum, item) => sum + (taxOn(item.new_cents, rateOf(item)) ?? 0), 0);
  const filters = increase.filters;

  const first = items[0];
  const firstName = first ? names.get(first.mindbody_client_id) : undefined;
  const sample =
    first && (increase.notice_subject || increase.notice_body)
      ? (() => {
          const variables = {
            first_name: firstName?.first || "there",
            member_since: day(first.original_start_date),
            effective_date: day(increase.effective_on),
            plan: first.contract_name,
            old_price: money(first.old_cents),
            new_price: money(first.new_cents),
            studio_name: (org?.name as string | undefined) ?? "The studio",
          };
          return `Subject: ${renderNotice(increase.notice_subject ?? "", variables)}\n\n${renderNotice(increase.notice_body ?? "", variables)}`;
        })()
      : null;
  const status = increase.cancelled_at ? "Cancelled" : increase.effective_on <= today ? "In effect" : "Scheduled";

  return (
    <DashboardShell title={increase.name} description={`${Number(increase.percent)}% increase starting ${day(increase.effective_on)}`}>
      <div className="space-y-6">
        <p className="text-sm">
          <Link href="/dashboard/memberships/price-increases" className="text-muted-foreground underline underline-offset-4">
            ← Price Increases
          </Link>
        </p>
        {status === "Scheduled" ? <ContractTermsWarning /> : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {status}
              <Badge variant={status === "Scheduled" ? "default" : "outline"}>{Number(increase.percent)}%</Badge>
            </CardTitle>
            <CardDescription>
              Scheduled by {staffName.get(increase.created_by_staff_id) ?? "staff"} on {at(increase.created_at)}.
              {increase.cancelled_at
                ? ` Cancelled by ${staffName.get(increase.cancelled_by_staff_id ?? "") ?? "staff"} on ${at(increase.cancelled_at)}: ${increase.cancel_reason}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Memberships" value={items.length.toLocaleString()} />
              <Stat label="Members" value={increase.member_count.toLocaleString()} />
              <Stat label="Base rate now (monthly)" value={money(monthlyOld)} />
              <Stat label="New base rate" value={`${money(monthlyNew)} (+${money(monthlyNew - monthlyOld)})`} />
              <Stat label="Tax on new rate" value={money(monthlyNewTax)} />
              <Stat label="New total" value={money(monthlyNew + monthlyNewTax)} />
            </div>
            <p className="text-muted-foreground">
              Search: member since {filters.originalStartFrom ? day(filters.originalStartFrom) : "any time"} –{" "}
              {filters.originalStartTo ? day(filters.originalStartTo) : "now"}; plans{" "}
              {filters.plans?.length ? filters.plans.join(", ") : "all"}; dues{" "}
              {filters.priceMinCents !== null ? money(filters.priceMinCents) : "any"} –{" "}
              {filters.priceMaxCents !== null ? money(filters.priceMaxCents) : "any"}
              {increase.round_to_dollar ? "; new prices rounded up to whole dollars" : ""}. The increase applies to the base rate (dues
              before tax); tax is recalculated at each membership&apos;s rate and isn&apos;t edited.
            </p>
            {status === "Scheduled" ? <CancelIncrease id={increase.id} /> : null}
          </CardContent>
        </Card>

        {sample ? (
          <Card>
            <CardHeader>
              <CardTitle>Notice email draft</CardTitle>
              <CardDescription>
                Not sent. Sample for {firstName ? `${firstName.first} ${firstName.last}` : "the first member"}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-sm">{sample}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>Memberships</CardTitle>
          </CardHeader>
          <div className="max-h-[32rem] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Member since</TableHead>
                  <TableHead className="text-right">Base now</TableHead>
                  <TableHead className="text-right">New base</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">New total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const name = names.get(item.mindbody_client_id);
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Link href={`/dashboard/memberships/${item.mindbody_client_id}`} className="underline-offset-4 hover:underline">
                          {name ? `${name.first} ${name.last}` : `Client ${item.mindbody_client_id}`}
                        </Link>
                      </TableCell>
                      <TableCell>{item.contract_name}</TableCell>
                      <TableCell className="whitespace-nowrap">{day(item.original_start_date)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(item.old_cents)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{money(item.new_cents)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {rateOf(item) === null ? "—" : money(taxOn(item.new_cents, rateOf(item)) as number)}
                        <span className="block text-xs">{formatTaxRate(rateOf(item))}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rateOf(item) === null ? "—" : money(item.new_cents + (taxOn(item.new_cents, rateOf(item)) as number))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
