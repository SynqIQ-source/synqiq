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
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

// Sent to every admin in the org the moment a request opens -- an
// oversight/FYI copy, not a call to action (that's substitutionRequestOpenEmail
// above, sent to eligible instructors instead). Admins otherwise have no way
// to learn a request exists short of opening the dashboard themselves.
export function substitutionRequestAdminAlertEmail({ className, startDatetime, timezone, siteUrl }: ClassInfo): {
  subject: string;
  html: string;
} {
  const when = formatClassTime(startDatetime, timezone);

  return {
    subject: `Sub request opened: ${className}`,
    html: `
      <p><strong>${className}</strong> on ${when} needs a substitute instructor.</p>
      <p>Eligible instructors have been notified automatically. Track responses and approve a substitute here:</p>
      <p><a href="${siteUrl}/dashboard/sub-requests">${siteUrl}/dashboard/sub-requests</a></p>
    `,
  };
}

type NewClassTypeInfo = {
  departmentName: string;
  className: string;
  seededStaffNames: string[];
};

// Sent to admins when the nightly sync sees a class type with no
// eligibility rows yet (lib/eligibility/new-class-types.ts). Its scheduled
// instructors were made eligible automatically; this is the prompt to add
// anyone else qualified to sub it. Escaped even though the values come from
// synced MindBody data -- class names are free text typed into MindBody.
export function newClassTypesEmail({ newClassTypes, siteUrl }: { newClassTypes: NewClassTypeInfo[]; siteUrl: string }): {
  subject: string;
  html: string;
} {
  const names = newClassTypes.map((type) => type.className);
  const items = newClassTypes
    .map(
      (type) =>
        `<li><strong>${escapeHtml(type.className)}</strong> (${escapeHtml(type.departmentName)}) -- eligible now: ${escapeHtml(
          type.seededStaffNames.join(", "),
        )}</li>`,
    )
    .join("");

  return {
    subject: names.length === 1 ? `New class type in SynqIQ: ${names[0]}` : `${names.length} new class types in SynqIQ`,
    html: `
      <p>SynqIQ found ${names.length === 1 ? "a new class type" : "new class types"} on the schedule. The instructors scheduled to teach ${
        names.length === 1 ? "it were" : "them were"
      } made eligible to cover substitutions automatically:</p>
      <ul>${items}</ul>
      <p>Add anyone else qualified to sub ${names.length === 1 ? "this class" : "these classes"} here:</p>
      <p><a href="${siteUrl}/dashboard/settings/eligibility">${siteUrl}/dashboard/settings/eligibility</a></p>
    `,
  };
}

type VolunteerInfo = ClassInfo & {
  instructorName: string;
};

// Sent to every admin when an instructor volunteers for an open request --
// this is the action-relevant moment (someone is available, an approval
// decision is now possible), unlike a plain decline which needs no admin
// action and stays silent.
export function substitutionRequestVolunteerEmail({ className, startDatetime, timezone, siteUrl, instructorName }: VolunteerInfo): {
  subject: string;
  html: string;
} {
  const when = formatClassTime(startDatetime, timezone);

  return {
    subject: `${instructorName} can cover: ${className}`,
    html: `
      <p><strong>${instructorName}</strong> volunteered to cover <strong>${className}</strong> on ${when}.</p>
      <p>Approve the substitute here:</p>
      <p><a href="${siteUrl}/dashboard/sub-requests">${siteUrl}/dashboard/sub-requests</a></p>
    `,
  };
}

// Sent to every instructor who volunteered ("interested") for a request
// when an admin approves someone else. Without it they'd have no way to
// know the class is handled and could keep holding the time open. The
// chosen instructor isn't named -- the point is "you're free", not who
// won the slot.
export function substitutionRequestNotSelectedEmail({ className, startDatetime, timezone, siteUrl }: ClassInfo): {
  subject: string;
  html: string;
} {
  const when = formatClassTime(startDatetime, timezone);

  return {
    subject: `Thanks for offering to cover ${className}`,
    html: `
      <p>Thank you for offering to cover <strong>${escapeHtml(className)}</strong> on ${when}.</p>
      <p>Another instructor was able to pick it up, so there's nothing you need to do.</p>
      <p>We appreciate you stepping up. You can see other open requests here:</p>
      <p><a href="${siteUrl}/dashboard/sub-requests">${siteUrl}/dashboard/sub-requests</a></p>
    `,
  };
}

// Sent to the instructor an admin approved. Mirrors the push sent at the
// same moment, for instructors without the app installed on a phone.
export function substitutionRequestSelectedEmail({ className, startDatetime, timezone, siteUrl }: ClassInfo): {
  subject: string;
  html: string;
} {
  const when = formatClassTime(startDatetime, timezone);

  return {
    subject: `You're confirmed to cover ${className}`,
    html: `
      <p>Thank you for picking up <strong>${escapeHtml(className)}</strong> on ${when}.</p>
      <p>You're confirmed as the instructor for this class, and the schedule has been updated.</p>
      <p>See it on your schedule here:</p>
      <p><a href="${siteUrl}/dashboard/schedule">${siteUrl}/dashboard/schedule</a></p>
    `,
  };
}

// Sent ~2 hours after a class ends to the instructor who taught it (the
// approved sub when there was one), when at least one member checked in.
// Points at Follow Up, where that class's attendees now appear.
export function postClassFollowUpEmail({
  className,
  startDatetime,
  timezone,
  siteUrl,
  checkedInCount,
}: ClassInfo & { checkedInCount: number }): { subject: string; html: string } {
  const when = formatClassTime(startDatetime, timezone);
  const people = checkedInCount === 1 ? "1 member" : `${checkedInCount} members`;

  return {
    subject: `Follow up with your ${className} class`,
    html: `
      <p>Thanks for teaching <strong>${escapeHtml(className)}</strong> on ${when}. ${people} checked in.</p>
      <p>A quick personal note after class goes a long way. Send a follow-up to the people who attended here:</p>
      <p><a href="${siteUrl}/dashboard/follow-up">${siteUrl}/dashboard/follow-up</a></p>
      <p>Members see your name and the studio. Your email address stays private.</p>
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

// Member account: a one-time link to set (or reset) their password.
export function memberPasswordLinkEmail({
  studioName,
  firstName,
  link,
  isNew,
}: {
  studioName: string;
  firstName: string;
  link: string;
  isNew: boolean;
}): {
  subject: string;
  html: string;
} {
  const action = isNew ? "create your account" : "reset your password";
  return {
    subject: `${studioName}: ${isNew ? "set up your class booking account" : "reset your password"}`,
    html: `
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>Use this link to ${action} for booking classes at ${escapeHtml(studioName)}:</p>
      <p><a href="${escapeHtml(link)}">${isNew ? "Create my password" : "Reset my password"}</a></p>
      <p>The link works once and expires in an hour. If you didn't ask for it, you can ignore this email.</p>
    `,
  };
}
