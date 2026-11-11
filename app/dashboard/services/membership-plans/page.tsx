import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { getScopedClient } from "@/lib/supabase/scoped";

type Plan = {
  id: string;
  name: string;
  description: string | null;
  recurring_subtotal_cents: number | null;
  first_payment_subtotal_cents: number | null;
  autopay_frequency: string | null;
  number_of_autopays: number | null;
  after_term: string | null;
  sold_online: boolean;
  requires_signature: boolean;
  members_only: boolean;
  agreement_terms: string | null;
  synced_at: string | null;
};

const money = (cents: number | null) =>
  cents === null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function term(plan: Plan) {
  const every = (plan.autopay_frequency ?? "").toLowerCase() || "period";
  const length = plan.number_of_autopays ? `${plan.number_of_autopays} ${every} payments` : "Open-ended";
  const after =
    plan.after_term === "ContractAutomaticallyRenews" ? "renews automatically" : plan.after_term === "ContractExpires" ? "then ends" : null;
  return after ? `${length}, ${after}` : length;
}

// Services & Pricing -> Membership Plans: the membership contracts members
// can be on, as set up in Mindbody (imported nightly), with how many
// members are on each. Read-only for now; contracts will be managed here
// after the switch. Club Admins only.
export default async function MembershipPlansPage() {
  const staff = await requireAccess(isClubAdmin);
  const supabase = await getScopedClient(staff);
  const orgId = staff.organizationId;
  const today = DateTime.now().toISODate()!;
  const [{ data: plans }, contracts] = await Promise.all([
    supabase
      .from("membership_plans")
      .select(
        "id, name, description, recurring_subtotal_cents, first_payment_subtotal_cents, autopay_frequency, number_of_autopays, after_term, sold_online, requires_signature, members_only, agreement_terms, synced_at",
      )
      .eq("organization_id", orgId)
      .eq("active", true)
      .order("name")
      .returns<Plan[]>(),
    (async () => {
      const rows: { plan_id: string | null; autopay_status: string | null; end_date: string | null }[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data } = await supabase
          .from("member_contracts")
          .select("plan_id, autopay_status, end_date")
          .eq("organization_id", orgId)
          .order("id")
          .range(offset, offset + 999);
        rows.push(...((data ?? []) as typeof rows));
        if (!data || data.length < 1000) break;
      }
      return rows;
    })(),
  ]);

  const counts = new Map<string, { active: number; frozen: number }>();
  for (const contract of contracts) {
    if (!contract.plan_id || (contract.end_date && contract.end_date < today)) continue;
    const status = (contract.autopay_status ?? "").toLowerCase();
    if (status !== "active" && status !== "suspended") continue;
    const entry = counts.get(contract.plan_id) ?? { active: 0, frozen: 0 };
    if (status === "suspended") entry.frozen += 1;
    else entry.active += 1;
    counts.set(contract.plan_id, entry);
  }
  const sorted = [...(plans ?? [])].sort(
    (a, b) => (counts.get(b.id)?.active ?? 0) - (counts.get(a.id)?.active ?? 0) || a.name.localeCompare(b.name),
  );
  const totalMembers = [...counts.values()].reduce((sum, entry) => sum + entry.active + entry.frozen, 0);

  return (
    <DashboardShell
      title="Membership Plans"
      description="The membership contracts members can be on, as set up in Mindbody (imported nightly). Read-only for now; contracts will be managed here after the switch."
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {sorted.length} plans · {totalMembers.toLocaleString()} current memberships. Prices are dues before tax.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {sorted.map((plan) => {
            const count = counts.get(plan.id) ?? { active: 0, frozen: 0 };
            return (
              <Card key={plan.id} className="gap-3">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    {plan.name}
                    <span className="text-lg font-semibold tabular-nums">
                      {money(plan.recurring_subtotal_cents)}
                      {plan.autopay_frequency ? (
                        <span className="text-sm font-normal text-muted-foreground">
                          {" "}
                          / {plan.autopay_frequency.toLowerCase().replace(/ly$/, "")}
                        </span>
                      ) : null}
                    </span>
                  </CardTitle>
                  <CardDescription className="flex flex-wrap gap-1">
                    <Badge variant="secondary">
                      {count.active} active{count.frozen ? ` · ${count.frozen} frozen` : ""}
                    </Badge>
                    {plan.sold_online ? <Badge variant="outline">Sold online</Badge> : null}
                    {plan.requires_signature ? <Badge variant="outline">Signature</Badge> : null}
                    {plan.members_only ? <Badge variant="outline">Members only</Badge> : null}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>
                    <span className="text-muted-foreground">Term:</span> {term(plan)}
                  </p>
                  {plan.first_payment_subtotal_cents !== null && plan.first_payment_subtotal_cents !== plan.recurring_subtotal_cents ? (
                    <p>
                      <span className="text-muted-foreground">First payment:</span> {money(plan.first_payment_subtotal_cents)}
                    </p>
                  ) : null}
                  {plan.description ? <p className="text-muted-foreground">{plan.description}</p> : null}
                  {plan.agreement_terms ? (
                    <details className="rounded-md border bg-muted/30 px-3 py-2">
                      <summary className="cursor-pointer text-sm font-medium">Agreement terms</summary>
                      <p className="mt-2 max-h-72 overflow-auto text-xs whitespace-pre-line text-muted-foreground">
                        {plan.agreement_terms}
                      </p>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </DashboardShell>
  );
}
