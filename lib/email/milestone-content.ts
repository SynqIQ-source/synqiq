// Class milestone emails: which milestones exist, the suggested wording
// instructors start from, and rendering. Pure.
import { brandedLayout, escapeHtml, fillPlain, type EmailKit } from "@/lib/email/studio-templates";

// 200 stands for "every 100 after the 100th" (200th, 300th, ...).
export const MILESTONES = [1, 3, 10, 25, 50, 100, 200] as const;
export type Milestone = (typeof MILESTONES)[number];
export const isMilestone = (value: unknown): value is Milestone => MILESTONES.includes(value as Milestone);

export function milestoneFor(classCount: number): Milestone | null {
  if ((MILESTONES as readonly number[]).includes(classCount) && classCount <= 100) return classCount as Milestone;
  return classCount > 100 && classCount % 100 === 0 ? 200 : null;
}

export function ordinal(n: number) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  return `${n}${suffix}`;
}

export const milestoneLabel = (milestone: Milestone) =>
  milestone === 200 ? "Every 100 after that (200th, 300th…)" : `${ordinal(milestone)} class`;

export const MILESTONE_FIELDS: Record<string, string> = {
  first_name: "Member's first name",
  count: "Which class, e.g. 10th",
  class_name: "The class",
  instructor: "Your first name",
  studio: "Studio name",
};

export const SUGGESTED: Record<Milestone, { subject: string; body: string }> = {
  1: {
    subject: "Welcome to {{studio}}, {{first_name}}!",
    body: "Hi {{first_name}},\n\nThanks for taking {{class_name}} with me. It was great to have you in your very first class at {{studio}}! Come back anytime, and say hi before class so I can help you get set up.\n\nSee you soon,\n{{instructor}}",
  },
  3: {
    subject: "Three classes in, {{first_name}}!",
    body: "Hi {{first_name}},\n\nThat was your 3rd class. You're building a habit! I loved having you in {{class_name}}.\n\nSee you next time,\n{{instructor}}",
  },
  10: {
    subject: "10 classes, {{first_name}}!",
    body: "Hi {{first_name}},\n\nCongratulations on your 10th class at {{studio}}! Your consistency is paying off. Thanks for spending it with me in {{class_name}}.\n\n{{instructor}}",
  },
  25: {
    subject: "25 classes! 🎉",
    body: "Hi {{first_name}},\n\n25 classes. That's real commitment! It was fun to celebrate it with you in {{class_name}}.\n\nKeep it up,\n{{instructor}}",
  },
  50: {
    subject: "50 classes, {{first_name}}!",
    body: "Hi {{first_name}},\n\nYou just took your 50th class at {{studio}}. That's amazing! Thank you for being part of our community.\n\n{{instructor}}",
  },
  100: {
    subject: "100 classes! 🏆",
    body: "Hi {{first_name}},\n\nYour 100th class! That's a huge milestone, and I'm proud I got to be part of it in {{class_name}}.\n\nHere's to the next 100,\n{{instructor}}",
  },
  200: {
    subject: "{{count}} class, {{first_name}}!",
    body: "Hi {{first_name}},\n\nThat was your {{count}} class at {{studio}}. Incredible! Thank you for showing up again and again.\n\n{{instructor}}",
  },
};

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;
export function unknownMilestoneFields(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]).filter((name) => !(name in MILESTONE_FIELDS)))];
}

export function fillMilestone(text: string, vars: Record<string, string>) {
  return fillPlain(text, vars).trim();
}

// The email as the member gets it: studio header and footer, the instructor's
// words (already filled in), no studio sign-off (the instructor signs it).
export function renderMilestoneEmail(kit: EmailKit, subject: string, body: string) {
  const content = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 16px">${escapeHtml(block)
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\n/g, "<br>")}</p>`,
    )
    .join("\n");
  return { subject: subject.replace(/\s+/g, " ").trim(), html: brandedLayout(kit.branding, content, { staff: true }) };
}
