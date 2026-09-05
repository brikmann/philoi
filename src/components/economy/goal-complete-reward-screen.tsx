import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { asBoxKey, useRewardClaim } from '@/components/economy/reward-claim';
import { useRevealCue } from '@/components/economy/reward-reveal';
import { RewardRevealFrame, RevealHeadline, type RowClaim } from '@/components/economy/reward-reveal-frame';
import { type RewardRowSpec } from '@/components/economy/reward-rows';
import { EquippedFlameSvg } from '@/components/flame-icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { BOXES, boxAccent } from '@/lib/economy/boxes';
import type { UnseenGoalReward } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// A GOAL YOU FINISHED, PAID OUT LOUD — mock 170 (the two-step reveal) + mock 176 §4 (the honest
// line about what unverified costs you).
//
// THE FOURTH WRAPPER ON THE SAME FRAME, and that is the whole design. `RewardRevealFrame` already
// owns the geometry, the ray fan, the balance pill, the build-in, the status → "See rewards" →
// "YOUR REWARDS" choreography and the footer. This file owns the two things that are genuinely
// this payout's own: the crate as the hero, and the line that says what verification level it
// settled at. Forking a fifth reveal is what the frame exists to prevent.
//
// 🔒 PRESENTATION ONLY. NOTHING HERE GRANTS ANYTHING. economy_on_challenge_completed called
// grant_reward when `completed_at` was set — often server-side, with the app shut — and 0167 only
// captured the receipt it returned. Every figure on this screen is read back off that receipt.
// There is no re-pricing and, per 0164, no upgrade to animate: the single grant already fired at
// the band the goal actually earned.
// ══════════════════════════════════════════════════════════════════════════════════════════════

type Props = {
  goal: UnseenGoalReward;
  onClose: () => void;
  /** Route to the crack screen. Absent when the payload has no `box_id` to open. */
  onOpenBox?: () => void;
};

export function GoalCompleteRewardScreen({ goal, onClose, onOpenBox }: Props) {
  const payload = goal.payload;
  const boxKey = asBoxKey(payload?.box);
  const embers = payload?.embers ?? 0;

  // The pill counts UP TO the wallet's own figure and starts from `wallet - embers`, because the
  // grant landed before this screen existed. Withheld while the read is in flight rather than
  // guessed — see the hook's own note on why deriving it the other way round is a bug.
  const { embers: walletEmbers, loading: walletLoading } = useInventory();

  const claim = useRewardClaim({
    boxKey,
    boxName: boxKey ? BOXES[boxKey].name : null,
    embers,
    // NO XP ROW, and that is the payload's doing rather than a choice: grant_reward pays embers, a
    // box and (on the top two bands) a badge. A goal's XP moves through a different door entirely.
    walletEmbers: walletLoading ? null : walletEmbers,
    onDone: onClose,
  });

  // The same cue a settled challenge gets. A scoped feat finishing is a win, not the day's small
  // beat — 'challenge_solo' is the row that says so, and it carries the tint and the ray count too.
  useRevealCue('challenge_solo');

  // Destructured at the top for both reasons the challenge screen's note gives: the hook returns
  // its measurement refs in the same object, so the React Compiler taints every `claim.x` read
  // during render, and the object is new on every render including the ~16 a second the balance
  // counter pushes mid-flight.
  const { claimed, busy, claimFor, claim: claimOne } = claim;
  const rows = useMemo(
    () => buildRows(goal, { claimed, busy, claimFor, claimOne }, onOpenBox),
    [goal, onOpenBox, claimed, busy, claimFor, claimOne]
  );

  const line = verificationLine(goal);

  return (
    <RewardRevealFrame
      claim={claim}
      // Tint, wedge count and intensity for a solo win. A personal goal IS a solo challenge — it is
      // literally a row in `challenges` — so it takes that row rather than inventing a seventh.
      kind="challenge_solo"
      heroStyle={styles.hero}
      hero={
        // THE CRATE IS THE HERO (§2). This reveal has no placement, no opponent and no rank bar;
        // what the user earned IS the box, and its rarity is the one thing they read first. The
        // frame puts `originRef` on this, so the crate is also where the rays bloom from and where
        // the embers lift off — the light comes off the thing that was won.
        //
        // A completion-band goal mints no box at all (grant_reward returns box: null), and a hero
        // slot with nothing in it would read as a broken image. The equipped flame stands in, which
        // is the same fallback the challenge screen uses for a win with no crate.
        boxKey ? (
          <View style={[styles.crate, { shadowColor: boxAccent(boxKey) }]}>
            <BoxArt boxKey={boxKey} size={132} />
          </View>
        ) : (
          <EquippedFlameSvg width={72} height={72} />
        )
      }
      rows={rows}>
      <RevealHeadline
        eyebrow="GOAL COMPLETE"
        eyebrowColor={boxKey ? boxAccent(boxKey) : undefined}
        // THE GOAL IN ITS OWN WORDS. "Learn a standing backflip" is what makes this feel like the
        // app noticed the specific thing the user set out to do, rather than a generic payout —
        // which is the entire argument for Cindy scoping a feat in the first place.
        headline={goal.goal_label?.trim() || 'You finished it.'}
      />
      {line ? <Text style={[styles.line, line.warn && styles.lineWarn]}>{line.text}</Text> : null}
    </RewardRevealFrame>
  );
}

/**
 * The honest line — mock 176 §4.
 *
 * 🔴 IT NAMES WHAT WAS LOST, not just what was won. An unvouched claim pays one band down (0159,
 * capped at Furnace) and the reveal is the only place the user ever finds that out. Saying so, with
 * the crate they would have had, is what makes the vouch flow worth using next time; a reveal that
 * quietly handed over the smaller box and said nothing would teach nothing.
 *
 * Nothing here recomputes a payout. `full_band`/`full_box` come off the RPC, which asks the same
 * `goal_paid_band` helper the trigger asked — and asks it about a grant that will never happen.
 */
function verificationLine(goal: UnseenGoalReward): { text: string; warn: boolean } | null {
  const fullBox = asBoxKey(goal.full_box);
  const paidBox = asBoxKey(goal.payload?.box);

  if (goal.verified_as === 'honor') {
    // Only when the discount actually COST something. A tier whose honour band and full band land
    // on the same crate has nothing to upsell, and printing the warning anyway would be the screen
    // inventing a loss.
    if (fullBox && fullBox !== paidBox) {
      return {
        text: `Unverified — this paid one tier down. A clip, or two friends vouching, unlocks the full ${BOXES[fullBox].name}.`,
        warn: true,
      };
    }
    return { text: 'Taken on your word. Nice one.', warn: false };
  }
  if (goal.verified_as === 'vouched') {
    return { text: 'Verified — you got the full tier.', warn: false };
  }
  if (goal.verified_as === 'auto') {
    return { text: 'Tracked end to end. Full tier, no questions.', warn: false };
  }
  return null;
}

function buildRows(
  goal: UnseenGoalReward,
  claim: RowClaim,
  onOpenBox?: () => void
): RewardRowSpec[] {
  const rows: RewardRowSpec[] = [];
  const payload = goal.payload;
  const boxKey = asBoxKey(payload?.box);

  // BOX, THEN EMBERS, THEN THE BADGE nothing is claimed from — the order "Claim all" runs and the
  // order every other reveal lists them in.
  if (boxKey) {
    const box = BOXES[boxKey];
    rows.push({
      kind: 'box',
      title: box.name,
      detail: 'Cosmetic loot box',
      chip: { label: box.rarity.toUpperCase(), color: boxAccent(boxKey) },
      accent: boxAccent(boxKey),
      // Open IS the box's claim — it marks the row taken so "Claim all" does not try to fly a crate
      // already on its way to the crack screen, then routes. Absent when the payload predates
      // box_id and there is no specific crate to open; the row still renders, as a receipt.
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
  if (payload?.embers && payload.embers > 0) {
    rows.push({
      kind: 'embers',
      title: 'Embers',
      detail: 'Spend in the shop',
      value: `+${payload.embers.toLocaleString('en-US')}`,
      claim: claim.claimFor('embers'),
      destination: '→ wallet',
      claimed: Boolean(claim.claimed.embers),
    });
  }
  if (payload?.badge && payload.band) {
    rows.push({
      kind: 'badge',
      // The label is rebuilt from `band` exactly as the challenge reveal does it: the payload
      // stores the KEY ('challenge-elite') and the human name lives nowhere on the row.
      title: `${payload.band[0].toUpperCase()}${payload.band.slice(1)} badge`,
      detail: "Exclusive — can't be bought",
      chip: { label: 'EARNED', color: Colors.green },
      // Not claimable, for the challenge screen's reason: a badge is minted onto the profile and
      // has no wallet or inventory corner to travel to.
      destination: '→ earned',
    });
  }
  return rows;
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 168,
  },
  // The crate's own rarity, as light rather than as a border. Android ignores shadowColor on a
  // plain View, which is why this is a lift and not the only thing carrying the rarity — the chip,
  // the eyebrow and the Open button all take boxAccent too.
  crate: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.55,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 0 },
  },
  line: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  lineWarn: {
    color: Colors.amber,
  },
});
