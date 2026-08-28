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
      <p>A new lead came in through the Synq contact form.</p>
      ${rows}
    `,
  };
}
