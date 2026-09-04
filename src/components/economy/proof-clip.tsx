import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';
import { campfirePhotoUrl, isVideoPath } from '@/lib/api/messages';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE STAMPED CLIP — mock 176 frame D's "🤸 ▶ · BACKFLIP · TODAY".
//
// 🔴 THE STAMP IS RENDERED, NOT BURNED IN, AND THAT IS THE STRONGER OPTION.
//
// The spec asks for the clip to be "stamped with the goal name + date... so a recycled clip reads
// as off". The obvious reading is to composite text into the video file at capture. Do not: it
// needs a frame-by-frame re-encode (ffmpeg-class work) for a caption that the person who chose the
// video also controls — and pixels the uploader controls are exactly what cannot be trusted.
//
// So the stamp is drawn HERE, over the player, from `label` and `claimed_at` as the SERVER returned
// them (get_vouch_request / get_claim_status). It says what this clip is being passed off as,
// asserted by the database rather than by the claimant. A recycled clip still "reads as off" —
// which is the spec's actual goal — because the viewer sees the claim and the footage together and
// can see they disagree. A burned-in caption would have been a caption the cheat could fake.
//
// 🔒 AND IT IS STILL NOT PROOF. Nothing here verifies anything. Media forensics and identity
// matching are refused outright by the spec — impractical and a liability — so this component's
// whole job is to let a HUMAN who knows the claimant look at what they did and decide. The caption
// says so out loud rather than implying a check nobody performs.
// ══════════════════════════════════════════════════════════════════════════════════════════════

type ProofClipProps = {
  /** Storage key in the campfire-photos bucket. */
  path: string;
  /** The goal, as the server holds it — the "BACKFLIP" half of the stamp. */
  label: string | null;
  /** ISO claim time — the "TODAY" half. */
  claimedAt: string | null;
  /** Frame D shows the caption; frame C, where it is your own clip, does not need telling. */
  showCaption?: boolean;
};

/** "BACKFLIP · TODAY" — the goal, and when it was claimed, both from the server. */
function stampText(label: string | null, claimedAt: string | null): string {
  const name = (label ?? '').trim().toUpperCase() || 'CLAIM';
  if (!claimedAt) return name;

  const when = new Date(claimedAt);
  if (Number.isNaN(when.getTime())) return name;

  const now = new Date();
  const sameDay =
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const wasYesterday =
    when.getFullYear() === yesterday.getFullYear() &&
    when.getMonth() === yesterday.getMonth() &&
    when.getDate() === yesterday.getDate();

  // A 48h window means every clip a voucher sees is today or yesterday, so those two get words and
  // anything older gets a date — a stale one should look stale rather than blend in.
  const day = sameDay
    ? 'TODAY'
    : wasYesterday
      ? 'YESTERDAY'
      : when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();

  return `${name} · ${day}`;
}

export function ProofClip({ path, label, claimedAt, showCaption = true }: ProofClipProps) {
  const [open, setOpen] = useState(false);
  const url = campfirePhotoUrl(path);
  const isVideo = isVideoPath(path);
  const stamp = stampText(label, claimedAt);

  return (
    <View style={styles.root}>
      <Pressable
        style={styles.tile}
        onPress={() => isVideo && setOpen(true)}
        accessibilityRole={isVideo ? 'button' : 'image'}
        accessibilityLabel={isVideo ? `Play the clip: ${stamp}` : stamp}>
        {isVideo ? (
          <View style={styles.videoFill}>
            <Ionicons name="videocam" size={26} color={Colors.textTertiary} />
            <View style={styles.play}>
              <Ionicons name="play" size={15} color="#FFFFFF" />
            </View>
          </View>
        ) : (
          <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
        )}
        {/* The stamp. Server-sourced — see the header for why it is not composited into the file. */}
        <View style={styles.stamp}>
          <Text style={styles.stampText} numberOfLines={1}>
            {stamp}
          </Text>
        </View>
      </Pressable>

      {showCaption ? (
        <Text style={styles.caption}>recorded live in-app · you decide if it counts</Text>
      ) : null}

      {isVideo ? <ClipPlayer visible={open} url={url} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

function ClipPlayer({ visible, url, onClose }: { visible: boolean; url: string; onClose: () => void }) {
  // Deferred native import — same reasoning as gym-clip-player.tsx: expo-video is only in builds
  // that compiled it, and a module-scope import would crash an older binary's bundle eval rather
  // than degrading. Nothing else on this screen depends on it, so a failure here costs the clip
  // and not the vouch.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred native import
  const { VideoView, useVideoPlayer } = require('expo-video') as typeof import('expo-video');

  const player = useVideoPlayer(visible ? url : null, (p) => {
    p.loop = true;
  });

  useEffect(() => {
    if (visible) player.play();
  }, [visible, player]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.close} onPress={onClose} hitSlop={10} accessibilityLabel="Close clip">
          <Ionicons name="close" size={26} color={Colors.ink} />
        </Pressable>
        <VideoView player={player} style={styles.fullVideo} contentFit="contain" nativeControls />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 7, marginTop: Spacing.two },
  tile: {
    width: 150,
    height: 94,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stamp: {
    position: 'absolute',
    left: 6,
    bottom: 5,
    maxWidth: '90%',
    backgroundColor: 'rgba(0,0,0,0.68)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  stampText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 0.6,
    color: '#FFFFFF',
  },
  caption: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,6,12,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  close: { position: 'absolute', top: 54, right: 22, zIndex: 2 },
  fullVideo: { width: '100%', height: '70%' },
});
