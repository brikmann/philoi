import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useMyChallenges } from '@/hooks/use-my-challenges';
import { useSocialChallenges } from '@/hooks/use-social-challenges';
import { useAuth } from '@/lib/auth/auth-context';
import { CHALLENGE_TYPE_ICON } from '@/lib/goal-types';
import { formatTimeLeft } from '@/lib/format';

// Challenge / Goal info — design-mocks/102 v2, the screen that makes the minimal card possible.
//
// THE POINT: the browse cards used to carry "Winner +200 XP", "+50 embers on complete" and the
// tiebreak rules inline, which is what made a list of three challenges read as a wall. Moving all
// of it one tap away lets the card be avatars + bar + lead + clock, and gives the rules somewhere
// to be COMPLETE rather than abbreviated to whatever fits under a progress bar.
//
// Two variants behind one route, because they answer the same question ("what are the rules of the
// thing I'm looking at?") and splitting them into two screens would duplicate the row chrome.

type Row = { k: string; v: string; highlight?: boolean };

export default function ChallengeInfoScreen() {
  const router = useRouter();
  const { challengeId, kind } = useLocalSearchParams<{ challengeId: string; kind?: string }>();
  const isGoal = kind === 'goal';

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>{isGoal ? 'Goal info' : 'Challenge info'}</Text>
      </View>

      {isGoal ? <GoalInfo challengeId={challengeId} /> : <SocialInfo challengeId={challengeId} />}
    </Screen>
  );
}

function SocialInfo({ challengeId }: { challengeId: string }) {
  const router = useRouter();
  const { session } = useAuth();
  const { challenges } = useSocialChallenges();
  const c = challenges.find((x) => x.id === challengeId);

  if (!c) return <Missing what="challenge" />;

  const isCreator = session?.user.id === c.created_by;
  const youName = 'You';
  const otherName = (isCreator ? c.opponent_name : c.created_by_name) ?? 'Opponent';
  const isTimeMetric = c.race_metric === 'lockin_time';

  const rows: Row[] = [
    { k: 'Type', v: c.mode === 'h2h' ? 'Head-to-head' : 'Group race' },
    { k: 'The race', v: isTimeMetric ? 'Most lock-in time' : 'Most XP' },
    {
      k: 'Duration',
      v: c.ends_at ? `${c.window_hours}h · ${formatTimeLeft(c.ends_at)}` : `${c.window_hours}h`,
    },
    { k: 'Winner takes', v: `+${c.payout_xp} XP`, highlight: true },
    // The tiebreak is the spec's resolution rule, stated here because it is precisely the sort of
    // thing nobody thinks about until it decides their challenge.
    { k: "If it's a tie", v: 'First to reach it' },
    { k: 'Campfire watching', v: c.circle_id ? 'On' : 'Off' },
  ];

  return (
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      <View style={styles.arena}>
        <View style={styles.competitor}>
          <Avatar label={youName} size={44} lit />
          <Text style={styles.competitorName}>You</Text>
        </View>
        <Text style={styles.vs}>VS</Text>
        <View style={styles.competitor}>
          <Avatar label={otherName} size={44} />
          <Text style={styles.competitorName} numberOfLines={1}>
            {otherName}
          </Text>
        </View>
      </View>

      <Rules rows={rows} />

      <View style={styles.note}>
        <Text style={styles.noteText}>
          <Text style={styles.noteStrong}>Winner +{c.payout_xp} XP</Text> — scales with effort, capped to keep it
          fair. The loser gets a rematch, not a penalty. Whoever has the most{' '}
          {isTimeMetric ? 'lock-in time' : 'XP'} when the clock hits zero takes it.
        </Text>
      </View>

      {c.status === 'active' ? (
        <View style={styles.actions}>
          <PrimaryButton
            label="Watch live"
            onPress={() =>
              router.push({ pathname: '/watch/[challengeId]', params: { challengeId: c.id, mode: c.mode } })
            }
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

function GoalInfo({ challengeId }: { challengeId: string }) {
  const { challenges } = useMyChallenges();
  const g = challenges.find((x) => x.id === challengeId);

  if (!g) return <Missing what="goal" />;

  const pct = Math.min(100, Math.round((g.progress / g.target) * 100));
  const isAuto = g.count_mode !== 'manual';

  const rows: Row[] = [
    { k: 'Type', v: 'Personal goal' },
    { k: 'Target', v: `${g.target.toLocaleString('en-US')} ${g.unit}` },
    { k: 'Source', v: isAuto ? 'Tracked automatically' : 'Logged by hand' },
    // Plain "midnight" is now true — migration 0084 rolls each user at their OWN midnight rather
    // than a single 00:10 UTC sweep. Weekly is still the shared UTC boundary.
    { k: 'Resets', v: g.period === 'day' ? 'Every night at midnight' : 'Every Sunday (UTC)' },
    { k: 'Reward', v: 'Embers on completion', highlight: true },
    { k: 'Goal streak', v: 'Milestones at 3 · 7 · 14 · 30 days' },
  ];

  return (
    <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
      <View style={styles.goalHero}>
        <View style={styles.goalIcon}>
          <Ionicons name={CHALLENGE_TYPE_ICON[g.type]} size={30} color={Colors.amber} />
        </View>
        <Text style={styles.goalTitle}>
          {g.label ?? `${g.target.toLocaleString('en-US')} ${g.unit}`}
        </Text>
        <Text style={styles.goalProgress}>
          {g.progress.toLocaleString('en-US')} / {g.target.toLocaleString('en-US')}{' '}
          {g.period === 'day' ? 'today' : 'this week'} · {pct}%
        </Text>
      </View>

      <Rules rows={rows} />

      <View style={styles.note}>
        <Text style={styles.noteText}>
          Each day you clear this banks a small ember drip that scales with how ambitious the target
          is. An unbroken run pays a bonus on top at{' '}
          <Text style={styles.noteStrong}>3, 7, 14 and 30 days</Text> — the 30-day milestone also
          drops a box.
        </Text>
      </View>
    </ScrollView>
  );
}

function Rules({ rows }: { rows: Row[] }) {
  return (
    <View style={styles.rules}>
      {rows.map((r, i) => (
        <View key={r.k} style={[styles.rule, i > 0 && styles.ruleDivider]}>
          <Text style={styles.ruleKey}>{r.k}</Text>
          <Text style={[styles.ruleValue, r.highlight && styles.ruleValueWin]} numberOfLines={1}>
            {r.v}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The list this screen reads from is a cache, so a deep link or a stale back-stack entry can land
 * here with nothing to show. Says so plainly rather than rendering an empty rules table. */
function Missing({ what }: { what: string }) {
  return (
    <View style={styles.missing}>
      <Text style={styles.missingText}>That {what} isn&apos;t available any more.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingBottom: Spacing.three,
  },
  headerTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
  },
  body: {
    paddingBottom: Spacing.four,
  },
  arena: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  competitor: {
    alignItems: 'center',
    gap: 4,
    maxWidth: 110,
  },
  competitorName: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  vs: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  goalHero: {
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.four,
  },
  goalIcon: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: 'rgba(242,163,60,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 19,
    color: Colors.ink,
    textAlign: 'center',
  },
  goalProgress: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  rules: {
    backgroundColor: Colors.achieverBg,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 14,
    overflow: 'hidden',
  },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  ruleDivider: {
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  ruleKey: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.muted,
  },
  ruleValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
    flexShrink: 1,
  },
  ruleValueWin: {
    color: Colors.ember,
  },
  // Mock 102's `.note` — the one place on the screen that explains rather than lists.
  note: {
    backgroundColor: '#231A2E',
    borderLeftWidth: 3,
    borderLeftColor: Colors.coral,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginTop: Spacing.three,
  },
  noteText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.ink,
  },
  noteStrong: {
    fontFamily: Fonts.bodyBold,
    color: Colors.amber,
  },
  actions: {
    marginTop: Spacing.four,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingText: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.muted,
  },
});
