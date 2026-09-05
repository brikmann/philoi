import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ItemArt } from '@/components/economy/item-art';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { getItem } from '@/lib/economy/catalog';
import { RARITY_COLOR, rarityGlow } from '@/lib/economy/rarity';
import { formatLadderValue, rungGlyph, type DisciplineStanding } from '@/lib/economy/relic-ladders';
import type { HallRelic } from '@/types/database';

// ONE DISCIPLINE RELIC ON ITS LADDER (§4a-2), for the full Trophy Hall.
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
//
// TAKES A DisciplineStanding, NOT A HallRelic. The standing is derived from the full §4a-2 set
// rather than from whatever get_trophy_hall happened to return, so a discipline nobody has touched
// still gets a row — see disciplineStandings(). It is also the same value the profile shelf and the
// tap sheet draw from, which is what stops the hall's bar and the shelf's "78%" from disagreeing.

export function RelicLadderRow({
  standing,
  onPress,
}: {
  standing: DisciplineStanding;
  onPress?: () => void;
}) {
  const item = getItem(standing.relicKey);
  const ladder = standing.ladder;
  // Off-ladder, or a relic this build's catalog has never heard of. Both are the caller's mistake
  // rather than a state to render — the capstone belongs in a trophy tile, not on a rung.
  if (!ladder || !item) return null;

  const colour = standing.earned ? RARITY_COLOR[standing.rarity] : Colors.textTertiary;
  const glyph = rungGlyph(standing.tier);
  const atTop = standing.nextThreshold === null;

  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}>
      <View style={[styles.art, { borderColor: colour + '55' }, !standing.earned && styles.artDim]}>
        {standing.earned ? (
          <View style={[styles.glow, { backgroundColor: rarityGlow(standing.rarity, 0.16) }]} />
        ) : null}
        <ItemArt item={item} size={26} />
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.name, !standing.earned && styles.nameDim]} numberOfLines={1}>
            {item.name}
          </Text>
          {/* The rung badge only exists once a rung has been reached — at tier 0 there is no glyph
              to draw, and inventing one would claim a rung the user has not earned. */}
          {standing.earned && glyph ? (
            <View style={[styles.rung, { borderColor: colour + '66' }]}>
              <Text style={[styles.rungText, { color: colour }]}>
                {glyph} {standing.tier}/{standing.maxTier}
              </Text>
            </View>
          ) : standing.earned ? null : (
            <Text style={styles.notYet}>NOT YET EARNED</Text>
          )}
        </View>

        {/* The bar measures the CURRENT rung, not the whole ladder: from the threshold already
            cleared to the one being chased. A bar against the top threshold would sit near zero for
            the entire first rung and read as "nothing is happening" during the part that needs the
            most encouragement. disciplineStandings() computes it, so the shelf agrees by
            construction. */}
        <View style={styles.track}>
          <View
            style={[styles.fill, { width: `${Math.round(standing.pct * 100)}%`, backgroundColor: colour }]}
          />
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.discipline}>{ladder.label.toUpperCase()}</Text>
          <Text style={[styles.progress, atTop && { color: colour }]}>
            {atTop
              ? `${formatLadderValue(standing.value, standing.unit)} ${standing.unit} · maxed`
              : `${formatLadderValue(standing.value, standing.unit)} / ${formatLadderValue(standing.nextThreshold as number, standing.unit)} ${standing.unit}`}
          </Text>
        </View>
      </View>
    </Pressable>
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
