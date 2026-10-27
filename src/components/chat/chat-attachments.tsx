import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AttachmentRow } from '@/components/agora/agora-card';
import { Icon } from '@/components/ui/icon';
import { AGORA_VIDEO_ENABLED, CHAT_VIDEO_ENABLED } from '@/constants/feature-flags';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { attachmentView } from '@/lib/agora-attachment';
import { formatClipLength } from '@/lib/api/agora-video';
import {
  cachedChatMediaUrl,
  chatVideoSnapshot,
  getChatVideoUrls,
  signChatMedia,
  type ChatAttachment,
  type ChatScope,
  type ChatVideoSnapshot,
  type ChatVideoUrls,
} from '@/lib/api/chat';
import type { AgoraAttachKind, AgoraAttachSnapshot } from '@/types/database';

// What a chat message CARRIES, drawn under (or instead of) its words — 0284's attachments.
//
//   · image  — a private chat-media object, shown through a signed URL; tap for full screen.
//   · file   — a chip with the name + size; tap opens the signed URL in the system viewer.
//   · anthem — the sender's grind song, frozen when they sent it; tap opens its link.
//   · video  — a clip in R2 (the Agora's upload path), poster + play; tap plays it in place.
//              Behind CHAT_VIDEO_ENABLED + AGORA_VIDEO_ENABLED — off, it draws nothing, like any
//              kind this build doesn't know.
//   · lockin / milestone / rank / streak / pass / cosmetic / pr — the Agora's own AttachmentRow,
//     through attachmentView, so a session shared in a DM is literally the card the feed draws.
//
// A kind this build doesn't know renders NOTHING rather than a broken tile. OTA is closed; what a
// shipped build does with tomorrow's kinds is decided today.
//
// Every tile takes the bubble's `onLongPress`. A tile is the innermost pressable, so it takes the
// responder: without passing it through, a long-press on a photo or a shared session reached no
// sheet at all, and only the strip of timestamp under it could be held to report or delete.

const SHARE_KINDS = new Set<string>(['lockin', 'milestone', 'rank', 'streak', 'pass', 'cosmetic', 'pr']);

function snap(a: ChatAttachment): Record<string, unknown> {
  return a.snapshot ?? {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The chip's type word, from the mime storage recorded (never the name the sender typed). */
const FILE_KIND_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/plain': 'TEXT',
  'text/markdown': 'MARKDOWN',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'WORD',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/heic': 'HEIC',
};

/** "2.4 MB" — the chip's size line. */
export function formatBytes(bytes: number | null): string | null {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A signed URL for one private object, from the session cache when it's fresh. */
function useChatMediaUrl(key: string | null): string | null | 'failed' {
  const [url, setUrl] = useState<{ key: string; url: string | null } | null>(() =>
    key ? { key, url: cachedChatMediaUrl(key) } : null
  );
  useEffect(() => {
    if (!key || cachedChatMediaUrl(key)) return;
    let live = true;
    signChatMedia(key).then((u) => {
      if (live) setUrl({ key, url: u ?? 'failed' });
    });
    return () => {
      live = false;
    };
  }, [key]);
  if (!key) return 'failed';
  const fresh = cachedChatMediaUrl(key);
  if (fresh) return fresh;
  return url && url.key === key ? url.url : null;
}

/** Chat video is drawn only when every gate is open; chatSupported() is implied by a row having attachments. */
const VIDEO_ON = CHAT_VIDEO_ENABLED && AGORA_VIDEO_ENABLED;

export function ChatAttachmentList({
  attachments,
  scope,
  messageId,
  onLongPress,
}: {
  attachments: ChatAttachment[] | null | undefined;
  /** The room + message a video plays from — chat-video-playback-url signs per message, not per key. */
  scope?: ChatScope;
  messageId?: string;
  /** The bubble's message sheet, so holding any tile reaches it too. */
  onLongPress?: () => void;
}) {
  const router = useRouter();
  const list = Array.isArray(attachments) ? attachments.filter((a) => a && typeof a.kind === 'string') : [];
  if (list.length === 0) return null;

  // Photos first, as one stack; then everything else in the order it was composed.
  const images = list.filter((a) => a.kind === 'image' && a.key);
  const rest = list.filter((a) => a.kind !== 'image');

  return (
    <View style={styles.list}>
      {images.map((a) => (
        <ChatImage key={`image:${a.key}`} attachment={a} onLongPress={onLongPress} />
      ))}
      {rest.map((a, i) => {
        if (a.kind === 'file' && a.key) return <ChatFileChip key={`file:${a.key}`} attachment={a} onLongPress={onLongPress} />;
        if (a.kind === 'anthem') return <ChatAnthem key={`anthem:${i}`} attachment={a} onLongPress={onLongPress} />;
        if (a.kind === 'video') {
          const video = VIDEO_ON && scope && messageId ? chatVideoSnapshot(a) : null;
          if (!video || !scope || !messageId) return null;
          return (
            <ChatVideo key={`video:${video.video_key}`} scope={scope} messageId={messageId} video={video} onLongPress={onLongPress} />
          );
        }
        if (SHARE_KINDS.has(a.kind)) {
          const s = snap(a) as AgoraAttachSnapshot;
          const view = attachmentView(a.kind as AgoraAttachKind, s);
          if (!view) return null;
          return (
            <View key={`${a.kind}:${a.ref_id ?? a.key ?? i}`} style={styles.share}>
              <AttachmentRow
                view={view}
                xp={a.kind === 'lockin' ? s.xp_earned : undefined}
                onPress={() => {
                  if (view.route) router.push(view.route as never);
                }}
                onLongPress={onLongPress}
              />
            </View>
          );
        }
        return null;
      })}
    </View>
  );
}

function ChatImage({ attachment, onLongPress }: { attachment: ChatAttachment; onLongPress?: () => void }) {
  const url = useChatMediaUrl(attachment.key);
  const [open, setOpen] = useState(false);
  const s = snap(attachment);
  const w = num(s.width);
  const h = num(s.height);
  // The frozen dimensions keep the bubble from jumping when the bytes land. Clamped so a panorama
  // or a long screenshot stays a bubble rather than a ribbon or a wall.
  const ratio = w && h ? Math.min(Math.max(w / h, 0.6), 1.8) : 4 / 3;

  if (url === 'failed') {
    return (
      <View style={[styles.image, styles.imageGone, { aspectRatio: ratio }]}>
        <Icon name="photo" size={22} color={Colors.spaceFaint} />
        <Text style={styles.gone}>Photo unavailable</Text>
      </View>
    );
  }
  return (
    <>
      <Pressable
        onPress={() => url && setOpen(true)}
        onLongPress={onLongPress}
        accessibilityRole="imagebutton"
        accessibilityLabel="Photo — open full screen">
        <View style={[styles.image, { aspectRatio: ratio }]}>
          {url ? (
            <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
          ) : (
            <ActivityIndicator color={Colors.navEmber2} />
          )}
        </View>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={styles.viewer} onPress={() => setOpen(false)} accessibilityLabel="Close photo">
          {url ? <Image source={{ uri: url }} style={styles.viewerImage} contentFit="contain" /> : null}
          <View style={styles.viewerClose}>
            <Icon name="close" size={20} color={Colors.ink} />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function ChatFileChip({ attachment, onLongPress }: { attachment: ChatAttachment; onLongPress?: () => void }) {
  const [busy, setBusy] = useState(false);
  const s = snap(attachment);
  const name = str(s.name) ?? 'File';
  const size = formatBytes(num(s.bytes));
  const kindLabel = FILE_KIND_LABEL[str(s.mime) ?? ''] ?? null;

  async function open() {
    if (!attachment.key) return;
    setBusy(true);
    try {
      const url = await signChatMedia(attachment.key);
      if (!url) throw new Error('gone');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not open file', 'It may have been deleted. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      style={styles.chip}
      onPress={() => void open()}
      onLongPress={onLongPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`Open ${name}${size ? `, ${size}` : ''}`}>
      <View style={styles.chipIcon}>
        <Icon name="notes" size={18} color={Colors.navEmber2} />
      </View>
      <View style={styles.chipText}>
        <Text style={styles.chipName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.chipSub} numberOfLines={1}>
          {[kindLabel, size].filter(Boolean).join(' · ') || 'Tap to open'}
        </Text>
      </View>
      {busy ? <ActivityIndicator size="small" color={Colors.navEmber2} /> : null}
    </Pressable>
  );
}

function ChatAnthem({ attachment, onLongPress }: { attachment: ChatAttachment; onLongPress?: () => void }) {
  const s = snap(attachment);
  const title = str(s.title) ?? 'Their anthem';
  const artist = str(s.artist);
  const url = str(s.url);
  return (
    <Pressable
      style={styles.chip}
      onPress={() => {
        if (url) Linking.openURL(url).catch(() => {});
      }}
      onLongPress={onLongPress}
      // Not `disabled` without a link: a disabled Pressable swallows the long-press too.
      accessibilityRole={url ? 'link' : undefined}
      accessibilityLabel={`Anthem: ${title}${artist ? ` by ${artist}` : ''}`}>
      <View style={styles.chipIcon}>
        <Icon name="music" size={18} color={Colors.navEmber2} />
      </View>
      <View style={styles.chipText}>
        <Text style={styles.chipName} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.chipSub} numberOfLines={1}>
          {artist ? `${artist} · ANTHEM` : 'ANTHEM'}
        </Text>
      </View>
    </Pressable>
  );
}

// ───────────────────────────── video ─────────────────────────────

// ONE CLIP PLAYS AT A TIME. A module-level "now playing" id rather than per-screen state: every
// tile reads it, so starting one unmounts the player of whichever was going — and unmounting IS
// the stop, the same no-bookkeeping rule as the feed's ReelPlayer. Only one chat is ever focused,
// so one-per-app is one-per-screen.
let nowPlaying: string | null = null;
const playingListeners = new Set<() => void>();

function setNowPlaying(id: string | null) {
  if (nowPlaying === id) return;
  nowPlaying = id;
  playingListeners.forEach((l) => l());
}

function subscribePlaying(listener: () => void) {
  playingListeners.add(listener);
  return () => {
    playingListeners.delete(listener);
  };
}

function ChatVideo({
  scope,
  messageId,
  video,
  onLongPress,
}: {
  scope: ChatScope;
  messageId: string;
  video: ChatVideoSnapshot;
  onLongPress?: () => void;
}) {
  const id = `${scope}:${messageId}:${video.video_key}`;
  const playing = useSyncExternalStore(subscribePlaying, () => nowPlaying === id);
  // undefined = asking, null = this viewer can't have it (or the function isn't deployed yet).
  const [urls, setUrls] = useState<ChatVideoUrls | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getChatVideoUrls(scope, messageId).then((u) => {
      if (alive) setUrls(u);
    });
    return () => {
      alive = false;
    };
  }, [scope, messageId]);

  // Leaving the thread (to a profile, back to Chats) stops the clip — the screen stays mounted
  // underneath in the stack, so an unmount alone would leave it talking in the background.
  useFocusEffect(
    useCallback(
      () => () => {
        if (nowPlaying === id) setNowPlaying(null);
      },
      [id]
    )
  );
  // …and so does the tile itself going (scrolled out of the list's window, message deleted).
  useEffect(
    () => () => {
      if (nowPlaying === id) setNowPlaying(null);
    },
    [id]
  );

  // Portrait phone clips are the norm; clamp like a photo so one stays a bubble, not a wall.
  const ratio = video.width && video.height ? Math.min(Math.max(video.width / video.height, 0.6), 1.8) : 3 / 4;
  const fit = video.width && video.height && video.width > video.height ? 'contain' : 'cover';

  if (urls === null) {
    return (
      <View style={[styles.image, styles.imageGone, { aspectRatio: ratio }]}>
        <Icon name="video" size={22} color={Colors.spaceFaint} />
        <Text style={styles.gone}>Video unavailable</Text>
      </View>
    );
  }

  return (
    <View style={[styles.image, { aspectRatio: ratio }]}>
      {urls ? (
        <Image source={{ uri: urls.posterUrl }} style={StyleSheet.absoluteFill} contentFit={fit} transition={120} />
      ) : (
        <ActivityIndicator color={Colors.navEmber2} />
      )}
      {playing && urls ? (
        <ChatVideoPlayer uri={urls.videoUrl} fit={fit} />
      ) : (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => urls && setNowPlaying(id)}
          onLongPress={onLongPress}
          disabled={!urls && !onLongPress}
          accessibilityRole="button"
          accessibilityLabel={`Play video${video.duration_s > 0 ? `, ${formatClipLength(video.duration_s)}` : ''}`}>
          {urls ? (
            <View style={styles.playBtn} pointerEvents="none">
              <Icon name="play" size={22} color={Colors.ink} />
            </View>
          ) : null}
          {video.duration_s > 0 ? (
            <View style={styles.length} pointerEvents="none">
              <Text style={styles.lengthText}>{formatClipLength(video.duration_s)}</Text>
            </View>
          ) : null}
        </Pressable>
      )}
    </View>
  );
}

/**
 * The live player, mounted only while its tile is the one playing. Sound ON — you tapped this
 * one clip to hear it, unlike the feed's autoplaying reel — and the platform's own controls, so
 * scrubbing and fullscreen are the OS's rather than something drawn here.
 */
function ChatVideoPlayer({ uri, fit }: { uri: string; fit: 'cover' | 'contain' }) {
  // Deferred, like every other expo-video consumer (feed-page.tsx's ReelPlayer, gym-clip-player.tsx).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VideoView, useVideoPlayer } = require('expo-video') as typeof import('expo-video');
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = false;
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls />;
}

const styles = StyleSheet.create({
  list: {
    gap: 6,
    marginTop: 4,
  },
  share: {
    // AttachmentRow is drawn for a feed card; in a bubble column it wants a panel of its own.
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.card,
    padding: Spacing.two,
  },
  image: {
    width: 220,
    maxWidth: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageGone: {
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  gone: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceFaint,
  },
  playBtn: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  length: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  lengthText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.ink,
  },
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '80%',
  },
  viewerClose: {
    position: 'absolute',
    top: 56,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minWidth: 200,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.card,
  },
  chipIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    flexShrink: 1,
  },
  chipName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  chipSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    letterSpacing: 0.4,
    color: Colors.spaceDim,
  },
});
