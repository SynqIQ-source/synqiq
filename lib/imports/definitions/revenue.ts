import { createHash } from "crypto";
import type {
  ColumnDef,
  ImportContext,
  ImportDefinition,
  ResolveRowResult,
  TypedRowValues,
} from "@/lib/imports/types";

// Mindbody's "Rev. per Visit" is only a stable, real per-visit fact for
// capped/fixed-count packages (PT packs, Pilates packs, single sessions,
// day passes). For uncapped/unlimited plans it's (monthly fee / visits so
// far in the member's current billing cycle), recalculated and
// back-applied to every visit row in that cycle each time the report is
// pulled -- not a stable per-visit fact. Detection rule, validated against
// real export data: the "Visits Rem." column. Under 1000 = a real
// fixed-count package. Tens/hundreds of thousands = Mindbody's placeholder
// range for "no real limit." The Pricing Option name string is NOT a
// reliable signal for this (confirmed inconsistent -- e.g. "PT 60 16PK"
// ranges $90-$110 across different real clients), so it's also never used
// as a static price lookup: the per-row Rev. per Visit value is always the
// source of truth for capped rows.
export const CAPPED_VISITS_THRESHOLD = 1000;

export type RevenueRow = {
  date_of_service: string;
  staff_id: string | null;
  staff_name_raw: string;
  client_name: string;
  class_name: string | null;
  pricing_option: string | null;
  visits_remaining: number;
  // NULL = excluded from attribution (uncapped, visits_remaining >=
  // CAPPED_VISITS_THRESHOLD). A real number (including 0) = a trusted,
  // as-reported figure from a capped row -- never derived/looked-up.
  revenue_amount: number | null;
};

type StaffMatch = { id: string; displayName: string };

export type RevenueContext = {
  staffByName: Map<string, StaffMatch[]>;
};

const COLUMNS: ColumnDef[] = [
  {
    field: "date_of_service",
    label: "Date",
    // The real export's header is literally "Date", not "Date Of
    // Service" -- confirmed against a real pulled file. "Date Of Service"
    // kept as a fallback candidate only, in case a different report
    // variant ever labels it that way (matches instructor_reviews'
    // already-confirmed header for the same underlying concept).
    sourceHeaders: ["Date", "Date Of Service"],
    required: true,
    type: "date",
  },
  {
    field: "staff_name",
    label: "Staff",
    sourceHeaders: ["Staff"],
    // Cell-level: soft, not strict -- an unmatched or blank staff name
    // resolves to a null staff_id rather than failing the row (see
    // resolveRow below). Header-level: still expected to exist in the
    // file, via requireHeader.
    required: false,
    requireHeader: true,
    type: "string",
  },
  {
    field: "client_name",
    label: "Client",
    sourceHeaders: ["Client"],
    required: true,
    type: "string",
  },
  {
    field: "visits_remaining",
    label: "Visits Rem.",
    sourceHeaders: ["Visits Rem.", "Visits Rem", "Visits Remaining"],
    required: true,
    type: "smallint",
  },
  {
    field: "rev_per_visit",
    label: "Rev. per Visit",
    sourceHeaders: ["Rev. per Visit", "Rev per Visit", "Revenue per Visit"],
    required: true,
    type: "number",
  },
  {
    field: "pricing_option",
    label: "Pricing Option",
    sourceHeaders: ["Pricing Option"],
    required: false,
    type: "string",
  },
  // Same uncertainty this pipeline has not yet been run against a real
  // exported file for -- kept optional with multiple candidate headers,
  // same pattern as instructor_reviews' analogous service_name column.
  {
    field: "class_name",
    label: "Class",
    sourceHeaders: ["Class", "Service", "Service Name", "Class Name"],
    required: false,
    type: "string",
  },
];

async function loadContext(ctx: ImportContext): Promise<RevenueContext> {
  const { data, error } = await ctx.supabase
    .from("staff")
    .select("id, display_name")
    .eq("organization_id", ctx.organizationId);

  if (error) {
    throw new Error(`Failed to load staff roster: ${error.message}`);
  }

  const staffByName = new Map<string, StaffMatch[]>();
  for (const row of data ?? []) {
    const key = row.display_name.trim().toLowerCase();
    const list = staffByName.get(key) ?? [];
    list.push({ id: row.id, displayName: row.display_name });
    staffByName.set(key, list);
  }

  return { staffByName };
}

function resolveRow(
  values: TypedRowValues,
  _ctx: ImportContext,
  extra: RevenueContext,
): ResolveRowResult<RevenueRow> {
  const staffNameRaw = (values.staff_name as string | null) ?? "";
  const clientName = values.client_name as string;
  const visitsRemaining = values.visits_remaining as number;
  const revPerVisit = values.rev_per_visit as number;
  const pricingOption = (values.pricing_option as string | null) ?? null;
  const className = (values.class_name as string | null) ?? null;

  if (visitsRemaining < 0) {
    return {
      errors: [
        { column: "Visits Rem.", message: `Visits Rem. cannot be negative (got ${visitsRemaining}).` },
      ],
    };
  }

  // Soft match, unlike ratings/reviews' strict staff resolution -- an
  // unmatched or blank staff name does not fail the row. Revenue
  // attribution's value is the per-visit dollar figure itself; losing
  // that over one unresolved name would be a worse outcome here than for
  // reviews, where staff attribution IS the entire point of the row. This
  // also matches the real live Sales by Rep report, where a large
  // "Not Assigned" bucket is normal, legitimate data, not an error --
  // and the nullable staff_id already in the schema.
  const matches = extra.staffByName.get(staffNameRaw.trim().toLowerCase()) ?? [];
  const staffId = matches.length === 1 ? matches[0].id : null;

  const revenueAmount = visitsRemaining < CAPPED_VISITS_THRESHOLD ? revPerVisit : null;

  return {
    row: {
      date_of_service: values.date_of_service as string,
      staff_id: staffId,
      staff_name_raw: staffNameRaw,
      client_name: clientName,
      class_name: className,
      pricing_option: pricingOption,
      visits_remaining: visitsRemaining,
      revenue_amount: revenueAmount,
    },
  };
}

function computeRowHash(row: RevenueRow, ctx: ImportContext, values: TypedRowValues): string {
  // Hashes the raw, pre-attribution Rev. per Visit value (values.rev_per_visit),
  // not row.revenue_amount -- row.revenue_amount is null for uncapped rows,
  // and if CAPPED_VISITS_THRESHOLD is ever revisited, a row's attribution
  // could flip on re-import. Hashing the untouched source value means
  // dedup identity never reshuffles just because the threshold changed.
  const rawRevPerVisit = values.rev_per_visit as number;

  const fingerprint = [
    "revenue",
    ctx.organizationId,
    row.date_of_service,
    row.staff_name_raw.trim().toLowerCase(),
    row.client_name.trim().toLowerCase(),
    (row.class_name ?? "").trim().toLowerCase(),
    (row.pricing_option ?? "").trim().toLowerCase(),
    row.visits_remaining,
    rawRevPerVisit,
  ].join("|");

  return createHash("sha256").update(fingerprint).digest("hex");
}

type ZeroRevenueCappedRow = {
  date_of_service: string;
  staff_name_raw: string;
  client_name: string;
  pricing_option: string | null;
};

// Neither of these is a validation error -- both are expected, legitimate
// data shapes under the all-or-nothing contract, so this never blocks an
// import. excludedUncappedCount is a pure data-quality/coverage caveat.
// zeroRevenueCappedRows is more than that: a $0 row on a package that
// should carry real value is a real audit signal for an unapproved
// comp/trade, not just noise -- see conversation history re: the UI phase
// making this list sortable/filterable by staff and client so a repeated
// pattern is easy to spot, not a buried footnote.
function computeWarnings(rows: RevenueRow[]): Record<string, unknown> | null {
  const excludedUncappedCount = rows.filter((row) => row.revenue_amount === null).length;

  const zeroRevenueCappedRows: ZeroRevenueCappedRow[] = rows
    .filter((row) => row.revenue_amount === 0)
    .map((row) => ({
      date_of_service: row.date_of_service,
      staff_name_raw: row.staff_name_raw,
      client_name: row.client_name,
      pricing_option: row.pricing_option,
    }));

  if (excludedUncappedCount === 0 && zeroRevenueCappedRows.length === 0) {
    return null;
  }

  return {
    excludedUncappedCount,
    zeroRevenueCappedCount: zeroRevenueCappedRows.length,
    zeroRevenueCappedRows,
  };
}

export const REVENUE_DEFINITION: ImportDefinition<RevenueRow, RevenueContext> = {
  reportType: "revenue",
  table: "revenue_line_items",
  columns: COLUMNS,
  loadContext,
  resolveRow,
  computeRowHash,
  computeWarnings,
};
