// Studio email templates (Admin > Email > Templates). Club Admins can reword
// the emails SynqIQ sends for them and set a shared header (logo, color) and
// footer/signature. Pure: rendering is shared by the senders, the editor's
// live preview and the tests. Defaults are the wording used before templates
// existed, so an untouched studio sends exactly what it always did.

export type TemplateKey =
  | "payment_declined"
  | "payment_on_hold"
  | "card_expiring"
  | "card_expiring_reminder"
  | "card_link"
  | "card_cutover"
  | "rating_request"
  | "class_followup_reminder";

type TemplateDef = {
  label: string;
  audience: string;
  when: string;
  subject: string;
  body: string;
  fields: Record<string, { label: string; sample: string }>;
  staff?: boolean; // goes to staff: no studio signature
};

const STUDIO = { label: "Studio name", sample: "The Preserve" };
const FIRST = { label: "Member's first name", sample: "Sam" };
const MEMBERSHIP = { label: "Membership name", sample: "Monthly Unlimited" };
const AMOUNT = { label: "Amount", sample: "$219.00" };
const CARD_NOTE = { label: 'Card, e.g. " (Visa ending 4242)" (blank if unknown)', sample: " (Visa ending 4242)" };

const DECLINE_TAIL =
  "If your card has changed or was replaced, update it with the link above, or stop by or call the front desk and we'll take care of it.";
const CARD_TAIL = "You can also update it in the app, or at the front desk.";

export const EMAIL_TEMPLATES: Record<TemplateKey, TemplateDef> = {
  payment_declined: {
    label: "Payment declined",
    audience: "Members",
    when: "A monthly payment is declined (booking pauses until it's paid).",
    subject: "Your {{studio}} membership payment didn't go through",
    body: `Hi {{first_name}},

Your **{{membership}}** payment of {{amount}} was declined by your card{{card_note}}.

Class and lane booking is paused until the payment is made. We'll try your card again on **{{retry_date}}**.

[button]

${DECLINE_TAIL}`,
    fields: {
      studio: STUDIO,
      first_name: FIRST,
      membership: MEMBERSHIP,
      amount: AMOUNT,
      card_note: CARD_NOTE,
      retry_date: { label: "Next try", sample: "Friday, December 4" },
    },
  },
  payment_on_hold: {
    label: "Membership on hold",
    audience: "Members",
    when: "The last retry failed and the membership is frozen.",
    subject: "Your {{studio}} membership is on hold",
    body: `Hi {{first_name}},

We weren't able to collect your **{{membership}}** payment of {{amount}} after several tries, so your membership is on hold.

Class and lane booking is paused until the payment is made.

[button]

${DECLINE_TAIL}`,
    fields: { studio: STUDIO, first_name: FIRST, membership: MEMBERSHIP, amount: AMOUNT },
  },
  card_expiring: {
    label: "Card expiring",
    audience: "Members",
    when: "A month before the card on file expires.",
    subject: "Your card on file with {{studio}} expires soon",
    body: `Hi {{first_name}},

The card we have on file for your membership{{card_note}} expires at the end of **{{expires}}**. To keep your membership payments going without interruption, please add your new card.

[button]

${CARD_TAIL}`,
    fields: { studio: STUDIO, first_name: FIRST, card_note: CARD_NOTE, expires: { label: "Expiry month", sample: "December 2026" } },
  },
  card_expiring_reminder: {
    label: "Card expiring (reminder)",
    audience: "Members",
    when: "15 days after the first expiring-card email, if the card wasn't updated.",
    subject: "Reminder: your card on file with {{studio}} expires soon",
    body: `Hi {{first_name}},

The card we have on file for your membership{{card_note}} expires at the end of **{{expires}}**. To keep your membership payments going without interruption, please add your new card.

[button]

${CARD_TAIL}`,
    fields: { studio: STUDIO, first_name: FIRST, card_note: CARD_NOTE, expires: { label: "Expiry month", sample: "December 2026" } },
  },
  card_link: {
    label: "Update your card (sent by staff)",
    audience: "Members",
    when: 'Staff press "Email member a link" on a profile.',
    subject: "Update your card on file with {{studio}}",
    body: `Hi {{first_name}},

Here's the secure link to add or update the card we keep on file for your membership payments.

[button]

${CARD_TAIL}`,
    fields: { studio: STUDIO, first_name: FIRST },
  },
  card_cutover: {
    label: "Add your card (move to SynqIQ billing)",
    audience: "Members",
    when: "A Club Admin sends it from Member Billing > Jan 1 cutover, to members whose card isn't in SynqIQ yet.",
    subject: "Action needed: add your card for your {{studio}} membership",
    body: `Hi {{first_name}},

Starting {{start_date}}, {{studio}} membership payments move to our new member system. To keep your **{{membership}}** going without interruption, please add the card you'd like to use for your monthly dues.

[button]

It takes about a minute. Your card goes straight to our secure payment processor, Stripe. Your billing day stays the same.

You can also add it in our app, or at the front desk.`,
    fields: {
      studio: STUDIO,
      first_name: FIRST,
      membership: MEMBERSHIP,
      start_date: { label: "When the move happens", sample: "January 1" },
    },
  },
  rating_request: {
    label: "Rate your class",
    audience: "Members",
    when: "The morning after a member's first class with an instructor each quarter (when rating emails are on).",
    subject: "How was {{class_name}} with {{instructor}}?",
    body: `Hi {{first_name}},

Thanks for coming to **{{class_name}}** with {{instructor}} on {{day}}. How was it?

[button]

Tap a star to rate it. You can add a comment on the next page if you like.`,
    fields: {
      studio: STUDIO,
      first_name: FIRST,
      class_name: { label: "Class", sample: "Power Flow" },
      instructor: { label: "Instructor's first name", sample: "Jess" },
      day: { label: "Day of the class", sample: "Tuesday" },
    },
  },
  class_followup_reminder: {
    label: "After-class follow-up reminder",
    audience: "Instructors",
    when: "At noon or 8 PM after a class where a member reached a class milestone, to the instructor who taught it.",
    subject: "Follow up with your {{class_name}} class",
    body: `Thanks for teaching **{{class_name}}** on {{class_time}}. {{milestones}}

Your milestone note is ready to send. Open Follow Up to send or edit it:

[button]

Members see your name and the studio. Your email address stays private.`,
    fields: {
      studio: STUDIO,
      class_name: { label: "Class", sample: "Power Flow" },
      class_time: { label: "Class day and time", sample: "Tuesday, December 1 at 6:00 AM" },
      checked_in: { label: "How many checked in", sample: "12 members" },
      milestones: { label: "Who reached a milestone", sample: "Sam reached their 10th class." },
    },
    staff: true,
  },
};

export const TEMPLATE_KEYS = Object.keys(EMAIL_TEMPLATES) as TemplateKey[];
export const isTemplateKey = (value: unknown): value is TemplateKey =>
  typeof value === "string" && (TEMPLATE_KEYS as string[]).includes(value);

export type EmailBranding = {
  studioName: string;
  logoUrl: string | null;
  color: string;
  signature: string | null; // null = "Thank you,\n{{studio}}"
  footer: string | null; // address, phone, hours...
  showLogo: boolean;
};
export type TemplateOverrides = Partial<Record<TemplateKey, { subject: string; body: string }>>;
// fromDomain: the studio's verified sending domain (null = synqiq.co).
export type EmailKit = { branding: EmailBranding; overrides: TemplateOverrides; fromDomain?: string | null };

export const DEFAULT_SIGNATURE = "Thank you,\n{{studio}}";
export const SUBJECT_MAX = 200;
export const BODY_MAX = 5000;

export function defaultKit(studioName: string): EmailKit {
  return {
    branding: { studioName, logoUrl: null, color: "#0f766e", signature: null, footer: null, showLogo: true },
    overrides: {},
  };
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

// Placeholders in the text that this email doesn't have (shown as an error
// when saving, so a typo doesn't go out as a blank).
export function unknownPlaceholders(text: string, key: TemplateKey): string[] {
  const known = EMAIL_TEMPLATES[key].fields;
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]).filter((name) => !(name in known)))];
}

export function fillPlain(text: string, vars: Record<string, string>) {
  return text.replace(PLACEHOLDER, (_, name: string) => vars[name] ?? "");
}

// Text -> HTML: escaped, {{fields}} filled (escaped), **bold**, blank lines
// make paragraphs, single line breaks kept. "[button]" on its own line is
// where the email's button (or stars) goes.
function paragraphs(text: string, vars: Record<string, string>, action: string) {
  let placed = false;
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (block === "[button]") {
        if (placed) return "";
        placed = true;
        return action;
      }
      const html = escapeHtml(block)
        .replace(PLACEHOLDER, (_, name: string) => escapeHtml(vars[name] ?? ""))
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
      return `<p style="margin:0 0 16px">${html}</p>`;
    });
  if (!placed && action) blocks.push(action);
  return blocks.join("\n");
}

export function emailButton(url: string, label: string, color: string, note?: string) {
  return `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}" style="display:inline-block;background:${color};color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a>${
    note ? `<br><span style="color:#666;font-size:12px">${escapeHtml(note)}</span>` : ""
  }</p>`;
}

const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/;

// The shared look: a colored header with the studio logo (or name), the
// message, the signature, then the footer and any fine print.
export function brandedLayout(branding: EmailBranding, content: string, options: { finePrint?: string; staff?: boolean } = {}) {
  const color = SAFE_COLOR.test(branding.color) ? branding.color : "#0f766e";
  const logo =
    branding.showLogo && branding.logoUrl && /^https:\/\//.test(branding.logoUrl)
      ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.studioName)}" style="height:36px;max-width:220px;display:block">`
      : `<span style="color:#fff;font-size:18px;font-weight:700">${escapeHtml(branding.studioName)}</span>`;
  const vars = { studio: branding.studioName };
  const signature = options.staff
    ? ""
    : `<p style="margin:0 0 4px">${escapeHtml(fillPlain(branding.signature?.trim() || DEFAULT_SIGNATURE, vars)).replace(/\n/g, "<br>")}</p>`;
  const footer = branding.footer?.trim()
    ? `<p style="margin:0 0 8px">${escapeHtml(fillPlain(branding.footer.trim(), vars)).replace(/\n/g, "<br>")}</p>`
    : "";
  return `<div style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;font-size:15px;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">
<div style="background:${color};padding:16px 24px">${logo}</div>
<div style="padding:24px">
${content}
${signature}
</div>
${footer || options.finePrint ? `<div style="padding:16px 24px;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px">${footer}${options.finePrint ?? ""}</div>` : ""}
</div>
</div>`;
}

// One studio email: the studio's wording (or the default), filled in and
// wrapped in the studio's header and footer.
export function renderStudioEmail(
  key: TemplateKey,
  vars: Record<string, string>,
  kit: EmailKit,
  extras: { action?: string; finePrint?: string } = {},
): { subject: string; html: string } {
  const def = EMAIL_TEMPLATES[key];
  const override = kit.overrides[key];
  const allVars = { studio: kit.branding.studioName, ...vars, first_name: vars.first_name || "there" };
  const subject = fillPlain(override?.subject?.trim() || def.subject, allVars)
    .replace(/\s+/g, " ")
    .trim();
  const content = paragraphs(override?.body?.trim() || def.body, allVars, extras.action ?? "");
  return { subject, html: brandedLayout(kit.branding, content, { finePrint: extras.finePrint, staff: def.staff }) };
}

// Sample values for the editor's preview.
export function sampleVars(key: TemplateKey): Record<string, string> {
  return Object.fromEntries(Object.entries(EMAIL_TEMPLATES[key].fields).map(([name, field]) => [name, field.sample]));
}
