import { NextResponse } from "next/server";
import { getCrmStaffForApi } from "@/lib/crm/module";
import { checkEmailWithDns, checkEmailWithMailgun, MailgunUnavailableError } from "@/lib/crm/email-check";
import { jsonError, logCrmError } from "@/lib/crm/http";

// Admin "Test email check" button in CRM settings: checks the studio's own
// SynqIQ address (never a guest's) and reports whether Mailgun validation is
// in use or the built-in fallback is.
const TEST_ADDRESS = "info@synqiq.co";

function unavailableReason(error: MailgunUnavailableError): string {
  if (error.message.includes("not set")) return "MAILGUN_API_KEY isn't set in this deployment";
  if (error.message.includes("401")) return "Mailgun rejected the key (check it's a private API key and the US/EU region)";
  return "email validation isn't included on this Mailgun plan";
}

export async function POST() {
  const staff = await getCrmStaffForApi({ adminOnly: true });
  if (!staff) return jsonError("Not found.", 404);

  try {
    const outcome = await checkEmailWithMailgun(TEST_ADDRESS);
    return NextResponse.json({
      success: true,
      provider: "mailgun",
      message: `Mailgun is working: ${TEST_ADDRESS} came back ${outcome.status} (${outcome.result.result}).`,
    });
  } catch (error) {
    if (error instanceof MailgunUnavailableError) {
      const reason = unavailableReason(error);
      try {
        const outcome = await checkEmailWithDns(TEST_ADDRESS);
        return NextResponse.json({
          success: true,
          provider: "dns",
          message: `Using the built-in check because ${reason}. ${TEST_ADDRESS}: ${
            outcome.result.result === "domain_accepts_mail" ? "domain accepts mail" : "domain can't receive mail"
          }.`,
        });
      } catch {
        return NextResponse.json({ success: false, error: `The built-in check failed too, and ${reason}.` });
      }
    }
    logCrmError("crm/email-check-test", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: `${message}. Try again in a few minutes.` });
  }
}
