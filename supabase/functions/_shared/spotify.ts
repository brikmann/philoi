// Spotify → the lock-in music chip (CODE_PROMPT_spotify_backend.md). Mirrors _shared/gcal.ts: this
// module is the integration's surface, and spotify-now-playing is a thin HTTP wrapper around it.
//
// The contract, in one line:
//
//   getNowPlaying(admin, userId) -> NowPlaying
//
// It NEVER throws. No connection, a revoked grant, a rate-limited poll, a dev-mode allowlist
// refusal and a Spotify outage all come back as `connected: false` with a `reason` — the same
// "works-without-it" contract as the calendar. The chip is decoration on a lock-in; nothing about
// Spotify is worth an error state in front of someone trying to focus.
//
// WHAT IT DOES NOT DO: warehouse anything. There is no listening-history table and no now-playing
// cache — the track is read live, handed to the owner's own UI, and dropped. Access tokens are
// minted per read and never stored; only the refresh token sits at rest, AES-GCM-encrypted under
// SPOTIFY_TOKEN_ENC_KEY (its own key, not the calendar's — see token-crypto.ts).
//
// READ-ONLY BY SCOPE. No user-modify-playback-state: transport (play/pause/skip) is a later
// upgrade with Premium-only constraints, and a grant that cannot change playback cannot be abused
// to change it.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { decryptSecret, encryptSecret } from './token-crypto.ts';

export const SPOTIFY_TOKEN_KEY_ENV = 'SPOTIFY_TOKEN_ENC_KEY' as const;

/** What the authorize call asks for. `user-read-currently-playing` is the one this module needs;
 * `user-read-playback-state` rides along per the spec so a later "which device" line needs no
 * re-consent. */
export const SPOTIFY_OAUTH_SCOPES = ['user-read-currently-playing', 'user-read-playback-state'] as const;

const REQUIRED_SCOPE = 'user-read-currently-playing';

/** Whether a granted scope string can serve now-playing. Checked against Spotify's own `scope` on
 * the token response, not against what the app says it asked for. Returns false for a blank string;
 * callers that hold a stored row skip the check when `scopes` is blank rather than treat "unknown"
 * as "narrow", and let Spotify's 403 be the backstop. */
export function grantCoversNowPlaying(grantedScopes: string | null | undefined): boolean {
  if (!grantedScopes) return false;
  return grantedScopes.split(/\s+/).includes(REQUIRED_SCOPE);
}

/** Hard ceiling of Spotify reads per member per rolling hour. Every read is two Spotify calls
 * (token mint + currently-playing), and Spotify's rate limit is per APP, not per member — so one
 * runaway poll loop spends everyone's budget. 120/hour is a 30-second poll held for a full hour,
 * which is the cadence the client should use; a faster poll hits `rate_limited` for the rest of
 * the hour rather than hammering Spotify. */
export const MAX_FETCHES_PER_HOUR = 120;

/** A poll that hangs is a chip that never settles. Spotify answers in well under a second; past
 * this the member is better served by `error` and the next poll. */
const SPOTIFY_TIMEOUT_MS = 8000;

export type NowPlayingReason =
  | 'not_connected'
  | 'revoked'
  | 'rate_limited'
  /** Spotify refused the read: in development mode, a member who is not on the app's allowlist. */
  | 'forbidden'
  | 'error'
  | null;

/**
 * Flat on purpose — every field is always present, so the client never branches on shape.
 * `connected: true, isPlaying: false` with null fields is "connected, nothing playing" (Spotify's
 * 204). Only `not_connected` and `revoked` mean "show the Connect row"; `rate_limited`, `forbidden`
 * and `error` are transient and should keep the last good chip.
 */
export type NowPlaying = {
  connected: boolean;
  reason: NowPlayingReason;
  isPlaying: boolean;
  track: string | null;
  /** Artists joined with ", " for a track; the show name for a podcast episode. */
  artist: string | null;
  albumArt: string | null;
  /** Spotify id. Null for local files, which Spotify reports without one. */
  trackId: string | null;
};

export async function getNowPlaying(
  admin: SupabaseClient,
  userId: string,
  options: { now?: Date } = {}
): Promise<NowPlaying> {
  const now = options.now ?? new Date();
  try {
    return await loadNowPlaying(admin, userId, now);
  } catch (e) {
    console.error('[spotify] now-playing failed', userId, e instanceof Error ? e.message : e);
    return disconnected('error');
  }
}

type ConnectionRow = {
  refresh_token_encrypted: string;
  scopes: string;
  fetch_count: number;
  fetch_window_started_at: string;
};

async function loadNowPlaying(admin: SupabaseClient, userId: string, now: Date): Promise<NowPlaying> {
  const { data: connection } = await admin
    .from('spotify_connections')
    .select('refresh_token_encrypted, scopes, fetch_count, fetch_window_started_at')
    .eq('user_id', userId)
    .maybeSingle<ConnectionRow>();

  if (!connection) return disconnected('not_connected');
  if (connection.scopes && !grantCoversNowPlaying(connection.scopes)) return disconnected('not_connected');

  if (!withinRateLimit(connection, now)) return disconnected('rate_limited');

  // Counted BEFORE the Spotify calls, unlike gcal's record-after-success. gcal sits behind a
  // cache, so only successes cost Google anything; this has no cache, and a Spotify outage must
  // not become a free retry loop for a client polling through it.
  await recordFetch(admin, userId, connection, now);

  const storedRefreshToken = await decryptSecret(connection.refresh_token_encrypted, SPOTIFY_TOKEN_KEY_ENV);

  let accessToken: string;
  try {
    const minted = await refreshAccessToken(storedRefreshToken);
    accessToken = minted.accessToken;
    // Spotify MAY rotate the refresh token on refresh ("when a refresh token is not returned,
    // continue using the existing token"). When it does, the old one can stop working — failing
    // to persist the new one would silently disconnect the member on some later poll.
    if (minted.refreshToken && minted.refreshToken !== storedRefreshToken) {
      await admin
        .from('spotify_connections')
        .update({ refresh_token_encrypted: await encryptSecret(minted.refreshToken, SPOTIFY_TOKEN_KEY_ENV) })
        .eq('user_id', userId);
    }
  } catch (e) {
    if (e instanceof SpotifyGrantRevokedError) {
      // The member removed Philoi at spotify.com/account/apps (or the grant expired). Forget it
      // here too, so the status RPC stops claiming a connection that no longer exists.
      await forgetConnection(admin, userId);
      return disconnected('revoked');
    }
    throw e;
  }

  const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
  });

  // 204: no active device / nothing playing. Connected, just quiet.
  if (res.status === 204) return nothingPlaying();
  if (res.status === 403) return disconnected('forbidden');
  if (res.status === 429) return disconnected('rate_limited');
  if (!res.ok) throw new Error(`Spotify currently-playing failed (${res.status}).`);

  const body = (await res.json().catch(() => null)) as RawCurrentlyPlaying | null;
  if (!body) return nothingPlaying();
  return normalize(body);
}

// ── Spotify API ─────────────────────────────────────────────────────────────────────────────

export class SpotifyGrantRevokedError extends Error {}

/** `Authorization: Basic base64(client_id:client_secret)` — the server-secret variant of the
 * Authorization Code flow. The secret exists only in Edge Function secrets. */
export function spotifyBasicAuth(): string {
  return `Basic ${btoa(`${requireEnv('SPOTIFY_CLIENT_ID')}:${requireEnv('SPOTIFY_CLIENT_SECRET')}`)}`;
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string | null }> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: spotifyBasicAuth() },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant is Spotify's answer for a refresh token that is dead for good (revoked at
    // spotify.com/account/apps, or superseded) — not retryable.
    if (body?.error === 'invalid_grant') throw new SpotifyGrantRevokedError('Spotify grant is no longer valid.');
    throw new Error(`Spotify token refresh failed (${res.status}): ${body?.error ?? 'unknown'}`);
  }
  if (typeof body.access_token !== 'string') throw new Error('Spotify returned no access token.');
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
  };
}

type RawImage = { url?: string; width?: number | null; height?: number | null };

type RawCurrentlyPlaying = {
  is_playing?: boolean;
  currently_playing_type?: 'track' | 'episode' | 'ad' | 'unknown';
  item?: {
    id?: string | null;
    name?: string;
    type?: 'track' | 'episode';
    artists?: { name?: string }[];
    album?: { images?: RawImage[] };
    images?: RawImage[];
    show?: { name?: string; images?: RawImage[] };
  } | null;
};

/** Only the five fields the chip draws. Everything else Spotify sends — device, context,
 * progress, market data — is dropped here rather than passed through. */
export function normalize(raw: RawCurrentlyPlaying): NowPlaying {
  const item = raw.item;
  // An ad, or a private session, reports is_playing with no item. There is nothing to show, and
  // "playing" with blank fields is a worse chip than "nothing playing".
  if (!item || typeof item.name !== 'string') return nothingPlaying();

  const isEpisode = item.type === 'episode' || raw.currently_playing_type === 'episode';
  const artist = isEpisode
    ? item.show?.name ?? null
    : (item.artists ?? []).map((a) => a.name).filter((n): n is string => !!n).join(', ') || null;
  const images = isEpisode ? (item.images?.length ? item.images : item.show?.images) : item.album?.images;

  return {
    connected: true,
    reason: null,
    isPlaying: raw.is_playing === true,
    track: item.name,
    artist,
    albumArt: pickImage(images),
    trackId: typeof item.id === 'string' && item.id ? item.id : null,
  };
}

/** Spotify sends ~640/300/64px renditions. The chip is small but on a high-density screen, so the
 * smallest rendition at least ART_MIN_PX wide — not the 640 that costs a lock-in's worth of
 * cellular data over an hour of polls, and not the 64 that looks like mush. */
const ART_MIN_PX = 200;

function pickImage(images: RawImage[] | undefined): string | null {
  const usable = (images ?? []).filter((i): i is RawImage & { url: string } => typeof i.url === 'string' && !!i.url);
  if (!usable.length) return null;
  const bySize = [...usable].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (bySize.find((i) => (i.width ?? 0) >= ART_MIN_PX) ?? bySize[bySize.length - 1]).url;
}

// ── Rate limit + connection lifecycle ───────────────────────────────────────────────────────

type RateLimitRow = { fetch_count: number; fetch_window_started_at: string };

function hourElapsed(connection: RateLimitRow, now: Date): boolean {
  const windowStarted = Date.parse(connection.fetch_window_started_at);
  return !Number.isFinite(windowStarted) || now.getTime() - windowStarted >= 60 * 60 * 1000;
}

function withinRateLimit(connection: RateLimitRow, now: Date): boolean {
  return hourElapsed(connection, now) || connection.fetch_count < MAX_FETCHES_PER_HOUR;
}

async function recordFetch(admin: SupabaseClient, userId: string, connection: RateLimitRow, now: Date): Promise<void> {
  const fresh = hourElapsed(connection, now);
  await admin
    .from('spotify_connections')
    .update({
      last_fetched_at: now.toISOString(),
      fetch_count: fresh ? 1 : connection.fetch_count + 1,
      fetch_window_started_at: fresh ? now.toISOString() : connection.fetch_window_started_at,
    })
    .eq('user_id', userId);
}

/** Drops the grant. Used by the revoked-at-Spotify path above and by spotify-disconnect. There is
 * no now-playing cache to purge alongside it — if one is ever added, delete it here first. */
export async function forgetConnection(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from('spotify_connections').delete().eq('user_id', userId);
}

// ── Small helpers ───────────────────────────────────────────────────────────────────────────

function disconnected(reason: Exclude<NowPlayingReason, null>): NowPlaying {
  return { connected: false, reason, isPlaying: false, track: null, artist: null, albumArt: null, trackId: null };
}

function nothingPlaying(): NowPlaying {
  return { connected: true, reason: null, isPlaying: false, track: null, artist: null, albumArt: null, trackId: null };
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set on this Supabase project.`);
  return value;
}
