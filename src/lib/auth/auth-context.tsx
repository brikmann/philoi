import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { identify, track } from '@/lib/analytics';
import { signOutGoogle } from '@/lib/auth/providers';
import { configureBilling, resetBilling } from '@/lib/billing';
import { getErrorMessage } from '@/lib/errors';
import { unregisterPushToken } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  /** True once we've restored the session and (if signed in) loaded the profile row. */
  ready: boolean;
  /** Set if loading the session/profile failed — surfaced so the app doesn't spin forever silently. */
  error: string | null;
  /** True when signed in but the profile is missing a handle — show the handle-setup screen. */
  needsHandle: boolean;
  /** True when signed in but the user hasn't completed the 18+ attestation + consent screen. */
  needsConsent: boolean;
  /** True when a moderator has disabled this account (e.g. a confirmed CSAE action) — see admin_disable_account() in schema.sql. */
  needsAccountDisabled: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Session restore + profile load has no timeout of its own — on a stalled/dead connection
// the underlying fetch can hang indefinitely, which left `ready` stuck false forever (the
// app just sat on a blank screen; the only fix was force-quitting and reopening on the
// hope of a better connection next time). Bounding it means a bad connection surfaces the
// existing "Couldn't connect to Philoi" retry screen instead of hanging silently.
const AUTH_RESTORE_TIMEOUT_MS = 10000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function ensureProfile(user: User): Promise<Profile> {
  const { data: existing } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (existing) return existing;

  // Upsert, not insert — getSession() and onAuthStateChange's INITIAL_SESSION event both fire
  // this on first sign-in, racing on the insert otherwise (duplicate key on profiles_pkey).
  // Only touches id/display_name/avatar_url on conflict, so handle/university/is_pro on an
  // existing row are never clobbered.
  const meta = user.user_metadata ?? {};
  const { data: row, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: user.id,
        display_name: meta.full_name ?? meta.name ?? user.email?.split('@')[0] ?? 'New friend',
        avatar_url: meta.avatar_url ?? meta.picture ?? null,
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single();

  if (error) throw error;
  track('signed_up');
  return row;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadProfileFor(user: User | undefined) {
    if (!user) {
      setProfile(null);
      return;
    }
    const row = await ensureProfile(user);
    setProfile(row);
    identify(row.id, { handle: row.handle, university: row.university, display_name: row.display_name });
  }

  useEffect(() => {
    let mounted = true;

    withTimeout(
      supabase.auth.getSession().then(async ({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        await loadProfileFor(data.session?.user);
      }),
      AUTH_RESTORE_TIMEOUT_MS,
      'Timed out restoring your session — check your connection.'
    )
      .catch((e) => {
        console.error('[auth] failed to restore session/profile:', e);
        if (mounted) setError(getErrorMessage(e, 'Something went wrong restoring your session.'));
      })
      .finally(() => {
        if (mounted) setReady(true);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      try {
        await withTimeout(
          loadProfileFor(nextSession?.user),
          AUTH_RESTORE_TIMEOUT_MS,
          'Timed out loading your profile — check your connection.'
        );
        setError(null);
      } catch (e) {
        console.error('[auth] failed to load profile on auth change:', e);
        setError(getErrorMessage(e, 'Something went wrong loading your profile.'));
      } finally {
        setReady(true);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // RevenueCat is identified by the SUPABASE USER ID (#71). That's what ties an entitlement to an
  // account rather than to a device — without it, a reinstall or a new phone reads as a different
  // customer and the Forge Pass appears to vanish.
  //
  // Its own effect, keyed on the id, so it re-runs on a genuine account switch and not on every
  // profile refresh. Deliberately no cleanup: this effect's teardown fires on every id CHANGE, and
  // calling resetBilling() there would log the NEW user straight back out. Sign-out is where the
  // reset belongs, and that's where it is.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) return;
    void configureBilling(userId);
  }, [userId]);

  const value: AuthContextValue = {
    session,
    profile,
    ready,
    error,
    needsHandle: Boolean(session && profile && !profile.handle),
    needsConsent: Boolean(session && profile && !profile.has_consented),
    needsAccountDisabled: Boolean(session && profile && profile.is_disabled),
    refreshProfile: async () => loadProfileFor(session?.user),
    signOut: async () => {
      const userId = session?.user.id;
      // Drop the local session/profile BEFORE any of the awaits below (punchlist 6 §1). The
      // previous account's row — university_email_verified in particular — must never be
      // readable by a screen rendered after sign-out, and every call here is a network call
      // that can be slow or fail outright, which is exactly how a stale "You're verified at
      // {school}" panel survived into the next session.
      setSession(null);
      setProfile(null);
      if (userId) await unregisterPushToken(userId);
      // Same reason as the Google sign-out below: RevenueCat caches the identified user, so on a
      // shared device the next person to sign in would inherit this account's Forge Pass
      // entitlement until the SDK happened to refresh.
      await resetBilling();
      // Clear the native Google session too — otherwise the SDK's cached account survives
      // sign-out and "Continue with Google" logs straight back in with no account picker.
      await signOutGoogle();
      // Callers fire this and forget (there's no confirmation step anymore), so swallow rather
      // than leave an unhandled rejection: the local state above is already gone, which is what
      // the user asked for, and the stored session is cleared by supabase-js regardless.
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) console.warn('[auth] sign-out call failed:', signOutError);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
