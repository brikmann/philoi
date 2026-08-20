import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ItemArt } from '@/components/economy/item-art';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { getItem } from '@/lib/economy/catalog';
import { RARITY_COLOR, RARITY_LABEL, rarityGlow } from '@/lib/economy/rarity';

// One earned relic/medal, rarity-glowed. Shared by the collapsed featured strip (§4) and the full
// hall, so the two can never drift into drawing the same trophy differently.
//
// Art comes from ItemArt — the SAME vector family the inventory and the equip UI draw, keyed off
// the item's own palette. A trophy that looked different here than in your inventory would read as
// a different object.

export function TrophyTile({
  itemKey,
  tag,
  hidden,
  onPress,
}: {
  itemKey: string;
  /** "★ RAREST" / "NEW" ribbon on the auto-featured strip. */
  tag?: 'rarest' | 'newest' | null;
  /** Owner-only: this one is hidden from visitors. */
  hidden?: boolean;
  onPress?: () => void;
}) {
  const item = getItem(itemKey);
  // An item this build has no catalog entry for — granted by a newer server. Drawn as a neutral
  // slab rather than dropped: the person did earn something, and a hole in the strip is worse than
  // an unnamed tile.
  if (!item) {
    return (
      <View style={[styles.tile, styles.unknown]}>
        <Text style={styles.unknownMark}>?</Text>
      </View>
    );
  }

  const colour = RARITY_COLOR[item.rarity];

  return (
    <Pressable
      style={[styles.tile, { borderColor: colour + '66' }, hidden && styles.dimmed]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${item.name}, ${RARITY_LABEL[item.rarity]}`}>
      <View style={[styles.glow, { backgroundColor: rarityGlow(item.rarity, 0.18) }]} />
      {tag ? (
        <View style={styles.tag}>
          <Text style={styles.tagText}>{tag === 'rarest' ? '★ RAREST' : 'NEW'}</Text>
        </View>
      ) : null}
      <ItemArt item={item} size={34} />
      <Text style={[styles.rarity, { color: colour }]}>{RARITY_LABEL[item.rarity]}</Text>
      {hidden ? <Text style={styles.hiddenMark}>🔒</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: Radius.input,
    borderWidth: 1,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  dimmed: {
    opacity: 0.45,
  },
  unknown: {
    borderColor: Colors.line,
  },
  unknownMark: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.textTertiary,
  },
  tag: {
    position: 'absolute',
    top: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  tagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 6.5,
    letterSpacing: 0.5,
    color: Colors.ember,
  },
  rarity: {
    position: 'absolute',
    bottom: 5,
    fontFamily: Fonts.bodyBold,
    fontSize: 7.5,
    letterSpacing: 0.6,
  },
  hiddenMark: {
    position: 'absolute',
    top: 5,
    right: 5,
    fontSize: 9,
  },
});
