import { DashboardShell } from "@/components/dashboard-shell";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export default function SubstitutionsPage() {
  return (
    <DashboardShell
      title="Substitutions"
      description="Placeholder view for instructor coverage workflows."
    >
      <PlaceholderPanel
        title="Coverage board"
        description="Substitution matching, approvals, and notifications will be implemented later."
      />
    </DashboardShell>
  );
}
