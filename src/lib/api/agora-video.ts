import { File } from 'expo-file-system';

import { uploadClipAsset } from '@/lib/api/gym-clips';
import { supabase } from '@/lib/supabase';
import type { AgoraItem } from '@/types/database';

// Agora video posts (migration 0279). The bytes live in R2 beside the gym clips, private: a clip
// is uploaded through a signed PUT from `agora-video-upload-url` and played through signed GETs
// from `agora-video-playback-url`, which only signs for posts the viewer can open.
//
// The POST itself still goes through create_agora_post — the clip is one more element of
// `p_attachments` (`{kind: 'video', key}`), and the server freezes its snapshot from the upload
// ledger the edge function wrote, never from anything sent here.
//
// Native modules (react-native-compressor, expo-video-thumbnails) are required lazily inside the
// functions, same as gym-clip-recorder.tsx and for the same reason.

/** The limits the server enforces too (agora-video-upload-url + 0279's CHECKs). */
export const AGORA_VIDEO_MAX_SECONDS = 60;
export const AGORA_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/** Long edge after compression. 720p-class: plenty on a feed card, and ~5–15 MB a minute. */
const MAX_EDGE_PX = 1280;

/** What a posted clip's snapshot carries (frozen by agora_attachment_snapshot's 'video' arm). */
export type AgoraVideoSnapshot = {
  video_key: string;
  poster_key: string;
  duration_s: number;
  width: number | null;
  height: number | null;
};

/** A clip compressed and ready to upload, with its poster frame. */
export type PreparedAgoraVideo = {
  uri: string;
  posterUri: string;
  bytes: number;
  posterBytes: number;
  durationS: number;
  width: number | null;
  height: number | null;
};

/** A user-facing refusal (too long, too big) — the composer shows `message` as is. */
export class AgoraVideoLimitError extends Error {}

/**
 * Compress the clip on-device and pull its poster frame. `durationMs` is the picker's own reading;
 * it is checked BEFORE compressing so a 4-minute pick is refused in a moment, not after a minute
 * of encoding it.
 */
export async function prepareAgoraVideo(
  source: { uri: string; durationMs?: number | null },
  onProgress?: (fraction: number) => void
): Promise<PreparedAgoraVideo> {
  if (source.durationMs && source.durationMs / 1000 > AGORA_VIDEO_MAX_SECONDS + 0.5) {
    throw new AgoraVideoLimitError(tooLong(source.durationMs / 1000));
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred native import
  const { Video: VideoCompressor, getVideoMetaData } = require('react-native-compressor') as typeof import('react-native-compressor');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred native import
  const VideoThumbnails = require('expo-video-thumbnails') as typeof import('expo-video-thumbnails');

  const uri = await VideoCompressor.compress(
    source.uri,
    { compressionMethod: 'auto', maxSize: MAX_EDGE_PX },
    (p) => onProgress?.(Math.max(0, Math.min(1, p)))
  );

  const meta = await getVideoMetaData(uri);
  const durationS = Number(meta.duration) || (source.durationMs ?? 0) / 1000;
  if (durationS > AGORA_VIDEO_MAX_SECONDS + 0.5) throw new AgoraVideoLimitError(tooLong(durationS));
  const bytes = new File(uri).size;
  if (bytes > AGORA_VIDEO_MAX_BYTES) {
    throw new AgoraVideoLimitError('That video is still over 50 MB after compressing. Try a shorter clip.');
  }

  // Half a second in, not frame 0 — the first frame of a phone clip is often black or mid-blur.
  const poster = await VideoThumbnails.getThumbnailAsync(uri, {
    time: Math.min(500, Math.floor(durationS * 500)),
    quality: 0.7,
  });

  return {
    uri,
    posterUri: poster.uri,
    bytes,
    posterBytes: new File(poster.uri).size,
    durationS,
    width: meta.width ? Math.round(meta.width) : null,
    height: meta.height ? Math.round(meta.height) : null,
  };
}

function tooLong(seconds: number): string {
  return `That clip is ${Math.round(seconds)}s — videos can be up to ${AGORA_VIDEO_MAX_SECONDS}s. Trim it and try again.`;
}

/**
 * Upload a prepared clip and its poster, returning the key to attach. `onProgress` reports the
 * video's bytes (the poster is a few KB and rides alongside).
 *
 * If the post is then refused or abandoned, nothing here cleans up: the upload ledger row stays
 * unclaimed and 0279's hourly sweep purges both objects from R2 after a day.
 */
export async function uploadAgoraVideo(
  video: PreparedAgoraVideo,
  onProgress?: (fraction: number) => void
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('agora-video-upload-url', {
    body: {
      bytes: video.bytes,
      posterBytes: video.posterBytes,
      durationS: video.durationS,
      width: video.width,
      height: video.height,
    },
  });
  if (error) throw await functionError(error);
  if (data?.error) throw new Error(data.error);
  const urls = data as { videoKey: string; videoUploadUrl: string; posterUploadUrl: string };

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred native import
  const { backgroundUpload } = require('react-native-compressor') as typeof import('react-native-compressor');

  const [res] = await Promise.all([
    backgroundUpload(
      urls.videoUploadUrl,
      video.uri,
      { httpMethod: 'PUT', headers: { 'Content-Type': 'video/mp4' } },
      (written, total) => onProgress?.(total > 0 ? written / total : 0)
    ),
    uploadClipAsset(urls.posterUploadUrl, video.posterUri, 'image/jpeg'),
  ]);
  const status = Number((res as { status?: number } | null)?.status ?? 200);
  if (status < 200 || status >= 300) throw new Error(`Video upload failed (${status}).`);
  onProgress?.(1);
  return urls.videoKey;
}

/** supabase-js hides a function's JSON error body behind a generic message; surface it. */
async function functionError(error: unknown): Promise<Error> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return new Error(body.error);
    } catch {
      // Not JSON — fall through to the original.
    }
  }
  return error instanceof Error ? error : new Error('Could not upload the video.');
}

// ───────────────────────────── playback ─────────────────────────────

/** The video attachment on a feed item, if it has one. */
export function itemVideo(item: Pick<AgoraItem, 'attachments'>): AgoraVideoSnapshot | null {
  const snap = (item.attachments ?? []).find((x) => x?.kind === 'video')?.snapshot;
  if (!snap?.video_key || !snap.poster_key) return null;
  return {
    video_key: snap.video_key,
    poster_key: snap.poster_key,
    duration_s: Number(snap.duration_s) || 0,
    width: snap.width ?? null,
    height: snap.height ?? null,
  };
}

export type AgoraVideoUrls = { videoUrl: string; posterUrl: string };

type CacheEntry = { urls: AgoraVideoUrls | null; expiresAt: number };

// Signed URLs last an hour; refresh with ten minutes to spare so a clip never 403s mid-play.
const MARGIN_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
const waiting = new Map<string, ((urls: AgoraVideoUrls | null) => void)[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Signed poster + video URLs for one post, or null when this viewer can't open it (or it's gone).
 *
 * BATCHED: every card that asks within the same ~40ms shares one edge-function call, so a page of
 * twenty cards costs one round trip, not twenty — the reason usePublicLoadouts batches too.
 */
export function getAgoraVideoUrls(postId: string): Promise<AgoraVideoUrls | null> {
  const hit = cache.get(postId);
  if (hit && hit.expiresAt - MARGIN_MS > Date.now()) return Promise.resolve(hit.urls);

  return new Promise((resolve) => {
    const list = waiting.get(postId) ?? [];
    list.push(resolve);
    waiting.set(postId, list);
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), 40);
  });
}

async function flush() {
  flushTimer = null;
  const batch = new Map(waiting);
  waiting.clear();
  const ids = [...batch.keys()];

  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    let sources: Record<string, AgoraVideoUrls> = {};
    let expiresAt = Date.now() + 60 * 1000; // a failed call is retried after a minute, not cached for the hour
    try {
      const { data, error } = await supabase.functions.invoke('agora-video-playback-url', {
        body: { postIds: chunk },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      sources = data?.sources ?? {};
      if (data?.expiresAt) expiresAt = new Date(data.expiresAt).getTime();
    } catch {
      // Every card in the chunk falls back to its "unavailable" state.
    }
    for (const id of chunk) {
      const urls = sources[id] ?? null;
      cache.set(id, { urls, expiresAt });
      for (const resolve of batch.get(id) ?? []) resolve(urls);
    }
  }
}

/** "0:42" */
export function formatClipLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
