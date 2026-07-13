import { DashboardShell } from "@/components/dashboard-shell";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export default function InstructorsPage() {
  return (
    <DashboardShell
      title="Instructors"
      description="Placeholder view for instructor and staff records."
    >
      <PlaceholderPanel
        title="Instructor roster"
        description="Staff profiles, availability, and assignment workflows will be implemented later."
      />
    </DashboardShell>
  );
}
