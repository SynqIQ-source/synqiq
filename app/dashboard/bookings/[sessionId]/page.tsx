import { notFound, redirect } from "next/navigation";

// Old link: the class page takes SynqIQ calendar ids too.
export default async function BookingSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) notFound();
  redirect(`/dashboard/classes/${sessionId}`);
}
