import { supabase } from '@/lib/supabase';
import type { ArtKind } from '@/types/database';

// The art resolver (ShareSpot §5, migration 0298, edge function `resolve-art`).
//
// Tag a thing — a game, a song, a film, a show, a book — and get back its REAL artwork from the
// source's own API (iTunes / OpenLibrary keyless; Spotify / TMDB / IGDB once their server secrets
// exist). Everything heavy is server-side: no art SDK ships in the client, and no API key either.
//
// A post attaches the CANONICAL ID only — `{ kind: 'art', ref_id: null, key: canonical_id }` — and
// the server freezes the entity into the post (agora_attachment_snapshot). So the title and image
// on a card are what the resolver fetched, never what this client sends.
//
// Consumers: the composer (ss3), Discover (ss2), Campfire (ss5).

export type { ArtKind };

export type ArtEntity = {
  canonical_id: string;
  kind: ArtKind;
  title: string;
  subtitle: string | null;
  art_url: string;
  source: 'spotify' | 'itunes' | 'tmdb' | 'igdb' | 'openlibrary';
  external_url: string | null;
};

export const ART_KINDS: { key: ArtKind; label: string; placeholder: string }[] = [
  { key: 'game', label: 'Game', placeholder: 'Minecraft, Elden Ring…' },
  { key: 'song', label: 'Song', placeholder: 'A song or artist' },
  { key: 'film', label: 'Film', placeholder: 'A movie' },
  { key: 'show', label: 'Show', placeholder: 'A TV show' },
  { key: 'book', label: 'Book', placeholder: 'A book or author' },
];

/** The eyebrow a card draws over a tag: "GAME", "SONG"… */
export const ART_KIND_LABEL: Record<ArtKind, string> = {
  game: 'Game',
  song: 'Song',
  film: 'Film',
  show: 'Show',
  book: 'Book',
};

/** Small attribution line, shown beside art from a source that asks for one. */
export const ART_SOURCE_LABEL: Record<ArtEntity['source'], string> = {
  spotify: 'Spotify',
  itunes: 'Apple',
  tmdb: 'TMDB',
  igdb: 'IGDB',
  openlibrary: 'Open Library',
};

/**
 * Best matches first, at most 6. Empty for a query under two characters. Throws on a network or
 * server failure, and on the per-user rate limit (429) — callers show "try again" rather than an
 * empty list that would read as "no such thing".
 */
export async function resolveArt(kind: ArtKind, query: string): Promise<ArtEntity[]> {
  if (query.trim().length < 2) return [];
  const { data, error } = await supabase.functions.invoke<{ results: ArtEntity[] }>('resolve-art', {
    body: { kind, query },
  });
  if (error) throw error;
  return data?.results ?? [];
}

/** An already-resolved entity by id (Discover / Campfire re-draw a tag without re-searching). */
export async function fetchArtEntity(canonicalId: string): Promise<ArtEntity | null> {
  const { data, error } = await supabase
    .from('art_entities' as never)
    .select('canonical_id, kind, title, subtitle, art_url, source, external_url')
    .eq('canonical_id', canonicalId)
    .maybeSingle();
  if (error) throw error;
  return (data as ArtEntity | null) ?? null;
}
