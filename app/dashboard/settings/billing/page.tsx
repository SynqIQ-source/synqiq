import { notFound, redirect } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { CONTACT_EMAIL } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getStudioBilling } from "@/lib/billing/account";
import { getCurrentStaff } from "@/lib/current-staff";
import { getEnabledModules } from "@/lib/modules";
import { listPrice, MODULES, TEXT_OVERAGE, TEXTS_INCLUDED } from "@/lib/plans";
import { BillingActions } from "./billing-actions";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment failed",
  unpaid: "Unpaid",
  canceled: "Canceled",
  incomplete: "Payment pending",
  incomplete_expired: "Payment expired",
  paused: "Paused",
};

// Settings -> Billing (studio admins): the plan, the Stripe billing portal
// (card, invoices), and canceling. Studios billed by hand see how to reach
// us instead.
export default async function BillingPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "admin") notFound();
  const [billing, modules] = await Promise.all([getStudioBilling(staff.organizationId), getEnabledModules(staff.organizationId)]);
  const moduleNames = MODULES.filter((module) => modules.has(module.key)).map((module) => module.name);
  const date = (iso: string | null) => (iso ? DateTime.fromISO(iso).toFormat("LLLL d, yyyy") : null);
  const price =
    billing.kind === "stripe" ? billing.amount : (billing.customPrice ?? listPrice([...modules]));

  return (
    <DashboardShell title="Billing" description="Your SynqIQ plan, payment method and invoices.">
      <div className="max-w-3xl space-y-6">
        {billing.kind === "stripe" && billing.cancelAt && billing.status !== "canceled" ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Your subscription is set to cancel on <span className="font-semibold">{date(billing.cancelAt)}</span>. You
            keep full access until then.
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Your plan
              {billing.kind === "stripe" ? (
                <Badge variant={billing.status === "active" || billing.status === "trialing" ? "secondary" : "destructive"}>
                  {STATUS_LABELS[billing.status] ?? billing.status}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>{moduleNames.length ? moduleNames.join(" + ") : "No modules"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-2xl font-semibold tabular-nums">${price ?? "—"}</span>
              <span className="text-muted-foreground"> / month, plus sales tax where it applies</span>
            </p>
            {modules.has("crm") ? (
              <p className="text-muted-foreground">
                Includes {TEXTS_INCLUDED.toLocaleString("en-US")} texts a month; {Math.round(TEXT_OVERAGE * 100)}¢ per text
                after that, added to the next bill.
              </p>
            ) : null}
            {billing.kind === "stripe" && billing.periodEnd && !billing.cancelAt ? (
              <p className="text-muted-foreground">Next bill: {date(billing.periodEnd)}</p>
            ) : null}
          </CardContent>
        </Card>

        {billing.kind === "stripe" ? (
          <BillingActions
            canceling={Boolean(billing.cancelAt) && billing.status !== "canceled"}
            canceled={billing.status === "canceled"}
            periodEnd={date(billing.periodEnd)}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Changes or cancellation</CardTitle>
              <CardDescription>
                Your studio is billed by SynqIQ directly. To change your plan or cancel, email{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary hover:underline">
                  {CONTACT_EMAIL}
                </a>{" "}
                and we&apos;ll take care of it.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </DashboardShell>
  );
}
