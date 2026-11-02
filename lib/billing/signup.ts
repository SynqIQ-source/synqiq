import type Stripe from "stripe";
import { getStripe, planPriceId } from "@/lib/billing/stripe";
import { createStudio, StudioError, type NewStudio } from "@/lib/platform/studios";
import { isModuleKey, type ModuleKey } from "@/lib/plans";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Self-serve signup: save the studio's details, send the owner to Stripe
// Checkout, and create the studio once Stripe says it's paid. Creating it
// is safe to call from both the success page and the webhook: the signup
// row is claimed first, so only one of them ever creates the studio.

export async function startSignup(
  studio: NewStudio,
  urls: { origin: string },
): Promise<{ checkoutUrl: string }> {
  if (studio.modules.length === 0) throw new StudioError("Pick at least one module.");
  const admin = createSupabaseAdminClient();

  // A login can belong to only one studio, so an existing one can't own a new studio.
  const { data: existing } = await admin.from("staff").select("id").ilike("email", studio.owner.email).not("auth_user_id", "is", null).limit(1);
  if (existing?.length) {
    throw new StudioError(`${studio.owner.email} already has a SynqIQ login. Use a different email for the new studio's owner.`);
  }
  if (studio.mindbodySiteId !== null) {
    const { data: taken } = await admin.from("organizations").select("id").eq("mindbody_site_id", studio.mindbodySiteId).maybeSingle();
    if (taken) throw new StudioError("That Mindbody site is already on SynqIQ. Talk to us if this is your studio.");
  }

  const { data: signup, error } = await admin
    .from("studio_signups")
    .insert({
      name: studio.name,
      timezone: studio.timezone,
      mindbody_site_id: studio.mindbodySiteId,
      modules: studio.modules,
      owner_first_name: studio.owner.firstName,
      owner_last_name: studio.owner.lastName,
      owner_email: studio.owner.email,
      terms_accepted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer_email: studio.owner.email,
    line_items: [{ price: await planPriceId(studio.modules), quantity: 1 }],
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    client_reference_id: signup.id,
    subscription_data: { metadata: { synqiq_signup_id: signup.id } },
    metadata: { synqiq_signup_id: signup.id },
    success_url: `${urls.origin}/signup/done?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${urls.origin}/signup?canceled=1`,
  });
  await admin.from("studio_signups").update({ checkout_session_id: session.id }).eq("id", signup.id);
  if (!session.url) throw new Error("Stripe didn't return a checkout page.");
  return { checkoutUrl: session.url };
}

export type ProvisionResult =
  | { status: "provisioned"; organizationId: string; ownerEmail: string; invited: boolean }
  | { status: "unpaid" }
  | { status: "not_found" };

// Creates the studio for a completed checkout (once).
export async function provisionCheckout(sessionId: string, inviteRedirect: string): Promise<ProvisionResult> {
  const admin = createSupabaseAdminClient();
  const session: Stripe.Checkout.Session = await getStripe().checkout.sessions.retrieve(sessionId);
  const signupId = session.client_reference_id;
  if (!signupId) return { status: "not_found" };
  const { data: signup } = await admin.from("studio_signups").select("*").eq("id", signupId).maybeSingle();
  if (!signup) return { status: "not_found" };
  if (signup.status === "provisioned" && signup.organization_id) {
    return { status: "provisioned", organizationId: signup.organization_id, ownerEmail: signup.owner_email, invited: true };
  }
  if (session.status !== "complete" || (session.payment_status !== "paid" && session.payment_status !== "no_payment_required")) {
    return { status: "unpaid" };
  }

  // Claim it, so a webhook arriving at the same moment doesn't also create it.
  const { data: claimed } = await admin
    .from("studio_signups")
    .update({ status: "provisioning" })
    .eq("id", signupId)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) {
    const { data: again } = await admin.from("studio_signups").select("status, organization_id, owner_email").eq("id", signupId).single();
    return again?.organization_id
      ? { status: "provisioned", organizationId: again.organization_id, ownerEmail: again.owner_email, invited: true }
      : { status: "unpaid" };
  }

  try {
    const modules = (signup.modules as string[]).filter(isModuleKey) as ModuleKey[];
    const result = await createStudio(
      {
        name: signup.name,
        timezone: signup.timezone,
        mindbodySiteId: signup.mindbody_site_id,
        modules,
        owner: { firstName: signup.owner_first_name, lastName: signup.owner_last_name, email: signup.owner_email },
      },
      inviteRedirect,
    );
    await admin
      .from("organizations")
      .update({
        stripe_customer_id: typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
        stripe_subscription_id:
          typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null),
        billing_status: "active",
      })
      .eq("id", result.organizationId);
    await admin
      .from("studio_signups")
      .update({
        status: "provisioned",
        organization_id: result.organizationId,
        provisioned_at: new Date().toISOString(),
        error: result.inviteError,
      })
      .eq("id", signupId);
    return { status: "provisioned", organizationId: result.organizationId, ownerEmail: signup.owner_email, invited: result.invited };
  } catch (error) {
    await admin
      .from("studio_signups")
      .update({ status: "failed", error: error instanceof Error ? error.message : String(error) })
      .eq("id", signupId);
    throw error;
  }
}
