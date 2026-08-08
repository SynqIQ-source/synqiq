import { parseSpreadsheet } from "./xlsx-parse";
import type { ColumnDef, ImportContext, ImportDefinition, RowError, TypedRowValues } from "./types";

export type ParseAndValidateResult<Row> =
  | { success: true; rows: (Row & { rowHash: string })[] }
  | { success: false; error: string; rowErrors?: RowError[] };

function findHeaderKey(headers: string[], sourceHeaders: string[]): string | null {
  const normalizedHeaders = headers.map((header) => header.toLowerCase());
  for (const candidate of sourceHeaders) {
    const index = normalizedHeaders.indexOf(candidate.toLowerCase());
    if (index !== -1) {
      return headers[index];
    }
  }
  return null;
}

function coerceValue(
  raw: string,
  column: ColumnDef,
  rowNumber: number,
): { value: string | number | null; error?: RowError } {
  const trimmed = raw.trim();

  if (trimmed === "") {
    if (column.required) {
      return {
        value: null,
        error: { row: rowNumber, column: column.label, message: `${column.label} is required.` },
      };
    }
    return { value: null };
  }

  if (column.type === "string") {
    return { value: trimmed };
  }

  if (column.type === "date") {
    // xlsx-parse normalizes true Excel date cells to YYYY-MM-DD, but CSV
    // (and any text-formatted cell) has no cell types at all -- it arrives
    // as plain text. The live report itself renders dates as US-style
    // M/D/YYYY (e.g. "9/16/2025", confirmed on screen), so that's the one
    // text format accepted as a fallback.
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return { value: trimmed };
    }

    const usDateMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (usDateMatch) {
      const [, month, day, year] = usDateMatch;
      return { value: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` };
    }

    return {
      value: null,
      error: { row: rowNumber, column: column.label, message: `"${trimmed}" is not a valid date.` },
    };
  }

  // number | smallint
  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return {
      value: null,
      error: { row: rowNumber, column: column.label, message: `"${trimmed}" is not a valid number.` },
    };
  }
  if (column.type === "smallint" && !Number.isInteger(num)) {
    return {
      value: null,
      error: { row: rowNumber, column: column.label, message: `"${trimmed}" must be a whole number.` },
    };
  }
  return { value: num };
}

// Parses, validates, and resolves every row in the file against `definition`.
// All-or-nothing: any header-level or row-level problem aborts the whole
// file with the full list of problems -- nothing is written by this
// function (it does no I/O beyond definition.loadContext, which is
// read-only), and callers should treat a failure result as "nothing
// happened."
export async function parseAndValidate<Row extends Record<string, unknown>, ExtraCtx>(
  definition: ImportDefinition<Row, ExtraCtx>,
  buffer: ArrayBuffer,
  ctx: ImportContext,
): Promise<ParseAndValidateResult<Row>> {
  let sheet;
  try {
    sheet = parseSpreadsheet(buffer);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to parse file." };
  }

  const headerKeyByField = new Map<string, string>();
  const missingRequiredColumns: string[] = [];

  for (const column of definition.columns) {
    const headerKey = findHeaderKey(sheet.headers, column.sourceHeaders);
    if (headerKey) {
      headerKeyByField.set(column.field, headerKey);
    } else if (column.requireHeader ?? column.required) {
      missingRequiredColumns.push(column.label);
    }
  }

  if (missingRequiredColumns.length > 0) {
    return {
      success: false,
      error: `The file is missing required column(s): ${missingRequiredColumns.join(", ")}.`,
    };
  }

  if (sheet.rows.length === 0) {
    return { success: false, error: "The file has a header row but no data rows." };
  }

  const extra = await definition.loadContext(ctx);

  const rowErrors: RowError[] = [];
  const resolvedRows: (Row & { rowHash: string })[] = [];

  sheet.rows.forEach((rawRow, index) => {
    const rowNumber = index + 2; // +1 for 1-based, +1 for the header row
    const values: TypedRowValues = {};
    let hasCoercionError = false;

    for (const column of definition.columns) {
      const headerKey = headerKeyByField.get(column.field);
      const raw = headerKey ? (rawRow[headerKey] ?? "") : "";
      const { value, error } = coerceValue(raw, column, rowNumber);
      values[column.field] = value;
      if (error) {
        rowErrors.push(error);
        hasCoercionError = true;
      }
    }

    if (hasCoercionError) {
      return;
    }

    const resolved = definition.resolveRow(values, ctx, extra);
    if ("errors" in resolved) {
      for (const error of resolved.errors) {
        rowErrors.push({ row: rowNumber, column: error.column, message: error.message });
      }
      return;
    }

    const rowHash = definition.computeRowHash(resolved.row, ctx, values);
    resolvedRows.push({ ...resolved.row, rowHash });
  });

  if (rowErrors.length > 0) {
    return {
      success: false,
      error: `${rowErrors.length} row(s) failed validation. Nothing was imported -- fix the file and re-upload.`,
      rowErrors,
    };
  }

  return { success: true, rows: resolvedRows };
}
