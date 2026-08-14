import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ItemArt } from '@/components/economy/item-art';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import type { CatalogItem } from '@/lib/economy/catalog';
import { RARITY_COLOR, RARITY_LABEL, formatOddsFlex, rarityGlow } from '@/lib/economy/rarity';

// The 9:16 unlock story card (mock 60, 21h). Rendered off-screen and captured by the same
// view-shot pipeline the lock-in cards already use (src/lib/share-card.ts).
//
// The flex here is the ODDS, not a call to action: "a 0.8% pull" says more than any tagline, and
// mock 60 is explicit that there's no CTA line — the item and the number speak for themselves.
// That's also what makes this a growth loop rather than an ad: rare unlocks are worth posting.

const CARD_WIDTH = 360;
const CARD_HEIGHT = 640; // 9:16

type Props = {
  item: CatalogItem;
  /** Published probability of the tier that dropped — the whole flex. */
  oddsPct: number;
  handle: string;
  rankLabel?: string;
  /** ×10: the rest of the haul as a rarity-bordered chip strip under the hero. */
  haul?: CatalogItem[];
};

export const UnlockShareCard = forwardRef<View, Props>(function UnlockShareCard(
  { item, oddsPct, handle, rankLabel, haul },
  ref
) {
  const tint = RARITY_COLOR[item.rarity];
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      {/* Tier-coloured glow — the card's whole palette adapts to what dropped (Mythic reads red,
          Legendary gold), so the rarity is legible before a single word is read. */}
      <View style={[styles.glow, { backgroundColor: rarityGlow(item.rarity, 0.4) }]} />
      <View style={[styles.ring, { borderColor: tint }]} />

      <View style={styles.artWrap}>
        <ItemArt item={item} size={190} />
      </View>

      <Text style={styles.name}>{item.name}</Text>
      <Text style={[styles.rarity, { color: tint }]}>
        {RARITY_LABEL[item.rarity]} · {item.type}
      </Text>

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

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          @{handle}
          {rankLabel ? ` · ${rankLabel}` : ''}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: Colors.twilight900,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    top: 90,
  },
  ring: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    borderWidth: 1,
    opacity: 0.35,
    top: 150,
  },
  artWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.five,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 30,
    color: Colors.ink,
    textAlign: 'center',
  },
  rarity: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 2,
    marginTop: Spacing.two,
  },
  oddsPill: {
    marginTop: Spacing.four,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
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
    marginTop: Spacing.four,
    maxWidth: 300,
  },
  chip: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: Spacing.five,
  },
  footerText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
  },
});
