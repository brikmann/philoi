import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';

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
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function ensureProfile(user: User): Promise<Profile> {
  const { data: existing } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (existing) return existing;

  const meta = user.user_metadata ?? {};
  const { data: created, error } = await supabase
    .from('profiles')
    .insert({
      id: user.id,
      handle: null,
      display_name: meta.full_name ?? meta.name ?? user.email?.split('@')[0] ?? 'New friend',
      avatar_url: meta.avatar_url ?? meta.picture ?? null,
      is_pro: false,
    })
    .select('*')
    .single();

  if (error) throw error;
  return created;
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
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        await loadProfileFor(data.session?.user);
      })
      .catch((e) => {
        console.error('[auth] failed to restore session/profile:', e);
        if (mounted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (mounted) setReady(true);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      try {
        await loadProfileFor(nextSession?.user);
        setError(null);
      } catch (e) {
        console.error('[auth] failed to load profile on auth change:', e);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setReady(true);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    session,
    profile,
    ready,
    error,
    needsHandle: Boolean(session && profile && !profile.handle),
    refreshProfile: async () => loadProfileFor(session?.user),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
