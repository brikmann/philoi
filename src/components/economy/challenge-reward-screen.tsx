import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, RadialGradient, Stop } from 'react-native-svg';

import { asBoxKey, useRewardClaim } from '@/components/economy/reward-claim';
import { RewardRevealFrame, type RowClaim } from '@/components/economy/reward-reveal-frame';
import { type RewardRowSpec } from '@/components/economy/reward-rows';
import { boxAccent } from '@/lib/economy/boxes';
import { useRevealCue, type RewardRevealKind } from '@/components/economy/reward-reveal';
import { EquippedFlameSvg } from '@/components/flame-icon';
import { DefeatedStrip, KingStatue } from '@/components/economy/king-statue';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { useFlameRamp } from '@/lib/economy/flame-ramp';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import {
  TIER_INTENSITY,
  TIER_MEDAL,
  challengeHeadline,
  ordinal,
  type PlacementTier,
  type RewardContext,
} from '@/lib/challenge-reward-copy';

// The challenge / campfire result screen — design-mocks/47.
//
// Fires when a challenge closes. Until now grant_reward paid out silently: embers landed in the
// wallet, a box appeared in the inventory and a badge was minted with nothing on screen to say so,
// which made the most rewarding moment in the app its quietest.
//
// The rewards shown are the ones the SERVER reports paying, never re-derived here. grant_reward
// returns {embers, box, badge, band}; this screen renders that. A screen that computed its own
// numbers from the same inputs would eventually disagree with the ledger, and the ledger is what
// actually moved.
//
// THE FRAME IS SHARED NOW. Everything structural — the full-screen fan, the top bar with the
// balance, the build-in, the row list, the footer — lives in RewardRevealFrame, because this screen
// was the reference the other three were supposed to match and matching it by hand is what let them
// drift. What is left here is what only a settled challenge has: the tier ladder, the burst, and
// the copy that names where you came.

export type ChallengeRewardResult = {
  /** Where they finished — drives copy pool AND the screen's intensity. */
  tier: PlacementTier;
  /** Duel vs board, so a 1v1 loss can never draw the "Fraud Watch" pool. */
  context: RewardContext;
  /** Absolute finishing position, 1-based. Null on a result settled without standings. */
  placement: number | null;
  /** How many raced. On a whole-campfire placement race this is the campfire. */
  fieldSize: number;
  /** 0 = top of the board, 1 = bottom — placementTier's orientation, already flipped for us. */
  percentile: number | null;
  /** For the sub-line: "You beat Dee", "Most lock-in time", "Semester". */
  opponentName?: string | null;
  metricLabel: string;
  durationLabel: string;
  xp: number;
  embers: number;
  /** `id` is the loot_boxes row (0125) — null on a payload written before that deployed, which is
   *  what leaves the Open CTA off rather than pointing it at a box that cannot be found. */
  box: { id: string | null; key: string; name: string; rarity: string } | null;
  badge: { key: string; name: string } | null;
};

type Props = {
  result: ChallengeRewardResult;
  displayName: string;
  /** The last headline this user saw, so the pool avoids an immediate repeat. */
  previousHeadline?: string | null;
  onOpenBox?: () => void;
  onShare?: () => void;
  onClose: () => void;
  sharing?: boolean;
  /**
   * §F.1 — THE KING IN THE HERO SLOT, for a duel win only (mock 172).
   *
   * Both faces, because a duel is the one result with a named other person in it: you on the
   * plinth, them struck through underneath. A board race has a FIELD rather than an opponent, so
   * it keeps the flame — a king implies you beat one person, which is the wrong story for beating
   * forty.
   *
   * Optional on purpose. A caller that does not pass them gets the flame, which is exactly what
   * every reveal did before this, so a presenter that has not been updated degrades rather than
   * renders a crownless plinth.
   */
  winnerAvatarUrl?: string | null;
  opponentAvatarUrl?: string | null;
  /**
   * Which of the three challenge reveals this is, for the ray tint and count in REVEAL_TUNING.
   *
   * Passed in rather than derived here because both presenters — the settlement watcher and the
   * challenge-info screen — already compute it with `challengeRevealKind` to queue at the right
   * priority, and a second derivation off `result.context` would disagree with theirs on a
   * collective challenge (which is a 'board' here but a team reveal there). The fallback is only
   * for a caller that has not been updated.
   */
  revealKind?: RewardRevealKind;
};

export function ChallengeRewardScreen({
  result,
  displayName,
  previousHeadline,
  onOpenBox,
  onShare,
  onClose,
  sharing = false,
  winnerAvatarUrl,
  opponentAvatarUrl,
  revealKind,
}: Props) {
  const reduceMotion = useReduceMotion();
  const intensity = TIER_INTENSITY[result.tier];
  const kind: RewardRevealKind = revealKind ?? (result.context === 'duel' ? 'challenge_solo' : 'challenge_placement');
  // A settlement's embers landed server-side, so this read already includes them — the pill counts
  // up TO it, from `wallet - paid`. Costs one get_inventory on a screen that only ever mounts on a
  // real payout, which is the same trade the goal reveal's own note argues for.
  const { embers: walletEmbers, loading: walletLoading } = useInventory();
  // THE LIGHT FOLLOWS THE FLAME; THE SEMANTICS DO NOT.
  //
  // This screen's hero is a flame, so everything that reads as light coming OFF that flame — the
  // glow it sits in and mock 47's crest rays — now takes the equipped flame's colourway, the same
  // way the full-screen fan does (see FLAME_HERO_KINDS in reward-reveal) and the same way
  // PersonalFlame's own glow already tracked `ramp.outer`. An Emberfall or violet flame throwing
  // orange light was the tell that these were three unrelated drawings.
  //
  // `intensity.accent` KEEPS the eyebrow and the field pill. Those are not light — they are the
  // tier, stated in colour, and IMMORTAL has to stay purple whatever flame is equipped.
  const ramp = useFlameRamp();

  // 🔇 THIS SCREEN MADE NO SOUND AT ALL. The three challenge rows of REVEAL_TUNING have pointed at
  // the victory fanfare since #185, and nothing read them: the cue only ever fired from the shared
  // card, and a settled challenge is presented by this bespoke screen through either door. So the
  // app's loudest payout — the one Noah calls the challenge victory — settled in silence.
  useRevealCue(kind);

  // Picked ONCE per mount. Regenerating on every render would reroll the headline mid-animation
  // and on every parent state change — the line has to hold still while it is being read.
  const headline = useMemo(
    () => challengeHeadline(result.tier, result.context, displayName, previousHeadline),
    [result.tier, result.context, displayName, previousHeadline]
  );

  // 🔴 A DUEL **WIN**, and both halves matter. 'rank1' alone would crown the winner of a
  // forty-person board race, where there is no single person to have beaten; `context === 'duel'`
  // alone would put a king under someone who came second in a 1v1. The loser of a duel keeps the
  // flame and the warm copy the tier pool already writes for them.
  const isDuelWin = result.context === 'duel' && result.tier === 'rank1';

  // The spec's intensity ladder, as one number the burst scales off: ray length, glow and flame
  // all climb together rather than each being tuned per tier by hand.
  const energy = intensity.level / 7;

  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 0;
      return;
    }
    // Faster at the top of the ladder — "animation speed scales up together" with the rest.
    const duration = 1600 - energy * 500;
    pulse.value = withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduceMotion, energy, pulse]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + pulse.value * (0.2 + energy * 0.3),
    transform: [{ scale: 1 + pulse.value * (0.02 + energy * 0.05) }],
  }));

  // 🔴 PER-ROW CLAIMING. Was box → embers → dismiss, walked by one footer button you tapped once
  // per reward. Every row carries its own control now; XP joins the claimable set (it ticks in
  // place — see RewardClaimKind for why it has no flight), and the footer is "Claim all".
  const claim = useRewardClaim({
    boxKey: asBoxKey(result.box?.key),
    boxName: result.box?.name,
    embers: result.embers,
    xp: result.xp,
    walletEmbers: walletLoading ? null : walletEmbers,
    onDone: onClose,
  });

  // Destructured immediately, and the row list depends on these rather than on `claim`. Two
  // reasons, both load-bearing: the hook returns its three measurement refs in the same object, so
  // the React Compiler taints every `claim.x` read during render as "accessing a ref"; and the
  // object itself is new on every render, including the ~16 a second the balance counter pushes
  // while embers are in the air — depending on it whole would rebuild every row spec mid-flight and
  // defeat RewardRow's memo. These four are the only inputs a row's appearance actually has.
  const { claimed, busy, claimFor, claim: claimOne } = claim;
  const rows = useMemo(
    () => buildRows(result, { claimed, busy, claimFor, claimOne }, onOpenBox),
    [result, onOpenBox, claimed, busy, claimFor, claimOne]
  );

  return (
    <RewardRevealFrame
      claim={claim}
      kind={kind}
      // THE GATE STAYS. The spec is explicit that a weak result gets embers, not blaze, and a
      // full-screen ray blast behind "NEEDS IGNITION" would be the app cheering a loss. Mock 47's
      // own 120pt crest rays below are gated on the same comparison for the same reason. One
      // comparison to move if Noah wants it lower.
      rays={intensity.level >= 3}
      heroStyle={styles.burst}
      hero={
        <>
          <Animated.View style={[styles.glowLayer, glowStyle]} pointerEvents="none">
            <Svg width={200} height={200}>
              <Defs>
                <RadialGradient id="rewardGlow" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={ramp.outer} stopOpacity={0.16 + energy * 0.3} />
                  <Stop offset="0.65" stopColor={ramp.outer} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={100} cy={100} r={100} fill="url(#rewardGlow)" />
            </Svg>
          </Animated.View>

          {/* Mock 47's radiating rays. Count climbs with the ladder, so a mid-pack finish gets a
              calm frame and a champion gets the full starburst — "embers, not blaze" at the
              bottom, per the spec's explicit instruction not to over-celebrate a weak result. */}
          {intensity.level >= 3 ? <Rays accent={ramp.outer} energy={energy} /> : null}

          {isDuelWin ? (
            /* §F.1 · YOU, ON THE PLINTH (mock 172). The same KingStatue + DefeatedStrip the share
               card draws, moved into the hero so the reveal and the card you post from it are the
               same image — the card was a floating artefact that looked nothing like the screen it
               was shared from.

               The glow and the rays above are UNTOUCHED and still take the flame ramp: they are
               light, and light in this app comes off the user's own fire whatever is standing in
               it. Only the object in the middle changes. */
            <View style={styles.kingHolder}>
              {result.opponentName ? (
                <DefeatedStrip name={result.opponentName} avatarUrl={opponentAvatarUrl ?? null} maxWidth={210} />
              ) : null}
              <KingStatue width={168} avatarUrl={winnerAvatarUrl ?? null} name={displayName} />
            </View>
          ) : (
            <View style={styles.flameHolder}>
              {/* THE EQUIPPED FLAME, not the fixed brand orange one. Retinting the fan and the glow
                  to the flame ramp while the flame itself stayed brand-orange would have swapped one
                  mismatch for a worse one — a violet fan around an orange flame. Same silhouette,
                  same brand mark; only the ramp moves. */}
              <EquippedFlameSvg width={54} height={54} />
            </View>
          )}
        </>
      }
      rows={rows}
      footer={
        onShare ? (
          <Pressable
            style={styles.shareBtn}
            onPress={onShare}
            disabled={sharing || claim.busy}
            accessibilityRole="button">
            <Text style={styles.shareText}>{sharing ? 'Preparing…' : 'Share to your story'}</Text>
          </Pressable>
        ) : null
      }>
      <Text style={[styles.eyebrow, { color: intensity.accent }]}>{intensity.label}</Text>
      <Text style={styles.headline}>{headline}</Text>
      {/* THE FIELD, STATED (#186). A placement race's result is "where you came out of how many",
          and until now that number appeared nowhere on the screen that celebrates it — the
          subline said "🥇 1st" whether you had beaten two people or two hundred. Given its own
          line, in the tier's accent, because on a big campfire race it IS the result. */}
      {fieldLine(result) ? (
        <View style={[styles.fieldPill, { borderColor: intensity.accent }]}>
          <Text style={[styles.fieldPillText, { color: intensity.accent }]}>{fieldLine(result)}</Text>
        </View>
      ) : null}
      <Text style={styles.subline}>{subline(result)}</Text>
    </RewardRevealFrame>
  );
}

/** Mock 47's seven rays. Static SVG — only the glow behind them breathes, so this costs one draw. */
function Rays({ accent, energy }: { accent: string; energy: number }) {
  const lines = [
    [60, 6],
    [104, 50],
    [16, 50],
    [92, 18],
    [28, 18],
    [92, 82],
    [28, 82],
  ];
  return (
    <View style={styles.rays} pointerEvents="none">
      <Svg width={120} height={100} viewBox="0 0 120 100">
        <G stroke={accent} strokeWidth={2} strokeLinecap="round" opacity={0.25 + energy * 0.35}>
          {lines.map(([x, y]) => (
            <Line key={`${x}-${y}`} x1={60} y1={50} x2={x} y2={y} />
          ))}
        </G>
      </Svg>
    </View>
  );
}

/**
 * "🥇 1st of 48" / "12th of 48 · TOP 25%" — the headline fact of a board race, or null when there
 * is no field worth naming.
 *
 * NOT SHOWN FOR A DUEL. "1st of 2" is a worse way of saying "you won", and the duel already gets
 * "You beat Dee" in the subline. Nor for a field of one, which is not a race.
 */
function fieldLine(r: ChallengeRewardResult): string | null {
  if (r.context !== 'board' || r.placement == null || r.fieldSize < 2) return null;
  const medal = TIER_MEDAL[r.tier];
  // The podium medals already carry the ordinal ("🥇 1st"), so they take the field count directly
  // rather than repeating it — "🥇 1st of 48", not "🥇 1st · 1st of 48".
  if (r.tier === 'rank1' || r.tier === 'rank2' || r.tier === 'rank3') return `${medal} of ${r.fieldSize}`;
  return `${ordinal(r.placement)} of ${r.fieldSize} · ${medal}`;
}

/** "🥇 1st · You beat Dee · Most lock-in time · Semester" */
function subline(r: ChallengeRewardResult): string {
  // The medal moves up into the field pill when there is one, so it is stated once per screen.
  const lead = fieldLine(r) ? null : TIER_MEDAL[r.tier];
  return [lead, r.opponentName ? `You beat ${r.opponentName}` : null, r.metricLabel, r.durationLabel]
    .filter(Boolean)
    .join(' · ');
}

function buildRows(r: ChallengeRewardResult, claim: RowClaim, onOpenBox?: () => void): RewardRowSpec[] {
  const rows: RewardRowSpec[] = [];

  // BOX FIRST, THEN EMBERS, THEN XP, then the badge nothing is claimed from. The manifest reads in
  // the order "Claim all" runs — see useRewardClaim — so the box is no longer buried under two
  // lines of numbers on the screen that grants it.
  if (r.box) {
    rows.push({
      kind: 'box',
      title: r.box.name,
      detail: 'Cosmetic loot box',
      // 🔴 THE BOX'S OWN RARITY, not gold. This chip read `Colors.amber` for every crate, so an
      // Ignition Crate — an UNCOMMON, green everywhere else in the app — announced itself in the
      // same colour as a Promethean. See boxAccent.
      chip: { label: r.box.rarity.toUpperCase(), color: boxAccent(r.box.key) },
      accent: boxAccent(r.box.key),
      // OPEN IS THE BOX'S CLAIM. Noah asked for a claim on every row, and the box already had a
      // better one: opening it is claiming it and then some. So Open marks the row taken — which is
      // what keeps "Claim all" from trying to fly a box that is already on its way to the crack
      // screen — and then routes. Both presenters tear this reveal down inside onOpenBox, so the
      // drift animation is moot there; the marking is not, and on a reveal that stays mounted the
      // box flies exactly as it would have.
      onOpen: onOpenBox
        ? () => {
            claim.claimOne?.('box');
            onOpenBox();
          }
        : undefined,
      openDisabled: claim.busy,
      claimed: Boolean(claim.claimed.box),
    });
  }
  if (r.embers > 0) {
    rows.push({
      kind: 'embers',
      title: 'Embers',
      detail: 'Spend in the shop',
      value: `+${r.embers.toLocaleString('en-US')}`,
      claim: claim.claimFor('embers'),
      destination: '→ wallet',
      claimed: Boolean(claim.claimed.embers),
    });
  }
  if (r.xp > 0) {
    rows.push({
      kind: 'xp',
      title: 'XP earned',
      detail: 'The bigger the goal, the bigger the pot',
      value: `+${r.xp.toLocaleString('en-US')}`,
      claim: claim.claimFor('xp'),
      claimed: Boolean(claim.claimed.xp),
    });
  }
  if (r.badge) {
    rows.push({
      kind: 'badge',
      title: `"${r.badge.name}" badge`,
      detail: "Exclusive — can't be bought",
      chip: { label: 'EARNED', color: Colors.green },
      // NOT CLAIMABLE, and that is not an oversight. A badge is minted onto the profile at
      // settlement and has no wallet, no inventory corner and no bar to travel to — a Claim on it
      // would be a button that dims itself and does nothing else.
      destination: '→ earned',
    });
  }
  return rows;
}

const styles = StyleSheet.create({
  kingHolder: {
    alignItems: 'center',
    gap: 8,
  },
  burst: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowLayer: {
    position: 'absolute',
  },
  rays: {
    position: 'absolute',
  },
  flameHolder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    marginTop: Spacing.two,
  },
  headline: {
    fontFamily: Fonts.bodyBold,
    fontSize: 23,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 29,
  },
  fieldPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: Spacing.twelve,
    backgroundColor: Colors.scrim,
    marginTop: Spacing.twelve,
  },
  fieldPillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    letterSpacing: 0.4,
  },
  subline: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 6,
  },
  shareBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.twelve,
  },
  shareText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13.5,
    color: Colors.muted,
  },
});
