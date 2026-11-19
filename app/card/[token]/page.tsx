import type { Metadata } from "next";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findCardLink } from "@/lib/billing/card-links";
import { CardUpdate } from "@/components/billing/card-update";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Update your card", robots: { index: false, follow: false } };

// The page behind an emailed "update your card" link. No sign-in: the link
// itself (7 days, used once) identifies the member. Shows only their first
// name and the studio; the card goes straight to Stripe.
export default async function CardLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await findCardLink(token);
  const admin = createSupabaseAdminClient();
  const [{ data: org }, { data: client }] = link
    ? await Promise.all([
        admin.from("organizations").select("name").eq("id", link.organizationId).maybeSingle(),
        admin
          .from("clients")
          .select("first_name")
          .eq("organization_id", link.organizationId)
          .eq("mindbody_client_id", link.clientId)
          .maybeSingle(),
      ])
    : [{ data: null }, { data: null }];

  return (
    <main className="mx-auto min-h-screen max-w-md space-y-4 bg-background px-4 py-10">
      {link ? (
        <>
          <h1 className="text-2xl font-semibold">{(org?.name as string | null) ?? "Your studio"}</h1>
          <p className="text-muted-foreground">
            Hi {(client?.first_name as string | null) || "there"}, add the card you&apos;d like to use for your monthly membership payments.
            If a payment is overdue, it&apos;s tried again with this card right away.
          </p>
          <CardUpdate endpoint="/api/card-update" body={{ token }} label="Add my card" />
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">This link has expired</h1>
          <p className="text-muted-foreground">
            Card update links work for 7 days and only once. Please ask the front desk to send a new one, or update your card in the app.
          </p>
        </>
      )}
    </main>
  );
}
