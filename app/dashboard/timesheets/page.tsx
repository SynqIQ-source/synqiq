import { redirect } from "next/navigation";

// Timesheets moved under Payroll; keep old links and bookmarks working.
export default async function OldTimesheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  const query = params.toString();
  redirect(`/dashboard/payroll/timesheets${query ? `?${query}` : ""}`);
}
