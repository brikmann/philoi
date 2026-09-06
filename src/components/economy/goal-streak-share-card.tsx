import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { boxStamp } from '@/components/economy/share-card-stamp';
import { PersonalFlame } from '@/components/personal-flame';
import { ShareCardFrame, fitFontSize } from '@/components/share-card-frame';
import { useFlameRamp } from '@/lib/economy/flame-ramp';
import { Colors, Fonts } from '@/constants/theme';
import { BOXES, type BoxKey } from '@/lib/economy/boxes';
import { RARITY_COLOR, RARITY_LABEL, rarityGlow } from '@/lib/economy/rarity';
import type { DifficultyTier, RankTierName } from '@/types/database';

// §E — the goal story card (design-mocks/104, reworked to 171), fired from the goal reveal's
// "Share to your story".
//
// TWO HEROES, chosen by what the goal actually was:
//
//   · A STREAK (mock 171 card 1). The number IS the card. A streak's whole appeal is that it is a
//     single legible integer that can only be earned one day at a time, so it gets the same
//     treatment the lock-in card gives duration: enormous, everything else demoted to a caption.
//
//   · A SCOPED SKILL GOAL (mock 171 card 5). A one-off feat that Cindy priced — "land a standing
//     backflip", scoped EPIC — has no streak to brag about; the flex is the DIFFICULTY. So the box
//     that difficulty paid becomes the hero, tinted to its tier, and the caption names the scoping
//     because that is the part that says the feat was hard: "most never do".
//
// PersonalFlame rather than the brand FlameSvg on the streak variant, unlike the challenge card
// next to it. A streak is personal — it is the user's own equipped flame that has been kept alight
// — whereas a challenge win is a competitive result and wears the brand mark. Same distinction
// PersonalFlame's own comment draws between "home is you" and the shared surfaces.

type Props = {
  streakDays: number;
  /** "10,000 steps" — the goal in its own words. */
  goalLabel: string;
  handle: string | null;
  tier?: RankTierName;
  division?: number;
  /**
   * The difficulty Cindy scoped this feat into (0159/0160). Present only on a scoped goal; null on
   * every goal created before scoping existed and on every ordinary recurring target, both of which
   * keep the streak hero.
   */
  difficultyTier?: DifficultyTier | null;
  /** The box the completion granted, for the "what you won" stamp — never an ember count. */
  boxKey?: string | null;
};

export const GoalStreakShareCard = forwardRef<View, Props>(function GoalStreakShareCard(
  { streakDays, goalLabel, handle, tier, division, difficultyTier, boxKey },
  ref
) {
  // A scoped goal is a FEAT, not a habit — and the two want opposite cards. The branch is on the
  // scope rather than on `streakDays === 1`, because a one-day streak on a recurring goal is still
  // a streak and should still show the number.
  const scoped = difficultyTier ?? null;
  // The streak hero is the user's OWN equipped flame (PersonalFlame), and it has always recoloured
  // with the skin — while the fan behind it stayed orange. This is the "daily card needs rays
  // accurate" item: the exported PNG's rays now come off the flame that is actually in it.
  const ramp = useFlameRamp();

  if (scoped) {
    const tint = RARITY_COLOR[scoped];
    const box = boxKey ? BOXES[boxKey as BoxKey] : null;

    return (
      <ShareCardFrame
        ref={ref}
        kick={`${RARITY_LABEL[scoped]} GOAL`}
        kickColor={tint}
        handle={handle}
        tier={tier}
        division={division}>
        {/* The box the difficulty paid, in a tile lit by its own tier — mock 171's `.boxhero`. When
            the tier pays embers only there is no box to draw, so the tile holds the tint alone
            rather than a placeholder object. */}
        <View style={[styles.boxHero, { borderColor: tint, backgroundColor: rarityGlow(scoped, 0.18) }]}>
          {box ? <BoxArt boxKey={boxKey as BoxKey} size={76} /> : null}
        </View>

        <Text
          style={[styles.goal, { fontSize: fitFontSize(goalLabel, 22, 15, 20) }]}
          numberOfLines={2}>
          {goalLabel}
        </Text>
        {/* THE FLEX IS THE SCOPING. "Cindy scoped it EPIC" is a third party calling the feat hard,
            which is a far better brag than any number the user could have typed themselves. */}
        <Text style={styles.caption}>
          Cindy scoped it <Text style={{ color: tint }}>{RARITY_LABEL[scoped]}</Text> · most never do
        </Text>
        {boxStamp(boxKey)}
      </ShareCardFrame>
    );
  }

  return (
    <ShareCardFrame
      ref={ref}
      kick="STILL ON FIRE"
      // Only the STREAK variant gets it. The scoped-goal variant above draws a loot box, not a
      // flame, and its fan belongs to the box's rarity.
      rayRamp={ramp}
      handle={handle}
      tier={tier}
      division={division}>
      <View style={styles.flame}>
        <PersonalFlame size={104} />
      </View>
      <View style={styles.numberRow}>
        <Text style={styles.number}>{streakDays}</Text>
        <Text style={styles.unit}>{streakDays === 1 ? 'day' : 'days'}</Text>
      </View>
      {/* 🐛 A GOAL NAME IS USER-WRITTEN AND ROUTINELY LONG — "Land a standing backflip",
          "10,000 steps before 9am". At a fixed 18pt this clipped on the one artefact of the app
          that gets posted publicly. Shrink first, then wrap. */}
      <Text style={[styles.goal, { fontSize: fitFontSize(goalLabel, 18, 13, 22) }]} numberOfLines={2}>
        {goalLabel}
      </Text>
      <Text style={styles.caption}>every single day</Text>
      {boxStamp(boxKey)}
    </ShareCardFrame>
  );
});

const styles = StyleSheet.create({
  flame: {
    alignItems: 'center',
  },
  boxHero: {
    width: 118,
    height: 118,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  number: {
    fontFamily: Fonts.bodyBold,
    fontSize: 76,
    color: Colors.ember,
    lineHeight: 82,
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    color: Colors.amber,
    marginBottom: 14,
  },
  goal: {
    fontFamily: Fonts.bodyBold,
    lineHeight: 27,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 8,
  },
  caption: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 6,
  },
});
