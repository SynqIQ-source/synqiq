import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { canCheckout, isClubAdmin } from "@/lib/permissions";
import { cancelReaderPayment, readerPaymentStatus, registerReader, removeReader, simulateTap } from "@/lib/payments/terminal";

// Desk card readers (Stripe Terminal). Club Admins register / remove readers;
// anyone at checkout follows a payment on a reader (status, cancel, and in
// test mode a simulated tap).
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !canCheckout(staff)) return fail("Not allowed.", 403);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const org = staff.organizationId;
  const respond = (result: Record<string, unknown>) =>
    "error" in result ? fail(String(result.error)) : NextResponse.json({ success: true, ...result });

  if (body?.action === "register" || body?.action === "remove") {
    if (!isClubAdmin(staff)) return fail("Club Admins only.", 403);
    if (body.action === "remove")
      return respond(UUID.test(String(body.id)) ? await removeReader(org, String(body.id)) : { error: "Reader not found." });
    const code = typeof body.code === "string" ? body.code.trim().slice(0, 100) : "";
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 60) : "";
    if (!code || !label) return fail("Enter the code on the reader's screen and a name for it.");
    const address = body.address && typeof body.address === "object" ? (body.address as Record<string, unknown>) : null;
    const clean = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 120) : "");
    return respond(
      await registerReader(org, staff.id, {
        code,
        label,
        address:
          address && clean(address.line1)
            ? { line1: clean(address.line1), city: clean(address.city), state: clean(address.state), postalCode: clean(address.postalCode) }
            : null,
      }),
    );
  }

  const paymentId = typeof body?.paymentId === "string" && UUID.test(body.paymentId) ? body.paymentId : null;
  if (!paymentId) return fail("Payment not found.");
  if (body?.action === "status") return respond(await readerPaymentStatus(org, paymentId));
  if (body?.action === "simulate") return respond(await simulateTap(org, paymentId));
  if (body?.action === "cancel") return respond(await cancelReaderPayment(org, paymentId));
  return fail("Unknown action.");
}
