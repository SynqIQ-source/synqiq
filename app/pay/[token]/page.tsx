import type { Metadata } from "next";
import { DateTime } from "luxon";
import { confirmSummary, findConfirmLink } from "@/lib/billing/confirm-payment";
import { PaymentConfirm } from "@/components/billing/payment-confirm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm your payment", robots: { index: false, follow: false } };

// The page behind an emailed "confirm your payment" link: the member's bank
// asked them to approve a monthly payment (3D Secure). No sign-in: the link
// (7 days, used once) identifies the member and the payment.
export default async function ConfirmPaymentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await findConfirmLink(token);
  const summary = link ? await confirmSummary(link) : null;
  const amount = summary ? `$${(summary.amountCents / 100).toFixed(2)}` : "";

  return (
    <main className="mx-auto min-h-screen max-w-md space-y-4 bg-background px-4 py-10">
      {summary ? (
        <>
          <h1 className="text-2xl font-semibold">{summary.studioName}</h1>
          {summary.paid ? (
            <p className="text-muted-foreground">This payment has already gone through. Thank you!</p>
          ) : summary.open ? (
            <>
              <p className="text-muted-foreground">
                Hi {summary.firstName || "there"}, your bank asked you to approve your <strong>{summary.membership}</strong> payment of{" "}
                <strong>{amount}</strong> (due {DateTime.fromISO(summary.dueDate).toFormat("LLLL d")})
                {summary.card ? ` on your ${summary.card}` : ""}. Approve it below and booking turns back on.
              </p>
              <PaymentConfirm token={token} amountLabel={amount} />
            </>
          ) : (
            <p className="text-muted-foreground">This payment can&apos;t be approved here any more. Please contact the front desk.</p>
          )}
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">This link has expired</h1>
          <p className="text-muted-foreground">
            Payment links work for 7 days and only once. Please ask the front desk to send a new one, or update your card in the app.
          </p>
        </>
      )}
    </main>
  );
}
