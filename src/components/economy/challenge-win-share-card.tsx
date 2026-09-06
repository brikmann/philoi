import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { DefeatedStrip, KingStatue } from '@/components/economy/king-statue';
import { boxStamp } from '@/components/economy/share-card-stamp';
import { ShareCardFrame, fitFontSize } from '@/components/share-card-frame';
import { Colors, Fonts } from '@/constants/theme';
import { TIER_INTENSITY, TIER_MEDAL, ordinal, type PlacementTier } from '@/lib/challenge-reward-copy';
import type { RankTierName } from '@/types/database';

// §E — the challenge/placement story card (design-mocks/104, reworked to 171 + 172), fired from the
// challenge reward reveal's "Share to your story".
//
// Same frame as every other card (rays, purple ground, rank-in-hex philoi.app footer) so the share
// set reads as one family. What is specific here is the PLACEMENT: the medal and the tier label
// come from the same TIER_INTENSITY/TIER_MEDAL tables the reward screen uses, so the card and the
// screen it was shared from can never disagree about how big the win was.
//
// TWO HEROES, ONE CARD, because a duel and a board race are different flexes:
//
//   · DUEL — the crowned king (mock 172). There is a specific human on the other side of a duel,
//     so the card names them: the winner's face is the statue's head, and the loser sits in a
//     DEFEATED strip above it with their name struck through. See king-statue.tsx.
//   · BOARD — the crown + "1st of 12" (mock 171 card 3). A placement race has a FIELD, not an
//     opponent, and the size of that field is the whole result: "1st" says nothing without it.
//
// Deliberately does NOT show the ember payout. A share card is a flex, and "I won 50 embers" is a
// worse flex than "I beat Dee" — it also advertises a currency number that means nothing to
// someone who doesn't play, which is exactly who these are aimed at. What a win DID grant that is
// worth naming is the box, and that goes in the stamp (see share-card-stamp.tsx).

/** Interchangeable per mock 172. Swap the default, or pass one in. */
export const DUEL_HEADLINES = {
  throne: 'The throne is yours.',
  longLive: 'Long live the champion.',
  /** `You beat {name}.` — built at the call site so the name can be trimmed. */
  beat: (name: string) => `You beat ${name}.`,
};

type Props = {
  tier: PlacementTier;
  /** 'duel' picks the king statue; anything else gets the crown + field line. */
  context: 'duel' | 'board';
  /** "You beat Dee" / "Emberfall · 214 in the campfire" — the board variant's context line. */
  contextLine: string;
  metricLabel: string;
  handle: string | null;
  rankTier?: RankTierName;
  division?: number;

  // ── duel only ──
  /** The sharer. Their avatar becomes the king's head. */
  winnerName?: string;
  winnerAvatarUrl?: string | null;
  opponentName?: string | null;
  opponentAvatarUrl?: string | null;
  /** Defaults to "The throne is yours." */
  duelHeadline?: string;

  // ── board only ──
  placement?: number | null;
  fieldSize?: number;

  /** The box this win granted, for the "what you won" stamp. Never an ember count. */
  boxKey?: string | null;
};

export const ChallengeWinShareCard = forwardRef<View, Props>(function ChallengeWinShareCard(
  {
    tier,
    context,
    contextLine,
    metricLabel,
    handle,
    rankTier,
    division,
    winnerName = 'You',
    winnerAvatarUrl,
    opponentName,
    opponentAvatarUrl,
    duelHeadline = DUEL_HEADLINES.throne,
    placement,
    fieldSize,
    boxKey,
  },
  ref
) {
  const intensity = TIER_INTENSITY[tier];
  const isDuel = context === 'duel';

  return (
    <ShareCardFrame
      ref={ref}
      kick={isDuel ? 'DUEL WON' : intensity.label}
      kickColor={isDuel ? '#9EC6FF' : intensity.accent}
      // 🔴 NO LONGER `ground="season"`. This card was one of the three lighting itself from the
      // lava floor while the rank-up and unlock cards lit from above — see the frame's own note on
      // why the family had split. The molten ground now belongs to the season card alone.
      rayTint={isDuel ? '#9EC6FF' : intensity.accent}
      // The fan sits behind the statue's torso rather than at the card's midpoint, so the light
      // reads as coming off the figure.
      rayCenterY={isDuel ? 0.44 : 0.4}
      handle={handle}
      tier={rankTier}
      division={division}>
      {isDuel ? (
        // MOCK 172'S LAYOUT CONTRACT: statue pinned toward the top, and headline + stats docked to
        // the bottom as ONE block directly above the footer. The mock's earlier bug was the footer
        // being pushed off the card because the hero grew; `space-between` on a fixed-height hero
        // cannot do that — the gap absorbs the slack instead of the footer.
        <View style={styles.duelColumn}>
          <View style={styles.duelTop}>
            {opponentName ? (
              <DefeatedStrip name={opponentName} avatarUrl={opponentAvatarUrl} maxWidth={280} />
            ) : null}
            <KingStatue width={225} avatarUrl={winnerAvatarUrl} name={winnerName} />
          </View>

          <View style={styles.duelBottom}>
            <Text
              style={[styles.duelHeadline, { fontSize: fitFontSize(duelHeadline, 21, 15, 24) }]}
              numberOfLines={2}>
              {duelHeadline}
            </Text>
            <Text style={styles.metric} numberOfLines={2}>
              {metricLabel}
            </Text>
            {boxStamp(boxKey)}
          </View>
        </View>
      ) : (
        <>
          <Crown />
          <Text style={[styles.placement, { color: intensity.accent }]} numberOfLines={1}>
            {placement != null && fieldSize && fieldSize > 1
              ? `${ordinal(placement)} of ${fieldSize}`
              : TIER_MEDAL[tier]}
          </Text>
          {/* Two lines and a fitted size: a campfire name is user-written and routinely long
              ("Grind Szn — Econ Finals Push"), which is exactly what the old single-line clip
              mangled. */}
          <Text
            style={[styles.context, { fontSize: fitFontSize(contextLine, 19, 13, 26) }]}
            numberOfLines={2}>
            {contextLine}
          </Text>
          <Text style={styles.metric} numberOfLines={2}>
            {metricLabel}
          </Text>
          {boxStamp(boxKey)}
        </>
      )}
    </ShareCardFrame>
  );
});

/** Mock 171's champion crown — the board variant's hero. Static, so it rasterises cleanly. */
function Crown() {
  return (
    <Svg width={110} height={92} viewBox="0 0 96 80">
      <Defs>
        <LinearGradient id="cwCrown" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFE9A8" />
          <Stop offset="1" stopColor="#E9A93A" />
        </LinearGradient>
      </Defs>
      <Path
        d="M12 62 L18 26 L34 44 L48 18 L62 44 L78 26 L84 62 Z"
        fill="url(#cwCrown)"
        stroke="#8A5E18"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <Rect x={12} y={62} width={72} height={10} rx={3} fill="url(#cwCrown)" stroke="#8A5E18" strokeWidth={2} />
      <Circle cx={48} cy={16} r={4} fill="#FFF0C0" />
      <Circle cx={18} cy={24} r={3} fill="#FFF0C0" />
      <Circle cx={78} cy={24} r={3} fill="#FFF0C0" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  duelColumn: {
    flex: 1,
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  duelTop: {
    alignItems: 'center',
    gap: 8,
  },
  duelBottom: {
    alignItems: 'center',
    width: '100%',
  },
  duelHeadline: {
    fontFamily: Fonts.bodyBold,
    color: '#FFD27A',
    textAlign: 'center',
    lineHeight: 26,
  },
  placement: {
    fontFamily: Fonts.bodyBold,
    fontSize: 38,
    textAlign: 'center',
    letterSpacing: -0.5,
    marginTop: 10,
  },
  context: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 24,
  },
  metric: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 5,
    lineHeight: 18,
  },
});
