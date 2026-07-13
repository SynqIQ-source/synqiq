import { DashboardShell } from "@/components/dashboard-shell";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export default function DashboardPage() {
  return (
    <DashboardShell
      title="Overview"
      description="A starting point for studio health, upcoming coverage needs, and operational alerts."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <PlaceholderPanel
          title="Classes"
          description="Class sync status and upcoming schedule data will appear here."
        />
        <PlaceholderPanel
          title="Instructors"
          description="Instructor availability and staff records will be connected here."
        />
        <PlaceholderPanel
          title="Substitutions"
          description="Substitution requests and coverage workflows will be added here."
        />
      </div>
    </DashboardShell>
  );
}
