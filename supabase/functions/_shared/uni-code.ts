// Shared between send_uni_code and verify_uni_code — the hash has to be computed identically on
// both sides or nothing ever verifies.

/** SHA-256 of `${code}:${userId}`. Salted with the user id so two people who happen to draw the
 * same 6 digits don't share a hash, and so a stolen hash can't be replayed against another
 * account. Codes are short-lived and single-purpose, so a fast hash is appropriate here — this
 * is not a password. */
export async function hashCode(code: string, userId: string): Promise<string> {
  const data = new TextEncoder().encode(`${code}:${userId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Six digits, uniformly distributed, from the CSPRNG — never Math.random(), which is seeded
 * predictably enough that a determined caller could narrow the search space. Leading zeros are
 * preserved (000123 is a valid code). */
export function generateCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

/** Constant-time comparison — a plain `===` on hex strings leaks, through timing, how many
 * leading characters matched, which is enough to reconstruct a hash byte by byte. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function domainOf(email: string): string {
  return email.trim().toLowerCase().split('@')[1] ?? '';
}

/** Deliberately permissive: the point is to catch a typo like a missing @, not to police which
 * addresses are "real". The code arriving is the actual proof. */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export const CODE_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_SECONDS = 45;
