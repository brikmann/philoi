// resolve-art (ShareSpot §5, ss3) — give a tagged thing its REAL artwork.
//
// POST { kind: 'game'|'song'|'film'|'show'|'book', query: string }
//   → { results: ArtEntity[] }   (best match first, at most 6)
//
// Every result is written to public.art_entities (service role only) under a canonical id like
// `itunes:software:479516143` or `openlibrary:OL27448W`. A post then attaches the CANONICAL ID only
// ({kind: 'art', key}) and agora_attachment_snapshot (0298) re-reads the row and freezes it — the
// same "client sends which, never what" rule as every other attachment. So nothing a client sends
// can put an arbitrary image URL on a card: the URL on the card is one this function fetched from a
// source's own API.
//
// SOURCES, keyless first. Prod has no Spotify / TMDB / IGDB secret today, so the floor is:
//   song → iTunes (Apple Music catalogue art)         show → iTunes (season key art)
//   game → iTunes App Store (the game's own key art)   book → OpenLibrary covers
//   film → NOTHING keyless. iTunes Search stopped indexing movies (0 results for any title, checked
//          2026-11-09), so the film tag returns [] until TMDB_READ_TOKEN is set.
// and each keyed source takes over its kind the moment its secret exists:
//   SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET (client-credentials, no user token) → song
//   TMDB_READ_TOKEN (v4 bearer) or TMDB_API_KEY (v3)                               → film, show
//   TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET (IGDB)                                  → game
// A keyed source that errors falls through to the keyless one rather than failing the tag.
//
// NO REAL PEOPLE. We never search a people index (no TMDB person/multi search, no Spotify artist
// search) and never take an artist image — songs get their ALBUM art. Nothing is downloaded or
// re-hosted: art_url is the source CDN's own URL.
//
// Caching: (kind, normalized query) → canonical ids in art_search_cache for 30 days, so a popular
// tag ("minecraft") hits the sources once. Only cache misses count against the per-user limit.
//
// Self-contained on purpose (only ../_shared/cors.ts): `functions deploy` ships the on-disk
// _shared/, and this function should not carry a sibling session's uncommitted edits with it.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from '../_shared/cors.ts';

type ArtKind = 'game' | 'song' | 'film' | 'show' | 'book';
const KINDS: ArtKind[] = ['game', 'song', 'film', 'show', 'book'];

type ArtEntity = {
  canonical_id: string;
  kind: ArtKind;
  title: string;
  subtitle: string | null;
  art_url: string;
  source: 'spotify' | 'itunes' | 'tmdb' | 'igdb' | 'openlibrary';
  external_url: string | null;
};

const MAX_RESULTS = 6;
const CACHE_DAYS = 30;
const MISSES_PER_MINUTE = 20;
const TIMEOUT_MS = 6000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** "  Minecraft:  Java " → "minecraft: java". The cache key, and what the sources are sent. */
export function normalizeQuery(q: string): string {
  return q.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 80);
}

/** Only https art, and only from the CDNs these sources actually serve from. */
const ART_HOSTS = [
  /\.mzstatic\.com$/,
  /^i\.scdn\.co$/,
  /^image\.tmdb\.org$/,
  /^images\.igdb\.com$/,
  /^covers\.openlibrary\.org$/,
];
export function isAllowedArtUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && ART_HOSTS.some((h) => h.test(url.hostname));
  } catch {
    return false;
  }
}

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json();
}

// ───────────────────────────── iTunes (keyless) ─────────────────────────────

/** iTunes hands 100px art; the same path serves any size. */
function itunesArt(u: string | undefined): string | null {
  if (!u) return null;
  return u.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/, '/600x600bb.jpg');
}

async function itunes(kind: ArtKind, q: string): Promise<ArtEntity[]> {
  const params: Record<ArtKind, string> = {
    song: 'media=music&entity=song',
    film: 'media=movie&entity=movie',
    show: 'media=tvShow&entity=tvSeason',
    game: 'media=software&entity=software',
    book: 'media=ebook&entity=ebook',
  };
  const data = await getJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&${params[kind]}&limit=15&country=US`
  );
  let rows: any[] = Array.isArray(data?.results) ? data.results : [];
  // The App Store answers "minecraft" with guides and skin packs too; real games first.
  if (kind === 'game') {
    const games = rows.filter((r) => r.primaryGenreName === 'Games' || (r.genres ?? []).includes('Games'));
    if (games.length) rows = games;
  }
  const out: ArtEntity[] = [];
  for (const r of rows) {
    const art = itunesArt(r.artworkUrl100 ?? r.artworkUrl60);
    if (!art) continue;
    const id = r.trackId ?? r.collectionId;
    if (!id) continue;
    const title = kind === 'show' ? (r.artistName ?? r.collectionName) : (r.trackName ?? r.collectionName);
    if (!title) continue;
    const year = typeof r.releaseDate === 'string' ? r.releaseDate.slice(0, 4) : null;
    const subtitle =
      kind === 'song'
        ? [r.artistName, r.collectionName].filter(Boolean).join(' · ')
        : kind === 'game'
          ? (r.sellerName ?? r.artistName ?? null)
          : kind === 'show'
            ? (r.collectionName ?? null)
            : [r.artistName, year].filter(Boolean).join(' · ') || year;
    out.push({
      canonical_id: `itunes:${kind}:${id}`,
      kind,
      title: String(title).slice(0, 200),
      subtitle: subtitle ? String(subtitle).slice(0, 200) : null,
      art_url: art,
      source: 'itunes',
      external_url: r.trackViewUrl ?? r.collectionViewUrl ?? null,
    });
  }
  return out;
}

// ───────────────────────────── OpenLibrary (keyless) ─────────────────────────────

async function openLibrary(q: string): Promise<ArtEntity[]> {
  const data = await getJson(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12&fields=key,title,author_name,cover_i,first_publish_year`,
    // OpenLibrary asks automated clients to identify themselves.
    { headers: { 'User-Agent': 'PhiloiArtResolver/1.0 (https://philoi.app)' } }
  );
  const docs: any[] = Array.isArray(data?.docs) ? data.docs : [];
  return docs
    .filter((d) => d.cover_i && d.key && d.title)
    .map((d) => ({
      canonical_id: `openlibrary:${String(d.key).replace('/works/', '')}`,
      kind: 'book' as const,
      title: String(d.title).slice(0, 200),
      subtitle: [d.author_name?.[0], d.first_publish_year].filter(Boolean).join(' · ') || null,
      art_url: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`,
      source: 'openlibrary' as const,
      external_url: `https://openlibrary.org${d.key}`,
    }));
}

// ───────────────────────────── Spotify (client credentials) ─────────────────────────────

async function spotify(q: string): Promise<ArtEntity[] | null> {
  const id = Deno.env.get('SPOTIFY_CLIENT_ID');
  const secret = Deno.env.get('SPOTIFY_CLIENT_SECRET');
  if (!id || !secret) return null;
  const token = await getJson('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  // type=track only: an artist result carries a photo of a real person.
  const data = await getJson(`https://api.spotify.com/v1/search?type=track&limit=10&q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const items: any[] = data?.tracks?.items ?? [];
  return items
    .filter((t) => t.id && t.album?.images?.[0]?.url)
    .map((t) => ({
      canonical_id: `spotify:track:${t.id}`,
      kind: 'song' as const,
      title: String(t.name).slice(0, 200),
      subtitle: [t.artists?.map((a: any) => a.name).join(', '), t.album?.name].filter(Boolean).join(' · ') || null,
      art_url: t.album.images[0].url,
      source: 'spotify' as const,
      external_url: t.external_urls?.spotify ?? null,
    }));
}

// ───────────────────────────── TMDB ─────────────────────────────

async function tmdb(kind: 'film' | 'show', q: string): Promise<ArtEntity[] | null> {
  const bearer = Deno.env.get('TMDB_READ_TOKEN');
  const key = Deno.env.get('TMDB_API_KEY');
  if (!bearer && !key) return null;
  const path = kind === 'film' ? 'movie' : 'tv';
  const url = `https://api.themoviedb.org/3/search/${path}?include_adult=false&query=${encodeURIComponent(q)}${bearer ? '' : `&api_key=${key}`}`;
  const data = await getJson(url, bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : undefined);
  const rows: any[] = data?.results ?? [];
  return rows
    .filter((r) => r.id && r.poster_path)
    .map((r) => {
      const title = kind === 'film' ? r.title : r.name;
      const date = kind === 'film' ? r.release_date : r.first_air_date;
      return {
        canonical_id: `tmdb:${path}:${r.id}`,
        kind,
        title: String(title).slice(0, 200),
        subtitle: typeof date === 'string' && date ? date.slice(0, 4) : null,
        art_url: `https://image.tmdb.org/t/p/w500${r.poster_path}`,
        source: 'tmdb' as const,
        external_url: `https://www.themoviedb.org/${path}/${r.id}`,
      };
    });
}

// ───────────────────────────── IGDB (Twitch app token) ─────────────────────────────

async function igdb(q: string): Promise<ArtEntity[] | null> {
  const id = Deno.env.get('TWITCH_CLIENT_ID');
  const secret = Deno.env.get('TWITCH_CLIENT_SECRET');
  if (!id || !secret) return null;
  const token = await getJson(
    `https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  const safe = q.replace(/["\\;]/g, ' ');
  const rows: any[] = await getJson('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'Client-ID': id, Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'text/plain' },
    body: `search "${safe}"; fields name,slug,cover.image_id,first_release_date; where cover != null & version_parent = null; limit 10;`,
  });
  return (Array.isArray(rows) ? rows : [])
    .filter((g) => g.id && g.cover?.image_id)
    .map((g) => ({
      canonical_id: `igdb:${g.id}`,
      kind: 'game' as const,
      title: String(g.name).slice(0, 200),
      subtitle: g.first_release_date ? String(new Date(g.first_release_date * 1000).getUTCFullYear()) : null,
      art_url: `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`,
      source: 'igdb' as const,
      external_url: g.slug ? `https://www.igdb.com/games/${g.slug}` : null,
    }));
}

/** Keyed source first; on no key, an error or no hits, the keyless floor. */
async function lookup(kind: ArtKind, q: string): Promise<ArtEntity[]> {
  const keyed = async (): Promise<ArtEntity[] | null> => {
    if (kind === 'song') return spotify(q);
    if (kind === 'film' || kind === 'show') return tmdb(kind, q);
    if (kind === 'game') return igdb(q);
    return null;
  };
  try {
    const hits = await keyed();
    if (hits && hits.length) return hits;
  } catch (e) {
    console.error(`resolve-art keyed source failed for ${kind}:`, e instanceof Error ? e.message : e);
  }
  return kind === 'book' ? openLibrary(q) : itunes(kind, q);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body: { kind?: string; query?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }
  const kind = body.kind as ArtKind;
  if (!KINDS.includes(kind)) return json({ error: 'Unknown kind' }, 400);
  const q = normalizeQuery(String(body.query ?? ''));
  if (q.length < 2) return json({ results: [] });

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ── cache hit ──
  const since = new Date(Date.now() - CACHE_DAYS * 86400_000).toISOString();
  const { data: cached } = await service
    .from('art_search_cache')
    .select('canonical_ids')
    .eq('kind', kind)
    .eq('query', q)
    .gte('resolved_at', since)
    .maybeSingle();
  if (cached?.canonical_ids?.length) {
    const ids: string[] = cached.canonical_ids;
    const { data: rows } = await service
      .from('art_entities')
      .select('canonical_id, kind, title, subtitle, art_url, source, external_url')
      .in('canonical_id', ids);
    if (rows && rows.length) {
      const byId = new Map(rows.map((r) => [r.canonical_id, r]));
      return json({ results: ids.map((id) => byId.get(id)).filter(Boolean), cached: true });
    }
  }

  // ── miss: rate-limit, then ask the sources ──
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await service
    .from('art_resolve_log')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('at', minuteAgo);
  if ((count ?? 0) >= MISSES_PER_MINUTE) return json({ error: 'Slow down a moment' }, 429);
  await service.from('art_resolve_log').insert({ user_id: user.id, kind });

  let results: ArtEntity[];
  try {
    results = (await lookup(kind, q)).filter((r) => isAllowedArtUrl(r.art_url));
  } catch (e) {
    console.error(`resolve-art lookup failed for ${kind} "${q}":`, e instanceof Error ? e.message : e);
    return json({ error: 'Art lookup failed' }, 502);
  }
  // One entity per canonical id, best first.
  const seen = new Set<string>();
  results = results.filter((r) => (seen.has(r.canonical_id) ? false : (seen.add(r.canonical_id), true))).slice(0, MAX_RESULTS);

  if (results.length) {
    const now = new Date().toISOString();
    const { error: upErr } = await service
      .from('art_entities')
      .upsert(results.map((r) => ({ ...r, resolved_at: now })), { onConflict: 'canonical_id' });
    if (upErr) console.error('resolve-art entity upsert failed:', upErr.message);
    const { error: cacheErr } = await service
      .from('art_search_cache')
      .upsert(
        { kind, query: q, canonical_ids: results.map((r) => r.canonical_id), resolved_at: now },
        { onConflict: 'kind,query' }
      );
    if (cacheErr) console.error('resolve-art cache upsert failed:', cacheErr.message);
  }
  return json({ results });
});
