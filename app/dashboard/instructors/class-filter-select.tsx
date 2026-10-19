"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Radix Select can't use "" as an item value, so "no filter" is a sentinel.
const ALL = "__all__";

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
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={selectedDepartmentId || ALL}
        onValueChange={(value) => updateParams({ department: value === ALL ? undefined : value, class: undefined })}
      >
        <SelectTrigger aria-label="Department" className="min-w-[170px] bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All departments</SelectItem>
          {departments.map((department) => (
            <SelectItem key={department.id} value={department.id}>
              {department.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={selectedClassName || ALL}
        onValueChange={(value) => updateParams({ class: value === ALL ? undefined : value })}
      >
        <SelectTrigger aria-label="Class" className="min-w-[170px] bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All classes</SelectItem>
          {classOptions.map((className) => (
            <SelectItem key={className} value={className}>
              {className}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
