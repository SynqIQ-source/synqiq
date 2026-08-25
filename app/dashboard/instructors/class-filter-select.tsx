"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ClassFilterSelectProps = {
  departments: { id: string; name: string }[];
  classNamesByDepartment: Record<string, string[]>;
  allClassNames: string[];
  selectedDepartmentId: string;
  selectedClassName: string;
};

// Cascading department -> class name filter, same searchParams-driven shape
// as ./range-select.tsx. Picking a department narrows the class dropdown to
// that department's classes and clears any class selection that no longer
// applies; leaving department on "All departments" lets the class dropdown
// list every class studio-wide, since a specific class name (e.g. "Sculpt")
// already implies its department well enough on its own.
export function ClassFilterSelect({
  departments,
  classNamesByDepartment,
  allClassNames,
  selectedDepartmentId,
  selectedClassName,
}: ClassFilterSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(next).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    router.push(`${pathname}?${params.toString()}`);
  }

  const classOptions = selectedDepartmentId
    ? classNamesByDepartment[selectedDepartmentId] ?? []
    : allClassNames;

  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Class type
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <select
          value={selectedDepartmentId}
          onChange={(event) =>
            updateParams({ department: event.target.value || undefined, class: undefined })
          }
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
        >
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>

        <select
          value={selectedClassName}
          onChange={(event) => updateParams({ class: event.target.value || undefined })}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
        >
          <option value="">All classes</option>
          {classOptions.map((className) => (
            <option key={className} value={className}>
              {className}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
