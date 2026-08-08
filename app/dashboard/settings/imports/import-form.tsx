"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type RowError = { row: number; column?: string; message: string };

type RevenueWarnings = {
  excludedUncappedCount: number;
  zeroRevenueCappedCount: number;
};

type SubmitState =
  | { status: "idle" }
  | { status: "uploading" }
  | {
      status: "success";
      summary: {
        rowCount: number;
        insertedCount: number;
        duplicateCount: number;
        warnings: RevenueWarnings | null;
      };
    }
  | { status: "error"; error: string; rowErrors?: RowError[] };

const REPORT_TYPES = [
  { value: "ratings_reviews", label: "Ratings & Reviews", enabled: true },
  { value: "revenue", label: "Revenue", enabled: true },
  { value: "payroll", label: "Payroll", enabled: true },
];

export function ImportForm() {
  const router = useRouter();
  const [reportType, setReportType] = useState("ratings_reviews");
  const [state, setState] = useState<SubmitState>({ status: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setState({ status: "uploading" });

    try {
      const formData = new FormData();
      formData.append("reportType", reportType);
      formData.append("file", file);

      const response = await fetch("/api/imports", { method: "POST", body: formData });
      const result = await response.json();

      if (!response.ok || !result.success) {
        setState({ status: "error", error: result.error ?? "Import failed.", rowErrors: result.rowErrors });
        return;
      }

      setState({ status: "success", summary: result.summary });
      router.refresh();
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-lg border border-zinc-200 bg-white p-6"
    >
      <h2 className="text-sm font-semibold text-zinc-950">Upload a report</h2>

      <div className="flex flex-wrap gap-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-zinc-700">Report type</legend>
          <div className="flex flex-col gap-1.5">
            {REPORT_TYPES.map((type) => (
              <label
                key={type.value}
                className={`flex items-center gap-2 text-sm ${
                  type.enabled ? "text-zinc-700" : "text-zinc-400"
                }`}
              >
                <input
                  type="radio"
                  name="reportType"
                  value={type.value}
                  checked={reportType === type.value}
                  disabled={!type.enabled}
                  onChange={(event) => setReportType(event.target.value)}
                />
                {type.label}
                {!type.enabled && (
                  <span className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[0.65rem] font-medium text-zinc-400">
                    Coming soon
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-zinc-700" htmlFor="import-file">
            File (.xlsx, .xls, .csv)
          </label>
          <input
            ref={fileInputRef}
            id="import-file"
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={state.status === "uploading"}
            className="text-sm"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={state.status === "uploading"}
        className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {state.status === "uploading" ? "Uploading..." : "Upload"}
      </button>

      {state.status === "success" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-emerald-700">
            Imported {state.summary.insertedCount} of {state.summary.rowCount} row(s)
            {state.summary.duplicateCount > 0
              ? ` (${state.summary.duplicateCount} already imported, skipped)`
              : ""}
            .
          </p>

          {state.summary.warnings && state.summary.warnings.excludedUncappedCount > 0 && (
            <p className="text-sm text-zinc-600">
              {state.summary.warnings.excludedUncappedCount} row(s) were on an uncapped/unlimited
              plan and excluded from revenue attribution -- Rev. per Visit isn&apos;t a stable
              per-visit fact for those.
            </p>
          )}

          {state.summary.warnings && state.summary.warnings.zeroRevenueCappedCount > 0 && (
            <p className="text-sm font-medium text-amber-700">
              {state.summary.warnings.zeroRevenueCappedCount} row(s) show $0 revenue on a package
              that should carry real value -- often an unapproved comp or trade. Review them on the{" "}
              <Link href="/dashboard/comp-audit" className="underline">
                Comp Audit
              </Link>{" "}
              page.
            </p>
          )}
        </div>
      )}

      {state.status === "error" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-red-600">{state.error}</p>
          {state.rowErrors && state.rowErrors.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-3">
              <ul className="flex flex-col gap-1 text-xs text-red-700">
                {state.rowErrors.map((rowError, index) => (
                  <li key={index}>
                    Row {rowError.row}
                    {rowError.column ? ` (${rowError.column})` : ""}: {rowError.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
