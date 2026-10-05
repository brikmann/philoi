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

// iOS reuses a pooled HTTP/2 connection and, when the OS tears that connection down between
// requests, the next fetch rejects with NSURLErrorNetworkConnectionLost (-1005) —
// "The network connection was lost." It's a transport flake, not a real outage: the request
// never completed, so a plain re-send succeeds. Left unhandled it surfaced as the Friends tab's
// "fetch failed … network connection was lost" error card on first open (device triage).
//
// We only retry GETs. A failed GET (every PostgREST select — friends, loadouts, active lock-ins,
// social challenges) is safe to repeat; retrying a POST/RPC could double-apply an economy mutation,
// so those bubble the error up unchanged. A read-only RPC opts in with `rpc(fn, args, { get: true })`
// — PostgREST only serves GET for STABLE/IMMUTABLE functions and runs it read-only, so the server
// itself guarantees a GET it accepts is safe to repeat (see fetchInventory).
const CONNECTION_LOST = /network connection was lost|connection was lost|-1005|Network request failed/i;

/** True for the transport flake above. Accepts a thrown Error or a returned PostgrestError, whose
 * message postgrest-js builds as `${name}: ${message}` when the underlying fetch rejected. */
export function isConnectionLost(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : (err as { message?: unknown } | null)?.message;
  return typeof msg === 'string' && CONNECTION_LOST.test(msg);
}

const retryingFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? 'GET').toUpperCase();
  const retriable = method === 'GET';
  const maxAttempts = retriable ? 3 : 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= maxAttempts || !CONNECTION_LOST.test(msg)) break;
      // Short backoff lets iOS stand up a fresh connection before the re-send: 150ms, then 400ms.
      await new Promise((r) => setTimeout(r, attempt === 1 ? 150 : 400));
    }
  }
  throw lastErr;
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: retryingFetch,
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
