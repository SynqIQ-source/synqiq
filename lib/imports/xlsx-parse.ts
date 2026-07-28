import * as XLSX from "xlsx";

export type ParsedSheet = {
  headers: string[];
  // Keyed by the exact header text found in the file (not the internal
  // field name) -- pipeline.ts does the header-to-field matching.
  rows: Record<string, string>[];
};

function cellToString(value: unknown): string {
  if (value instanceof Date) {
    // Local calendar date, not value.toISOString() -- cellDates gives a Date
    // at local midnight for a date-only cell, and toISOString() shifts that
    // back a day in any timezone behind UTC.
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

export function parseSpreadsheet(buffer: ArrayBuffer): ParsedSheet {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("The uploaded file has no sheets.");
  }

  const sheet = workbook.Sheets[firstSheetName];

  // header: 1 returns raw arrays-of-cells per row so header matching is done
  // explicitly in pipeline.ts, rather than trusting SheetJS's own
  // object-key inference (which silently mangles duplicate/blank headers).
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });

  if (raw.length === 0) {
    throw new Error("The uploaded file is empty.");
  }

  const headers = raw[0].map((cell) => cellToString(cell));

  const rows = raw.slice(1).map((rowArray) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cellToString(rowArray[index]);
    });
    return row;
  });

  return { headers, rows };
}
