import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import {
  formatClipLength,
  getAgoraVideoUrls,
  type AgoraVideoSnapshot,
  type AgoraVideoUrls,
} from '@/lib/api/agora-video';

// A posted clip on an Agora card (migration 0279): the poster frame and a play button until it's
// tapped, then the clip itself, inline, with native controls. Tap-to-play, not autoplay: a feed
// of strangers' clips starting on their own is a bandwidth bill and an ambush, and v1 can earn
// muted-autoplay-in-view later if the square wants it.
//
// The poster is the only thing a scrolling card loads. The signed URLs come from one batched call
// per page (getAgoraVideoUrls), and the video stream doesn't start until someone asks for it.
//
// REPORT IS ON THE TILE. A public video surface reaches far more people than a photo, and the
// card's "…" is easy to miss, so someone else's clip carries its own flag that opens the same
// report/block sheet as the "…" (moderation_reports → the 24h inbox, MODERATION.md). Own clips
// don't: reporting yourself is noise, and Delete lives in the "…".

/** Portrait phone clips are 9:16; a card that tall is a whole screen. Clamp to 4:5 … 16:9. */
function tileAspect(video: AgoraVideoSnapshot): number {
  const ratio = video.width && video.height ? video.width / video.height : 16 / 9;
  return Math.min(16 / 9, Math.max(4 / 5, ratio));
}

export function AgoraVideoTile({
  postId,
  video,
  onReport,
}: {
  postId: string;
  video: AgoraVideoSnapshot;
  /** Someone else's post: show the flag. Absent on your own. */
  onReport?: () => void;
}) {
  const [urls, setUrls] = useState<AgoraVideoUrls | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    getAgoraVideoUrls(postId).then((u) => {
      if (alive) setUrls(u);
    });
    return () => {
      alive = false;
    };
  }, [postId]);

  const aspectRatio = tileAspect(video);

  // Gone (post deleted mid-scroll) or not this viewer's to play: a quiet line, not a black slab.
  if (urls === null) {
    return (
      <View style={styles.unavailable}>
        <Ionicons name="videocam-off-outline" size={14} color={Colors.textTertiary} />
        <Text style={styles.unavailableText}>Video unavailable</Text>
      </View>
    );
  }

  return (
    <View style={[styles.tile, { aspectRatio }]}>
      {playing && urls ? (
        <InlinePlayer uri={urls.videoUrl} />
      ) : (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => urls && setPlaying(true)}
          disabled={!urls}
          accessibilityRole="button"
          accessibilityLabel={`Play video, ${formatClipLength(video.duration_s)}`}>
          {urls ? (
            <Image source={{ uri: urls.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
          ) : (
            <ActivityIndicator color={Colors.textTertiary} style={styles.loader} />
          )}
          <View style={styles.playBtn}>
            <Ionicons name="play" size={24} color="#FFFFFF" />
          </View>
          {video.duration_s > 0 ? (
            <View style={styles.length}>
              <Text style={styles.lengthText}>{formatClipLength(video.duration_s)}</Text>
            </View>
          ) : null}
        </Pressable>
      )}

      {onReport ? (
        <Pressable
          style={styles.flag}
          onPress={onReport}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Report this video">
          <Ionicons name="flag-outline" size={14} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </View>
  );
}

function InlinePlayer({ uri }: { uri: string }) {
  // Deferred, like every other expo-video consumer (gym-clip-player.tsx).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { VideoView, useVideoPlayer } = require('expo-video') as typeof import('expo-video');
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls
      fullscreenOptions={{ enable: true }}
    />
  );
}

const styles = StyleSheet.create({
  tile: {
    width: '100%',
    marginTop: Spacing.two,
    borderRadius: Radius.card,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  loader: {
    flex: 1,
  },
  playBtn: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -26,
    width: 52,
    height: 52,
    borderRadius: 26,
    paddingLeft: 3,
    backgroundColor: 'rgba(6,5,10,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  length: {
    position: 'absolute',
    bottom: Spacing.two,
    left: Spacing.two,
    borderRadius: Radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: 'rgba(6,5,10,0.65)',
  },
  lengthText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: '#FFFFFF',
  },
  flag: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(6,5,10,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.two,
  },
  unavailableText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
});
