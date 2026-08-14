"use client";

import { useEffect, useState } from "react";

export type DepartmentRow = { id: string; name: string };

type Instructor = { id: string; display_name: string };
type EligibilityRow = { staff_id: string; class_name: string; enabled: boolean };

type LoadStatus = "idle" | "loading" | "loaded" | "error";
type ToggleStatus = "idle" | "saving" | "error";

export function EligibilityTable({ departments }: { departments: DepartmentRow[] }) {
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [className, setClassName] = useState("");
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [classNames, setClassNames] = useState<string[]>([]);
  const [eligibility, setEligibility] = useState<EligibilityRow[]>([]);
  const [toggleState, setToggleState] = useState<Record<string, { status: ToggleStatus; error?: string }>>({});

  useEffect(() => {
    if (!departmentId) return;

    let cancelled = false;
    setLoadStatus("loading");
    setLoadError(null);
    setClassName("");

    fetch(`/api/instructor-eligibility?departmentId=${departmentId}`)
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setLoadStatus("error");
          setLoadError(data?.error ?? "Failed to load eligibility data.");
          return;
        }
        setInstructors(data.instructors ?? []);
        setClassNames(data.classNames ?? []);
        setEligibility(data.eligibility ?? []);
        setLoadStatus("loaded");
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadStatus("error");
        setLoadError(error instanceof Error ? error.message : "Failed to load eligibility data.");
      });

    return () => {
      cancelled = true;
    };
  }, [departmentId]);

  function isEnabled(staffId: string) {
    return eligibility.some((row) => row.staff_id === staffId && row.class_name === className && row.enabled);
  }

  async function toggle(staffId: string, nextEnabled: boolean) {
    setToggleState((prev) => ({ ...prev, [staffId]: { status: "saving" } }));

    try {
      const response = await fetch("/api/instructor-eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, departmentId, className, enabled: nextEnabled }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        setToggleState((prev) => ({
          ...prev,
          [staffId]: { status: "error", error: result?.error ?? "Failed to save." },
        }));
        return;
      }

      setEligibility((prev) => {
        const withoutThisRow = prev.filter(
          (row) => !(row.staff_id === staffId && row.class_name === className),
        );
        return [...withoutThisRow, { staff_id: staffId, class_name: className, enabled: nextEnabled }];
      });
      setToggleState((prev) => ({ ...prev, [staffId]: { status: "idle" } }));
    } catch (error) {
      setToggleState((prev) => ({
        ...prev,
        [staffId]: { status: "error", error: error instanceof Error ? error.message : "Failed to save." },
      }));
    }
  }

  const eligibleCount = className
    ? instructors.filter((instructor) => isEnabled(instructor.id)).length
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 rounded-lg border border-zinc-200 bg-white p-4">
        <label className="block text-sm font-medium text-zinc-700">
          Department
          <select
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            className="mt-1 block w-64 rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
          >
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium text-zinc-700">
          Class name
          <input
            list="eligibility-class-names"
            value={className}
            onChange={(event) => setClassName(event.target.value)}
            disabled={loadStatus === "loading"}
            placeholder="Pick or type a class name"
            className="mt-1 block w-64 rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
          />
          <datalist id="eligibility-class-names">
            {classNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
      </div>

      {loadStatus === "loading" && <p className="text-sm text-zinc-500">Loading...</p>}
      {loadStatus === "error" && <p className="text-sm text-red-600">{loadError}</p>}

      {loadStatus === "loaded" && !className && (
        <p className="text-sm text-zinc-500">
          Pick or type a class name above to see and toggle who gets notified for it.
        </p>
      )}

      {loadStatus === "loaded" && className && (
        <div className="overflow-x-auto rounded-lg border">
          <div className="border-b bg-zinc-50 px-4 py-2 text-xs text-zinc-600">
            {eligibleCount === 0 ? (
              <span className="font-medium text-amber-700">
                No instructors are eligible for &quot;{className}&quot; in this department -- a substitution
                request for it will notify no one.
              </span>
            ) : (
              <span>
                {eligibleCount} instructor{eligibleCount === 1 ? "" : "s"} eligible for &quot;{className}&quot;.
              </span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                <th className="p-3 text-left">Instructor</th>
                <th className="p-3 text-left">Eligible</th>
              </tr>
            </thead>
            <tbody>
              {instructors.length === 0 ? (
                <tr>
                  <td className="p-6 text-center text-sm text-zinc-500" colSpan={2}>
                    No instructors found.
                  </td>
                </tr>
              ) : (
                instructors.map((instructor) => {
                  const enabled = isEnabled(instructor.id);
                  const rowToggleState = toggleState[instructor.id]?.status ?? "idle";

                  return (
                    <tr key={instructor.id} className="border-b">
                      <td className="p-3 text-zinc-950">{instructor.display_name}</td>
                      <td className="p-3">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={rowToggleState === "saving"}
                            onChange={(event) => toggle(instructor.id, event.target.checked)}
                            className="h-4 w-4 rounded border-zinc-300"
                          />
                          {rowToggleState === "saving" && (
                            <span className="text-xs text-zinc-500">Saving...</span>
                          )}
                          {rowToggleState === "error" && (
                            <span className="text-xs text-red-600">{toggleState[instructor.id]?.error}</span>
                          )}
                        </label>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
