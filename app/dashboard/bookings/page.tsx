import { redirect } from "next/navigation";

// Bookings now live on the Classes pages (one page per class).
export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  redirect(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `/dashboard/classes?viewMode=day&date=${date}` : "/dashboard/classes");
}
