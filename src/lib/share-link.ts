import type { Ionicons } from '@expo/vector-icons';
import { Linking } from 'react-native';

import type { AgoraAttachSnapshot } from '@/types/database';

// A link shared in from another app (0294). Instagram hands Philoi a Reel's URL, never its video,
// so "share a Reel to Philoi" posts the link: an Agora post carrying one `link` attachment, drawn
// as a card that opens the Reel where it lives.
//
// The server freezes {url, host, provider}; the words ("Instagram Reel") are derived here, beside
// the shape check the composer runs before it sends anything — the same rule 0294 enforces, so a
// link the composer accepts is one the server accepts.

export type LinkProvider = 'instagram' | 'tiktok' | 'youtube' | 'x' | 'spotify' | 'web';

/** 0294's shape: https, a dotted host, no whitespace, at most 2048 characters. */
const POSTABLE = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?([/?#]\S*)?$/i;

/** The first https URL in a share's text — apps often send "Check this out! https://…". */
const IN_TEXT = /https:\/\/[^\s<>"'`]+/i;

/**
 * Share-tracking parameters. They identify who shared the link (Instagram's igsh, YouTube's si),
 * which nobody posting a Reel to their friends means to broadcast, so they're dropped before posting.
 */
const TRACKING = /^(igsh|igshid|si|utm_[a-z]+|fbclid|gclid|ref_src|ref_url|_r|_t|is_from_webapp|sender_device|feature)$/i;

export function isPostableLink(url: string): boolean {
  return url.length >= 12 && url.length <= 2048 && POSTABLE.test(url);
}

/** Drops the share-tracking parameters; leaves anything else (a YouTube `t=` timestamp) alone. */
export function cleanLink(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const hash = url.indexOf('#', q);
  const base = url.slice(0, q);
  const query = url.slice(q + 1, hash < 0 ? undefined : hash);
  const fragment = hash < 0 ? '' : url.slice(hash);
  const kept = query.split('&').filter((pair) => pair && !TRACKING.test(pair.split('=')[0] ?? ''));
  return `${base}${kept.length ? `?${kept.join('&')}` : ''}${fragment}`;
}

/**
 * What a share carried, split into the link (if any) and the words around it. A share that IS a
 * link (`url`) wins; otherwise the first https URL in the text is taken out of it, so the caption
 * doesn't repeat the card. Trailing punctuation a sentence put after the URL is not part of it.
 */
export function splitSharedLink(input: { url?: string | null; text?: string | null }): { url: string | null; rest: string } {
  const text = (input.text ?? '').trim();
  let url = input.url?.trim() || null;
  let rest = text;
  if (!url) {
    const m = IN_TEXT.exec(text);
    if (m) {
      url = m[0].replace(/[).,!?;:\]]+$/, '');
      rest = (text.slice(0, m.index) + text.slice(m.index + url.length)).replace(/\s{2,}/g, ' ').trim();
    }
  } else if (rest.includes(url)) {
    rest = rest.replace(url, '').trim();
  }
  if (url) url = cleanLink(url);
  return { url: url && isPostableLink(url) ? url : null, rest };
}

function hostOf(url: string): string {
  const m = /^https:\/\/([^/:?#]+)/i.exec(url);
  return (m?.[1] ?? '').toLowerCase().replace(/^(www|m)\./, '');
}

/** The same classification 0294 freezes — used before posting, when there's no snapshot yet. */
export function linkProviderOf(url: string): LinkProvider {
  const host = hostOf(url);
  if (host === 'instagram.com' || host === 'instagr.am' || host.endsWith('.instagram.com')) return 'instagram';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') return 'youtube';
  if (host === 'x.com' || host === 'twitter.com') return 'x';
  if (host === 'spotify.com' || host.endsWith('.spotify.com')) return 'spotify';
  return 'web';
}

function pathOf(url: string): string {
  return url.replace(/^https:\/\/[^/?#]+/i, '').split(/[?#]/)[0] ?? '';
}

/** "Instagram Reel", "YouTube Short", "Post on X" — what the card is titled. */
export function linkTitle(url: string, provider: LinkProvider = linkProviderOf(url)): string {
  const path = pathOf(url).toLowerCase();
  switch (provider) {
    case 'instagram':
      if (path.startsWith('/reel')) return 'Instagram Reel';
      if (path.startsWith('/stories')) return 'Instagram story';
      return 'Instagram post';
    case 'tiktok':
      return 'TikTok';
    case 'youtube':
      return path.startsWith('/shorts') ? 'YouTube Short' : 'YouTube video';
    case 'x':
      return 'Post on X';
    case 'spotify':
      return 'Spotify';
    default:
      return hostOf(url) || 'Link';
  }
}

/** "instagram.com/reel/DAbc123" — the address, without the scheme, query or a trailing slash. */
export function linkCaption(url: string): string {
  const shown = `${hostOf(url)}${pathOf(url)}`.replace(/\/+$/, '');
  return shown.length > 60 ? `${shown.slice(0, 57)}…` : shown;
}

export const LINK_ICON: Record<LinkProvider, keyof typeof Ionicons.glyphMap> = {
  instagram: 'logo-instagram',
  tiktok: 'logo-tiktok',
  youtube: 'logo-youtube',
  x: 'logo-x',
  spotify: 'musical-notes',
  web: 'link-outline',
};

export const LINK_TINT: Record<LinkProvider, string> = {
  instagram: '#8A2C6B',
  tiktok: '#1F1A2E',
  youtube: '#8C1D1D',
  x: '#1C1C22',
  spotify: '#1B5E3A',
  web: '#2A2347',
};

/**
 * A YouTube thumbnail, derived from the video id — Google's own static image host, so no page is
 * fetched and nothing the poster typed becomes an image URL. Every other provider draws its glyph:
 * Instagram and TikTok offer no thumbnail without an API token, and an arbitrary og:image would put
 * an unvetted image from any host in front of everyone who scrolls past.
 */
export function linkThumb(url: string): string | null {
  if (linkProviderOf(url) !== 'youtube') return null;
  const m = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/.exec(url);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null;
}

/**
 * Opens a posted link where it lives — Instagram / YouTube / TikTok take their own URLs as universal
 * links, so a Reel opens in Instagram when it's installed and in the browser when it isn't. Re-checks
 * the shape first: the snapshot is server-checked, but this is the one place a URL leaves the app.
 */
export function openPostedLink(url: string): void {
  if (!isPostableLink(url)) return;
  Linking.openURL(url).catch(() => {
    // Nothing can open it (no browser at all) — the card stays as it was.
  });
}

/** The frozen snapshot's provider, when it's one this build knows. */
export function snapshotProvider(snap: AgoraAttachSnapshot): LinkProvider {
  const p = snap.provider;
  return p === 'instagram' || p === 'tiktok' || p === 'youtube' || p === 'x' || p === 'spotify' ? p : 'web';
}
