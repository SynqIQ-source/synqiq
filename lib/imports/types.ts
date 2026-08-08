import type { ScopedSupabaseClient } from "@/lib/supabase/scoped";

export type ColumnType = "string" | "number" | "smallint" | "date";

export type ColumnDef = {
  field: string;
  // Shown to the admin in error messages -- the label from the source
  // report, not the internal field name (e.g. "Date Of Service", not
  // "date_of_service").
  label: string;
  // Accepted header spellings for this column, matched case-insensitively --
  // exports rename columns often enough that a single fixed string is too
  // brittle.
  sourceHeaders: string[];
  // Cell-level: an empty value in this column fails the row. Also drives
  // header-level enforcement UNLESS requireHeader overrides it below.
  required: boolean;
  // Header-level only, independent of `required` above -- for a column
  // whose header should exist but whose per-row value may legitimately be
  // blank (e.g. revenue's Staff column: a blank/unmatched name resolves to
  // a null FK rather than failing the row, but the file should still be
  // expected to have a Staff column at all). Defaults to `required` when
  // omitted, so every existing column definition is unaffected.
  requireHeader?: boolean;
  type: ColumnType;
};

export type TypedRowValues = Record<string, string | number | null>;

export type RowError = {
  // 1-based counting the header row as row 1, so "row 2" is the first data
  // row -- matches what an admin sees when they open the source file.
  row: number;
  column?: string;
  message: string;
};

export type ImportContext = {
  organizationId: string;
  supabase: ScopedSupabaseClient;
};

export type ResolveRowResult<Row> =
  | { row: Row }
  | { errors: { message: string; column?: string }[] };

// ExtraCtx is loaded once per import (e.g. the org's staff roster), not
// re-fetched per row -- resolveRow itself stays synchronous so a large file
// doesn't turn into hundreds of per-row queries.
export type ImportDefinition<Row extends Record<string, unknown>, ExtraCtx> = {
  reportType: string;
  table: string;
  columns: ColumnDef[];
  loadContext: (ctx: ImportContext) => Promise<ExtraCtx>;
  resolveRow: (values: TypedRowValues, ctx: ImportContext, extra: ExtraCtx) => ResolveRowResult<Row>;
  // Takes the row's typed-but-pre-resolution values too, not just the
  // resolved Row -- lets a definition hash a raw source value (e.g.
  // revenue's Rev. per Visit) that a derived Row field may null out
  // without needing to smuggle that raw value into the Row shape, which
  // must exactly match the destination table's insertable columns.
  computeRowHash: (row: Row, ctx: ImportContext, values: TypedRowValues) => string;
  // Non-blocking, informational summary computed from the full set of
  // successfully-resolved rows, before insert -- e.g. revenue's excluded
  // (uncapped) and zero-revenue (capped) row counts. Never used to fail
  // an import; surfaced in the API response and persisted to
  // report_imports.warnings_summary. Omitted (undefined) means no
  // warnings computation for this report type.
  computeWarnings?: (rows: Row[]) => Record<string, unknown> | null;
};
