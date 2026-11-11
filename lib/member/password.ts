import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

// Member passwords and one-time tokens. Pure node:crypto; unit-tested in
// tests/member-password.test.ts.
//
// Passwords: scrypt (N=16384, r=8, p=1, 64-byte key, 16-byte salt), stored
// as "scrypt$N$r$p$salt$key" (base64) so the cost can be raised later.
// Tokens (session cookie, emailed links): 32 random bytes; only their
// sha256 is stored, so a database leak can't be replayed.

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, KEY_LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // No stored hash: still do the work so the response time doesn't reveal it.
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    await scrypt(password, randomBytes(16), N, R, P);
    return false;
  }
  const [, n, r, p, salt, key] = parts;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// What a new password needs. Returns the problem, or null when it's fine.
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "That's too long (200 characters at most).";
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) return "Don't use your email as your password.";
  if (/^(.)\1+$/.test(password)) return "Pick something harder to guess.";
  return null;
}

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Sign-in lockout: 5 wrong passwords in a row lock the account for 15
// minutes; a right one resets the count.
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export function afterFailedAttempt(failedAttempts: number, now: Date): { failedAttempts: number; lockedUntil: string | null } {
  const next = failedAttempts + 1;
  return next >= MAX_FAILED_ATTEMPTS
    ? { failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() }
    : { failedAttempts: next, lockedUntil: null };
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
