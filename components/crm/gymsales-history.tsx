import { DateTime } from "luxon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";

const KIND_LABELS: Record<string, string> = { call: "Call", sms: "Text", email: "Email" };

// A lead's calls (with notes), texts and emails from Gym Sales, before
// SynqIQ. Read-only history from the report import.
export async function GymSalesHistory({
  supabase,
  contactIds,
  timezone,
}: {
  supabase: ScopedSupabaseClient;
  contactIds: string[];
  timezone: string;
}) {
  const { data } = await supabase
    .from("crm_imported_activity")
    .select("id, kind, direction, occurred_at, outcome, body, subject, sent_by_name, next_action")
    .in("contact_id", contactIds)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (!data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gym Sales history</CardTitle>
        <CardDescription>Calls, texts and emails from Gym Sales (imported), newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="max-h-[32rem] space-y-3 overflow-y-auto">
          {data.map((item) => (
            <li key={item.id as string} className="border-l-2 pl-3 text-sm">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {KIND_LABELS[item.kind as string] ?? item.kind}
                  {item.direction === "inbound" ? " from them" : ""}
                </span>
                {" · "}
                {DateTime.fromISO(item.occurred_at as string)
                  .setZone(timezone)
                  .toFormat("LLL d, yyyy h:mm a")}
                {item.outcome ? ` · ${item.outcome}` : ""}
                {item.sent_by_name ? ` · ${item.sent_by_name}` : ""}
              </p>
              {item.subject ? <p className="font-medium">{item.subject as string}</p> : null}
              {item.body ? <p className="line-clamp-6 whitespace-pre-wrap">{item.body as string}</p> : null}
              {item.next_action ? <p className="text-xs text-muted-foreground">Next: {item.next_action as string}</p> : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
