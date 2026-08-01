import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { requestClipPlaybackUrls } from '@/lib/api/gym-clips';
import { getErrorMessage } from '@/lib/errors';

type GymClipThumbnailProps = {
  workoutSetId: string;
  size?: number;
};

// Tap-to-play surface for a set's clip (PHILOI_UI_SPEC.md §23) — drop this wherever a clip
// should show: the done-screen recap, PR history, the posted campfire chat card. Fetches its own
// signed thumbnail URL on mount (each instance is one workout_set, so this stays cheap even in a
// list) and the signed video URL only once the viewer actually taps to play.
export function GymClipThumbnail({ workoutSetId, size = 96 }: GymClipThumbnailProps) {
  const [playerOpen, setPlayerOpen] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loadingThumb, setLoadingThumb] = useState(true);

  useEffect(() => {
    let cancelled = false;
    requestClipPlaybackUrls(workoutSetId)
      .then((urls) => {
        if (!cancelled) setThumbUrl(urls.thumbUrl);
      })
      .catch(() => {
        // A failed thumbnail fetch just falls back to the plain video icon below.
      })
      .finally(() => {
        if (!cancelled) setLoadingThumb(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workoutSetId]);

  return (
    <>
      <Pressable style={[styles.tile, { width: size, height: size }]} onPress={() => setPlayerOpen(true)} accessibilityLabel="Play clip">
        {loadingThumb ? (
          <ActivityIndicator color={Colors.coral} />
        ) : thumbUrl ? (
          <Image source={{ uri: thumbUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Ionicons name="videocam" size={22} color={Colors.textTertiary} />
        )}
        <View style={styles.playBadge}>
          <Ionicons name="play" size={13} color="#FFFFFF" />
        </View>
      </Pressable>

      <GymClipPlayerModal visible={playerOpen} workoutSetId={workoutSetId} onClose={() => setPlayerOpen(false)} />
    </>
  );
}

function GymClipPlayerModal({ visible, workoutSetId, onClose }: { visible: boolean; workoutSetId: string; onClose: () => void }) {
  // Deferred — see gym-clip-recorder.tsx's comment on why the video-clip native modules aren't
  // imported at module scope (this file predates any build that compiles expo-video in).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VideoView, useVideoPlayer } = require('expo-video') as typeof import('expo-video');

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const player = useVideoPlayer(videoUrl, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (!visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets on each open before the async fetch below, not a render-loop risk
    setVideoUrl(null);
    setError(null);
    requestClipPlaybackUrls(workoutSetId)
      .then((urls) => setVideoUrl(urls.videoUrl))
      .catch((e) => setError(getErrorMessage(e, "Couldn't load this clip.")));
  }, [visible, workoutSetId]);

  useEffect(() => {
    if (videoUrl) player.play();
  }, [videoUrl, player]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8} accessibilityLabel="Close">
          <Ionicons name="close" size={26} color={Colors.ink} />
        </Pressable>
        {error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : videoUrl ? (
          <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
        ) : (
          <ActivityIndicator color={Colors.coral} />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: Radius.card,
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  playBadge: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,6,12,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 56,
    right: 20,
    zIndex: 1,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: {
    width: '100%',
    height: '70%',
  },
  errorText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.coral,
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
});
