// Reduces a received email body to just the text the person newly typed --
// stripping quoted history and signatures so the relay doesn't forward an
// ever-growing pile of quoted thread on each hop.
//
// Primary: email-reply-parser, which handles the long tail of client
// quoting styles (Gmail, Outlook, Apple Mail, mobile). Fallback: a
// conservative line scanner for the handful of common markers, used only
// if the dep ever fails to load or throws.
import EmailReplyParser from "email-reply-parser";

const QUOTE_MARKERS: RegExp[] = [
  /^On .+ wrote:$/i,
  /^-{3,}\s*Original Message\s*-{3,}/i,
  /^_{5,}$/,
  /^From:\s.+/i,
  /^Sent from my /i,
  /^Get Outlook for /i,
];

export function extractReplyText(rawText: string): string {
  const normalized = (rawText ?? "").replace(/\r\n/g, "\n");

  try {
    const parsed = new EmailReplyParser().read(normalized);
    const visible = parsed.getVisibleText().trim();
    if (visible) {
      return visible;
    }
  } catch {
    // fall through to the scanner
  }

  return fallbackExtract(normalized);
}

function fallbackExtract(text: string): string {
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(">")) {
      break;
    }
    if (QUOTE_MARKERS.some((re) => re.test(trimmed))) {
      break;
    }
    kept.push(line);
  }
  const result = kept.join("\n").trim();
  // If the scan stripped everything (e.g. a top-posted reply we
  // misidentified), relay the original rather than an empty message.
  return result || text.trim();
}
