"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type StaffOption = {
  id: string;
  display_name: string;
};

type StaffSelectProps = {
  staffOptions: StaffOption[];
  staffId: string | null;
};

export function StaffSelect({ staffOptions, staffId }: StaffSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());

    if (event.target.value) {
      params.set("staffId", event.target.value);
    } else {
      params.delete("staffId");
    }

    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
      Viewing as
      <select
        value={staffId ?? ""}
        onChange={handleChange}
        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950"
      >
        <option value="">Select your name...</option>
        {staffOptions.map((staff) => (
          <option key={staff.id} value={staff.id}>
            {staff.display_name}
          </option>
        ))}
      </select>
    </label>
  );
}
