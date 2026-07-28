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
  required: boolean;
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
  computeRowHash: (row: Row, ctx: ImportContext) => string;
};
