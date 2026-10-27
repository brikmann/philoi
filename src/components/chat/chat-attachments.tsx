import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AttachmentRow } from '@/components/agora/agora-card';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { attachmentView } from '@/lib/agora-attachment';
import { cachedChatMediaUrl, signChatMedia, type ChatAttachment } from '@/lib/api/chat';
import type { AgoraAttachKind, AgoraAttachSnapshot } from '@/types/database';

// What a chat message CARRIES, drawn under (or instead of) its words — 0284's attachments.
//
//   · image  — a private chat-media object, shown through a signed URL; tap for full screen.
//   · file   — a chip with the name + size; tap opens the signed URL in the system viewer.
//   · anthem — the sender's grind song, frozen when they sent it; tap opens its link.
//   · lockin / milestone / rank / streak / pass / cosmetic / pr — the Agora's own AttachmentRow,
//     through attachmentView, so a session shared in a DM is literally the card the feed draws.
//
// A kind this build doesn't know (a later server's 'video') renders NOTHING rather than a broken
// tile. OTA is closed; what a shipped build does with tomorrow's kinds is decided today.

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

/** "2.4 MB" — the chip's size line. */
function formatBytes(bytes: number | null): string | null {
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

export function ChatAttachmentList({ attachments }: { attachments: ChatAttachment[] | null | undefined }) {
  const router = useRouter();
  const list = Array.isArray(attachments) ? attachments.filter((a) => a && typeof a.kind === 'string') : [];
  if (list.length === 0) return null;

  // Photos first, as one stack; then everything else in the order it was composed.
  const images = list.filter((a) => a.kind === 'image' && a.key);
  const rest = list.filter((a) => a.kind !== 'image');

  return (
    <View style={styles.list}>
      {images.map((a) => (
        <ChatImage key={`image:${a.key}`} attachment={a} />
      ))}
      {rest.map((a, i) => {
        if (a.kind === 'file' && a.key) return <ChatFileChip key={`file:${a.key}`} attachment={a} />;
        if (a.kind === 'anthem') return <ChatAnthem key={`anthem:${i}`} attachment={a} />;
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
              />
            </View>
          );
        }
        return null;
      })}
    </View>
  );
}

function ChatImage({ attachment }: { attachment: ChatAttachment }) {
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
      <Pressable onPress={() => url && setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="Photo — open full screen">
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

function ChatFileChip({ attachment }: { attachment: ChatAttachment }) {
  const [busy, setBusy] = useState(false);
  const s = snap(attachment);
  const name = str(s.name) ?? 'File';
  const size = formatBytes(num(s.bytes));
  const isPdf = str(s.mime) === 'application/pdf';

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
    <Pressable style={styles.chip} onPress={() => void open()} disabled={busy} accessibilityRole="button" accessibilityLabel={`Open ${name}`}>
      <View style={styles.chipIcon}>
        <Icon name="notes" size={18} color={Colors.navEmber2} />
      </View>
      <View style={styles.chipText}>
        <Text style={styles.chipName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.chipSub} numberOfLines={1}>
          {[isPdf ? 'PDF' : null, size].filter(Boolean).join(' · ') || 'Tap to open'}
        </Text>
      </View>
      {busy ? <ActivityIndicator size="small" color={Colors.navEmber2} /> : null}
    </Pressable>
  );
}

function ChatAnthem({ attachment }: { attachment: ChatAttachment }) {
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
      disabled={!url}
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
