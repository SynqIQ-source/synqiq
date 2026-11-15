import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/crm/kiosk-auth";
import { isCrmEnabled } from "@/lib/crm/module";
import { rateLimitAll } from "@/lib/crm/rate-limit";
import { jsonError, logCrmError } from "@/lib/crm/http";
import { flattenFields, parseWebLead } from "@/lib/crm/web-leads";
import { saveWebLead } from "@/lib/crm/web-lead-save";
import { spamCheck } from "@/lib/crm/spam";

const MAX_BYTES = 64_000;

type RouteParams = { params: Promise<{ token: string }> };

type LeadForm = {
  id: string;
  organization_id: string;
  name: string;
  how_heard_label: string | null;
  assigned_staff_id: string | null;
  submission_count: number;
};

// The active form for this URL token, in an org that has the CRM; else null.
// The organization always comes from the token, never from the body.
async function findForm(token: string): Promise<LeadForm | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("crm_lead_forms")
    .select("id, organization_id, name, how_heard_label, assigned_staff_id, submission_count, revoked_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  if (!(await isCrmEnabled(data.organization_id))) return null;
  return data;
}

async function readFields(request: NextRequest): Promise<Map<string, string> | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return null;
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return null;
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (type.includes("multipart/form-data")) {
    const form = await new Request("http://local", { method: "POST", headers: { "content-type": type }, body: raw })
      .formData()
      .catch(() => null);
    if (!form) return null;
    const record: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") record[key] = value;
    }
    return flattenFields(record);
  }

  const trimmed = raw.trim();
  if (type.includes("json") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? flattenFields(parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  // application/x-www-form-urlencoded (or unlabeled key=value pairs).
  const params = new URLSearchParams(trimmed);
  const record: Record<string, unknown> = {};
  for (const [key, value] of params) {
    // A checkbox posts a hidden "" then "1"; keep the last non-empty value.
    if (value || !(key in record)) record[key] = value;
  }
  return flattenFields(record);
}

// Lets someone check the URL in a browser before wiring up the form.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { token } = await params;
  const form = await findForm(token);
  if (!form) return jsonError("Not found.", 404);
  return NextResponse.json({ success: true, form: form.name, message: "Ready to receive website leads (POST)." });
}

// A website form submission becomes a web lead in the CRM. Public by design:
// the long random token in the URL is the credential. A visitor who is
// already in the CRM (same email or phone) isn't duplicated; their message is
// added to their existing thread instead. Either way the message lands in
// the guest's thread as an unread inbound "web" message and the owner (or
// every admin when unassigned) gets a push notification.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    const form = await findForm(token);
    if (!form) return jsonError("Not found.", 404);

    // Per form, not per IP: server-side senders (Freeform, Zapier) post every
    // lead from the same address.
    const allowed = await rateLimitAll([
      { key: `web-lead:form:${form.id}`, windowSeconds: 3_600, limit: 120 },
      { key: `web-lead:form-day:${form.id}`, windowSeconds: 86_400, limit: 1_000 },
    ]);
    if (!allowed) return jsonError("Too many submissions. Try again later.", 429);

    const fields = await readFields(request);
    if (!fields) return jsonError("Couldn't read the form submission.", 400);
    const lead = parseWebLead(fields);
    if (!lead.email && !lead.phone) {
      return jsonError("The submission needs an email address or phone number.", 422);
    }

    const admin = createSupabaseAdminClient();
    // Retries of the same submission are recorded once: by the sender's own
    // submission id when it sends one, else by the exact payload.
    const fingerprint = lead.submissionId
      ? `web:${form.id}:${lead.submissionId}`
      : `web:${form.id}:${sha256(JSON.stringify([...fields.entries()]))}`;

    // Bot submissions (random-letter names and messages, dot-padded Gmail)
    // are held for a Club Admin to review instead of becoming leads. The
    // sender still gets a normal success so bots learn nothing.
    const verdict = spamCheck({ firstName: lead.firstName, lastName: lead.lastName, email: lead.email, message: lead.message });
    if (verdict.spam) {
      await admin.from("crm_spam_submissions").upsert(
        {
          organization_id: form.organization_id,
          lead_form_id: form.id,
          fingerprint,
          first_name: lead.firstName,
          last_name: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          message: lead.message,
          lead,
          reasons: verdict.reasons,
        },
        { onConflict: "fingerprint", ignoreDuplicates: true },
      );
      return NextResponse.json({ success: true });
    }

    const result = await saveWebLead(admin, form, lead, fingerprint);
    if (result.duplicate) return NextResponse.json({ success: true, duplicate: true });
    return NextResponse.json({ success: true, created: result.created });
  } catch (error) {
    logCrmError("crm/web-leads POST", error);
    return jsonError("Couldn't save the lead.", 500);
  }
}
