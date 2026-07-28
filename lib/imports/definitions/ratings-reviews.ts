import { createHash } from "crypto";
import type { ColumnDef, ImportContext, ImportDefinition, ResolveRowResult, TypedRowValues } from "@/lib/imports/types";

export type ReviewRow = {
  date_of_service: string;
  staff_id: string;
  staff_name_raw: string;
  client_name: string;
  service_name: string | null;
  rating: number;
  review_text: string | null;
  helpful_count: number;
  not_helpful_count: number;
};

type StaffMatch = { id: string; displayName: string };

export type RatingsReviewsContext = {
  staffByName: Map<string, StaffMatch[]>;
};

const COLUMNS: ColumnDef[] = [
  {
    field: "date_of_service",
    label: "Date Of Service",
    sourceHeaders: ["Date Of Service", "Date of Service"],
    required: true,
    type: "date",
  },
  {
    field: "staff_name",
    label: "Staff",
    sourceHeaders: ["Staff"],
    required: true,
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
    field: "rating",
    label: "Rating",
    sourceHeaders: ["Rating"],
    required: true,
    type: "smallint",
  },
  {
    field: "review_text",
    label: "Review",
    sourceHeaders: ["Review"],
    required: false,
    type: "string",
  },
  {
    field: "helpful_count",
    label: "Helpful",
    sourceHeaders: ["Helpful"],
    required: false,
    type: "smallint",
  },
  {
    field: "not_helpful_count",
    label: "Not Helpful",
    sourceHeaders: ["Not Helpful"],
    required: false,
    type: "smallint",
  },
  // Not present as its own column in every export we've confirmed (the live
  // dashboard report shows it as a group header above the table, not a
  // per-row cell) -- kept optional so ingestion works whether or not the
  // real exported file flattens it into a column. See conversation history:
  // this pipeline has not yet been run against a real exported file.
  {
    field: "service_name",
    label: "Service",
    sourceHeaders: ["Service", "Service Name", "Service Category"],
    required: false,
    type: "string",
  },
];

async function loadContext(ctx: ImportContext): Promise<RatingsReviewsContext> {
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
  extra: RatingsReviewsContext,
): ResolveRowResult<ReviewRow> {
  const staffNameRaw = values.staff_name as string;
  const rating = values.rating as number;

  const matches = extra.staffByName.get(staffNameRaw.trim().toLowerCase()) ?? [];

  if (matches.length === 0) {
    return {
      errors: [{ column: "Staff", message: `No staff member found matching "${staffNameRaw}".` }],
    };
  }

  if (matches.length > 1) {
    return {
      errors: [
        {
          column: "Staff",
          message: `"${staffNameRaw}" matches more than one staff member -- can't resolve automatically.`,
        },
      ],
    };
  }

  if (rating < 1 || rating > 5) {
    return {
      errors: [{ column: "Rating", message: `Rating must be between 1 and 5 (got ${rating}).` }],
    };
  }

  return {
    row: {
      date_of_service: values.date_of_service as string,
      staff_id: matches[0].id,
      staff_name_raw: staffNameRaw,
      client_name: values.client_name as string,
      service_name: (values.service_name as string | null) ?? null,
      rating,
      review_text: (values.review_text as string | null) ?? null,
      helpful_count: (values.helpful_count as number | null) ?? 0,
      not_helpful_count: (values.not_helpful_count as number | null) ?? 0,
    },
  };
}

function computeRowHash(row: ReviewRow, ctx: ImportContext): string {
  const fingerprint = [
    "ratings_reviews",
    ctx.organizationId,
    row.date_of_service,
    row.staff_id,
    row.client_name.trim().toLowerCase(),
    row.rating,
    (row.review_text ?? "").trim().toLowerCase(),
    row.helpful_count,
    row.not_helpful_count,
  ].join("|");

  return createHash("sha256").update(fingerprint).digest("hex");
}

export const RATINGS_REVIEWS_DEFINITION: ImportDefinition<ReviewRow, RatingsReviewsContext> = {
  reportType: "ratings_reviews",
  table: "instructor_reviews",
  columns: COLUMNS,
  loadContext,
  resolveRow,
  computeRowHash,
};
