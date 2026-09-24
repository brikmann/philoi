// Tests for the now-playing read behind the lock-in music chip (spotify.ts) — run with:
//
//   deno test --allow-env supabase/functions/_shared/spotify.test.ts
//
// No network and no database: Spotify and the Supabase client are both stubbed. The things pinned
// are the ones that would fail silently in prod — a rotated refresh token that isn't persisted (a
// member quietly disconnected hours later), a token sealed under the calendar's key, a rate limit
// that still reaches Spotify, and any failure path that throws at the UI instead of degrading.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';

import { getNowPlaying, MAX_FETCHES_PER_HOUR, normalize } from './spotify.ts';
import { decryptSecret, encryptSecret } from './token-crypto.ts';

Deno.env.set('GCAL_TOKEN_ENC_KEY', btoa(String.fromCharCode(...new Uint8Array(32).fill(7))));
Deno.env.set('SPOTIFY_TOKEN_ENC_KEY', btoa(String.fromCharCode(...new Uint8Array(32).fill(9))));
Deno.env.set('SPOTIFY_CLIENT_ID', 'sp-id');
Deno.env.set('SPOTIFY_CLIENT_SECRET', 'sp-secret');

const NOW = new Date('2026-09-16T14:10:00Z');

// deno-lint-ignore no-explicit-any
type Any = any;

type State = { connection: Any; deleted: boolean };

function makeAdmin(state: State) {
  function table(_name: string) {
    const chain: Any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: state.connection }),
      update: (patch: Any) => {
        if (state.connection) Object.assign(state.connection, patch);
        return chain;
      },
      delete: () => {
        state.connection = null;
        state.deleted = true;
        return chain;
      },
      then: (resolve: Any) => resolve({ error: null }),
    };
    return chain;
  }
  return { from: table } as Any;
}

function res(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
  } as Any;
}

type Stub = {
  tokenCalls: number;
  playerCalls: number;
  basicAuthSeen: string | null;
  refreshBody: Any;
  player: () => Any;
};

function stubSpotify(stub: Stub) {
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://accounts.spotify.com/api/token') {
      stub.tokenCalls++;
      stub.basicAuthSeen = (init?.headers as Record<string, string>)?.Authorization ?? null;
      return Promise.resolve(stub.refreshBody());
    }
    if (url.startsWith('https://api.spotify.com/v1/me/player/currently-playing')) {
      stub.playerCalls++;
      return Promise.resolve(stub.player());
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  }) as typeof fetch;
}

const TRACK_BODY = {
  is_playing: true,
  currently_playing_type: 'track',
  item: {
    id: '4uLU6hMCjMI75M1A2tKUQC',
    name: 'Weightless',
    type: 'track',
    artists: [{ name: 'Marconi Union' }, { name: 'Lyrics Born' }],
    album: {
      images: [
        { url: 'https://i.scdn.co/640', width: 640, height: 640 },
        { url: 'https://i.scdn.co/300', width: 300, height: 300 },
        { url: 'https://i.scdn.co/64', width: 64, height: 64 },
      ],
    },
  },
};

Deno.test('getNowPlaying', async (t) => {
  const realFetch = globalThis.fetch;
  const state: State = { connection: null, deleted: false };
  const admin = makeAdmin(state);
  const stub: Stub = {
    tokenCalls: 0,
    playerCalls: 0,
    basicAuthSeen: null,
    refreshBody: () => res(200, { access_token: 'at-1', token_type: 'Bearer', expires_in: 3600 }),
    player: () => res(200, TRACK_BODY),
  };
  stubSpotify(stub);

  const connect = async () => {
    state.deleted = false;
    state.connection = {
      refresh_token_encrypted: await encryptSecret('rt-original', 'SPOTIFY_TOKEN_ENC_KEY'),
      scopes: 'user-read-currently-playing user-read-playback-state',
      fetch_count: 0,
      fetch_window_started_at: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(),
    };
  };

  await t.step('no connection → not_connected, and Spotify is never called', async () => {
    const np = await getNowPlaying(admin, 'u1', { now: NOW });
    assertEquals(np.connected, false);
    assertEquals(np.reason, 'not_connected');
    assertEquals(stub.tokenCalls + stub.playerCalls, 0);
  });

  await t.step('a playing track is normalized to exactly the chip fields', async () => {
    await connect();
    const np = await getNowPlaying(admin, 'u1', { now: NOW });
    assertEquals(np, {
      connected: true,
      reason: null,
      isPlaying: true,
      track: 'Weightless',
      artist: 'Marconi Union, Lyrics Born',
      albumArt: 'https://i.scdn.co/300',
      trackId: '4uLU6hMCjMI75M1A2tKUQC',
    });
    assertEquals(stub.tokenCalls, 1);
    assertEquals(stub.playerCalls, 1);
    assertEquals(stub.basicAuthSeen, `Basic ${btoa('sp-id:sp-secret')}`);
    assertEquals(state.connection.fetch_count, 1, 'the read is counted');
    assert(!JSON.stringify(np).includes('at-1'), 'the access token never leaves the module');
  });

  await t.step('204 → connected, nothing playing', async () => {
    stub.player = () => res(204);
    const np = await getNowPlaying(admin, 'u1', { now: NOW });
    assertEquals(np.connected, true);
    assertEquals(np.reason, null);
    assertEquals(np.isPlaying, false);
    assertEquals(np.track, null);
  });

  await t.step('a rotated refresh token is persisted, sealed under the SPOTIFY key', async () => {
    stub.player = () => res(200, TRACK_BODY);
    stub.refreshBody = () => res(200, { access_token: 'at-2', refresh_token: 'rt-rotated' });
    await getNowPlaying(admin, 'u1', { now: NOW });
    const stored = state.connection.refresh_token_encrypted;
    assertEquals(await decryptSecret(stored, 'SPOTIFY_TOKEN_ENC_KEY'), 'rt-rotated');
    // Control: the calendar key must not open it.
    await assertRejects(() => decryptSecret(stored));
  });

  await t.step('no rotation → the stored token is left untouched', async () => {
    stub.refreshBody = () => res(200, { access_token: 'at-3' });
    const before = state.connection.refresh_token_encrypted;
    await getNowPlaying(admin, 'u1', { now: NOW });
    assertEquals(state.connection.refresh_token_encrypted, before);
  });

  await t.step('rate limited → no Spotify call at all', async () => {
    state.connection.fetch_count = MAX_FETCHES_PER_HOUR;
    state.connection.fetch_window_started_at = NOW.toISOString();
    const calls = stub.tokenCalls + stub.playerCalls;
    const np = await getNowPlaying(admin, 'u1', { now: NOW });
    assertEquals(np.reason, 'rate_limited');
    assertEquals(stub.tokenCalls + stub.playerCalls, calls);
  });

  await t.step('the limit resets once the hour has passed', async () => {
    const later = new Date(NOW.getTime() + 61 * 60 * 1000);
    const np = await getNowPlaying(admin, 'u1', { now: later });
    assertEquals(np.connected, true);
    assertEquals(state.connection.fetch_count, 1);
    assertEquals(state.connection.fetch_window_started_at, later.toISOString());
  });

  await t.step('403 (dev-mode allowlist) → forbidden, and the connection is kept', async () => {
    stub.player = () => res(403, { error: { status: 403 } });
    const np = await getNowPlaying(admin, 'u1', { now: NOW });
    assertEquals(np.reason, 'forbidden');
    assertEquals(state.deleted, false);
  });

  await t.step('Spotify 429 → rate_limited, not an error', async () => {
    stub.player = () => res(429);
    assertEquals((await getNowPlaying(admin, 'u1', { now: NOW })).reason, 'rate_limited');
  });

  await t.step('invalid_grant → revoked, and the row is forgotten', async () => {
    stub.refreshBody = () => res(400, { error: 'invalid_grant' });
    const np = await getNowPlaying(admin, 'u1', { now: NOW });
    assertEquals(np.connected, false);
    assertEquals(np.reason, 'revoked');
    assertEquals(state.deleted, true);
  });

  await t.step('a non-invalid_grant token failure degrades but keeps the connection', async () => {
    await connect();
    stub.refreshBody = () => res(503, { error: 'server_error' });
    const np = await getNowPlaying(admin, 'u1', { now: NOW });
    assertEquals(np.reason, 'error');
    assertEquals(state.deleted, false);
  });

  await t.step('a network outage degrades quietly instead of throwing', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('network down'))) as typeof fetch;
    const np = await getNowPlaying(admin, 'u1', { now: NOW });
    assertEquals(np.connected, false);
    assertEquals(np.reason, 'error');
    stubSpotify(stub);
  });

  await t.step('a token sealed under the CALENDAR key degrades rather than throws', async () => {
    state.connection.refresh_token_encrypted = await encryptSecret('rt-wrong-key');
    const np = await getNowPlaying(admin, 'u1', { now: new Date(NOW.getTime() + 3 * 3600 * 1000) });
    assertEquals(np.reason, 'error');
  });

  globalThis.fetch = realFetch;
});

Deno.test('normalize', async (t) => {
  await t.step('a podcast episode uses the show as the artist and the episode art', () => {
    const np = normalize({
      is_playing: true,
      currently_playing_type: 'episode',
      item: {
        id: 'ep1',
        name: 'Deep Focus',
        type: 'episode',
        images: [{ url: 'https://i.scdn.co/ep300', width: 300 }],
        show: { name: 'Huberman Lab', images: [{ url: 'https://i.scdn.co/show', width: 300 }] },
      },
    });
    assertEquals(np.artist, 'Huberman Lab');
    assertEquals(np.albumArt, 'https://i.scdn.co/ep300');
    assertEquals(np.track, 'Deep Focus');
  });

  await t.step('an ad (is_playing, no item) reads as nothing playing', () => {
    const np = normalize({ is_playing: true, currently_playing_type: 'ad', item: null });
    assertEquals(np.connected, true);
    assertEquals(np.isPlaying, false);
    assertEquals(np.track, null);
  });

  await t.step('a local file has no id and no art, and that is fine', () => {
    const np = normalize({
      is_playing: false,
      item: { id: null, name: 'demo.mp3', type: 'track', artists: [{ name: 'Me' }], album: { images: [] } },
    });
    assertEquals(np.trackId, null);
    assertEquals(np.albumArt, null);
    assertEquals(np.isPlaying, false);
    assertEquals(np.track, 'demo.mp3');
  });

  await t.step('only small art available → the largest of it, not null', () => {
    const np = normalize({
      is_playing: true,
      item: { id: 't', name: 'x', type: 'track', artists: [], album: { images: [{ url: 'a', width: 64 }, { url: 'b', width: 120 }] } },
    });
    assertEquals(np.albumArt, 'b');
    assertEquals(np.artist, null);
  });
});
