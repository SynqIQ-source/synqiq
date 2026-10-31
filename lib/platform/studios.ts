import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Adding a studio (platform admins only): the organization, its modules,
// and its owner as an admin who gets an invite email to set a password.
// The Mindbody connection comes after, from the Studios page
// (lib/mindbody/activation.ts).

export const STUDIO_TIMEZONES = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NewStudio = {
  name: string;
  timezone: string;
  mindbodySiteId: number | null;
  crm: boolean;
  owner: { firstName: string; lastName: string; email: string };
};

export class StudioError extends Error {}

export function parseNewStudio(body: Record<string, unknown> | null): NewStudio {
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const name = text(body?.name, 120);
  const timezone = text(body?.timezone, 60);
  const siteRaw = text(body?.mindbodySiteId, 12);
  const owner = (body?.owner ?? {}) as Record<string, unknown>;
  const firstName = text(owner.firstName, 60);
  const lastName = text(owner.lastName, 60);
  const email = text(owner.email, 254).toLowerCase();

  if (!name) throw new StudioError("Enter the studio's name.");
  if (!STUDIO_TIMEZONES.some((zone) => zone.value === timezone)) throw new StudioError("Pick the studio's time zone.");
  if (siteRaw && !/^-?\d{1,10}$/.test(siteRaw)) throw new StudioError("The Mindbody site ID is a number, like 561843.");
  if (!firstName || !lastName) throw new StudioError("Enter the owner's first and last name.");
  if (!EMAIL_PATTERN.test(email)) throw new StudioError("Enter the owner's email address.");
  return {
    name,
    timezone,
    mindbodySiteId: siteRaw ? Number(siteRaw) : null,
    crm: body?.crm === true,
    owner: { firstName, lastName, email },
  };
}

// Creates the studio, then invites its owner. If the invite fails, the
// studio and owner row stay so the invite can be resent from Staff Logins.
export async function createStudio(
  studio: NewStudio,
  inviteRedirect: string,
): Promise<{ organizationId: string; invited: boolean; inviteError: string | null }> {
  const admin = createSupabaseAdminClient();

  if (studio.mindbodySiteId !== null) {
    const { data: taken } = await admin
      .from("organizations")
      .select("name")
      .eq("mindbody_site_id", studio.mindbodySiteId)
      .maybeSingle();
    if (taken) throw new StudioError(`Mindbody site ${studio.mindbodySiteId} already belongs to ${taken.name}.`);
  }

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: studio.name,
      timezone: studio.timezone,
      mindbody_site_id: studio.mindbodySiteId,
      status: "active",
    })
    .select("id")
    .single();
  if (orgError) throw orgError;

  if (studio.crm) {
    const { error } = await admin.from("org_modules").insert({ organization_id: org.id, module: "crm" });
    if (error) throw error;
  }

  const { data: owner, error: ownerError } = await admin
    .from("staff")
    .insert({
      organization_id: org.id,
      first_name: studio.owner.firstName,
      last_name: studio.owner.lastName,
      display_name: `${studio.owner.firstName} ${studio.owner.lastName}`,
      email: studio.owner.email,
      role: "admin",
      can_sell: true,
      active: true,
    })
    .select("id")
    .single();
  if (ownerError) throw ownerError;

  const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(studio.owner.email, {
    redirectTo: inviteRedirect,
  });
  if (inviteError || !invite?.user) {
    const alreadyRegistered = /already been registered|already registered|email address is already/i.test(
      inviteError?.message ?? "",
    );
    return {
      organizationId: org.id,
      invited: false,
      inviteError: alreadyRegistered
        ? `${studio.owner.email} already has a SynqIQ login, and a login can belong to only one studio. Use a different email for this studio's owner from Staff Logins.`
        : (inviteError?.message ?? "The invite email couldn't be sent."),
    };
  }
  const { error: linkError } = await admin.from("staff").update({ auth_user_id: invite.user.id }).eq("id", owner.id);
  if (linkError) throw linkError;
  return { organizationId: org.id, invited: true, inviteError: null };
}
