// email-reply-parser ships no type declarations. Minimal ambient types for
// the surface lib/email/reply-parser.ts actually uses.
declare module "email-reply-parser" {
  class Email {
    getVisibleText(): string;
    getQuotedText(): string;
  }

  export default class EmailReplyParser {
    read(text: string): Email;
    parseReply(text: string): string;
  }
}
