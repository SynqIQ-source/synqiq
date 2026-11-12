import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStudioStripeAccount, refreshStudioAccount } from "@/lib/payments/connect";
import { ConnectActions } from "./connect-actions";

type Props = { searchParams: Promise<{ returned?: string; resume?: string }> };

// Club Admin: the studio's own Stripe account for member payments. The
// studio is the merchant (its own Dashboard, payouts and disputes); SynqIQ
// creates charges in that account. Returning from Stripe's onboarding doesn't
// mean the account is ready -- the status is re-read from Stripe.
export default async function PaymentsSettingsPage({ searchParams }: Props) {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const params = await searchParams;
  let account = await getStudioStripeAccount(admin, staff.organizationId);
  let checkFailed = false;
  if (account && params.returned) {
    try {
      account = await refreshStudioAccount(admin, staff.organizationId);
    } catch {
      checkFailed = true;
    }
  }
  const status = !account ? "Not connected" : account.ready ? "Ready for payments" : "Setup in progress";

  return (
    <DashboardShell
      title="Payments"
      description="Your studio's own Stripe account for member payments. Your studio gets paid directly, sees everything in its Stripe Dashboard, and handles its own payouts and disputes."
    >
      <div className="max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Stripe account
              <Badge variant={account?.ready ? "default" : "secondary"}>{status}</Badge>
              {account && !account.livemode ? <Badge variant="outline">Test mode</Badge> : null}
            </CardTitle>
            <CardDescription>
              {!account
                ? "Connect your studio's Stripe account to take card payments at checkout and for memberships. Stripe will ask for your business, bank and owner details."
                : account.ready
                  ? "Card payments are on. Members' payments go straight into this account."
                  : "Stripe still needs some details before card payments can start. Continue the setup to finish."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {account && !account.ready && account.requirementsDue.length ? (
              <div>
                <p className="font-medium">Stripe still needs:</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {account.requirementsDue.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {checkFailed ? (
              <p className="text-destructive">Couldn&apos;t check with Stripe just now. Use “Check status” in a moment.</p>
            ) : null}
            <ConnectActions connected={Boolean(account)} ready={Boolean(account?.ready)} />
            <p className="text-xs text-muted-foreground">
              Card numbers are entered only into Stripe&apos;s own forms and readers; they never pass through SynqIQ. Stripe charges its
              processing fees to your Stripe account.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
