import { createHash } from "crypto";
import type {
  ColumnDef,
  ImportContext,
  ImportDefinition,
  ResolveRowResult,
  TypedRowValues,
} from "@/lib/imports/types";

// Built against "Payroll Export Setup" (Reports > Payroll Export Setup),
// not the human-readable "Payroll" report -- the latter has three
// incompatible row shapes per pay type (class, appointment/PT, hourly)
// and doesn't fit this codebase's one-flat-table-per-ImportDefinition
// pattern. The export report gives one uniform shape instead, verified
// against a real 472-row July pull. See migration
// 20260807180000_payroll_line_items_columns.sql for the fuller rationale,
// including why Personal Training/Hourly rows collapsing to a single
// lump row per instructor per period is expected, not a data gap.
export type PayrollRow = {
  staff_id: string | null;
  staff_name_raw: string;
  class_name: string;
  class_date: string | null;
  weekday: string | null;
  start_time: string | null;
  end_time: string | null;
  students: number | null;
  earnings_amt: number;
  file_number: string | null;
  program_code: string | null;
};

type StaffMatch = { id: string; displayName: string };

export type PayrollContext = {
  staffByName: Map<string, StaffMatch[]>;
};

const COLUMNS: ColumnDef[] = [
  {
    field: "staff_name",
    label: "Emp Name",
    sourceHeaders: ["Emp Name"],
    // Cell-level: soft, not strict -- an unmatched or blank name resolves
    // to a null staff_id rather than failing the row (see resolveRow
    // below), same convention as revenue_line_items. Header-level: still
    // expected to exist in the file.
    required: false,
    requireHeader: true,
    type: "string",
  },
  {
    field: "class_name",
    label: "Class Name",
    // The real file's header has a doubled internal space ("Class  Name")
    // -- confirmed against the actual literal file, not just on-screen
    // rendering. Single-space kept as the primary candidate in case a
    // future export normalizes it.
    sourceHeaders: ["Class Name", "Class  Name"],
    required: true,
    type: "string",
  },
  {
    field: "class_date",
    label: "Class Date",
    sourceHeaders: ["Class Date", "Class  Date"],
    required: false,
    type: "date",
  },
  {
    field: "weekday",
    label: "Weekday",
    sourceHeaders: ["Weekday"],
    required: false,
    type: "string",
  },
  {
    field: "start_time",
    label: "Start time",
    sourceHeaders: ["Start time", "Start Time"],
    required: false,
    type: "string",
  },
  {
    field: "end_time",
    label: "End time",
    sourceHeaders: ["End time", "End Time"],
    required: false,
    type: "string",
  },
  {
    field: "students",
    label: "Students",
    sourceHeaders: ["Students"],
    required: false,
    type: "smallint",
  },
  {
    field: "earnings_amt",
    label: "Earnings Amt",
    sourceHeaders: ["Earnings Amt", "Earnings Amount"],
    required: true,
    type: "number",
  },
  {
    field: "file_number",
    label: "File Number",
    sourceHeaders: ["File Number"],
    required: false,
    type: "string",
  },
  {
    field: "program_code",
    label: "Program Code",
    sourceHeaders: ["Program Code"],
    required: false,
    type: "string",
  },
];

async function loadContext(ctx: ImportContext): Promise<PayrollContext> {
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
  extra: PayrollContext,
): ResolveRowResult<PayrollRow> {
  const staffNameRaw = (values.staff_name as string | null) ?? "";

  // Soft match, same convention as revenue_line_items -- an unmatched or
  // blank staff name does not fail the row. payroll_line_items is a "what
  // did we actually pay" finance record; losing a row over one unresolved
  // name would be a worse outcome than leaving staff_id null.
  const matches = extra.staffByName.get(staffNameRaw.trim().toLowerCase()) ?? [];
  const staffId = matches.length === 1 ? matches[0].id : null;

  return {
    row: {
      staff_id: staffId,
      staff_name_raw: staffNameRaw,
      class_name: values.class_name as string,
      class_date: (values.class_date as string | null) ?? null,
      weekday: (values.weekday as string | null) ?? null,
      start_time: (values.start_time as string | null) ?? null,
      end_time: (values.end_time as string | null) ?? null,
      students: (values.students as number | null) ?? null,
      earnings_amt: values.earnings_amt as number,
      file_number: (values.file_number as string | null) ?? null,
      program_code: (values.program_code as string | null) ?? null,
    },
  };
}

function computeRowHash(row: PayrollRow, ctx: ImportContext): string {
  // Accepted limitation for lump-sum rows (Personal Training/Hourly Pay,
  // where class_date/start_time/end_time/students are all null): there's
  // no period identifier in the hash beyond earnings_amt itself, so two
  // different periods coincidentally producing the exact same dollar
  // total for the same person would collide and dedupe as if it were a
  // re-upload. Not engineered around -- an exact coincidence like that is
  // vanishingly unlikely, and the same value (colliding on a real
  // re-upload) is the whole point of row_hash.
  const fingerprint = [
    "payroll",
    ctx.organizationId,
    row.staff_name_raw.trim().toLowerCase(),
    row.class_name.trim().toLowerCase(),
    row.class_date ?? "",
    row.start_time ?? "",
    row.end_time ?? "",
    row.students ?? "",
    row.earnings_amt,
  ].join("|");

  return createHash("sha256").update(fingerprint).digest("hex");
}

export const PAYROLL_DEFINITION: ImportDefinition<PayrollRow, PayrollContext> = {
  reportType: "payroll",
  table: "payroll_line_items",
  columns: COLUMNS,
  loadContext,
  resolveRow,
  computeRowHash,
};
