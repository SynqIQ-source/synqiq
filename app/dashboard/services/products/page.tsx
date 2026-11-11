import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { ComingSoon } from "../coming-soon";

// Services & Pricing -> Products & Inventory (placeholder until the POS
// build).
export default async function ProductsPage() {
  await requireAccess(isClubAdmin);
  return (
    <DashboardShell title="Products & Inventory" description="Retail items sold at the front desk: drinks, bars, apparel and more.">
      <ComingSoon
        note="Built with SynqIQ's POS. Until then products are set up and sold in Mindbody."
        items={[
          "Create products with price, tax, category and barcode (scanned with the Honeywell Orbit at the desk).",
          "Stock counts, low-stock alerts and receiving new inventory.",
          "Bring in Mindbody's current products and their barcodes.",
          "Sales by product in reports.",
        ]}
      />
    </DashboardShell>
  );
}
