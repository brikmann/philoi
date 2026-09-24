import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { VouchUnlockLine } from '@/components/vouch-unlock-line';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { createScopedGoals, previewScopedReward, type ScopedGoalInput } from '@/lib/api/challenges';
import { asBoxKey, TIER_COLOR } from '@/lib/challenge-tier';
import { BOXES } from '@/lib/economy/boxes';
import { getErrorMessage } from '@/lib/errors';
import type { DifficultyTier, ScopedRewardPreview } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CINDY'S VERDICT ON A WHOLE ASK — "90% in every class", priced course by course.
//
// The sibling of challenge/verdict.tsx and deliberately NOT a mode of it. That screen is a hero:
// one goal, one crate, one halo, sized to be the only thing on the page. Five goals cannot be five
// heroes, and squeezing a list into that layout would have meant a `count > 1` branch around every
// element on it. So the shape that differs is its own file, and the two share the tier ramp and the
// box-key narrowing through lib/challenge-tier rather than through a copy.
//
// 🔒 NOTHING IS WRITTEN ON THE WAY HERE, exactly as the single verdict promises. cindy.tsx routes a
// `create_goals` proposal to this screen with the parsed list; the CTA is what calls
// create_scoped_goals. The chip in the chat stays 'proposed' until then, because at this point the
// user has been shown a price and not charged one.
//
// 🔒 AND THE PRICES ARE THE SERVER'S. One preview_challenge_reward per DISTINCT (tier, claim level)
// — not per goal, because five courses at the same tier have the same price and five identical
// round trips is four wasted. Cindy proposes a tier and is forbidden from naming a figure; this is
// where the figure comes from.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * What a goal in this batch will be worth, predicted the way goal_verifiability_for derives it.
 *
 * 🔒 A PREDICTION, NOT A CLAIM. create_scoped_goals derives the real verifiability from the row it
 * is about to write and ignores anything sent about it. This applies the same three-line rule to
 * the same three fields so the number on screen is the number that lands — a grade is somebody's
 * word (honour, capped at The Furnace), a built-in metric or a lock-in-time count is observed.
 */
function claimLevelFor(g: ScopedGoalInput): 'auto' | 'honor' {
  if (g.gradeTarget != null) return 'honor';
  if ((g.type ?? 'custom') !== 'custom') return 'auto';
  return g.countMode === 'lockin_time' ? 'auto' : 'honor';
}

export default function VerdictBatchScreen() {
  const router = useRouter();
  const p = useLocalSearchParams<{ goals?: string; headline?: string }>();

  // The proposal, carried whole as JSON rather than as N parallel param arrays. Parsed defensively:
  // a malformed param is a screen that cannot do its job, and a blank list saying so is better than
  // a crash inside a render.
  const [goals] = useState<ScopedGoalInput[]>(() => {
    try {
      const parsed = JSON.parse(p.goals ?? '[]');
      return Array.isArray(parsed) ? (parsed as ScopedGoalInput[]) : [];
    } catch {
      return [];
    }
  });

  const [prices, setPrices] = useState<Record<string, ScopedRewardPreview | null>>({});
  const [busy, setBusy] = useState(false);

  // One fetch per distinct (tier, claim level). The key is the pair because that pair is exactly
  // what preview_challenge_reward's answer depends on — five courses at rare/honour share one price.
  useEffect(() => {
    let alive = true;
    const wanted = new Map<string, { tier: DifficultyTier; level: 'auto' | 'honor' | 'vouched' }>();
    for (const g of goals) {
      const tier = (g.tier ?? 'uncommon') as DifficultyTier;
      const level = claimLevelFor(g);
      wanted.set(`${tier}:${level}`, { tier, level });
      // 0209 — an honour goal also needs what two vouches would lift it to, so the row can name the
      // way out of the cap. Still one fetch per distinct tier, not per goal.
      if (level === 'honor') wanted.set(`${tier}:vouched`, { tier, level: 'vouched' });
    }
    Promise.all(
      [...wanted.entries()].map(async ([key, { tier, level }]) => [key, await previewScopedReward(tier, level)] as const)
    ).then((pairs) => {
      if (alive) setPrices(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [goals]);

  const priced = goals.length > 0 && Object.keys(prices).length > 0;

  async function start() {
    setBusy(true);
    try {
      const receipts = await createScopedGoals(goals);
      const made = receipts.filter((r) => r.status === 'created');
      const existed = receipts.filter((r) => r.status === 'existed');

      // WHICH WERE MADE AND WHICH ALREADY EXISTED, said out loud (§A). A duplicate is not an error
      // — the server skips it and reports it so the other four still land — but it IS something the
      // user has to be told, or "start these five" quietly starts four and looks like a bug.
      if (existed.length > 0) {
        Alert.alert(
          made.length > 0 ? `${made.length} set up` : 'Nothing new to add',
          `${existed.length === 1 ? 'You already had' : 'You already had these running:'} ${existed
            .map((r) => r.label ?? 'a goal')
            .join(', ')}${existed.length === 1 ? ' running already.' : '.'}`,
          [{ text: 'Got it', onPress: () => router.replace('/(tabs)/challenges') }]
        );
        return;
      }
      router.replace('/(tabs)/challenges');
    } catch (e) {
      Alert.alert('That did not go through', getErrorMessage(e, 'Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }

  if (goals.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Cindy's verdict", headerShown: true }} />
        <Text style={styles.empty}>There was nothing to set up here — ask Cindy again?</Text>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: "Cindy's verdict", headerShown: true }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>YOUR GOALS</Text>
        <Text style={styles.headline}>{p.headline?.trim() || `${goals.length} goals, scoped`}</Text>
        <Text style={styles.sub}>
          Cindy priced each one on its own. Here is what you are chasing.
        </Text>

        {goals.map((g, i) => {
          const tier = (g.tier ?? 'uncommon') as DifficultyTier;
          const price = prices[`${tier}:${claimLevelFor(g)}`] ?? null;
          const vouchedPrice = prices[`${tier}:vouched`] ?? null;
          const boxKey = asBoxKey(price?.box);
          return (
            <View key={`${g.label}-${i}`} style={[styles.row, { borderColor: TIER_COLOR[tier] }]}>
              <View style={styles.rowArt}>
                {price === undefined || (price === null && Object.keys(prices).length === 0) ? (
                  <ActivityIndicator color={Colors.amber} />
                ) : boxKey ? (
                  <BoxArt boxKey={boxKey} size={40} />
                ) : (
                  <EmberIcon size={24} />
                )}
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {g.label}
                </Text>
                <Text style={styles.rowTarget} numberOfLines={1}>
                  {g.gradeTarget != null
                    ? `Target ${g.gradeTarget}%`
                    : `${g.target.toLocaleString('en-US')} ${g.unit || ''}`.trim()}
                </Text>
                <View style={styles.rowRewardLine}>
                  {/* 0209 — "effort" when capped: the tier is Cindy's judgement, the crate is what
                      your word pays. Side by side with nothing between, a LEGENDARY and an EPIC
                      grade both reading "The Furnace" looked like a pricing bug. */}
                  <Text style={[styles.rowTier, { color: TIER_COLOR[tier] }]}>
                    {tier.toUpperCase()}
                    {price?.discounted ? ' EFFORT' : ''}
                  </Text>
                  {price ? (
                    <>
                      <Text style={styles.rowDot}>·</Text>
                      <Text style={styles.rowReward} numberOfLines={1}>
                        {price.discounted ? 'earns ' : ''}
                        {boxKey ? BOXES[boxKey].name : 'Embers only'}
                      </Text>
                      <EmberIcon size={10} />
                      <Text style={styles.rowReward}>{price.embers.toLocaleString('en-US')}</Text>
                    </>
                  ) : null}
                </View>
                <VouchUnlockLine capped={price} vouched={vouchedPrice} style={styles.rowUnlock} />
              </View>
            </View>
          );
        })}

        {/* Said once for the batch rather than on every row: it is the same rule for all of them,
            and repeating it five times turns a caveat into noise. A grade goal is always honour —
            it is your word about a number the app cannot see — so this line is the honest half of
            "here is what you are chasing". */}
        {goals.some((g) => claimLevelFor(g) === 'honor') ? (
          <View style={styles.caveatRow}>
            <Ionicons name="hand-left-outline" size={14} color={Colors.textTertiary} />
            <Text style={styles.caveat}>
              You report these yourself, so they pay the honour rate — a grade is your word, and the
              app never sees it. When you report a pass, ask two friends to vouch and it pays the full
              tier instead.
            </Text>
          </View>
        ) : null}

        <View style={styles.cta}>
          <PrimaryButton
            label={`Start ${goals.length === 1 ? 'this goal' : `these ${goals.length} goals`}`}
            onPress={start}
            loading={busy}
            disabled={busy || !priced}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.two },
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 2.4,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  headline: {
    fontFamily: Fonts.bodyBold,
    fontSize: 21,
    lineHeight: 26,
    color: Colors.ink,
    textAlign: 'center',
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.muted,
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: 11,
    backgroundColor: 'rgba(20,14,26,0.66)',
  },
  rowArt: { width: 44, alignItems: 'center', justifyContent: 'center' },
  rowMeta: { flex: 1, gap: 3 },
  rowLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.ink },
  rowTarget: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.muted },
  rowRewardLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  rowUnlock: { marginTop: 3 },
  rowTier: { fontFamily: Fonts.bodyBold, fontSize: 10, letterSpacing: 1 },
  rowDot: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textTertiary },
  rowReward: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.muted },
  caveatRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: Spacing.two },
  caveat: { flex: 1, fontFamily: Fonts.body, fontSize: 11, lineHeight: 15.5, color: Colors.textTertiary },
  cta: { marginTop: Spacing.four },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.six,
  },
});
