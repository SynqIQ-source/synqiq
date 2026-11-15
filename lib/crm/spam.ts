// Website-form spam check. Bots fill forms with random strings ("Rgnbsqn",
// "xILGzbDrgSUsrgUtqSaJxBsF") and dotted Gmail addresses
// ("e.huk.ub.e.la.0.66@gmail.com"). Pure; unit-tested in tests/crm-spam.test.ts.
// Spam is held for a Club Admin to review instead of becoming a lead.

const VOWELS = /[aeiouy]/i;

// A token that looks machine-made: long, no spaces, case flipping a lot or
// almost no vowels.
export function looksRandom(token: string): boolean {
  const word = token.trim();
  if (word.length < 6 || /\s/.test(word)) return false;
  if (!/^[A-Za-z]+$/.test(word)) return false;
  const caseFlips = [...word].filter((c, i) => i > 0 && (c === c.toUpperCase()) !== (word[i - 1] === word[i - 1].toUpperCase())).length;
  const vowels = [...word].filter((c) => VOWELS.test(c)).length;
  const vowelShare = vowels / word.length;
  // Real names/words rarely flip case more than twice ("McDonald", "DeAndre").
  if (word.length >= 10 && caseFlips >= 4) return true;
  if (vowelShare < 0.2 && word.length >= 6) return true;
  // Long consonant runs ("Rgnbsqn" has "Rgnbsqn").
  if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(word)) return true;
  return false;
}

// Gmail ignores dots, so bots pad addresses with them.
export function dottedGmail(email: string | null): boolean {
  if (!email) return false;
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !/^(gmail|googlemail)\.com$/.test(domain ?? "")) return false;
  return (local.match(/\./g) ?? []).length >= 3;
}

export type SpamVerdict = { spam: boolean; reasons: string[] };

export function spamCheck(input: { firstName: string; lastName: string; email: string | null; message: string | null }): SpamVerdict {
  const reasons: string[] = [];
  const nameParts = `${input.firstName} ${input.lastName}`.trim().split(/\s+/).filter(Boolean);
  if (nameParts.some(looksRandom)) reasons.push("Name looks random");
  const message = (input.message ?? "").trim();
  if (message && message.split(/\s+/).length <= 2 && message.split(/\s+/).some((part) => looksRandom(part)))
    reasons.push("Message is random letters");
  if (dottedGmail(input.email)) reasons.push("Email padded with dots");
  if (/https?:\/\/|www\./i.test(message) && /(seo|backlink|crypto|loan|casino|ranking|traffic)/i.test(message)) reasons.push("Link spam");
  // One signal can be a real person (an unusual name); two is a bot.
  return { spam: reasons.length >= 2 || reasons.includes("Link spam"), reasons };
}
