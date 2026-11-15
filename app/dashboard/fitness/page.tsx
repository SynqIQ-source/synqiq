import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccess } from "@/lib/require-access";
import { isTrainerAccess } from "@/lib/permissions";

// Fitness: the personal-training side of the studio. The dashboard itself
// is still to be designed; for now this points to the fitness pages.
export default async function FitnessDashboardPage() {
  await requireAccess(isTrainerAccess);
  return (
    <DashboardShell title="Fitness Dashboard" description="Personal training at a glance. Coming soon.">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New Members</CardTitle>
            <CardDescription>New members, their trainer and intro session.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/sales/new-members" className="text-sm text-primary underline">
              Open New Members
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Trainer Health</CardTitle>
            <CardDescription>Each trainer&apos;s clients, sessions and packs.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/trainer-health" className="text-sm text-primary underline">
              Open Trainer Health
            </Link>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
