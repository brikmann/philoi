import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RewardRow, type RewardRowSpec } from '@/components/economy/reward-rows';
import { PersonalFlame } from '@/components/personal-flame';
import { RewardBurst, type RewardBurstHandle } from '@/components/reward-burst';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import type { GoalDayAward } from '@/lib/api/challenges';

// The personal-goal / streak payout screen — design-mocks/103.
//
// The counterpart to mock 47: 47 pays out competition, this pays out consistency. Same reward-row
// language on purpose (the mock says so outright), because "you won 50 embers" and "you earned 235
// embers" are the same kind of statement and shouldn't be typeset as if they were different.
//
// The BREAKDOWN LINE is the point of this screen, not decoration. A drip plus a milestone arriving
// as a single "+235" is indistinguishable from a number someone made up; showing "7 × 25 daily +
// 60 streak bonus" is what makes the payout legible as earned. It also sets up the next rung —
// the reason to come back tomorrow is knowing 14 days banks +150.

type Props = {
  /** Exactly what the server said it paid — see economy_award_goal_day (0085). */
  award: GoalDayAward;
  /** "10,000 steps" — the goal in its own words. */
  goalLabel: string;
  displayName: string;
  /** Milestone thresholds and their bonuses, for the "keep going" line. Mirrors economy_config's
   * goal_rewards.milestones so the screen promises what the server will actually pay. */
  milestones?: Record<number, number>;
  onShare?: () => void;
  onClose: () => void;
  sharing?: boolean;
};

const DEFAULT_MILESTONES: Record<number, number> = { 3: 30, 7: 60, 14: 150, 30: 400 };

export function GoalStreakRewardScreen({
  award,
  goalLabel,
  displayName,
  milestones = DEFAULT_MILESTONES,
  onShare,
  onClose,
  sharing = false,
}: Props) {
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
  // wrong the moment anything else moved the wallet in the same window.
  const newBalance = walletLoading ? null : walletEmbers;

  const rows = useMemo<RewardRowSpec[]>(() => {
    const list: RewardRowSpec[] = [];
    if (total > 0) {
      list.push({
        kind: 'embers',
        title: `+${total.toLocaleString('en-US')} Embers`,
        detail: isMilestone
          ? `${award.streak} daily drips + the ${award.streak}-day milestone bonus`
          : `Daily goal · ${award.difficulty} target`,
        destination:
          newBalance == null ? '→ wallet' : `→ wallet · ${newBalance.toLocaleString('en-US')}`,
      });
    }
    if (award.box) {
      list.push({
        kind: 'box',
        title: 'Loot box',
        detail: `${award.streak}-day goal streak`,
        chip: { label: 'EARNED', color: Colors.amber },
        destination: '→ inventory',
      });
    }
    return list;
  }, [total, isMilestone, award.streak, award.difficulty, award.box, newBalance]);

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

  return (
    <View style={styles.root}>
      <RewardBurst ref={burstRef} cue="settle" />
      <Pressable style={styles.close} onPress={onClose} hitSlop={12} accessibilityLabel="Close">
        <Ionicons name="close" size={22} color={Colors.textTertiary} />
      </Pressable>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* The streak number sits ON the flame, which is mock 103's crest. Reusing PersonalFlame
            rather than redrawing the mock's coal-bed SVG keeps this the user's OWN equipped flame
            — the thing they have been feeding all week is the thing that pays them. */}
        <View style={styles.crest}>
          <PersonalFlame size={104} />
          <View style={styles.streakBubble}>
            <Text style={styles.streakNum}>{award.streak}</Text>
          </View>
        </View>

        <Text style={styles.kick}>
          {isMilestone ? `${award.streak}-DAY GOAL STREAK` : 'DAILY GOAL COMPLETE'}
        </Text>
        <Text style={styles.headline}>{headline(award, displayName)}</Text>
        <Text style={styles.subline}>
          {goalLabel} · {isMilestone ? 'every single day' : 'today'} · 🔥 {award.streak}
        </Text>

        <View style={styles.rewards}>
          {rows.map((row) => (
            <RewardRow key={`${row.kind}-${row.title}`} spec={row} />
          ))}
        </View>

        <Text style={styles.breakdown}>{breakdown(award, milestones)}</Text>

        {/* Only shown when the weekly ceiling actually clipped this payout. Saying nothing would
            leave someone comparing a smaller number against the breakdown above and concluding the
            maths is broken. */}
        {award.capped ? (
          <Text style={styles.capped}>
            Weekly earning cap reached — the rest banks again next week.
          </Text>
        ) : null}
      </ScrollView>

      <View style={styles.foot}>
        <PrimaryButton label={total > 0 ? `Collect · +${total}` : 'Collect'} onPress={onClose} />
        {onShare ? (
          <Pressable style={styles.shareBtn} onPress={onShare} disabled={sharing} accessibilityRole="button">
            <Text style={styles.shareText}>{sharing ? 'Preparing…' : 'Share to your story'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function headline(award: GoalDayAward, name: string): string {
  if (award.streak >= 30) return `A full month, ${name}.`;
  if (award.streak >= 14) return `Two weeks unbroken, ${name}.`;
  if (award.streak >= 7) return `One week straight, ${name}.`;
  if (award.streak >= 3) return `Three in a row, ${name}.`;
  return `Goal cleared, ${name}.`;
}

/** "This week: 7 × 25 daily (ambitious goal) + 60 streak bonus = 235 embers. Keep the streak → …" */
function breakdown(award: GoalDayAward, milestones: Record<number, number>): string {
  const parts: string[] = [];

  if (award.milestone > 0) {
    // award.embers is TODAY's drip, so the run's daily total is that times the streak. Stated as
    // the multiplication rather than a single figure because the multiplication is the part that
    // makes it checkable — this is the mock's "7 × 25 daily + 60 streak bonus = 235".
    //
    // It is an approximation in one case: if the weekly ceiling clipped an earlier day, that day
    // paid less than today's rate and the real sum is lower. The `capped` note below fires exactly
    // when that has happened, which is why this line does not try to claim an exact total.
    const runTotal = award.streak * award.embers + award.milestone;
    parts.push(
      `${award.streak} × ${award.embers} daily (${award.difficulty} goal) + ${award.milestone} streak bonus = ${runTotal} embers.`
    );
  } else {
    parts.push(`+${award.embers} today (${award.difficulty} goal).`);
  }

  // The next rung up, so the screen always ends pointing at a reason to come back.
  const next = Object.keys(milestones)
    .map(Number)
    .sort((a, b) => a - b)
    .find((d) => d > award.streak);
  if (next) {
    parts.push(`Keep the streak → ${next}-day banks +${milestones[next]}.`);
  }

  return parts.join(' ');
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  close: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.three,
    zIndex: 2,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
  },
  crest: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakBubble: {
    position: 'absolute',
    bottom: 0,
    backgroundColor: Colors.achieverBg,
    borderRadius: 999,
    minWidth: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.ember,
    paddingHorizontal: 6,
  },
  streakNum: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    color: Colors.ember,
    fontVariant: ['tabular-nums'],
  },
  kick: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 1.4,
    color: Colors.amber,
    marginTop: Spacing.twelve,
  },
  headline: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 6,
  },
  subline: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 6,
  },
  rewards: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  breakdown: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  capped: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.amber,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  foot: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: Spacing.two,
    gap: Spacing.two,
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
