// Newsletters: filters and rendering. Pure (shared by the composer's preview,
// the sender and tests).
import { brandedLayout, escapeHtml, fillPlain, type EmailKit } from "@/lib/email/studio-templates";

export const CONTACT_TYPES = ["member", "lead", "guest"] as const;
export const MEMBER_STATUSES = ["active", "frozen", "cancelled"] as const;
export const LEAD_SOURCES: Record<string, string> = {
  walk_in: "Walk-in",
  web: "Website",
  guest_of_member: "Guest of a member",
  phone_in: "Phone",
  member: "Member referral",
  other: "Other",
};
export const NEWSLETTER_SUBJECT_MAX = 200;
export const NEWSLETTER_BODY_MAX = 20000;

export type NewsletterFilters = {
  types?: string[];
  member_status?: string[];
  sources?: string[];
  created_from?: string;
  created_to?: string;
  visited_from?: string;
  visited_to?: string;
  not_visited_days?: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pick = (value: unknown, allowed: readonly string[]) =>
  Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && allowed.includes(item)))] : [];

// Only known filters with valid values; anything else is dropped.
export function cleanFilters(input: unknown): NewsletterFilters {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: NewsletterFilters = {};
  const types = pick(raw.types, CONTACT_TYPES);
  if (types.length) out.types = types;
  const status = pick(raw.member_status, MEMBER_STATUSES);
  if (status.length) out.member_status = status;
  const sources = pick(raw.sources, Object.keys(LEAD_SOURCES));
  if (sources.length) out.sources = sources;
  for (const key of ["created_from", "created_to", "visited_from", "visited_to"] as const) {
    const value = raw[key];
    if (typeof value === "string" && DATE.test(value)) out[key] = value;
  }
  const days = Number(raw.not_visited_days);
  if (Number.isInteger(days) && days > 0 && days <= 3650) out.not_visited_days = days;
  return out;
}

// Plain-language summary of the filters, for the history list.
export function describeFilters(filters: NewsletterFilters): string {
  const parts: string[] = [];
  parts.push(filters.types?.length ? filters.types.map((type) => `${type}s`).join(", ") : "members, leads, guests");
  if (filters.member_status?.length) parts.push(`members ${filters.member_status.join("/")}`);
  if (filters.sources?.length) parts.push(`source ${filters.sources.map((source) => LEAD_SOURCES[source] ?? source).join("/")}`);
  if (filters.created_from || filters.created_to) parts.push(`added ${filters.created_from ?? "…"} to ${filters.created_to ?? "…"}`);
  if (filters.visited_from || filters.visited_to) parts.push(`last visit ${filters.visited_from ?? "…"} to ${filters.visited_to ?? "…"}`);
  if (filters.not_visited_days) parts.push(`no visit in ${filters.not_visited_days} days`);
  return parts.join(" · ");
}

const SAFE_URL = /^https:\/\/[^\s"'<>]+$/;

// Text -> HTML: blank line = paragraph, **bold**, [text](https://link),
// a line that is just ![alt](https://image) = an image, "## " = heading,
// {{first_name}} / {{studio}}.
export function newsletterContent(text: string, vars: Record<string, string>, color: string) {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(block);
      if (image && SAFE_URL.test(image[2])) {
        return `<p style="margin:0 0 16px"><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}" style="max-width:100%;height:auto;border-radius:8px;display:block"></p>`;
      }
      const heading = /^##\s+(.+)$/.exec(block);
      const inline = (value: string) =>
        escapeHtml(fillPlain(value, vars))
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, (_, label: string, url: string) =>
            SAFE_URL.test(url.replace(/&amp;/g, "&")) ? `<a href="${url}" style="color:${color};font-weight:600">${label}</a>` : label,
          )
          .replace(/\n/g, "<br>");
      if (heading && !heading[1].includes("\n"))
        return `<h2 style="margin:8px 0 12px;font-size:20px;line-height:1.3">${inline(heading[1])}</h2>`;
      return `<p style="margin:0 0 16px">${inline(block)}</p>`;
    })
    .join("\n");
}

export function renderNewsletter(
  kit: EmailKit,
  subject: string,
  body: string,
  person: { firstName: string | null; unsubscribeUrl: string },
): { subject: string; html: string } {
  const vars = { studio: kit.branding.studioName, first_name: person.firstName?.trim() || "there" };
  const content = newsletterContent(body, vars, /^#[0-9a-fA-F]{6}$/.test(kit.branding.color) ? kit.branding.color : "#0f766e");
  return {
    subject: fillPlain(subject, vars).replace(/\s+/g, " ").trim(),
    html: brandedLayout(kit.branding, content, {
      finePrint: `<p style="margin:0">You're getting this because you signed up for emails from ${escapeHtml(kit.branding.studioName)}. <a href="${escapeHtml(person.unsubscribeUrl)}" style="color:#71717a">Unsubscribe</a></p>`,
    }),
  };
}
