import { DashboardShell } from "@/components/dashboard-shell";

type MindbodyClass = {
  ClassScheduleId: string | number;
  ClassDescription?: {
    Name?: string;
  };
  StartDateTime?: string;
  Staff?: {
    Name?: string;
    FirstName?: string;
  };
  MaxCapacity?: number;
  TotalBooked?: number;
};

type ClassesResponse = {
  Classes?: MindbodyClass[];
};

async function getClasses() {
  const response = await fetch(
    "http://localhost:3000/api/mindbody/classes",
    {
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error("Failed to load classes");
  }

  return response.json() as Promise<ClassesResponse>;
}

function getFillRate(totalBooked = 0, maxCapacity = 0) {
  if (maxCapacity <= 0) {
    return 0;
  }

  return Math.round((totalBooked / maxCapacity) * 100);
}

export default async function ClassesPage() {
  const data = await getClasses();

  return (
    <DashboardShell
      title="Classes"
      description="Live Mindbody class schedule data."
    >
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-3 text-left">Internal ID</th>
              <th className="p-3 text-left">Class</th>
              <th className="p-3 text-left">Start Time</th>
              <th className="p-3 text-left">Instructor</th>
              <th className="p-3 text-right">Capacity</th>
              <th className="p-3 text-right">Booked</th>
              <th className="p-3 text-right">Fill Rate</th>
            </tr>
          </thead>
          <tbody>
            {data.Classes?.map((cls) => {
              const capacity = cls.MaxCapacity ?? 0;
              const booked = cls.TotalBooked ?? 0;
              const fillRate = getFillRate(booked, capacity);

              return (
                <tr key={cls.ClassScheduleId} className="border-b">
                  <td className="p-3 font-mono text-xs text-zinc-500">
                    {cls.ClassScheduleId}
                  </td>
                  <td className="p-3">
                    {cls.ClassDescription?.Name ?? "Unknown"}
                  </td>
                  <td className="p-3">
                    {cls.StartDateTime
                      ? new Date(cls.StartDateTime).toLocaleString()
                      : "N/A"}
                  </td>
                  <td className="p-3">
                    {cls.Staff?.Name ?? cls.Staff?.FirstName ?? "Unassigned"}
                  </td>
                  <td className="p-3 text-right">{capacity}</td>
                  <td className="p-3 text-right">{booked}</td>
                  <td className="p-3 text-right">{fillRate}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
