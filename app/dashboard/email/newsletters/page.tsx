import type { Metadata } from "next";
import Link from "next/link";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { describeFilters, type NewsletterFilters } from "@/lib/email/newsletter-content";
import { NewNewsletterButton } from "./new-button";

export const metadata: Metadata = { title: "Newsletters" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; variant: "secondary" | "default" | "outline" }> = {
  draft: { label: "Draft", variant: "outline" },
  scheduled: { label: "Scheduled", variant: "default" },
  sending: { label: "Sending", variant: "default" },
  sent: { label: "Sent", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

// Admin > Email > Newsletters (Club Admins): drafts, scheduled and sent
// newsletters, with how many each went to.
export default async function NewslettersPage() {
  const staff = await requireAccess(isClubAdmin);
  const admin = createSupabaseAdminClient();
  const [{ data: rows }, { data: org }, { data: unsubs }] = await Promise.all([
    admin
      .from("newsletters")
      .select("id, subject, status, filters, scheduled_for, sent_at, recipient_count, sent_count, failed_count, updated_at")
      .eq("organization_id", staff.organizationId)
      .order("updated_at", { ascending: false })
      .limit(100),
    admin.from("organizations").select("timezone").eq("id", staff.organizationId).maybeSingle(),
    admin
      .from("newsletter_recipients")
      .select("newsletter_id")
      .eq("organization_id", staff.organizationId)
      .not("unsubscribed_at", "is", null),
  ]);
  const zone = (org?.timezone as string | null) ?? "America/Chicago";
  const unsubBy = new Map<string, number>();
  for (const row of unsubs ?? []) unsubBy.set(row.newsletter_id as string, (unsubBy.get(row.newsletter_id as string) ?? 0) + 1);
  const when = (iso: string | null) => (iso ? DateTime.fromISO(iso).setZone(zone).toFormat("LLL d, yyyy h:mm a") : "");

  return (
    <DashboardShell
      title="Newsletters"
      description="Email your members, leads and guests. Only people who agreed to receive emails get them, and every email has an unsubscribe link."
      actions={<NewNewsletterButton />}
    >
      {rows?.length ? (
        <Card>
          <CardContent className="divide-y p-0">
            {rows.map((row) => {
              const status = STATUS[row.status as string] ?? STATUS.draft;
              return (
                <Link
                  key={row.id as string}
                  href={`/dashboard/email/newsletters/${row.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{(row.subject as string) || "Untitled newsletter"}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {describeFilters((row.filters ?? {}) as NewsletterFilters)}
                    </span>
                  </span>
                  <span className="text-right text-sm text-muted-foreground">
                    {row.status === "sent" ? (
                      <>
                        Sent {when(row.sent_at as string)}
                        <span className="block">
                          {row.sent_count as number} delivered
                          {row.failed_count ? ` · ${row.failed_count} failed` : ""}
                          {unsubBy.get(row.id as string) ? ` · ${unsubBy.get(row.id as string)} unsubscribed` : ""}
                        </span>
                      </>
                    ) : row.status === "scheduled" || row.status === "sending" ? (
                      <>
                        {row.status === "sending" ? "Sending now" : `Sends ${when(row.scheduled_for as string)}`}
                        <span className="block">{row.recipient_count as number} people</span>
                      </>
                    ) : (
                      `Edited ${when(row.updated_at as string)}`
                    )}
                  </span>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">No newsletters yet. Start one with New newsletter.</CardContent>
        </Card>
      )}
    </DashboardShell>
  );
}
