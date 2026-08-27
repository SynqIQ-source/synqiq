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
