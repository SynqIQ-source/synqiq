import { runsMaintenance } from "@/lib/permissions";
import { randomBytes } from "node:crypto";
import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmailToRecipients } from "@/lib/email/send";
import { sendPushToStaff } from "@/lib/push/send";
import { formatOutboundMessageId, sendRelayEmail } from "@/lib/email/relay";
import { extractReplyText } from "@/lib/email/reply-parser";
import { getOptionalEnv } from "@/lib/env";
import { MAINTENANCE_ALIAS_PREFIX, STATUS_LABELS, vendorEmailText, type IssueStatus } from "@/lib/maintenance/rules";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const MEDIA_BUCKET = "maintenance-media";

export type IssueRow = {
  id: string;
  organization_id: string;
  equipment_id: string | null;
  location_text: string | null;
  title: string;
  description: string;
  is_critical: boolean;
  status: IssueStatus;
  reported_by_staff_id: string | null;
  vendor_id: string | null;
  email_alias: string | null;
  last_message_id: string | null;
  next_visit_at: string | null;
  created_at: string;
};

export async function loadIssue(admin: Admin, organizationId: string, issueId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(issueId)) return null;
  const { data } = await admin.from("maintenance_issues").select("*").eq("id", issueId).eq("organization_id", organizationId).maybeSingle();
  if (!data) return null;
  const issue = data as IssueRow;
  const { data: equipment } = issue.equipment_id
    ? await admin
        .from("maintenance_equipment")
        .select("id, name, area, model_number, serial_number, owner_staff_id, default_vendor_id, is_critical")
        .eq("id", issue.equipment_id)
        .maybeSingle()
    : { data: null };
  return { issue, equipment: equipment as EquipmentRow | null };
}

export type EquipmentRow = {
  id: string;
  name: string;
  area: string | null;
  model_number: string | null;
  serial_number: string | null;
  owner_staff_id: string | null;
  default_vendor_id: string | null;
  is_critical: boolean;
};

// The equipment's owner (stakeholder), a Facility Tech or a Club Admin runs the issue.
export function canRunIssue(
  staff: { id: string; role: string; isFacilityTech?: boolean },
  equipment: { owner_staff_id: string | null } | null,
) {
  return runsMaintenance(staff) || (equipment?.owner_staff_id != null && equipment.owner_staff_id === staff.id);
}

export async function addEvent(admin: Admin, row: Record<string, unknown> & { organization_id: string; issue_id: string; kind: string }) {
  const { error } = await admin.from("maintenance_events").insert(row);
  if (error) throw new Error(error.message);
  await admin.from("maintenance_issues").update({ updated_at: new Date().toISOString() }).eq("id", row.issue_id);
}

// Club Admins, Facility Techs and the equipment's owner: who hears about an issue.
async function stakeholders(admin: Admin, organizationId: string, ownerStaffId: string | null) {
  const { data } = await admin
    .from("staff")
    .select("id, display_name, email, role")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .or(`role.eq.admin,is_facility_tech.eq.true${ownerStaffId ? `,id.eq.${ownerStaffId}` : ""}`);
  return (data ?? []) as { id: string; display_name: string; email: string | null; role: string }[];
}

function siteUrl() {
  return getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? "https://synqiq.co";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

async function orgInfo(admin: Admin, organizationId: string) {
  const { data } = await admin.from("organizations").select("name, timezone").eq("id", organizationId).maybeSingle();
  return { name: (data?.name as string | null) ?? "Your studio", timezone: (data?.timezone as string | null) ?? "America/Chicago" };
}

// Tell the owner, Facility Techs and Club Admins (email; push too when critical). Staff only.
export async function notifyStakeholders(
  admin: Admin,
  issue: IssueRow,
  ownerStaffId: string | null,
  message: { subject: string; lead: string; body?: string | null },
) {
  const people = await stakeholders(admin, issue.organization_id, ownerStaffId);
  const url = `${siteUrl()}/dashboard/maintenance/${issue.id}`;
  await sendEmailToRecipients(
    people.filter((person) => person.email).map((person) => ({ email: person.email as string, displayName: person.display_name })),
    {
      subject: message.subject,
      html: `
        <p>${escapeHtml(message.lead)}</p>
        <p><strong>${escapeHtml(issue.title)}</strong>${issue.is_critical ? ' <span style="color:#b91c1c">(critical)</span>' : ""}</p>
        ${message.body ? `<p style="white-space:pre-wrap">${escapeHtml(message.body)}</p>` : ""}
        <p><a href="${url}">Open the maintenance report</a></p>
      `,
    },
  );
  if (issue.is_critical) {
    await sendPushToStaff(
      people.map((person) => person.id),
      { title: message.subject, body: issue.title, url: `/dashboard/maintenance/${issue.id}` },
    );
  }
}

export async function notifyNewIssue(admin: Admin, issue: IssueRow, equipment: EquipmentRow | null, reporterName: string) {
  const where = equipment ? `${equipment.name}${equipment.area ? `, ${equipment.area}` : ""}` : (issue.location_text ?? "");
  await notifyStakeholders(admin, issue, equipment?.owner_staff_id ?? null, {
    subject: issue.is_critical ? `CRITICAL maintenance: ${issue.title}` : `Maintenance report: ${issue.title}`,
    lead: `${reporterName} reported a ${issue.is_critical ? "critical " : ""}maintenance issue${where ? ` (${where})` : ""}.${
      issue.is_critical
        ? " A Club Admin can approve contacting a vendor from the report."
        : " Add troubleshooting notes or mark it resolved from the report."
    }`,
    body: issue.description,
  });
}

function relayDomain() {
  const domain = process.env.FOLLOWUP_RELAY_DOMAIN;
  if (!domain) throw new Error("Email isn't set up (relay domain missing).");
  return domain;
}

async function aliasFor(admin: Admin, issue: IssueRow) {
  if (issue.email_alias) return issue.email_alias;
  const alias = `${MAINTENANCE_ALIAS_PREFIX}${randomBytes(12).toString("hex")}@${relayDomain()}`;
  await admin.from("maintenance_issues").update({ email_alias: alias }).eq("id", issue.id).is("email_alias", null);
  const { data } = await admin.from("maintenance_issues").select("email_alias").eq("id", issue.id).single();
  return data!.email_alias as string;
}

// A Club Admin emails the vendor (first contact = approval). The first email
// carries the original report, troubleshooting and photo/video links.
export async function emailVendor(
  admin: Admin,
  input: { issue: IssueRow; equipment: EquipmentRow | null; vendorId: string; message: string; staff: { id: string; displayName: string } },
) {
  const { issue } = input;
  const { data: vendor } = await admin
    .from("maintenance_vendors")
    .select("id, name, contact_name, email")
    .eq("id", input.vendorId)
    .eq("organization_id", issue.organization_id)
    .maybeSingle();
  if (!vendor) return { ok: false as const, error: "Pick a vendor." };
  if (!vendor.email) return { ok: false as const, error: `${vendor.name} has no email address. Add one under Vendors.` };

  const org = await orgInfo(admin, issue.organization_id);
  const first = !issue.vendor_id || issue.vendor_id !== vendor.id || !issue.last_message_id;
  let text = input.message.trim();
  if (first) {
    const [{ data: steps }, { data: media }] = await Promise.all([
      admin.from("maintenance_events").select("body").eq("issue_id", issue.id).eq("kind", "troubleshooting").order("created_at"),
      admin.from("maintenance_media").select("kind, path").eq("issue_id", issue.id).not("uploaded_at", "is", null).order("created_at"),
    ]);
    const links: { kind: "photo" | "video"; url: string }[] = [];
    for (const item of media ?? []) {
      const { data } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(item.path as string, 7 * 24 * 3600);
      if (data?.signedUrl) links.push({ kind: item.kind as "photo" | "video", url: data.signedUrl });
    }
    text = vendorEmailText({
      studioName: org.name,
      vendorContact: vendor.contact_name as string | null,
      equipment: input.equipment
        ? {
            name: input.equipment.name,
            area: input.equipment.area,
            model: input.equipment.model_number,
            serial: input.equipment.serial_number,
          }
        : null,
      locationText: issue.location_text,
      title: issue.title,
      description: issue.description,
      reportedAt: DateTime.fromISO(issue.created_at).setZone(org.timezone).toFormat("LLL d, yyyy h:mm a"),
      troubleshooting: (steps ?? []).map((step) => step.body as string).filter(Boolean),
      mediaLinks: links,
      message: input.message,
    });
  }

  const alias = await aliasFor(admin, issue);
  const subject = `${first ? "" : "Re: "}Service request: ${issue.title} (${org.name})`;
  const result = await sendRelayEmail({
    from: `"${`${org.name} Maintenance`.replace(/["\\\r\n]/g, "")}" <${alias}>`,
    to: vendor.email as string,
    replyTo: alias,
    subject,
    text,
    inReplyTo: first ? null : issue.last_message_id,
  });
  if (!result.ok) {
    console.error("[maintenance] vendor email failed:", result.error);
    return { ok: false as const, error: "The email couldn't be sent. Try again." };
  }
  const messageId = formatOutboundMessageId(result.resendMessageId);
  const now = new Date().toISOString();
  await admin
    .from("maintenance_issues")
    .update({
      vendor_id: vendor.id,
      last_message_id: messageId,
      ...(first ? { vendor_approved_by_staff_id: input.staff.id, vendor_approved_at: now, vendor_contacted_at: now } : {}),
      ...(["reported", "troubleshooting"].includes(issue.status) ? { status: "vendor_contacted" } : {}),
    })
    .eq("id", issue.id);
  await addEvent(admin, {
    organization_id: issue.organization_id,
    issue_id: issue.id,
    kind: "vendor_out",
    body: text,
    subject,
    staff_id: input.staff.id,
    vendor_id: vendor.id,
    from_email: vendor.email,
    provider_message_id: messageId,
  });
  return { ok: true as const, vendorName: vendor.name as string };
}

// A vendor replied to an issue's address: add it to the timeline, move the
// status on, and tell the owner + Club Admins.
export async function handleMaintenanceReply(email: {
  alias: string;
  from: string;
  subject: string;
  text: string;
  messageId: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("maintenance_issues").select("*").eq("email_alias", email.alias).maybeSingle();
  if (!data) return { status: "dropped" as const, reason: "unknown maintenance alias" };
  const issue = data as IssueRow;
  const body = extractReplyText(email.text ?? "").slice(0, 20000);
  const { data: vendor } = issue.vendor_id
    ? await admin.from("maintenance_vendors").select("id, name, email").eq("id", issue.vendor_id).maybeSingle()
    : { data: null };
  const fromAddress = (email.from.match(/<([^>]+)>/)?.[1] ?? email.from).trim().toLowerCase();
  const fromVendor = Boolean(vendor?.email && fromAddress === (vendor.email as string).toLowerCase());
  const now = new Date().toISOString();
  await admin
    .from("maintenance_issues")
    .update({
      last_vendor_reply_at: now,
      ...(email.messageId ? { last_message_id: email.messageId } : {}),
      ...(issue.status === "vendor_contacted" ? { status: "vendor_replied" } : {}),
    })
    .eq("id", issue.id);
  await addEvent(admin, {
    organization_id: issue.organization_id,
    issue_id: issue.id,
    kind: "vendor_in",
    body,
    subject: email.subject?.slice(0, 300) ?? null,
    vendor_id: vendor?.id ?? null,
    from_email: fromAddress,
    provider_message_id: email.messageId,
  });
  const { data: equipment } = issue.equipment_id
    ? await admin.from("maintenance_equipment").select("owner_staff_id").eq("id", issue.equipment_id).maybeSingle()
    : { data: null };
  await notifyStakeholders(admin, issue, (equipment?.owner_staff_id as string | null) ?? null, {
    subject: `Vendor replied: ${issue.title}`,
    lead: `${vendor?.name ?? "The vendor"} replied${fromVendor ? "" : ` (from ${fromAddress}, not the address on file)`}. Schedule the visit or answer from the report.`,
    body,
  });
  return { status: "recorded" as const };
}

export function statusLabel(status: string) {
  return STATUS_LABELS[status as IssueStatus] ?? status;
}
