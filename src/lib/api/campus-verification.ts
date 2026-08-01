import { track } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';

// Campus email verification (UNI_VERIFICATION_SPEC.md). Both calls go to Edge Functions running
// as service role — the client can't read or write uni_verification_codes at all (RLS with no
// policies), so a code hash or attempt count never reaches the device.
//
// Note what this ISN'T: supabase.auth.signInWithOtp / verifyOtp. Those sign the user in AS the
// uni address, i.e. a different auth user, which would replace the Google/Apple session that
// owns their profile. The campus email is an attribute, never a login.

/** Why a send or verify failed, in a form the UI can branch on — the human-readable message
 * comes back alongside it, so screens show the server's wording rather than reinventing it. */
export type CampusVerificationReason =
  | 'no_domain'
  | 'wrong_domain'
  | 'cooldown'
  | 'send_failed'
  | 'no_sender'
  | 'no_code'
  | 'expired'
  | 'wrong_code'
  | 'email_mismatch'
  | 'too_many_attempts'
  | 'school_changed'
  | 'malformed';

export class CampusVerificationError extends Error {
  readonly reason: CampusVerificationReason | null;
  /** Seconds left on the resend cooldown (reason === 'cooldown'). */
  readonly retryAfter: number | null;
  /** Guesses remaining before a fresh code is required (reason === 'wrong_code'). */
  readonly attemptsLeft: number | null;
  /** The domain the caller should have used (reason === 'wrong_domain'). */
  readonly domain: string | null;

  constructor(message: string, extra: Partial<Pick<CampusVerificationError, 'reason' | 'retryAfter' | 'attemptsLeft' | 'domain'>> = {}) {
    super(message);
    this.name = 'CampusVerificationError';
    this.reason = extra.reason ?? null;
    this.retryAfter = extra.retryAfter ?? null;
    this.attemptsLeft = extra.attemptsLeft ?? null;
    this.domain = extra.domain ?? null;
  }
}

type FailureBody = {
  error?: string;
  reason?: CampusVerificationReason;
  retryAfter?: number;
  attemptsLeft?: number;
  domain?: string;
};

// supabase-js surfaces a non-2xx from an Edge Function as a FunctionsHttpError whose body has to
// be read off `context` — without this, every failure collapses to the useless "Edge Function
// returned a non-2xx status code" and the user never learns the code was simply expired.
async function toCampusError(error: unknown, fallback: string): Promise<CampusVerificationError> {
  const response = (error as { context?: Response })?.context;
  if (response && typeof response.json === 'function') {
    try {
      const body = (await response.json()) as FailureBody;
      return new CampusVerificationError(body.error ?? fallback, {
        reason: body.reason,
        retryAfter: body.retryAfter,
        attemptsLeft: body.attemptsLeft,
        domain: body.domain,
      });
    } catch {
      // Body already consumed or not JSON — fall through to the generic message.
    }
  }
  return new CampusVerificationError(fallback);
}

export type SendCampusCodeResult = {
  email: string;
  expiresInMinutes: number;
  cooldownSeconds: number;
};

/** Mails a 6-digit code. The domain is checked server-side against the profile's
 * university_domain; the local part is never validated (§1b — conventions vary within a school
 * and the code arriving is the real proof). */
export async function sendCampusCode(email: string): Promise<SendCampusCodeResult> {
  const { data, error } = await supabase.functions.invoke('send_uni_code', { body: { email: email.trim() } });
  if (error) throw await toCampusError(error, 'Could not send that code — try again in a moment.');
  track('campus_code_sent', {});
  return {
    email: data?.email ?? email.trim().toLowerCase(),
    expiresInMinutes: data?.expiresInMinutes ?? 10,
    cooldownSeconds: data?.cooldownSeconds ?? 45,
  };
}

/** On success the caller MUST refresh the profile — university_email_verified is what unlocks
 * the campus boards, and the local copy is stale until it's re-read. */
export async function verifyCampusCode(email: string, code: string): Promise<{ email: string; university: string | null }> {
  const { data, error } = await supabase.functions.invoke('verify_uni_code', {
    body: { email: email.trim(), code: code.trim() },
  });
  if (error) throw await toCampusError(error, 'Could not check that code.');
  track('campus_verified', {});
  return { email: data?.email ?? email.trim().toLowerCase(), university: data?.university ?? null };
}

/** Saves the school + its domain together. They travel as a pair on purpose: a name without a
 * domain silently means "can never be verified", and letting them drift apart is how someone
 * ends up verified against the wrong campus. */
export async function saveUniversity(userId: string, university: string | null, domain: string | null): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ university, university_domain: domain })
    .eq('id', userId);
  if (error) throw error;
}
