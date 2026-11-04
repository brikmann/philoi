import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { fetchMyFeedChannels } from '@/lib/api/feed-channels';
import type { FeedChannel } from '@/types/social';

/**
 * YOUR CLUBS (Phase 8.5, mock 338) — your campfires and forests as chips under About, each opening
 * that room's page. One read, get_my_feed_channels (0280): the same membership list the feed's
 * channel row draws from, liveliest first. Own profile only — a visitor's memberships aren't
 * readable from here, and the block is about where *you* belong.
 *
 * No clubs yet → one quiet way to find some, not an empty heading.
 */
export function ProfileClubs() {
  const router = useRouter();
  const [clubs, setClubs] = useState<FeedChannel[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      fetchMyFeedChannels()
        .then((cs) => {
          if (live) setClubs(cs);
        })
        .catch(() => {
          // Fails soft — no block rather than a wrong "no clubs".
        });
      return () => {
        live = false;
      };
    }, [])
  );

  if (!clubs) return null;

  const open = (c: FeedChannel) => {
    if (c.kind === 'forest') router.push({ pathname: '/forest/[id]', params: { id: c.id } });
    else router.push({ pathname: '/group/[groupId]', params: { groupId: c.id } });
  };

  return (
    <View style={styles.block}>
      <Text style={styles.label}>Your clubs</Text>
      {clubs.length === 0 ? (
        <Pressable onPress={() => router.push('/(tabs)/social')} accessibilityRole="button" hitSlop={6}>
          <Text style={styles.empty}>You’re not in a club yet — find your people in Discover ›</Text>
        </Pressable>
      ) : (
        <View style={styles.chips}>
          {clubs.map((c) => (
            <Pressable
              key={`${c.kind}:${c.id}`}
              onPress={() => open(c)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${c.name}`}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
              <Text style={styles.chipText} numberOfLines={1}>
                {c.emoji ? `${c.emoji} ` : ''}
                {c.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: 14,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginBottom: 7,
    marginHorizontal: 2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  chip: {
    maxWidth: '100%',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  pressed: {
    opacity: 0.8,
  },
  chipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
    marginHorizontal: 2,
  },
});
