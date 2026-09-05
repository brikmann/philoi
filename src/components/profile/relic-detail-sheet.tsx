import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ItemArt } from '@/components/economy/item-art';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { getItem, type CatalogItem } from '@/lib/economy/catalog';
import { RARITY_COLOR, RARITY_LABEL, rarityGlow } from '@/lib/economy/rarity';
import { formatLadderValue, rungGlyph, type DisciplineStanding } from '@/lib/economy/relic-ladders';

// ONE DISCIPLINE RELIC, OPENED (mock 108) — the lore and the earn metric, which is what §4a-2 asks
// a tap to reveal.
//
// TWO NUMBERS, NOT ONE. §4a-2's tiered ladder means "what have you earned" and "what are you
// chasing" are different answers, and a sheet that gave only the first would make a tier-2 relic
// look finished. So the rung line says what is held and the metric line says what the next rung
// costs — 43 / 50 km, and the rarity it will become.
//
// THRESHOLDS ARE SHOWN ON PURPOSE. The §4a ancient relics are secret (hint while locked, reveal on
// unlock) and this set is deliberately the opposite: §4a-2 is "a running progression milestone",
// which only works if the number is visible. Never route a secret relic through this sheet.
//
// Rendered on other people's profiles too, so every line has to read in the third person or in no
// person at all. Nothing here says "you".

export function RelicDetailSheet({
  standing,
  onClose,
}: {
  standing: DisciplineStanding | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const item = standing ? getItem(standing.relicKey) : null;

  return (
    <Modal visible={standing !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        {standing && item ? (
          <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.four }]}>
            <View style={styles.grab} />

            <Body standing={standing} item={item} />

            <Pressable style={styles.done} onPress={onClose} accessibilityRole="button">
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function Body({ standing, item }: { standing: DisciplineStanding; item: CatalogItem }) {
  const colour = standing.earned ? RARITY_COLOR[standing.rarity] : Colors.textTertiary;
  const glyph = rungGlyph(standing.tier);
  const isCapstone = standing.ladder === null;

  return (
    <>
      <View style={styles.head}>
        <View style={[styles.art, { borderColor: colour + '66' }, !standing.earned && styles.artDim]}>
          {standing.earned ? (
            <View style={[styles.glow, { backgroundColor: rarityGlow(standing.rarity, 0.2) }]} />
          ) : null}
          <ItemArt item={item} size={44} />
        </View>

        <View style={styles.headText}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={[styles.discipline, { color: colour }]}>
            {isCapstone ? 'SET CAPSTONE' : (standing.ladder?.label ?? '').toUpperCase()}
          </Text>
          {/* Colour is rarity, letter is rung, and the two are independent (§4a-2) — so this claims
              a rarity only once one has actually been reached, and never infers the glyph from it. */}
          <Text style={[styles.rung, { color: colour }]}>
            {standing.earned
              ? isCapstone
                ? RARITY_LABEL.mythic
                : `${RARITY_LABEL[standing.rarity]} · ${glyph ?? ''} rung ${standing.tier} of ${standing.maxTier}`
              : 'NOT YET EARNED'}
          </Text>
        </View>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(standing.pct * 100)}%`, backgroundColor: colour }]} />
      </View>

      <Text style={styles.metric}>{metricLine(standing)}</Text>

      <Text style={styles.lore}>“{item.lore}”</Text>

      <Text style={styles.footnote}>
        Earned by depth in one discipline. Never bought, never rolled from a box.
      </Text>
    </>
  );
}

/**
 * The earn metric in one line — "43 / 50 km · next rung Epic".
 *
 * The capstone has no threshold of its own: its metric is how many ladders are maxed, which is the
 * only honest way to state a requirement made entirely of other requirements.
 */
function metricLine(standing: DisciplineStanding): string {
  if (standing.ladder === null) {
    return standing.earned
      ? `Every discipline at its top rung — ${standing.value} of ${standing.nextThreshold ?? standing.value}.`
      : `Top rung of every Discipline Relic — ${standing.value} of ${standing.nextThreshold ?? 0} so far.`;
  }

  const { unit, value, nextThreshold, tier, ladder } = standing;
  if (nextThreshold === null) {
    return `${formatLadderValue(value, unit)} ${unit} — the top rung. Nothing left to climb.`;
  }

  const nextRarity = ladder.rarities[Math.min(tier, ladder.rarities.length - 1)];
  return `${formatLadderValue(value, unit)} / ${formatLadderValue(nextThreshold, unit)} ${unit} · next rung ${RARITY_LABEL[nextRarity]}`;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(6,4,10,0.55)',
  },
  sheet: {
    backgroundColor: 'rgba(16,11,20,0.97)',
    borderTopWidth: 1,
    borderTopColor: Colors.lineStrong,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: Spacing.three,
    gap: Spacing.twelve,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.trackAlt,
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 6,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
  },
  art: {
    width: 64,
    height: 64,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: Colors.cardDark,
  },
  artDim: {
    opacity: 0.45,
  },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  headText: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: Colors.ink,
  },
  discipline: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.6,
  },
  rung: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.4,
  },
  track: {
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  metric: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ember,
    marginTop: -4,
  },
  lore: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 20,
    color: Colors.muted,
  },
  footnote: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    lineHeight: 16,
  },
  done: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: Radius.button,
    backgroundColor: Colors.card,
  },
  doneText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
});
