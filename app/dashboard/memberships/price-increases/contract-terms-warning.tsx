// Shown wherever increases are scheduled: The Preserve's current membership
// agreements only allow dues to rise for sales-tax changes.
export function ContractTermsWarning() {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      Current membership agreements only allow dues to go up for sales-tax changes, and 12-month memberships renew &quot;at the same
      rate.&quot; Have your attorney review before scheduling or sending notices. New agreements need a price-change clause.
    </div>
  );
}
