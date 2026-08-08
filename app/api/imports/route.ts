import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { getScopedClient } from "@/lib/supabase/scoped";
import { parseAndValidate } from "@/lib/imports/pipeline";
import { RATINGS_REVIEWS_DEFINITION } from "@/lib/imports/definitions/ratings-reviews";
import { REVENUE_DEFINITION } from "@/lib/imports/definitions/revenue";
import { PAYROLL_DEFINITION } from "@/lib/imports/definitions/payroll";
import type { ImportDefinition } from "@/lib/imports/types";

// Keyed by reportType so adding the next one is adding an entry here, not
// new route logic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each definition has its own Row/ExtraCtx generics, intentionally erased at this registry boundary
const DEFINITIONS: Record<string, ImportDefinition<any, any>> = {
  ratings_reviews: RATINGS_REVIEWS_DEFINITION,
  revenue: REVENUE_DEFINITION,
  payroll: PAYROLL_DEFINITION,
};

const ALLOWED_EXTENSIONS = [".xlsx", ".xls", ".csv"];
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const currentStaff = await getCurrentStaff();

    if (!currentStaff || currentStaff.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Only an authenticated admin can import reports." },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const reportType = formData.get("reportType");
    const file = formData.get("file");

    if (typeof reportType !== "string" || !DEFINITIONS[reportType]) {
      return NextResponse.json(
        { success: false, error: `Unsupported report type "${String(reportType)}".` },
        { status: 400 },
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "file is required." }, { status: 400 });
    }

    const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!hasAllowedExtension) {
      return NextResponse.json(
        { success: false, error: `Unsupported file "${file.name}". Use .xlsx, .xls, or .csv.` },
        { status: 400 },
      );
    }

    if (file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json({ success: false, error: "File must be 10MB or smaller." }, { status: 400 });
    }

    const definition = DEFINITIONS[reportType];
    const supabase = await getScopedClient(currentStaff);
    const buffer = await file.arrayBuffer();

    const result = await parseAndValidate(definition, buffer, {
      organizationId: currentStaff.organizationId,
      supabase,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, rowErrors: result.rowErrors },
        { status: 422 },
      );
    }

    // Non-blocking, informational -- computed from the full row set before
    // anything is written. Neither an excluded (uncapped) row nor a
    // zero-revenue (capped) row is a validation failure, so this never
    // changes whether the import proceeds.
    const warnings = definition.computeWarnings?.(result.rows) ?? null;

    // Nothing is written until validation has fully passed -- a rejected
    // file leaves no trace (no storage object, no audit row), matching the
    // all-or-nothing contract literally.
    const storagePath = `${currentStaff.organizationId}/${reportType}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("report-imports")
      .upload(storagePath, buffer, { contentType: file.type || "application/octet-stream" });

    if (uploadError) {
      throw new Error(`Failed to store uploaded file: ${uploadError.message}`);
    }

    const batchId = randomUUID();

    const { error: batchInsertError } = await supabase.from("report_imports").insert({
      id: batchId,
      organization_id: currentStaff.organizationId,
      report_type: reportType,
      uploaded_by_staff_id: currentStaff.id,
      filename: file.name,
      storage_path: storagePath,
      row_count: result.rows.length,
      inserted_count: 0,
      duplicate_count: 0,
      status: "success",
      warnings_summary: warnings,
    });

    if (batchInsertError) {
      throw new Error(`Failed to record import batch: ${batchInsertError.message}`);
    }

    try {
      const rowsToInsert = result.rows.map(({ rowHash, ...row }) => ({
        ...row,
        organization_id: currentStaff.organizationId,
        import_batch_id: batchId,
        row_hash: rowHash,
      }));

      // ON CONFLICT (organization_id, row_hash) DO NOTHING -- re-uploading
      // the same file (or a file that overlaps a prior one) is a no-op for
      // rows already imported. Rows that conflict are excluded from the
      // RETURNING set, so data.length is exactly the number newly inserted.
      const { data: insertedRows, error: insertError } = await supabase
        .from(definition.table)
        .upsert(rowsToInsert, { onConflict: "organization_id,row_hash", ignoreDuplicates: true })
        .select("id");

      if (insertError) {
        throw new Error(insertError.message);
      }

      const insertedCount = insertedRows?.length ?? 0;
      const duplicateCount = result.rows.length - insertedCount;

      await supabase
        .from("report_imports")
        .update({ inserted_count: insertedCount, duplicate_count: duplicateCount })
        .eq("id", batchId);

      return NextResponse.json({
        success: true,
        summary: { rowCount: result.rows.length, insertedCount, duplicateCount, warnings },
      });
    } catch (error) {
      await supabase
        .from("report_imports")
        .update({
          status: "failed",
          error_summary: { message: error instanceof Error ? error.message : "Unknown error" },
        })
        .eq("id", batchId);
      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
