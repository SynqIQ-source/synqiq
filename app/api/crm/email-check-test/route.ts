import { NextResponse } from "next/server";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { checkEmailWithMailgun } from "@/lib/crm/email-check";
import { jsonError, logCrmError } from "@/lib/crm/http";

// Admin "Test Mailgun" button in CRM settings: checks the studio's own
// SynqIQ address (never a guest's) to confirm the key works and email
// validation is on the Mailgun plan.
const TEST_ADDRESS = "info@synqiq.co";

export async function POST() {
  const staff = await getCrmStaffForApi({ adminOnly: true });
  if (!staff) return jsonError("Not found.", 404);

  if (!process.env.MAILGUN_API_KEY) {
    return NextResponse.json({ success: false, error: "MAILGUN_API_KEY isn't set in this deployment." });
  }
  try {
    const outcome = await checkEmailWithMailgun(TEST_ADDRESS);
    return NextResponse.json({ success: true, address: TEST_ADDRESS, status: outcome.status, result: outcome.result.result });
  } catch (error) {
    logCrmError("crm/email-check-test", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const hint = /\b(401)\b/.test(message)
      ? " The key was rejected; check it's a private API key and the region (US/EU) is right."
      : /\b(403)\b/.test(message)
        ? " Email validation probably isn't included on this Mailgun plan."
        : "";
    return NextResponse.json({ success: false, error: `${message}.${hint}` });
  }
}
