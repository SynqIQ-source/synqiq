import type { ClubOverview } from "@/lib/dashboard/club";

export const DRILL_VIEWS = ["members", "sales", "checkins", "guests", "maintenance"] as const;
export type DrillView = (typeof DRILL_VIEWS)[number];

// The details under a Club Overview card.
export function ClubDrillDown({ view }: { view: DrillView; data: ClubOverview }) {
  return <p className="text-sm text-muted-foreground">Details for {view} are coming next.</p>;
}
