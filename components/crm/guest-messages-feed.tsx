import Link from "next/link";
import { DateTime } from "luxon";
import { Mail, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentStaff } from "@/lib/current-staff";
import { isCrmEnabled } from "@/lib/crm/module";
import { getCrmOrg } from "@/lib/crm/org";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type FeedRow = {
  id: string;
  channel: string;
  created_at: string;
  read_at: string | null;
  contact: { id: string; first_name: string; last_name: string; assigned_staff_id: string | null; deleted_at: string | null } | null;
};

const FEED_DAYS = 7;
const FEED_LIMIT = 8;

// Overview card for admins: the latest texts and emails guests sent in,
// who they're from, which salesperson they belong to, and when.
export async function GuestMessagesFeed() {
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "admin" || !(await isCrmEnabled(staff.organizationId))) return null;

  const admin = createSupabaseAdminClient();
  const org = await getCrmOrg(staff.organizationId);
  const since = DateTime.now().minus({ days: FEED_DAYS }).toUTC().toISO()!;
  const [{ data }, { data: staffRows }] = await Promise.all([
    admin
      .from("crm_messages")
      .select(
        "id, channel, created_at, read_at, contact:crm_contacts!inner ( id, first_name, last_name, assigned_staff_id, deleted_at )",
      )
      .eq("organization_id", staff.organizationId)
      .eq("direction", "inbound")
      .gte("created_at", since)
      .is("contact.deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT)
      .returns<FeedRow[]>(),
    admin.from("staff").select("id, display_name").eq("organization_id", staff.organizationId),
  ]);
  const names = new Map((staffRows ?? []).map((row) => [row.id, row.display_name as string]));
  const rows = (data ?? []).filter((row) => row.contact);
  const unread = rows.filter((row) => !row.read_at).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Guest messages
          {unread > 0 ? <Badge>{unread} new</Badge> : null}
        </CardTitle>
        <CardDescription>Texts and emails guests sent in the last {FEED_DAYS} days.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No guest messages this week.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => {
              const contact = row.contact!;
              const Icon = row.channel === "sms" ? MessageSquare : Mail;
              return (
                <li key={row.id}>
                  <Link
                    href={`/dashboard/guests/${contact.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-muted/50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {row.read_at ? (
                        <span className="h-2 w-2 shrink-0" />
                      ) : (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-primary" title="Unread" />
                      )}
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className={row.read_at ? "truncate" : "truncate font-medium"}>
                        {row.channel === "sms" ? "Text" : "Email"} from {contact.first_name} {contact.last_name}
                      </span>
                      <span className="hidden truncate text-muted-foreground sm:inline">
                        · {contact.assigned_staff_id ? (names.get(contact.assigned_staff_id) ?? "—") : "Unassigned"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {DateTime.fromISO(row.created_at).setZone(org.timezone).toFormat("LLL d, h:mm a")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
