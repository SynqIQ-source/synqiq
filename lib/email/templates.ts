import { DateTime } from "luxon";

type ClassInfo = {
  className: string;
  startDatetime: string;
  timezone: string;
  siteUrl: string;
};

function formatClassTime(startDatetime: string, timezone: string): string {
  return DateTime.fromISO(startDatetime, { zone: "utc" }).setZone(timezone).toFormat("cccc, LLLL d 'at' h:mm a");
}

// Every field going into newLeadEmail below is visitor-submitted on a
// public, unauthenticated form -- unlike the substitution templates above
// (whose interpolated values all come from this app's own synced data),
// this has to assume a submitter could put HTML/script markup in a text
// field and escape it, or a crafted name/studio field could inject markup
// into the notification email itself.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Deliberately plain -- no heavy HTML-email styling/layout system. This is
// a one-line "here's what needs coverage, here's the link" notification,
// not a marketing email; a simple readable structure serves that better
// than investing in a template framework for two short messages.
export function substitutionRequestOpenEmail({ className, startDatetime, timezone, siteUrl }: ClassInfo): {
  subject: string;
  html: string;
} {
  const when = formatClassTime(startDatetime, timezone);

  return {
    subject: `Open substitution request: ${className}`,
    html: `
      <p><strong>${className}</strong> on ${when} needs a substitute instructor.</p>
      <p>If you're able to cover it, respond here:</p>
      <p><a href="${siteUrl}/dashboard/sub-requests">${siteUrl}/dashboard/sub-requests</a></p>
    `,
  };
}

// Sent to the same eligible group PLUS the original requester -- they need
// to know coverage still hasn't been found too, not just the pool of
// people who could pick it up.
export function substitutionRequestReminderEmail({ className, startDatetime, timezone, siteUrl }: ClassInfo): {
  subject: string;
  html: string;
} {
  const when = formatClassTime(startDatetime, timezone);

  return {
    subject: `Still open: ${className}`,
    html: `
      <p><strong>${className}</strong> on ${when} still needs a substitute instructor.</p>
      <p>If you're able to cover it, respond here:</p>
      <p><a href="${siteUrl}/dashboard/sub-requests">${siteUrl}/dashboard/sub-requests</a></p>
    `,
  };
}

type NewLead = {
  name: string;
  studioName: string;
  website: string | null;
  phone: string | null;
  email: string;
};

// One notification per submission, to LEAD_NOTIFICATION_EMAIL -- see
// app/api/leads/route.ts. Every field is escaped (see escapeHtml above);
// this is the one email template in this app fed entirely by
// unauthenticated public input.
export function newLeadEmail({ name, studioName, website, phone, email }: NewLead): { subject: string; html: string } {
  const rows = [
    ["Name", name],
    ["Studio / Gym", studioName],
    ["Website", website ?? "—"],
    ["Phone", phone ?? "—"],
    ["Email", email],
  ]
    .map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`)
    .join("\n");

  return {
    subject: `New lead: ${studioName}`,
    html: `
      <p>A new lead came in through the SynqIQ contact form.</p>
      ${rows}
    `,
  };
}

// Sent to the visitor themselves (not the internal LEAD_NOTIFICATION_EMAIL
// address above) -- from noreply@synqiq.co / "SynqIQ Support", a distinct
// sender identity from the notifications@ address the rest of this app's
// emails use, since this one is visitor-facing rather than an internal
// notification. name/studioName are visitor-submitted, so escaped same as
// newLeadEmail above.
export function leadAutoResponseEmail({ name, studioName }: Pick<NewLead, "name" | "studioName">): {
  subject: string;
  html: string;
} {
  return {
    subject: "We've received your inquiry — SynqIQ",
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Thanks for reaching out about SynqIQ for ${escapeHtml(studioName)}.</p>
      <p>We're building slowly and with intention, working closely with a small number of studios at a time rather than onboarding everyone at once. That means every inquiry gets a real look — we'll review what you've shared and get back to you personally.</p>
      <p>Here's what happens next:</p>
      <ol>
        <li><strong>We review your submission.</strong> We'll take a look at your studio and what you're hoping to solve.</li>
        <li><strong>We follow up directly</strong> — either to answer a few questions first, or, if it looks like a strong fit, to schedule a time for a more in-depth call and a live demo.</li>
        <li><strong>No automated onboarding.</strong> If we move forward, it'll be a real conversation about how SynqIQ fits your studio specifically, not a generic sales pitch.</li>
      </ol>
      <p>You can expect to hear from us within the next few — 3-4 — business days.</p>
      <p>Talk soon,<br>The SynqIQ Team</p>
    `,
  };
}
