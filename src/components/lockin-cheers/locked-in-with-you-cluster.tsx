import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { FriendFace, FriendFaceStack, UnreadBadge } from '@/components/lockin-cheers/friend-faces';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import type { FriendLockedIn, ReceivedCheer } from '@/lib/api/lockin-cheers';
import type { LockInCheerBanner } from '@/hooks/use-lockin-cheers';

/**
 * "Locked in with you" (mock 298, panel 1) — bottom-left of the running timer. One tap opens the
 * cheers panel; it never leaves the session. Renders nothing while no friend is live.
 */
export function LockedInWithYouCluster({
  friends,
  unread,
  onPress,
}: {
  friends: FriendLockedIn[];
  unread: number;
  onPress: () => void;
}) {
  if (friends.length === 0) return null;
  const liveCount = friends.filter((f) => f.live).length;
  // A friend can be listed only because your thread is still open (they stopped, you're still
  // live) — then the pill opens messages, and "0 live" would be wrong.
  const label = liveCount > 0 ? `${liveCount} live` : 'Messages';
  return (
    <View style={styles.cluster}>
      {liveCount > 0 && <Text style={styles.clusterLabel}>Locked in with you</Text>}
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${liveCount > 0 ? `${liveCount} friends locked in with you` : 'Messages'}${unread > 0 ? `, ${unread} unread` : ''}. Open.`}>
        <FriendFaceStack people={friends} max={3} />
        <Text style={styles.pillCount}>{label}</Text>
        <UnreadBadge count={unread} />
      </Pressable>
    </View>
  );
}

/** "🔥 3 cheers" under the timer — nothing until the first one lands. The flame is the bespoke
 * glyph now; the row is an Animated.View so the glyph and the line fade in as one. */
export function CheerTally({ cheers }: { cheers: ReceivedCheer[] }) {
  if (cheers.length === 0) return null;
  const names = cheers.map((c) => c.name.split(/\s+/)[0]);
  const who =
    names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} & ${names.length - 1} more`;
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.tallyRow}>
      <NavGlyph name="flame" size={12} color={Colors.gold} />
      <Text style={styles.tally} numberOfLines={1}>
        {cheers.length} {cheers.length === 1 ? 'cheer' : 'cheers'} · {who}
      </Text>
    </Animated.View>
  );
}

const BANNER_MS = 4200;

/**
 * The quiet inbound banner (mock 298, panel 3). Fades itself out — no tap to dismiss, no reply
 * required — and is pointer-transparent so it can never eat a tap meant for the timer.
 */
export function LockInCheerBannerView({
  banner,
  onDone,
}: {
  banner: LockInCheerBanner | undefined;
  onDone: (id: string) => void;
}) {
  if (!banner) return null;
  return <BannerCard key={banner.id} banner={banner} onDone={onDone} />;
}

function BannerCard({ banner, onDone }: { banner: LockInCheerBanner; onDone: (id: string) => void }) {
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withDelay(BANNER_MS - 500, withTiming(0, { duration: 500 }));
    const t = setTimeout(() => onDone(banner.id), BANNER_MS);
    return () => clearTimeout(t);
  }, [banner.id, onDone, opacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(250)}
      exiting={reduceMotion ? undefined : FadeOut.duration(200)}
      style={[styles.banner, fadeStyle]}
      pointerEvents="none"
      accessibilityLiveRegion="polite">
      <FriendFace name={banner.name} avatarUrl={banner.avatarUrl} size={30} />
      <Text style={styles.bannerText} numberOfLines={2}>
        <Text style={styles.bannerName}>{banner.name}</Text>
        {banner.kind === 'cheer' ? ' cheered you on\n' : ' says\n'}
        {banner.kind === 'cheer' ? banner.text : `“${banner.text}”`}
      </Text>
      <View style={styles.bannerGlyph}>
        {banner.kind === 'cheer' ? (
          <NavGlyph name="flame" size={16} color={Colors.gold} />
        ) : (
          <UiGlyph name="send" size={15} color={Colors.legend} />
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cluster: {
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: Spacing.three,
  },
  clusterLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.6,
    color: Colors.spaceFaint,
    textTransform: 'uppercase',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.two,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingLeft: 7,
    paddingRight: 12,
  },
  pressed: {
    opacity: 0.85,
  },
  pillCount: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ink,
  },
  // Gold: a cheer is something you were given.
  tallyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: Spacing.two,
  },
  tally: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.gold,
    textAlign: 'center',
  },
  banner: {
    position: 'absolute',
    top: Spacing.twelve,
    left: Spacing.twelve,
    right: Spacing.twelve,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: Spacing.twelve,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  bannerText: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.ink,
  },
  bannerName: {
    fontFamily: Fonts.bodyBold,
    color: Colors.navEmber2,
  },
  bannerGlyph: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },

});
