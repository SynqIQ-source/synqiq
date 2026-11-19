import type { Metadata } from "next";
import { findUnsubscribe } from "@/lib/email/newsletters";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

// The unsubscribe link at the bottom of every newsletter.
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const row = token === "test" ? null : await findUnsubscribe(token);

  let content: React.ReactNode;
  if (token === "test") content = <p>This is the unsubscribe link from a test email. In a real newsletter it unsubscribes the person.</p>;
  else if (!row) content = <p>This unsubscribe link isn&apos;t valid. If you keep getting emails, reply to one and ask to be removed.</p>;
  else if (done === "1" || row.unsubscribed_at)
    content = (
      <p>
        You&apos;re unsubscribed. <strong>{row.studioName}</strong> won&apos;t send newsletters to {row.email as string} anymore.
        You&apos;ll still get emails about your account, like receipts and booking confirmations.
      </p>
    );
  else
    content = (
      <form method="post" action={`/api/unsubscribe/${encodeURIComponent(token)}?page=1`} className="space-y-4">
        <p>
          Stop newsletters and promotions from <strong>{row.studioName}</strong> to {row.email as string}?
        </p>
        <button type="submit" className="h-11 rounded-lg bg-neutral-900 px-5 font-medium text-white">
          Unsubscribe
        </button>
      </form>
    );

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-neutral-900">
      <h1 className="mb-4 text-2xl font-semibold">Email preferences</h1>
      {content}
    </main>
  );
}
