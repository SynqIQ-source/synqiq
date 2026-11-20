import { getStripe } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStudioStripeAccount, stripeLivemode } from "@/lib/payments/connect";

// Card readers at the desk: Stripe Terminal smart readers, server-driven
// (SynqIQ sends the payment to the reader over the internet, so any browser
// works, iPads included). Direct charges in the studio's own Stripe account,
// like every other studio payment. In test mode a simulated reader stands in
// and "taps" a Stripe test card; real cards never go through a test reader.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type ReaderRow = { id: string; label: string; deviceType: string | null; stripeReaderId: string; livemode: boolean };

export async function studioReaders(admin: Admin, organizationId: string): Promise<ReaderRow[]> {
  const { data } = await admin
    .from("terminal_readers")
    .select("id, label, device_type, stripe_reader_id, livemode")
    .eq("organization_id", organizationId)
    .eq("livemode", stripeLivemode())
    .is("removed_at", null)
    .order("created_at");
  return (data ?? []).map((row) => ({
    id: row.id as string,
    label: row.label as string,
    deviceType: (row.device_type as string | null) ?? null,
    stripeReaderId: row.stripe_reader_id as string,
    livemode: Boolean(row.livemode),
  }));
}

export type LocationAddress = { line1: string; city: string; state: string; postalCode: string };

// Registers a reader with the code it shows (Settings > Readers), or Stripe's
// simulated reader in test mode ("simulated-wpe").
export async function registerReader(
  organizationId: string,
  staffId: string,
  input: { code: string; label: string; address: LocationAddress | null },
): Promise<{ error: string } | { reader: ReaderRow }> {
  const admin = createSupabaseAdminClient();
  const account = await getStudioStripeAccount(admin, organizationId);
  if (!account?.ready) return { error: "Connect the studio's Stripe account first (Settings > Payments)." };
  if (input.code === "simulated-wpe" && account.livemode) return { error: "Simulated readers are for test mode only." };
  const stripe = getStripe();
  const options = { stripeAccount: account.stripeAccountId };
  const { data: existing } = await admin
    .from("terminal_readers")
    .select("stripe_location_id")
    .eq("organization_id", organizationId)
    .eq("livemode", account.livemode)
    .limit(1);
  let locationId = (existing?.[0]?.stripe_location_id as string | undefined) ?? null;
  try {
    if (!locationId) {
      if (!input.address) return { error: "Enter the studio's street address for the first reader." };
      const { data: org } = await admin.from("organizations").select("name").eq("id", organizationId).maybeSingle();
      const location = await stripe.terminal.locations.create(
        {
          display_name: (org?.name as string | null) ?? "Studio",
          address: {
            line1: input.address.line1,
            city: input.address.city,
            state: input.address.state,
            postal_code: input.address.postalCode,
            country: "US",
          },
        },
        options,
      );
      locationId = location.id;
    }
    const reader = await stripe.terminal.readers.create(
      { registration_code: input.code, label: input.label, location: locationId },
      options,
    );
    const { data: row, error } = await admin
      .from("terminal_readers")
      .insert({
        organization_id: organizationId,
        livemode: account.livemode,
        stripe_account_id: account.stripeAccountId,
        stripe_location_id: locationId,
        stripe_reader_id: reader.id,
        label: input.label,
        device_type: reader.device_type,
        serial_number: reader.serial_number,
        registered_by_staff_id: staffId,
      })
      .select("id, label, device_type, stripe_reader_id, livemode")
      .single();
    if (error || !row) return { error: "The reader was added in Stripe but not saved here. Try again." };
    return {
      reader: {
        id: row.id as string,
        label: row.label as string,
        deviceType: (row.device_type as string | null) ?? null,
        stripeReaderId: row.stripe_reader_id as string,
        livemode: Boolean(row.livemode),
      },
    };
  } catch (error) {
    console.error("[terminal] register failed:", error);
    return { error: error instanceof Error ? error.message : "Stripe didn't accept that code." };
  }
}

export async function removeReader(organizationId: string, readerId: string) {
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("terminal_readers")
    .select("stripe_reader_id, stripe_account_id")
    .eq("id", readerId)
    .eq("organization_id", organizationId)
    .is("removed_at", null)
    .maybeSingle();
  if (!row) return { error: "Reader not found." };
  try {
    await getStripe().terminal.readers.del(row.stripe_reader_id as string, {}, { stripeAccount: row.stripe_account_id as string });
  } catch (error) {
    console.error("[terminal] delete in Stripe failed (removing here anyway):", error);
  }
  await admin.from("terminal_readers").update({ removed_at: new Date().toISOString() }).eq("id", readerId);
  return { success: true };
}

async function paymentWithReader(admin: Admin, organizationId: string, paymentId: string) {
  const { data } = await admin
    .from("pos_card_payments")
    .select("id, payment_intent_id, stripe_account_id, stripe_reader_id, status, livemode")
    .eq("id", paymentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data;
}

// Sends a started card payment (startCardPayment with terminal) to the reader.
export async function sendToReader(organizationId: string, paymentId: string, readerId: string) {
  const admin = createSupabaseAdminClient();
  const [payment, { data: reader }] = await Promise.all([
    paymentWithReader(admin, organizationId, paymentId),
    admin
      .from("terminal_readers")
      .select("stripe_reader_id, stripe_account_id")
      .eq("id", readerId)
      .eq("organization_id", organizationId)
      .is("removed_at", null)
      .maybeSingle(),
  ]);
  if (!payment?.payment_intent_id || payment.status !== "pending") return { error: "Payment not found." };
  if (!reader || reader.stripe_account_id !== payment.stripe_account_id) return { error: "Reader not found." };
  try {
    await getStripe().terminal.readers.processPaymentIntent(
      reader.stripe_reader_id as string,
      { payment_intent: payment.payment_intent_id as string },
      { stripeAccount: reader.stripe_account_id as string },
    );
    await admin.from("pos_card_payments").update({ stripe_reader_id: reader.stripe_reader_id }).eq("id", paymentId);
    return { success: true };
  } catch (error) {
    console.error("[terminal] process failed:", error);
    return { error: error instanceof Error ? error.message : "The reader didn't respond. Check it's on and online." };
  }
}

// What the reader is doing with the payment, for the checkout screen.
export async function readerPaymentStatus(organizationId: string, paymentId: string) {
  const admin = createSupabaseAdminClient();
  const payment = await paymentWithReader(admin, organizationId, paymentId);
  if (!payment?.payment_intent_id || !payment.stripe_reader_id) return { error: "Payment not found." };
  const stripe = getStripe();
  const options = { stripeAccount: payment.stripe_account_id as string };
  const [intent, reader] = await Promise.all([
    stripe.paymentIntents.retrieve(payment.payment_intent_id as string, {}, options),
    stripe.terminal.readers.retrieve(payment.stripe_reader_id as string, {}, options),
  ]);
  const action = "action" in reader ? reader.action : null;
  return {
    paid: intent.status === "succeeded",
    status: intent.status,
    readerStatus: action?.status ?? null,
    failure: action?.status === "failed" ? (action.failure_message ?? "The card was declined.") : null,
  };
}

// Test mode only: the simulated reader "taps" a Stripe test card.
export async function simulateTap(organizationId: string, paymentId: string) {
  const admin = createSupabaseAdminClient();
  const payment = await paymentWithReader(admin, organizationId, paymentId);
  if (!payment?.stripe_reader_id) return { error: "Payment not found." };
  if (payment.livemode) return { error: "Only in test mode." };
  await getStripe().testHelpers.terminal.readers.presentPaymentMethod(
    payment.stripe_reader_id as string,
    {},
    { stripeAccount: payment.stripe_account_id as string },
  );
  return { success: true };
}

// Cancel on the reader (staff pressed Cancel) and the payment with it.
export async function cancelReaderPayment(organizationId: string, paymentId: string) {
  const admin = createSupabaseAdminClient();
  const payment = await paymentWithReader(admin, organizationId, paymentId);
  if (!payment?.stripe_reader_id) return { success: true };
  const options = { stripeAccount: payment.stripe_account_id as string };
  try {
    await getStripe().terminal.readers.cancelAction(payment.stripe_reader_id as string, {}, options);
  } catch {
    // Nothing in progress on the reader.
  }
  return { success: true };
}
