import type { User } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import type { Profile } from '@/types/database';

// "Who signed in on this device last" — the sign-in screen reads it to say "Welcome back, @handle"
// and lead with the provider they used, so a lapsed session is one tap from home again.
//
// PUBLIC PROFILE FIELDS ONLY in the hint. The one credential this file keeps is the RESUME TOKEN
// below, stored under its own key and only between a plain sign-out and the next sign-in.
// SecureStore rather than AsyncStorage, so neither leaves the keychain or lands in backups.
//
// One account, the most recent. A different account signing in overwrites it; "Not you?" on the
// welcome-back screen and Settings' "Sign out & forget this device" delete it. Plain sign-out
// keeps it — that's the whole point.
const ACCOUNT_HINT_KEY = 'philoi_account_hint';

export type AccountHintProvider = 'google' | 'apple';

export type AccountHint = {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  provider: AccountHintProvider;
  last_signed_in_at: string;
};

/** The provider this session signed in with, when it's one the sign-in screen can relaunch. */
export function hintProviderOf(user: User): AccountHintProvider | null {
  const provider = user.app_metadata?.provider;
  return provider === 'google' || provider === 'apple' ? provider : null;
}

export async function getAccountHint(): Promise<AccountHint | null> {
  try {
    const raw = await SecureStore.getItemAsync(ACCOUNT_HINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccountHint>;
    // A garbled or half-written hint reads as "no hint" — the plain sign-in screen is always safe.
    if (
      typeof parsed?.user_id !== 'string' ||
      typeof parsed.handle !== 'string' ||
      !parsed.handle ||
      (parsed.provider !== 'google' && parsed.provider !== 'apple')
    ) {
      return null;
    }
    return {
      user_id: parsed.user_id,
      handle: parsed.handle,
      display_name: typeof parsed.display_name === 'string' ? parsed.display_name : parsed.handle,
      avatar_url: typeof parsed.avatar_url === 'string' ? parsed.avatar_url : null,
      provider: parsed.provider,
      last_signed_in_at: typeof parsed.last_signed_in_at === 'string' ? parsed.last_signed_in_at : '',
    };
  } catch {
    return null;
  }
}

/**
 * Remember this account. Called on every profile load (auth-context), which covers a fresh sign-in,
 * an account switch and the silent backfill for sessions that predate this feature. Skipped until
 * the profile has a handle — there's no "@" to greet mid-onboarding — and never for a disabled
 * account, which account-disabled.tsx signs out with `forget`.
 */
export async function rememberAccount(user: User, profile: Profile): Promise<void> {
  const provider = hintProviderOf(user);
  if (!provider || !profile.handle || profile.is_disabled) return;
  const hint: AccountHint = {
    user_id: profile.id,
    handle: profile.handle,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url ?? null,
    provider,
    last_signed_in_at: user.last_sign_in_at ?? new Date().toISOString(),
  };
  try {
    await SecureStore.setItemAsync(ACCOUNT_HINT_KEY, JSON.stringify(hint));
  } catch {
    // A failed write only means the next sign-in screen is the plain one.
  }
}

/** Forgets the account entirely: the greeting AND any resume token that would sign it back in. */
export async function clearAccountHint(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(ACCOUNT_HINT_KEY);
  } catch {
    // Best effort — a surviving hint only ever greets the account that wrote it.
  }
  await clearResumeToken();
}

// ── The resume token: what makes "Continue as @handle" actually one tap ─────────────────────────
//
// The hint alone could only relaunch the provider, and on iOS Google sign-in is web OAuth, so
// "Continue" opened the same "Philoi wants to use auth.philoi.app" sheet as the plain button. A
// plain sign-out now keeps the session's refresh token here and drops the session LOCALLY ONLY
// (auth-context), so "Continue" restores it with refreshSession and no sheet at all.
//
// The deliberate trade: a plain sign-out leaves that session alive on the server until the token is
// used or expires. Everything that means "forget me" — "Not you?", Settings' "Sign out & forget
// this device", a disabled or vanished account — goes through clearAccountHint above, which wipes
// it. Any live session also wipes it (auth-context, on profile load): a token is only ever kept
// for the gap between signing out and coming back.
const RESUME_KEY = 'philoi_resume_session';

/** Keeps `refreshToken` for `userId`. False when the keychain write failed — sign out for real. */
export async function saveResumeToken(userId: string, refreshToken: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(RESUME_KEY, JSON.stringify({ user_id: userId, refresh_token: refreshToken }));
    return true;
  } catch {
    return false;
  }
}

/** Reads AND deletes the token — single use either way, since a refresh rotates it. */
export async function takeResumeToken(userId: string): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(RESUME_KEY);
    await SecureStore.deleteItemAsync(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user_id?: unknown; refresh_token?: unknown };
    return parsed.user_id === userId && typeof parsed.refresh_token === 'string' ? parsed.refresh_token : null;
  } catch {
    return null;
  }
}

export async function clearResumeToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(RESUME_KEY);
  } catch {
    // Best effort.
  }
}
