import { DashboardShell } from "@/components/dashboard-shell";
import { requireAccess } from "@/lib/require-access";
import { isClubAdmin } from "@/lib/permissions";
import { ComingSoon } from "../coming-soon";

// Services & Pricing -> Services & Packs (placeholder until the POS and
// pricing build).
export default async function ServicesAndPacksPage() {
  await requireAccess(isClubAdmin);
  return (
    <DashboardShell
      title="Services & Packs"
      description="Session packs and services members buy: personal training, Pilates, Reformer and more."
    >
      <ComingSoon
        note="Built with SynqIQ's POS and pricing. Until then packs are sold in Mindbody, and members' packs and sessions left show on each member's page."
        items={[
          "PT and Pilates packs with prices by trainer level (instead of trainers marking prices down).",
          "Reformer and class packs, drop-ins and intro offers.",
          "Expiration rules (e.g. packs expire after a set time) and what each pack covers.",
          "Which staff can sell each one, and promo codes (Club Admins).",
        ]}
      />
    </DashboardShell>
  );
}
