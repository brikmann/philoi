import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmberIcon } from '@/components/economy/ember-icon';
import { EmberPill, SectionLabel, formatEmbers } from '@/components/economy/economy-bits';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { claimPassTier, fetchAchievementProgress } from '@/lib/api/forge-pass';
import { BOXES } from '@/lib/economy/boxes';
import { getItem } from '@/lib/economy/catalog';
import {
  ACHIEVEMENTS,
  CADENCE_LABEL,
  CADENCE_RESET_HINT,
  PASS_FINE_PRINT,
  PASS_PRICE_LABEL,
  PASS_TIERS,
  SEASON,
  tierCost,
  tierFromXp,
  type AchievementCadence,
  type PassReward,
  type PassTier,
} from '@/lib/economy/forge-pass';
import { getErrorMessage } from '@/lib/errors';
import { RARITY_COLOR } from '@/lib/economy/rarity';

// Forge Pass (mock 68, 21k). Two lanes across 100 tiers: Free on top, Premium below.
//
// The Premium lock is a RENDER concern only — claim_pass_tier re-checks ownership server-side. And
// because that check happens at CLAIM time rather than climb time, subscribing mid-season
// retroactively unlocks every tier already climbed, which is the behaviour FORGE_PASS.md promises.

export default function ForgePassScreen() {
  const router = useRouter();
  const { embers, pass, refetch } = useInventory();
  const [tab, setTab] = useState<'track' | 'xp'>('track');
  const [busy, setBusy] = useState(false);

  const passXp = pass?.pass_xp ?? 0;
  const ownsPremium = pass?.owns_premium ?? false;
  const { tier, intoTier, nextTierCost } = tierFromXp(passXp);

  const claimed = useMemo(() => {
    const set = new Set<string>();
    for (const c of pass?.claims ?? []) set.add(`${c.tier}:${c.lane}`);
    return set;
  }, [pass]);

  async function claim(t: PassTier, lane: 'free' | 'premium', reward: PassReward) {
    if (lane === 'premium' && !ownsPremium) {
      Alert.alert('Premium locked', `This tier is on the Premium track. The Forge Pass is ${PASS_PRICE_LABEL}.`);
      return;
    }
    setBusy(true);
    try {
      await claimPassTier(t.tier, lane, reward);
      await refetch();
    } catch (e) {
      Alert.alert("Couldn't claim that", getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={Colors.ink} />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>🔥 Forge Pass</Text>
            <Text style={styles.sub}>
              Season {SEASON.id.replace('S', '')} · {SEASON.name}
            </Text>
          </View>
          <EmberPill embers={embers} />
        </View>

        <View style={styles.tierNow}>
          <Text style={styles.tierBig}>{tier}</Text>
          <Text style={styles.tierSlash}>/ {SEASON.totalTiers}</Text>
        </View>

        <View style={styles.xpBlock}>
          <View style={styles.xpTop}>
            <Text style={styles.xpLabel}>Tier {tier}</Text>
            <Text style={styles.xpLabel}>
              {formatEmbers(intoTier)} / {formatEmbers(nextTierCost || tierCost(SEASON.totalTiers))} Pass XP → Tier{' '}
              {Math.min(tier + 1, SEASON.totalTiers)}
            </Text>
          </View>
          <View style={styles.xpTrack}>
            <View style={[styles.xpFill, { width: `${nextTierCost ? (intoTier / nextTierCost) * 100 : 100}%` }]} />
          </View>
        </View>

        {!ownsPremium ? (
          <View style={styles.premiumCta}>
            <Text style={styles.premiumText}>
              Premium locked. <Text style={styles.premiumBold}>Every tier + the Emberfall set + a Mythic capstone.</Text>
            </Text>
            <Pressable
              style={styles.premiumBtn}
              onPress={() =>
                Alert.alert(
                  'Forge Pass — coming soon',
                  'The seasonal subscription needs the next native build. Everything on the Free lane works today.'
                )
              }>
              <Text style={styles.premiumBtnText}>Get Pass</Text>
              <Text style={styles.premiumBtnSub}>{PASS_PRICE_LABEL}</Text>
            </Pressable>
          </View>
        ) : null}
        <Text style={styles.fine}>{PASS_FINE_PRINT}</Text>

        <View style={styles.tabs}>
          {(['track', 'xp'] as const).map((t) => (
            <Pressable key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'track' ? 'Track' : 'Pass XP'}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'track' ? (
          <>
            <View style={styles.legend}>
              <Text style={styles.legendText}>Top = Free</Text>
              <Text style={styles.legendText}>Bottom = Premium 🔒</Text>
              <Text style={styles.legendText}>★ milestone</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.track}>
              {PASS_TIERS.map((t) => (
                <TierColumn
                  key={t.tier}
                  tier={t}
                  reached={t.tier <= tier}
                  isNow={t.tier === tier}
                  ownsPremium={ownsPremium}
                  claimed={claimed}
                  busy={busy}
                  onClaim={claim}
                />
              ))}
            </ScrollView>
          </>
        ) : (
          <AchievementList seasonId={pass?.season_id ?? SEASON.id} earned={pass?.achievements ?? []} />
        )}

        <Text style={styles.rule}>
          Pass XP comes from achievements, never from rank XP — ranks stay their own long climb. Daily achievements are
          once per day, so the Pass rewards showing up, not marathoning.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function TierColumn({
  tier,
  reached,
  isNow,
  ownsPremium,
  claimed,
  busy,
  onClaim,
}: {
  tier: PassTier;
  reached: boolean;
  isNow: boolean;
  ownsPremium: boolean;
  claimed: Set<string>;
  busy: boolean;
  onClaim: (t: PassTier, lane: 'free' | 'premium', r: PassReward) => void;
}) {
  return (
    <View style={styles.col}>
      <RewardCell
        reward={tier.free}
        locked={!reached}
        claimed={claimed.has(`${tier.tier}:free`)}
        onPress={() => tier.free && onClaim(tier, 'free', tier.free)}
        busy={busy}
      />
      <View style={[styles.tierBadge, isNow && styles.tierBadgeNow, tier.milestone && styles.tierBadgeMilestone]}>
        <Text style={[styles.tierBadgeText, isNow && styles.tierBadgeTextNow]}>{tier.tier}</Text>
      </View>
      <RewardCell
        reward={tier.premium}
        locked={!reached || !ownsPremium}
        claimed={claimed.has(`${tier.tier}:premium`)}
        premium
        onPress={() => tier.premium && onClaim(tier, 'premium', tier.premium)}
        busy={busy}
      />
    </View>
  );
}

function RewardCell({
  reward,
  locked,
  claimed,
  premium,
  onPress,
  busy,
}: {
  reward: PassReward | null;
  locked: boolean;
  claimed: boolean;
  premium?: boolean;
  onPress: () => void;
  busy: boolean;
}) {
  if (!reward) return <View style={[styles.cell, styles.cellEmpty]} />;

  const { icon, label, color } = describeReward(reward);
  return (
    <Pressable
      style={[styles.cell, claimed && styles.cellClaimed, locked && styles.cellLocked]}
      disabled={locked || claimed || busy}
      onPress={onPress}>
      {/* The ember reward's glyph is an SVG, not a character — it can't live inside <Text>. */}
      {claimed || (premium && locked) ? (
        <Text style={styles.cellIcon}>{claimed ? '✓' : '🔒'}</Text>
      ) : typeof icon === 'string' ? (
        <Text style={styles.cellIcon}>{icon}</Text>
      ) : (
        icon
      )}
      <Text style={[styles.cellLabel, color ? { color } : null]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function describeReward(reward: PassReward): { icon: ReactNode; label: string; color?: string } {
  switch (reward.kind) {
    case 'embers':
      return { icon: <EmberIcon size={14} />, label: String(reward.amount) };
    case 'box':
      return { icon: '📦', label: BOXES[reward.box].name };
    case 'item': {
      const item = getItem(reward.itemId);
      return { icon: '◎', label: item?.name ?? reward.itemId, color: item ? RARITY_COLOR[item.rarity] : undefined };
    }
    case 'badge':
      return { icon: '🏅', label: reward.label };
  }
}

function AchievementList({ seasonId, earned }: { seasonId: string; earned: { key: string; period_key: string }[] }) {
  const done = new Set(earned.map((e) => e.key));
  const cadences: AchievementCadence[] = ['daily', 'weekly', 'season'];
  const [progress, setProgress] = useState<Record<string, number>>({});

  // Real counters, not a claimed/unclaimed tick. Failure is silent: the list still renders with
  // ticks, it just loses the "2 / 3" lines — progress detail is not worth an error state.
  useEffect(() => {
    let cancelled = false;
    fetchAchievementProgress()
      .then((p) => {
        if (!cancelled) setProgress(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View>
      <Text style={styles.intro}>
        Climb the Pass by completing <Text style={styles.introBold}>achievements</Text> — not by grinding rank XP. Ranks
        stay their own long climb; this rewards showing up.
      </Text>
      {cadences.map((cadence) => (
        <View key={cadence}>
          <SectionLabel label={CADENCE_LABEL[cadence]} action={CADENCE_RESET_HINT[cadence]} />
          {ACHIEVEMENTS.filter((a) => a.cadence === cadence).map((a) => {
            const complete = done.has(a.key);
            const at = progress[a.key];
            return (
              <View key={a.key} style={[styles.ach, complete && styles.achDone]}>
                <View style={[styles.check, complete && styles.checkOn]}>
                  {complete ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <View style={styles.achCol}>
                  <Text style={styles.achLabel}>{a.label}</Text>
                  {/* Only the counter-style achievements carry a target; the rest are a plain
                      did-it/didn't tick and would read oddly as "1 / 1". */}
                  {!complete && a.target != null && at != null ? (
                    <Text style={styles.achProgress}>
                      {at} / {a.target}
                      {a.unit ? ` ${a.unit}` : ''}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.achXp}>+{a.xp}</Text>
              </View>
            );
          })}
        </View>
      ))}
      <Text style={styles.seasonNote}>Season {seasonId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.three,
  },
  titleWrap: { flex: 1 },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 19,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.muted,
  },
  tierNow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginTop: Spacing.three,
  },
  tierBig: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 40,
    color: Colors.ember,
  },
  tierSlash: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textTertiary,
    marginLeft: Spacing.one,
  },
  xpBlock: { marginTop: Spacing.two },
  xpTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  xpLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.muted,
  },
  xpTrack: {
    height: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.disabled,
    overflow: 'hidden',
  },
  xpFill: {
    height: '100%',
    backgroundColor: Colors.amber,
    borderRadius: Radius.pill,
  },
  premiumCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.cardDark,
    borderRadius: 13,
    padding: Spacing.twelve,
    marginTop: Spacing.three,
  },
  premiumText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.muted,
  },
  premiumBold: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  premiumBtn: {
    backgroundColor: Colors.coral,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  premiumBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: '#3a1608',
  },
  premiumBtnSub: {
    fontFamily: Fonts.body,
    fontSize: 9,
    color: '#3a1608',
  },
  fine: {
    fontFamily: Fonts.body,
    fontSize: 9,
    color: Colors.textTertiary,
    marginTop: Spacing.two,
  },
  tabs: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  tab: {
    flex: 1,
    borderRadius: Radius.pill,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: Colors.cardDark,
  },
  tabOn: { backgroundColor: Colors.coral },
  tabText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.muted,
  },
  tabTextOn: { color: '#fff' },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.three,
  },
  legendText: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
  },
  track: {
    gap: 6,
    paddingVertical: Spacing.two,
  },
  col: {
    alignItems: 'center',
    gap: 5,
  },
  cell: {
    width: 62,
    height: 54,
    borderRadius: 10,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    gap: 2,
  },
  cellEmpty: {
    backgroundColor: 'transparent',
  },
  cellClaimed: {
    opacity: 0.4,
  },
  cellLocked: {
    opacity: 0.35,
  },
  cellIcon: { fontSize: 14 },
  cellLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    color: Colors.ink,
    textAlign: 'center',
  },
  tierBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierBadgeNow: {
    backgroundColor: Colors.coral,
  },
  tierBadgeMilestone: {
    borderWidth: 1.5,
    borderColor: Colors.amber,
  },
  tierBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: Colors.muted,
  },
  tierBadgeTextNow: { color: '#fff' },
  intro: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.muted,
    marginTop: Spacing.three,
  },
  introBold: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  ach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.cardDark,
    borderRadius: 11,
    padding: Spacing.twelve,
    marginBottom: 6,
  },
  achDone: {
    opacity: 0.55,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: Colors.trackAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: Colors.green,
    borderColor: Colors.green,
  },
  checkMark: {
    fontSize: 10,
    color: '#fff',
    fontFamily: Fonts.bodyBold,
  },
  achCol: {
    flex: 1,
  },
  achLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink,
  },
  achProgress: {
    fontFamily: Fonts.body,
    fontSize: 9,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  achXp: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.ember,
  },
  seasonNote: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  rule: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.four,
  },
});
