import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { isClubAdmin } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cleanDomain, resendDomainStatus } from "@/lib/email/domains";

// Club Admins: the studio's own email domains. Saving a domain doesn't use it;
// "Check" asks Resend and turns it on only once Resend reports it verified
// (with sending, or receiving for the reply domain).
const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !isClubAdmin(staff)) return fail("Club Admins only.", 403);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const admin = createSupabaseAdminClient();
  const org = staff.organizationId;
  const kind = body?.kind === "relay" ? "relay" : "from";
  const column = kind === "relay" ? "email_relay_domain" : "email_from_domain";
  const verifiedColumn = kind === "relay" ? "email_relay_verified_at" : "email_from_verified_at";

  if (body?.action === "save") {
    const raw = typeof body.domain === "string" ? body.domain.trim() : "";
    const domain = raw ? cleanDomain(raw) : null;
    if (raw && !domain) return fail("That doesn't look like a domain (e.g. reply.thepreservehouston.com).");
    if (kind === "relay" && domain && !domain.split(".").slice(0, -2).length)
      return fail("Use a subdomain for replies (e.g. reply.thepreservehouston.com), so your studio's own mailboxes aren't affected.");
    const { error } = await admin
      .from("organizations")
      .update({ [column]: domain, [verifiedColumn]: null })
      .eq("id", org);
    if (error) return fail(error.code === "23505" ? "Another studio already uses that domain." : error.message, 400);
    return NextResponse.json({ success: true });
  }

  if (body?.action === "check") {
    const { data: row } = await admin.from("organizations").select(column).eq("id", org).maybeSingle();
    const domain = (row as Record<string, string | null> | null)?.[column] ?? null;
    if (!domain) return fail("Save a domain first.");
    const status = await resendDomainStatus(domain);
    if ("error" in status) return fail(status.error);
    const ready = status.found && status.status === "verified" && (kind === "relay" ? status.receiving && status.sending : status.sending);
    await admin
      .from("organizations")
      .update({ [verifiedColumn]: ready ? new Date().toISOString() : null })
      .eq("id", org);
    return NextResponse.json({
      success: true,
      ready,
      message: ready
        ? "Verified. SynqIQ uses it from now on."
        : !status.found
          ? "This domain isn't added in Resend yet."
          : status.status !== "verified"
            ? `Resend says "${status.status}". Add the DNS records Resend shows, then check again.`
            : kind === "relay"
              ? "Verified, but receiving isn't turned on for it in Resend."
              : "Verified, but sending isn't turned on for it in Resend.",
    });
  }

  return fail("Unknown action.");
}
