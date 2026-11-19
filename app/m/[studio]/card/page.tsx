import { redirect } from "next/navigation";

// Moved into the member app's Wallet tab (cards, purchase history, agreements).
export default async function MovedToWallet({ params }: { params: Promise<{ studio: string }> }) {
  const { studio } = await params;
  redirect(`/m/${encodeURIComponent(studio)}/wallet`);
}
