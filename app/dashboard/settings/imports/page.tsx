import { redirect } from "next/navigation";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { ImportForm } from "./import-form";

type WarningsSummary = {
  excludedUncappedCount?: number;
  zeroRevenueCappedCount?: number;
} | null;

type ImportBatch = {
  id: string;
  report_type: string;
  filename: string;
  row_count: number;
  inserted_count: number;
  duplicate_count: number;
  status: string;
  created_at: string;
  warnings_summary: WarningsSummary;
  staff: { display_name: string } | { display_name: string }[] | null;
};

function uploaderName(staff: ImportBatch["staff"]): string {
  if (!staff) return "Unknown";
  return Array.isArray(staff) ? (staff[0]?.display_name ?? "Unknown") : staff.display_name;
}

export default async function ImportsPage() {
  const currentStaff = await getCurrentStaff();

  // Real page-level guard, same as /dashboard/settings -- this page writes
  // data (imports rows into real tables), so a non-admin hitting an RLS
  // rejection on submit is a worse dead end than not landing here at all.
  if (!currentStaff || currentStaff.role !== "admin") {
    redirect("/dashboard");
  }

  const supabase = await getScopedClient(currentStaff);
  const { data: batches, error } = await supabase
    .from("report_imports")
    .select(
      "id, report_type, filename, row_count, inserted_count, duplicate_count, status, created_at, warnings_summary, staff:uploaded_by_staff_id(display_name)",
    )
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<ImportBatch[]>();

  if (error) {
    throw new Error(`Failed to load import history: ${error.message}`);
  }

  return (
    <DashboardShell
      title="Imports"
      description="Upload dashboard-only Mindbody reports (ratings & reviews, revenue, payroll) that have no API sync."
    >
      <div className="flex flex-col gap-8">
        <ImportForm />

        <section>
          <h2 className="text-sm font-semibold text-zinc-950">Recent imports</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-zinc-500">
                  <th className="p-3 text-left">Uploaded</th>
                  <th className="p-3 text-left">Report</th>
                  <th className="p-3 text-left">File</th>
                  <th className="p-3 text-left">By</th>
                  <th className="p-3 text-right">Rows</th>
                  <th className="p-3 text-right">Inserted</th>
                  <th className="p-3 text-right">Duplicates</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Warnings</th>
                </tr>
              </thead>
              <tbody>
                {(batches ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-sm text-zinc-500">
                      No imports yet.
                    </td>
                  </tr>
                ) : (
                  (batches ?? []).map((batch) => {
                    const zeroRevenueCappedCount = batch.warnings_summary?.zeroRevenueCappedCount ?? 0;
                    const excludedUncappedCount = batch.warnings_summary?.excludedUncappedCount ?? 0;

                    return (
                      <tr key={batch.id} className="border-b">
                        <td className="p-3 text-zinc-600">{new Date(batch.created_at).toLocaleString()}</td>
                        <td className="p-3 text-zinc-950">{batch.report_type}</td>
                        <td className="p-3 text-zinc-600">{batch.filename}</td>
                        <td className="p-3 text-zinc-600">{uploaderName(batch.staff)}</td>
                        <td className="p-3 text-right">{batch.row_count}</td>
                        <td className="p-3 text-right">{batch.inserted_count}</td>
                        <td className="p-3 text-right">{batch.duplicate_count}</td>
                        <td className="p-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              batch.status === "success"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-red-50 text-red-700"
                            }`}
                          >
                            {batch.status}
                          </span>
                        </td>
                        <td className="p-3">
                          {zeroRevenueCappedCount > 0 ? (
                            <Link
                              href="/dashboard/comp-audit"
                              className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 underline"
                            >
                              {zeroRevenueCappedCount} $0 comp{zeroRevenueCappedCount === 1 ? "" : "s"}
                            </Link>
                          ) : excludedUncappedCount > 0 ? (
                            <span className="text-xs text-zinc-500">
                              {excludedUncappedCount} excluded (uncapped)
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-400">--</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
