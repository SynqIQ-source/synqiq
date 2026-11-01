import { notFound, redirect } from "next/navigation";
import { DateTime } from "luxon";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentStaff } from "@/lib/current-staff";
import { guessCounts, type ItemKind } from "@/lib/mindbody/item-types";
import { getScopedClient } from "@/lib/supabase/scoped";
import { ItemList, type ItemRow } from "./item-list";

export const dynamic = "force-dynamic";

// Settings -> Mindbody items (admins): which Mindbody contracts count as a
// membership (New Members) and which items sold are PT (Trainer Health).
// Names appear here as the syncs see them, each pre-set by a guess from its
// name; an admin's tick overrides the guess.
export default async function MindbodyItemsPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "admin") notFound();

  const supabase = await getScopedClient(staff);
  const { data, error } = await supabase
    .from("mindbody_item_types")
    .select("kind, name, counts, last_seen_at")
    .order("name");
  if (error) throw new Error("Failed to load Mindbody items.");

  const rows = (kind: ItemKind): ItemRow[] =>
    (data ?? [])
      .filter((row) => row.kind === kind)
      .map((row) => {
        const guess = guessCounts(kind, row.name);
        return {
          name: row.name,
          counts: row.counts ?? guess,
          guessed: row.counts === null,
          lastSeen: DateTime.fromISO(row.last_seen_at).toFormat("LLL d, yyyy"),
        };
      });

  return (
    <DashboardShell
      title="Mindbody items"
      description="Which Mindbody contracts are memberships, and which items sold are personal training."
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Memberships</CardTitle>
            <CardDescription>
              Ticked contracts count as a membership on New Members. A new member is someone whose ticked contract
              starts and who has never had one, or whose last one ended over 90 days before (shown as Returning).
              Automatic 12-month resells and re-signing within 90 days don&apos;t count. Contracts appear here as
              Synq sees them on new members.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ItemList kind="contract" rows={rows("contract")} empty="No contracts seen yet." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Personal training</CardTitle>
            <CardDescription>
              Ticked items are PT on Trainer Health: each PT sale is credited to the trainer who completed the most
              sessions with that client in the 90 days after it. Items appear here from the nightly sales sync.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ItemList kind="sale_item" rows={rows("sale_item")} empty="No items sold seen yet." />
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
