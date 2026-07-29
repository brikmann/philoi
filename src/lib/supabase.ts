import { AppState } from 'react-native';
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

const { supabaseUrl, supabaseAnonKey } = Constants.expoConfig?.extra ?? {};

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase config. Set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file (see .env.example).'
  );
}

// AsyncStorage's web implementation reads window.localStorage unconditionally (it keys off
// Platform.OS === 'web', which is true even when this module is evaluated by Metro's Node.js
// SSR renderer for the web bundle) — crashing the whole dev server with "window is not
// defined" the moment the client tries to recover a session. No real session to recover
// during a server render anyway, so fall back to an inert no-op storage there.
const storage =
  typeof window === 'undefined'
    ? { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }
    : AsyncStorage;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Stop the auto-refresh timer when the app backgrounds, restart on foreground —
// avoids burning refresh calls while the app isn't visible.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
