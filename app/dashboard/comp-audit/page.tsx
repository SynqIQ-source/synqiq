import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient, type ScopedSupabaseClient } from "@/lib/supabase/scoped";
import { CAPPED_VISITS_THRESHOLD } from "@/lib/imports/definitions/revenue";
import { CompAuditTable, type CompRow } from "./comp-audit-table";

const PAGE_SIZE = 1000;

type RawCompRow = {
  id: string;
  date_of_service: string;
  staff_id: string | null;
  client_name: string;
  pricing_option: string | null;
  class_name: string | null;
  staff: { display_name: string } | { display_name: string }[] | null;
};

function staffDisplayName(staff: RawCompRow["staff"]): string {
  if (!staff) return "Not Assigned";
  return Array.isArray(staff) ? (staff[0]?.display_name ?? "Not Assigned") : staff.display_name;
}

// Same 1000-row PostgREST page cap and .range() pagination loop already
// used across this app's other full-table reads (Instructor Analytics,
// Trainer Health) -- comp/promo rows should be rare, but nothing here
// assumes that.
async function getZeroRevenueCappedRows(supabase: ScopedSupabaseClient): Promise<CompRow[]> {
  const allRows: RawCompRow[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("revenue_line_items")
      .select(
        "id, date_of_service, staff_id, client_name, pricing_option, class_name, staff:staff_id(display_name)",
      )
      .eq("revenue_amount", 0)
      .lt("visits_remaining", CAPPED_VISITS_THRESHOLD)
      .order("date_of_service", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<RawCompRow[]>();

    if (error) {
      throw new Error(`Failed to load comp/promo rows: ${error.message}`);
    }

    allRows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows.map((row) => ({
    id: row.id,
    dateOfService: row.date_of_service,
    staffName: staffDisplayName(row.staff),
    clientName: row.client_name,
    pricingOption: row.pricing_option,
    className: row.class_name,
  }));
}

export default async function CompAuditPage() {
  const currentStaff = await getCurrentStaff();

  if (!currentStaff || currentStaff.role !== "admin") {
    redirect("/dashboard");
  }

  const supabase = await getScopedClient(currentStaff);
  const rows = await getZeroRevenueCappedRows(supabase);

  return (
    <DashboardShell
      title="Comp Audit"
      description="Every imported revenue row showing $0 on a package that should carry real value -- a real signal for an unapproved comp or trade, not just a data-quality note. Sort or filter by staff or client to spot a repeated pattern."
    >
      <CompAuditTable rows={rows} />
    </DashboardShell>
  );
}
