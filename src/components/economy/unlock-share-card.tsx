import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ItemArt } from '@/components/economy/item-art';
import { ShareCardFrame } from '@/components/share-card-frame';
import { Colors, Fonts } from '@/constants/theme';
import type { CatalogItem } from '@/lib/economy/catalog';
import { RARITY_COLOR, RARITY_LABEL, formatOddsFlex, rarityGlow } from '@/lib/economy/rarity';
import type { RankTierName } from '@/types/database';

type Props = {
  item: CatalogItem;
  /** Published probability of the tier that dropped — the second half of the flex. */
  oddsPct: number;
  handle: string | null;
  tier?: RankTierName;
  division?: number;
  /** ×10: the rest of the haul as a rarity-bordered chip strip under the hero. */
  haul?: CatalogItem[];
};

// B4 — the rare-cosmetic flex (design-mocks/96, card 5). Fires from the unlock / box-open reveal.
//
// The item's own art and its own words carry the card: NAME AND DESCRIPTION COME FROM THE CATALOG
// (`catalog.ts`), never from copy written here — the mock's "Zeus' Wrath" text is a stand-in for
// whatever the real catalog entry says, and hardcoding it would mean the card lies the moment an
// item is re-themed. Rarity colour stays semantic (Mythic reads red, Legendary gold), which is why
// the rarity tint is the only thing on this card that isn't ember.
export const UnlockShareCard = forwardRef<View, Props>(function UnlockShareCard(
  { item, oddsPct, handle, tier, division, haul },
  ref
) {
  const tint = RARITY_COLOR[item.rarity];

  return (
    <ShareCardFrame
      ref={ref}
      kick={`${RARITY_LABEL[item.rarity].toUpperCase()} UNLOCKED`}
      kickColor={tint}
      handle={handle}
      tier={tier}
      division={division}>
      <View style={[styles.glow, { backgroundColor: rarityGlow(item.rarity, 0.4) }]} />
      <View style={styles.artWrap}>
        <ItemArt item={item} size={172} />
      </View>

      <Text style={[styles.name, { color: tint }]}>{item.name}</Text>
      {/* The catalog's own lore line — the item describing itself. */}
      <Text style={styles.lore}>{item.lore}</Text>

      <View style={[styles.oddsPill, { borderColor: tint }]}>
        <Text style={[styles.oddsText, { color: tint }]}>{formatOddsFlex(oddsPct)}</Text>
      </View>

      {haul && haul.length > 0 ? (
        <View style={styles.haul}>
          {haul.slice(0, 9).map((h, i) => (
            <View key={`${h.id}-${i}`} style={[styles.chip, { borderColor: RARITY_COLOR[h.rarity] }]}>
              <ItemArt item={h} size={22} />
            </View>
          ))}
        </View>
      ) : null}
    </ShareCardFrame>
  );
});

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    top: 0,
  },
  artWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 30,
    textAlign: 'center',
    marginTop: 18,
  },
  lore: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 240,
  },
  oddsPill: {
    marginTop: 18,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  oddsText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
  },
  haul: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 18,
    maxWidth: 280,
  },
  chip: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
