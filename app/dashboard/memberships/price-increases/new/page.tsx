import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";
import { dollarsToCents } from "@/lib/memberships/adjustments";
import { isBillingMembership, parseFilters } from "@/lib/memberships/price-increase";
import { loadCandidates, loadClientNames, loadScheduledIncreases, previewIncrease } from "@/lib/memberships/price-increase-data";
import { ContractTermsWarning } from "../contract-terms-warning";
import { ScheduleIncrease } from "./schedule-increase";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

// Search memberships, preview old -> new dues, then schedule.
export default async function NewPriceIncreasePage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireAccess(isClubAdmin);
  const supabase = await getScopedClient(staff);
  const orgId = staff.organizationId;
  const params = await searchParams;

  const [{ data: org }, candidates, scheduled] = await Promise.all([
    supabase.from("organizations").select("name, timezone, billing_cutover_date").eq("id", orgId).maybeSingle(),
    loadCandidates(supabase, orgId),
    loadScheduledIncreases(supabase, orgId),
  ]);
  const today = DateTime.now()
    .setZone((org?.timezone as string | undefined) ?? "America/Chicago")
    .toISODate()!;
  const cutover = (org?.billing_cutover_date as string | undefined) ?? "2027-02-01";

  // Plans that are still billing, with how many memberships each.
  const planCounts = new Map<string, number>();
  for (const contract of candidates) {
    if (isBillingMembership(contract, today)) planCounts.set(contract.contractName, (planCounts.get(contract.contractName) ?? 0) + 1);
  }
  const plans = [...planCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const pickedPlans = (Array.isArray(params.plan) ? params.plan : params.plan ? [params.plan] : []).filter((plan) => planCounts.has(plan));
  const minRaw = one(params.min);
  const maxRaw = one(params.max);
  const pctRaw = one(params.pct) || "5";
  const roundToDollar = one(params.round) === "1";
  const searched = one(params.run) === "1";
  const minCents = minRaw ? dollarsToCents(minRaw) : null;
  const maxCents = maxRaw ? dollarsToCents(maxRaw) : null;
  const percent = Number(pctRaw);

  let error: string | null = null;
  const filters = parseFilters({
    originalStartFrom: one(params.from) || null,
    originalStartTo: one(params.to) || null,
    plans: pickedPlans,
    priceMinCents: minCents ?? (minRaw ? -1 : null),
    priceMaxCents: maxCents ?? (maxRaw ? -1 : null),
  });
  if (!filters.ok) error = filters.error;
  else if (!Number.isFinite(percent) || percent <= 0 || percent > 100) error = "Enter a percent between 0.01 and 100.";

  let rows: Awaited<ReturnType<typeof buildRows>> = [];
  async function buildRows() {
    if (!filters.ok) return [];
    const preview = previewIncrease(candidates, scheduled, filters.value, percent, roundToDollar, today);
    const names = await loadClientNames(
      supabase,
      orgId,
      preview.map((row) => row.mindbodyClientId),
    );
    return preview.map((row) => ({
      contractId: row.contractId,
      mindbodyClientId: row.mindbodyClientId,
      firstName: names.get(row.mindbodyClientId)?.first ?? "",
      name: names.get(row.mindbodyClientId)
        ? `${names.get(row.mindbodyClientId)!.first} ${names.get(row.mindbodyClientId)!.last}`.trim()
        : `Client ${row.mindbodyClientId}`,
      plan: row.contractName,
      since: row.originalStartDate ?? row.startDate,
      oldCents: row.normalAutopayCents as number,
      newCents: row.newCents,
      taxRate: row.taxRate ?? null,
      alreadyScheduled: row.alreadyScheduled,
    }));
  }
  if (searched && !error) rows = await buildRows();

  return (
    <DashboardShell
      title="New price increase"
      description="Find memberships by when the member joined, plan and current dues; preview; then schedule."
    >
      <div className="space-y-6">
        <p className="text-sm">
          <Link href="/dashboard/memberships/price-increases" className="text-muted-foreground underline underline-offset-4">
            ← Price Increases
          </Link>
        </p>
        <ContractTermsWarning />

        <Card>
          <CardHeader>
            <CardTitle>Which memberships</CardTitle>
            <CardDescription>
              &quot;Member since&quot; follows renewals back to the first contract. Prices are the base rate (dues before tax); tax is added
              at each membership&apos;s rate. Leave a field empty to include everyone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action="/dashboard/memberships/price-increases/new" className="space-y-4">
              <input type="hidden" name="run" value="1" />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div className="space-y-1.5">
                  <Label htmlFor="from">Member since, from</Label>
                  <Input id="from" name="from" type="date" defaultValue={one(params.from)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="to">Member since, to</Label>
                  <Input id="to" name="to" type="date" defaultValue={one(params.to)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="min">Dues from ($)</Label>
                  <Input id="min" name="min" inputMode="decimal" defaultValue={minRaw} placeholder="Any" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max">Dues to ($)</Label>
                  <Input id="max" name="max" inputMode="decimal" defaultValue={maxRaw} placeholder="Any" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pct">Increase (%)</Label>
                  <Input id="pct" name="pct" inputMode="decimal" defaultValue={pctRaw} />
                </div>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Plans (none ticked = every plan)</legend>
                <div className="grid max-h-56 gap-1 overflow-auto rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {plans.map(([plan, count]) => (
                    <label key={plan} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="plan" value={plan} defaultChecked={pickedPlans.includes(plan)} />
                      <span>
                        {plan} <span className="text-muted-foreground">({count})</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="round" value="1" defaultChecked={roundToDollar} />
                Round new prices up to a whole dollar
              </label>
              <Button type="submit">Preview</Button>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </form>
          </CardContent>
        </Card>

        {searched && !error && filters.ok ? (
          <ScheduleIncrease
            key={JSON.stringify([filters.value, percent, roundToDollar])}
            rows={rows}
            filters={filters.value}
            percent={percent}
            roundToDollar={roundToDollar}
            cutover={cutover}
            today={today}
            studioName={(org?.name as string | undefined) ?? "The studio"}
          />
        ) : null}
      </div>
    </DashboardShell>
  );
}
