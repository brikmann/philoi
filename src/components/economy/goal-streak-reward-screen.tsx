import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { asBoxKey, useRewardClaim } from '@/components/economy/reward-claim';
import { RewardRevealFrame, type RowClaim } from '@/components/economy/reward-reveal-frame';
import { type RewardRowSpec } from '@/components/economy/reward-rows';
import { boxAccent } from '@/lib/economy/boxes';
import { StreakMeter } from '@/components/economy/streak-meter';
import { useRevealCue } from '@/components/economy/reward-reveal';
import { PersonalFlame } from '@/components/personal-flame';
import { RewardBurst, type RewardBurstHandle } from '@/components/reward-burst';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { BOXES, type BoxKey } from '@/lib/economy/boxes';
import type { GoalDayAward } from '@/lib/api/challenges';

// The personal-goal / streak payout screen — design-mocks/103.
//
// The counterpart to mock 47: 47 pays out competition, this pays out consistency. Same reward-row
// language on purpose (the mock says so outright), because "you won 50 embers" and "you earned 235
// embers" are the same kind of statement and shouldn't be typeset as if they were different.
//
// STRIPPED TO A TITLE AND ITS ROWS. What used to be here, and what Noah cut:
//
//   · a streak badge on the flame, an eyebrow, a headline ("Goal cleared, Noah."), a subline
//     repeating the goal and the streak, and a breakdown line explaining the arithmetic. Six pieces
//     of text for one number.
//   · the breakdown in particular had a real argument behind it — "7 × 25 daily + 60 streak bonus"
//     is what makes a payout legible as earned rather than invented — and it is gone anyway,
//     because on the DAILY reveal there is no arithmetic to show. "+12 today (easy goal)" explains
//     a single figure by restating it.
//
// What is left is the payout and the thing that took it: the title names the goal you cleared, and
// the rows name what it paid with a Claim inside each. The flame and the rays carry the occasion,
// which is what they were always for.
//
// SAME SHELL AS THE OTHER THREE NOW. The full-screen fan, the balance pill, the build-in and the
// footer all come from RewardRevealFrame — this screen had hand-written copies of every one of
// them, which is precisely how the four reveals drifted apart in the first place.

type Props = {
  /** Exactly what the server said it paid — see economy_award_goal_day (0085). */
  award: GoalDayAward;
  /**
   * "10,000 steps" — the goal in its own words, and now the title.
   *
   * It already carries the target AND the metric: personalGoalTitle (lib/goal-types) formats a
   * steps goal as `${target.toLocaleString()} steps`. So the headline reads off this and nothing
   * had to be threaded through from the goal row.
   */
  goalLabel: string;
  onShare?: () => void;
  onClose: () => void;
  sharing?: boolean;
};

export function GoalStreakRewardScreen({ award, goalLabel, onShare, onClose, sharing = false }: Props) {
  const total = award.embers + award.milestone;
  const isMilestone = award.milestone > 0;

  // 🐛 THE BALANCE HAD NOWHERE TO LAND. Noah reported the ember balance not updating after finishing
  // a goal, and the wallet-refresh pub/sub only fixes that for screens carrying an `EmberPill` —
  // Shop, Inventory, Flame Pass, box/item detail. A goal completion lands the user HERE, on the
  // Challenges tab, and this tab has no pill at all. So there was no number on screen to move, and
  // "it didn't update" was really "it was never shown".
  //
  // The lock-in done screen already solved the same problem its own way (FlameMeterComplete takes
  // `embersBefore` and counts up to the new figure). This is the goal-side equivalent: say what was
  // paid AND what the wallet now holds, so the change is legible without a pill anywhere.
  //
  // Mounted here rather than in the parent on purpose. `useInventory` costs a get_inventory round
  // trip, and hanging it off the Challenges tab would pay that on every focus for a screen that
  // usually shows no reward at all; this component only ever mounts on a real payout. Its fetch runs
  // after the award has resolved (the parent only renders this once `awardGoalDay` came back), and
  // it re-renders again if the shared refresh lands later — see lib/economy/wallet-refresh.ts.
  const { embers: walletEmbers, loading: walletLoading } = useInventory();
  // Withheld rather than guessed while the read is in flight: a total is a factual claim about the
  // ledger, and `embersBefore + total` would be this screen deriving a balance the server owns —
  // wrong the moment anything else moved the wallet in the same window. The pill in the top bar is
  // where it lands now; the wallet figure no longer appears as a string on the ember row, because
  // printing the answer above a counter that is about to count to it is what makes the counter
  // pointless.
  const wallet = walletLoading ? null : walletEmbers;

  // NO XP ROW HERE, and that is the payload's doing rather than a choice: economy_award_goal_day
  // (0085) pays embers, a milestone bonus and sometimes a box — GoalDayAward has no xp field at
  // all. The claimable set is whatever the server says it paid, so this reveal simply has two rows
  // where the challenge reveal has four.
  const claim = useRewardClaim({
    boxKey: asBoxKey(award.box),
    boxName: 'your loot box',
    embers: total,
    walletEmbers: wallet,
    onDone: onClose,
  });

  // 🐛 THE MISSING BURST. challenges.tsx has always had two completion branches, and only one of
  // them celebrated: when the server actually PAID, `handleLogged` set `goalAward` and returned
  // early — straight past the `setCelebrating(true)` that fires the burst. So the louder outcome
  // (a real payout, this screen) played nothing, while the quieter one (already banked today) got
  // the animation. Owning the burst here rather than fixing the branch is what keeps it that way:
  // this screen cannot be shown without its own reveal.
  //
  // Fired from an effect, not inline, for the same reason check-in.tsx and challenges.tsx do it —
  // the ref only attaches after the first render, so calling on the render pass would no-op.
  // Empty deps: exactly once per mount, and the parent only ever mounts this on a fresh award.
  //
  // 🔒 PRESENTATION ONLY. The embers landed server-side before this screen existed; the burst
  // announces the payout, it does not create one. Reduce-motion and the sound/haptic preferences
  // are all honoured inside RewardBurst.fire().
  const burstRef = useRef<RewardBurstHandle>(null);
  useEffect(() => {
    burstRef.current?.fire();
  }, []);

  // 🔇 AND THE MISSING FANFARE. The burst above fixed the missing ANIMATION; the sound it plays is
  // 'settle', the quiet post-confirmation tick, and that was the entire audio of a cleared goal.
  // Meanwhile 'victory' had shipped and was wired into REVEAL_TUNING, where nothing bespoke read
  // it. This is the row's cue — 'victory-short' — playing on the reveal that earns it. The burst is
  // muted rather than removed so the two do not overlap; it keeps its Lottie and its haptic.
  useRevealCue('daily_fire');

  // Destructured immediately, for both reasons the challenge screen's own note gives: the hook's
  // measurement refs taint `claim.x` reads during render, and the object is new every render.
  const { claimed, claimFor } = claim;
  const rows = useMemo<RewardRowSpec[]>(
    () => buildRows(award, total, { claimed, claimFor }),
    [award, total, claimed, claimFor]
  );

  return (
    <RewardRevealFrame
      claim={claim}
      // `daily_fire` is the row FlameMeterComplete pulls too: this and the lock-in done screen are
      // the same beat, the day's small payout. Tint, wedge count, intensity and reduce-motion all
      // come from REVEAL_TUNING via the shared component.
      kind="daily_fire"
      hero={
        // Mock 103's crest, minus the streak badge that used to sit on it. Reusing PersonalFlame
        // rather than redrawing the mock's coal-bed SVG keeps this the user's OWN equipped flame —
        // the thing they have been feeding all week is the thing that pays them.
        //
        // The frame puts `originRef` on this, so it is also the origin of both flights and the
        // anchor for the rays: the embers lift off the flame that earned them, not off the middle
        // of the screen.
        <PersonalFlame size={104} />
      }
      rows={rows}
      below={
        <>
          {/* §4 — the streak, as something with a next rung rather than a bare digit. It sat above
              the payout when the payout was one row; with the reward rows now carrying the same
              layout as the challenge screen, the meter moves BELOW them so the manifest is in the
              same place on both screens and the context follows it. */}
          <View style={styles.streak}>
            <StreakMeter streak={award.streak} />
          </View>

          {/* KEPT, against "nothing else", and it is the one judgement call in this pass. It renders
              only when the server says the weekly ceiling actually clipped the payout — otherwise a
              smaller number than usual appears with nothing on screen to explain it, and with the
              breakdown gone there is now nothing else that could. One line to delete if Noah wants
              it out too. */}
          {award.capped ? (
            <Text style={styles.capped}>
              Weekly earning cap reached — the rest banks again next week.
            </Text>
          ) : null}
        </>
      }
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
      {/* The burst is a one-shot that fires and fades — it is not the ray fan, which the frame
          owns and which stays for as long as the reveal does. */}
      <RewardBurst ref={burstRef} cue="settle" silent />

      {/* ONE LINE, AND IT NAMES THE GOAL. "DAILY GOAL COMPLETE: 10,000 STEPS" — `goalLabel`
          already formats as target + metric, so this is the whole headline. The milestone
          variant keeps the streak in the same slot rather than adding a second line, which is
          where the badge that used to sit on the flame went. */}
      <Text style={styles.title}>
        {isMilestone ? `${award.streak}-DAY GOAL STREAK` : 'DAILY GOAL COMPLETE'}:{' '}
        {goalLabel.toUpperCase()}
      </Text>
    </RewardRevealFrame>
  );
}

function buildRows(award: GoalDayAward, total: number, claim: RowClaim): RewardRowSpec[] {
  const rows: RewardRowSpec[] = [];

  // THE BOX ROW SURVIVES, even though Noah's answer is that daily goals pay embers only. It is a
  // field on GoalDayAward and a milestone could still carry one. It no longer has to survive for
  // the old reason — a sequence that would dead-end on an unrendered step — because there is no
  // sequence any more; it survives because a box the server minted has to appear somewhere.
  //
  // BOX FIRST, THEN EMBERS — the manifest reads in the order "Claim all" runs.
  if (award.box) {
    rows.push({
      kind: 'box',
      title: BOXES[award.box as BoxKey]?.name ?? 'Loot box',
      detail: `${award.streak}-day goal streak`,
      // The crate's rarity, not a flat gold "EARNED" — the same fix as the challenge reveal.
      chip: {
        label: (BOXES[award.box as BoxKey]?.rarity ?? 'earned').toUpperCase(),
        color: boxAccent(award.box),
      },
      accent: boxAccent(award.box),
      claim: claim.claimFor('box'),
      claimed: Boolean(claim.claimed.box),
      destination: '→ inventory',
    });
  }
  if (total > 0) {
    rows.push({
      kind: 'embers',
      title: `+${total.toLocaleString('en-US')} Embers`,
      // NO CAPTION. "Daily goal · easy target" was a label on a screen whose entire argument is
      // that it is one number and one button, and the difficulty tier is not something anyone
      // came here to read. The streak meter below carries the only context that earns its place.
      detail: undefined,
      // The Claim sits exactly where "→ wallet" used to.
      claim: claim.claimFor('embers'),
      claimed: Boolean(claim.claimed.embers),
      destination: '→ wallet',
    });
  }
  return rows;
}

const styles = StyleSheet.create({
  // Was `kick`, a 10.5pt eyebrow over a headline, then 14 when the headline went. It is the
  // headline now, so it is sized as one. The tracking comes DOWN as the size goes up — 1.1 was
  // right for a 10pt label and turns a 20pt line into something spaced-out and hard to read — and
  // it wraps rather than shrinking, because "DAILY GOAL COMPLETE: COLD PLUNGES" on two centred
  // lines reads better than one squeezed one.
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    lineHeight: 27,
    letterSpacing: 0.4,
    color: Colors.amber,
    textAlign: 'center',
    marginTop: Spacing.four,
    paddingHorizontal: Spacing.two,
  },
  streak: {
    alignSelf: 'stretch',
    marginTop: Spacing.four,
  },
  capped: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.amber,
    textAlign: 'center',
    marginTop: Spacing.two,
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
