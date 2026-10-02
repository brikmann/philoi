import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ItemArt } from '@/components/economy/item-art';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { getItem } from '@/lib/economy/catalog';
import { featuredTrophies } from '@/lib/economy/milestone-badges';
import { RARITY_COLOR, RARITY_LABEL, rarityGlow } from '@/lib/economy/rarity';
import type { TrophyHall } from '@/types/database';

// Mock 248's SHOWCASE — the medals and relics on a shelf directly under the hero card, so the
// earned half of someone's identity sits next to the cosmetic half instead of three sections down.
//
// Same pick as the Trophy Hall's old featured strip (featuredTrophies: rarest + newest, earned-only,
// in-progress ladders excluded), which is why TrophyHallSection drops its own strip when the profile
// shows this one — the same four trophies twice on one screen would read as a rendering bug.
//
// Four slots, always: one or two trophies keep the 4-up rhythm and the shelf simply ends early,
// rather than stretching a single medal across half the screen.

const SLOTS = 4;

export function ProfileShowcase({ hall, userId }: { hall: TrophyHall; userId: string }) {
  const router = useRouter();
  const featured = featuredTrophies(hall.relics, SLOTS);
  if (featured.length === 0) return null;

  const open = () => router.push({ pathname: '/trophy-hall', params: { userId } });

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.heading}>Showcase</Text>
        <Text style={styles.seeAll} accessibilityRole="button" onPress={open}>
          Trophy Hall ›
        </Text>
      </View>
      <View style={styles.shelf}>
        {featured.map((t) => {
          const item = getItem(t.key);
          if (!item) return <View key={t.key} style={styles.slot} />;
          return (
            <Pressable
              key={t.key}
              style={[styles.slot, { borderColor: RARITY_COLOR[item.rarity] + '70' }]}
              onPress={open}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${RARITY_LABEL[item.rarity]}`}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: rarityGlow(item.rarity, 0.14) }]} />
              <View style={styles.art}>
                <ItemArt item={item} size={40} />
              </View>
              <Text style={styles.cap} numberOfLines={1}>
                {item.name}
              </Text>
            </Pressable>
          );
        })}
        {featured.length < SLOTS
          ? Array.from({ length: SLOTS - featured.length }, (_, i) => <View key={`pad-${i}`} style={styles.pad} />)
          : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  heading: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: Colors.textTertiary,
  },
  seeAll: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.achieverText,
  },
  shelf: {
    flexDirection: 'row',
    gap: 10,
  },
  slot: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors.lineStrong,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pad: {
    flex: 1,
  },
  art: {
    marginTop: -8,
  },
  cap: {
    position: 'absolute',
    bottom: 6,
    left: 4,
    right: 4,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 8.5,
    color: Colors.muted,
  },
});
