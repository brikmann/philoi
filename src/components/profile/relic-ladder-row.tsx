import { StyleSheet, Text, View } from 'react-native';

import { ItemArt } from '@/components/economy/item-art';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { getItem } from '@/lib/economy/catalog';
import { RARITY_COLOR, rarityGlow } from '@/lib/economy/rarity';
import { formatLadderValue, ladderForRelic, ladderRarity, rungGlyph } from '@/lib/economy/relic-ladders';
import type { HallRelic } from '@/types/database';

// ONE DISCIPLINE RELIC ON ITS LADDER (§4a-2), for the Trophy Hall — the surface that migration 0143
// finally gave the numbers to draw.
//
// This is the shape a ladder relic needs and a trophy tile cannot give it. A TrophyTile says "you
// own this, and it is Epic"; a ladder relic's whole story is the part that has not happened yet —
// 43 of 50 km, one rung short of red. So the row leads with the bar, and the rarity chip is the
// footnote rather than the headline.
//
// EARNED AND UNEARNED USE THE SAME ROW ON PURPOSE. A ladder below its first threshold (tier 0) is
// the single most motivating thing the Hall can show a new user — it is the only trophy surface
// that says "you have started" — and giving it a different component would have let the two drift.
// The difference is drawn, not structural: an unearned row is desaturated and its art is dimmed,
// and it never claims a rarity it has not reached.
//
// Colour is rarity, letter is rung, and the two are INDEPENDENT (0119): a maxed Movement relic
// reads red + δ while a maxed Gym relic reads red + Ω. Never derive one from the other.

export function RelicLadderRow({ relic }: { relic: HallRelic }) {
  const ladder = ladderForRelic(relic.key);
  const item = getItem(relic.key);
  // Off-ladder, or a relic this build's catalog has never heard of. Both are the caller's mistake
  // rather than a state to render — the Hall filters on `family` before it gets here.
  if (!ladder || !item) return null;

  const tier = relic.tier ?? 0;
  const value = relic.value ?? 0;
  const unit = relic.unit ?? ladder.unit;
  const maxTier = relic.max_tier ?? ladder.thresholds.length;
  // `in_progress` IS the earned/unearned line, and it is exact: get_trophy_hall only sets it false
  // for rows that exist in cosmetics_owned, so !in_progress means the relic is genuinely owned.
  // Deliberately not `tier >= 1` — that infers ownership from the ladder standing, and would draw an
  // owned relic whose progress row went missing as something the user has not earned.
  const earned = !relic.in_progress;

  // The rung's rarity, not the catalog's — the catalog carries rung one's, and the server raises
  // rarity_override on every rung after it. get_trophy_hall does not return the override, so this
  // is resolved from the tier, which is exactly what ladderRarity() exists for.
  const rarity = ladderRarity(relic.key, tier) ?? item.rarity;
  const colour = earned ? RARITY_COLOR[rarity] : Colors.textTertiary;
  const glyph = rungGlyph(tier);

  // The bar measures the CURRENT rung, not the whole ladder: from the threshold already cleared to
  // the one being chased. A bar against the top threshold would sit near zero for the entire first
  // rung and read as "nothing is happening" during the part that needs the most encouragement.
  const floor = tier >= 1 ? ladder.thresholds[tier - 1] : 0;
  const ceiling = relic.next_threshold;
  const atTop = ceiling === null;
  const span = atTop ? 0 : (ceiling as number) - floor;
  const pct = atTop ? 1 : span <= 0 ? 0 : Math.max(0, Math.min(1, (value - floor) / span));

  return (
    <View style={styles.row}>
      <View style={[styles.art, { borderColor: colour + '55' }, !earned && styles.artDim]}>
        {earned ? <View style={[styles.glow, { backgroundColor: rarityGlow(rarity, 0.16) }]} /> : null}
        <ItemArt item={item} size={26} />
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.name, !earned && styles.nameDim]} numberOfLines={1}>
            {item.name}
          </Text>
          {/* The rung badge only exists once a rung has been reached — at tier 0 there is no glyph
              to draw, and inventing one would claim a rung the user has not earned. */}
          {earned && glyph ? (
            <View style={[styles.rung, { borderColor: colour + '66' }]}>
              <Text style={[styles.rungText, { color: colour }]}>
                {glyph} {tier}/{maxTier}
              </Text>
            </View>
          ) : earned ? null : (
            <Text style={styles.notYet}>NOT YET EARNED</Text>
          )}
        </View>

        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: colour }]} />
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.discipline}>{ladder.label.toUpperCase()}</Text>
          <Text style={[styles.progress, atTop && { color: colour }]}>
            {atTop
              ? `${formatLadderValue(value, unit)} ${unit} · maxed`
              : `${formatLadderValue(value, unit)} / ${formatLadderValue(ceiling as number, unit)} ${unit}`}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** True for a relic that rides a discipline ladder. `family` is the server's discriminator (0143). */
export function isLadderHallRelic(relic: HallRelic): boolean {
  return relic.family !== null;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.cardDark,
    borderRadius: Radius.card,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  art: {
    width: 40,
    height: 40,
    borderRadius: Radius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
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
  body: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  nameDim: {
    color: Colors.muted,
  },
  rung: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  rungText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
  },
  notYet: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.4,
    color: Colors.textTertiary,
  },
  track: {
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  discipline: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.5,
    color: Colors.textTertiary,
  },
  progress: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.muted,
  },
});
