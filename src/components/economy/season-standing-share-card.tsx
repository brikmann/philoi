import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { SEASON } from '@/lib/economy/forge-pass';

// The season-close standing card (FORGE_PASS_SEASON1 §"End-of-season placement rewards" — "wire a
// Champion share card"). 9:16, captured by the same view-shot pipeline as every other card.
//
// It is a STANDING card, not strictly a Champion card. Building it for #1 only would have meant one
// person per campus per season had anything to post, and the whole point of a placement ladder is
// that finishing 7th out of 400 is also worth showing. The design escalates instead: the Champion
// gets the crown treatment, everyone else gets their real number, and nobody gets a card that reads
// as a consolation prize.

const CARD_WIDTH = 360;
const CARD_HEIGHT = 640;

/** Band styling. Keyed off the same thresholds the SQL grant uses, so the card can never claim a
 *  band the server didn't actually pay out. */
function bandFor(rank: number, boardSize: number): { label: string; tint: string; crown: boolean } {
  const pct = rank / Math.max(boardSize, 1);
  if (rank === 1) return { label: 'SEASON CHAMPION', tint: '#FFD24D', crown: true };
  if (rank <= 10) return { label: 'TOP 10', tint: '#FFC24D', crown: false };
  if (pct <= 0.01) return { label: 'TOP 1%', tint: '#FF9A3C', crown: false };
  if (pct <= 0.1) return { label: 'TOP 10%', tint: '#F2A33C', crown: false };
  if (pct <= 0.5) return { label: 'TOP 50%', tint: '#D9913C', crown: false };
  return { label: 'EMBERFALL', tint: '#C4701F', crown: false };
}

type Props = {
  rank: number;
  boardSize: number;
  university: string;
  passLevel: number;
  handle: string;
};

export const SeasonStandingShareCard = forwardRef<View, Props>(function SeasonStandingShareCard(
  { rank, boardSize, university, passLevel, handle },
  ref
) {
  const band = bandFor(rank, boardSize);

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <View style={[styles.glow, { backgroundColor: `${band.tint}44` }]} />
      <View style={[styles.ring, { borderColor: band.tint }]} />

      <Text style={styles.season}>
        {SEASON.name.toUpperCase()} · SEASON {SEASON.id.replace('S', '')}
      </Text>

      {band.crown ? <Text style={styles.crown}>👑</Text> : null}

      {/* The rank is the entire card. Everything else is caption. */}
      <View style={styles.rankWrap}>
        <Text style={[styles.hash, { color: band.tint }]}>#</Text>
        <Text style={[styles.rank, { color: band.tint }]}>{rank}</Text>
      </View>
      <Text style={styles.of}>of {boardSize.toLocaleString('en-US')} at {university}</Text>

      <View style={[styles.band, { borderColor: band.tint }]}>
        <Text style={[styles.bandText, { color: band.tint }]}>{band.label}</Text>
      </View>

      <Text style={styles.level}>Forge Pass Level {passLevel}</Text>

      <Text style={styles.handle}>@{handle}</Text>
      {/* No CTA, same rule as the unlock card: a real number posted by a real person is the growth
          loop. A tagline underneath would turn it into an ad and stop it being posted at all. */}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: '#0b0710',
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: Spacing.four,
  },
  glow: {
    position: 'absolute',
    top: -110,
    width: 460,
    height: 460,
    borderRadius: 230,
  },
  ring: {
    position: 'absolute',
    top: 26,
    left: 26,
    right: 26,
    bottom: 26,
    borderRadius: 20,
    borderWidth: 1,
    opacity: 0.45,
  },
  season: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 2,
    color: Colors.textTertiary,
    marginBottom: Spacing.three,
  },
  crown: {
    fontSize: 44,
    marginBottom: Spacing.one,
  },
  rankWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  hash: {
    fontFamily: Fonts.bodyBold,
    fontSize: 46,
    marginTop: 14,
  },
  rank: {
    fontFamily: Fonts.bodyBold,
    fontSize: 128,
    lineHeight: 132,
  },
  of: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
    marginTop: Spacing.one,
    textAlign: 'center',
  },
  band: {
    marginTop: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 18,
  },
  bandText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.6,
  },
  level: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.textTertiary,
    marginTop: Spacing.three,
  },
  handle: {
    position: 'absolute',
    bottom: 44,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.textTertiary,
  },
});
