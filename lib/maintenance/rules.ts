// Maintenance rules that don't touch the database (tested in
// tests/maintenance.test.ts).

export const ISSUE_STATUSES = [
  "reported",
  "troubleshooting",
  "vendor_contacted",
  "vendor_replied",
  "visit_scheduled",
  "on_site",
  "resolved",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const STATUS_LABELS: Record<IssueStatus, string> = {
  reported: "Reported",
  troubleshooting: "Troubleshooting",
  vendor_contacted: "Vendor contacted",
  vendor_replied: "Vendor replied",
  visit_scheduled: "Visit scheduled",
  on_site: "Vendor on site",
  resolved: "Resolved",
};

export const MAINTENANCE_ALIAS_PREFIX = "m-";

// Photos and short videos per issue: up to 8 photos (15 MB each) and up to
// 2 videos (different angles) totalling 30 seconds, 50 MB each.
export const MEDIA_LIMITS = {
  photos: 8,
  photoBytes: 15 * 1024 * 1024,
  videos: 2,
  videoBytes: 50 * 1024 * 1024,
  videoSecondsTotal: 30,
};
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

export type ExistingMedia = { kind: "photo" | "video"; duration_seconds: number | null };

export function checkMediaUpload(
  existing: ExistingMedia[],
  file: { contentType: string; sizeBytes: number; durationSeconds: number | null },
): { ok: true; kind: "photo" | "video" } | { ok: false; error: string } {
  const type = file.contentType.toLowerCase();
  if (PHOTO_TYPES.includes(type)) {
    if (existing.filter((m) => m.kind === "photo").length >= MEDIA_LIMITS.photos) {
      return { ok: false, error: `Up to ${MEDIA_LIMITS.photos} photos per report.` };
    }
    if (file.sizeBytes > MEDIA_LIMITS.photoBytes) return { ok: false, error: "That photo is too large (15 MB max)." };
    return { ok: true, kind: "photo" };
  }
  if (VIDEO_TYPES.includes(type)) {
    const videos = existing.filter((m) => m.kind === "video");
    if (videos.length >= MEDIA_LIMITS.videos) return { ok: false, error: `Up to ${MEDIA_LIMITS.videos} videos per report.` };
    if (file.sizeBytes > MEDIA_LIMITS.videoBytes)
      return { ok: false, error: "That video is too large (50 MB max). Record a shorter clip." };
    if (file.durationSeconds == null || !Number.isFinite(file.durationSeconds) || file.durationSeconds <= 0) {
      return { ok: false, error: "Couldn't read the video's length. Try recording it again." };
    }
    const used = videos.reduce((sum, m) => sum + Number(m.duration_seconds ?? 0), 0);
    if (used + file.durationSeconds > MEDIA_LIMITS.videoSecondsTotal + 0.5) {
      return {
        ok: false,
        error: `Videos can be ${MEDIA_LIMITS.videoSecondsTotal} seconds in total (${Math.max(0, Math.floor(MEDIA_LIMITS.videoSecondsTotal - used))} s left).`,
      };
    }
    return { ok: true, kind: "video" };
  }
  return { ok: false, error: "Add a photo (JPG, PNG, HEIC) or a video (MP4, MOV)." };
}

// Dollars typed by staff -> cents ("1,250.50" -> 125050).
export function parseDollars(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// What a piece of equipment has cost: the latest quote per issue isn't
// spend, payments are.
export function costSummary(events: { kind: string; amount_cents: number | null }[]) {
  let quoted = 0;
  let paid = 0;
  for (const event of events) {
    if (event.kind === "quote") quoted += event.amount_cents ?? 0;
    if (event.kind === "paid") paid += event.amount_cents ?? 0;
  }
  return { quotedCents: quoted, paidCents: paid };
}

export type VendorEmailInput = {
  studioName: string;
  vendorContact: string | null;
  equipment: { name: string; area: string | null; model: string | null; serial: string | null } | null;
  locationText: string | null;
  title: string;
  description: string;
  reportedAt: string;
  troubleshooting: string[];
  mediaLinks: { kind: "photo" | "video"; url: string }[];
  message: string;
};

// The first email to a vendor: the admin's own message, then the original
// report and in-house troubleshooting. Plain text (relay emails are text).
export function vendorEmailText(input: VendorEmailInput): string {
  const lines: string[] = [];
  lines.push(input.message.trim(), "", "---", `Service request from ${input.studioName}`, "");
  if (input.equipment) {
    lines.push(`Equipment: ${input.equipment.name}${input.equipment.area ? ` (${input.equipment.area})` : ""}`);
    if (input.equipment.model) lines.push(`Model #: ${input.equipment.model}`);
    if (input.equipment.serial) lines.push(`Serial #: ${input.equipment.serial}`);
  }
  if (input.locationText) lines.push(`Location: ${input.locationText}`);
  lines.push(`Reported: ${input.reportedAt}`, "", `Issue: ${input.title}`, input.description.trim());
  if (input.troubleshooting.length) {
    lines.push("", "Troubleshooting done in house:");
    for (const step of input.troubleshooting) lines.push(`- ${step.trim()}`);
  }
  if (input.mediaLinks.length) {
    lines.push("", "Photos / video (links work for 7 days):");
    input.mediaLinks.forEach((media, index) => lines.push(`${media.kind === "video" ? "Video" : "Photo"} ${index + 1}: ${media.url}`));
  }
  lines.push(
    "",
    "Please reply to this email with your availability to come on site and any questions. Your reply goes straight to our team.",
  );
  return lines.join("\n");
}

export function findMaintenanceAlias(recipients: string[], domain: string | undefined): string | null {
  if (!domain) return null;
  for (const recipient of recipients) {
    const match = recipient.match(/<([^>]+)>/);
    const email = (match ? match[1] : recipient).trim().toLowerCase();
    if (email.startsWith(MAINTENANCE_ALIAS_PREFIX) && email.endsWith(`@${domain.toLowerCase()}`)) return email;
  }
  return null;
}
