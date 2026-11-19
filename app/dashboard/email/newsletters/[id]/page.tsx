import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadEmailKit } from "@/lib/email/studio-kit";
import { cleanFilters } from "@/lib/email/newsletter-content";
import { NewsletterComposer } from "./composer";

export const metadata: Metadata = { title: "Newsletter" };
export const dynamic = "force-dynamic";

export default async function NewsletterPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireAccess(isClubAdmin);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const admin = createSupabaseAdminClient();
  const [{ data: row }, kit, { data: org }, { count: unsubscribed }] = await Promise.all([
    admin
      .from("newsletters")
      .select("id, subject, body, filters, status, scheduled_for, sent_at, recipient_count, sent_count, failed_count")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .maybeSingle(),
    loadEmailKit(admin, staff.organizationId),
    admin.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle(),
    admin
      .from("newsletter_recipients")
      .select("contact_id", { count: "exact", head: true })
      .eq("newsletter_id", id)
      .not("unsubscribed_at", "is", null),
  ]);
  if (!row) notFound();
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const local = (iso: string | null) => (iso ? DateTime.fromISO(iso).setZone(zone).toFormat("LLL d, yyyy 'at' h:mm a") : null);

  return (
    <DashboardShell
      title={(row.subject as string) || "New newsletter"}
      description="Write it, pick who gets it, send yourself a test, then schedule it."
    >
      <NewsletterComposer
        kit={kit}
        newsletter={{
          id: row.id as string,
          subject: row.subject as string,
          body: row.body as string,
          filters: cleanFilters(row.filters),
          status: row.status as string,
          scheduledFor: local(row.scheduled_for as string | null),
          sentAt: local(row.sent_at as string | null),
          recipients: (row.recipient_count as number | null) ?? null,
          sent: row.sent_count as number,
          failed: row.failed_count as number,
          unsubscribed: unsubscribed ?? 0,
        }}
        defaultWhen={DateTime.now().setZone(zone).plus({ hours: 1 }).startOf("hour").toFormat("yyyy-LL-dd'T'HH:mm")}
        timezone={zone}
        hasFooter={Boolean(kit.branding.footer?.trim())}
      />
    </DashboardShell>
  );
}
