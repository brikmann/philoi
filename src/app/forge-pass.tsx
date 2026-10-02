import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BoxArt } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { showRewardReveal, type RewardLine } from '@/components/economy/reward-reveal';
import { SeasonPlacementShareCard, SeasonRewardsShareCard } from '@/components/economy/season-standing-share-card';
import { BurningName } from '@/components/burning-name';
import { CosmeticDetail, DetailSheet } from '@/components/pass/cosmetic-detail-sheet';
import { EMBER, EmberfallSeal, EmberfallSky, FallingEmbers } from '@/components/pass/emberfall-art';
import { useBreath } from '@/components/pass/pass-motion';
import { Screen } from '@/components/ui/screen';
import { Fonts, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { useProductPrices } from '@/hooks/use-purchase';
import { useShareRank } from '@/hooks/use-share-rank';
import { claimPassLevel, fetchAchievementProgress, fetchMySeasonCard } from '@/lib/api/forge-pass';
import { useAuth } from '@/lib/auth/auth-context';
import { restorePurchases } from '@/lib/billing';
import { BOXES } from '@/lib/economy/boxes';
import { getItem } from '@/lib/economy/catalog';
import {
  ACHIEVEMENTS,
  CADENCE_LABEL,
  CADENCE_RESET_HINT,
  PASS_FINE_PRINT,
  PASS_LEVELS,
  SEASON,
  levelFromXp,
  msUntilSeasonBoundary,
  passUnlockLevel,
  seasonPhase,
  type AchievementCadence,
  type PassLevel,
  type PassReward,
} from '@/lib/economy/forge-pass';
import { FORGE_PASS_PRODUCT_ID } from '@/lib/economy/iap';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/economy/rarity';
import { SEAL_COSMETIC_KEY } from '@/lib/economy/seal-owners';
import { getErrorMessage } from '@/lib/errors';
import { shareCardImage } from '@/lib/share-card';
import type { SeasonCard } from '@/types/database';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE FLAME PASS TRACK — "Your track" (design-mocks/228), on the paywall's Emberfall sky so the pitch
// and the climb read as a pair.
//
// Top to bottom: a status card (level, your BURNING name, ember balance, the XP bar, how far the
// Seal is), ONE "Claim rewards (N)" button, then the two-lane track — every level a node on a spine
// with a Free chip and a 🔥 Flame Pass chip — ending on the Seal capstone at L100.
//
// ONE CLAIM ACTION. Chips carry a state (✓ claimed · ● ready · 🔒 ahead) but never a button of their
// own; the top button settles everything reached. Tapping a chip opens that level's lane in full.
//
// THE FREE PATH IS THE SAME SCREEN. A non-owner climbs and claims the Free lane exactly as an owner
// does; the whole Flame Pass lane shows 🔒 and a sticky "Unlock the Flame Pass" bar hands off to the
// paywall, which is the one surface that makes the case and takes the money.
//
// 🔴 NOTHING ON THE TRACK IS TYPED IN. Every chip is read off PASS_LEVELS — the table
// claim_pass_level pays against — and names/rarities off catalog.ts and boxes.ts. The price is the
// store's own `priceString`.
//
// COPY RULE: this screen counts in LEVELS. "Tier" belongs to the rank ladder and never appears here.
// ══════════════════════════════════════════════════════════════════════════════════════════════

type Lane = 'free' | 'premium';
type Target = { level: PassLevel; lane: Lane };

/** Uniform, so the 100-row list can be virtualized and opened straight onto your level. */
const ROW_H = 58;

/** The Seal's level, off the track rather than a literal 100. */
const SEAL_LEVEL = passUnlockLevel(SEAL_COSMETIC_KEY) ?? SEASON.totalLevels;

/**
 * A pass reward as a line in the reveal. Reads the CLAIMED reward — the same array handed to
 * claim_pass_level — so the reveal cannot congratulate you for something you did not get.
 */
function passRewardLine(reward: PassReward): RewardLine {
  switch (reward.kind) {
    case 'embers':
      return { kind: 'embers', label: `${reward.amount.toLocaleString()} embers` };
    case 'box':
      return { kind: 'box', label: BOXES[reward.box].name, art: <BoxArt boxKey={reward.box} size={24} motion="off" /> };
    case 'item': {
      const item = getItem(reward.itemId);
      return {
        kind: 'cosmetic',
        label: item?.name ?? 'A new cosmetic',
        art: item ? <ItemArt item={item} size={24} motion="off" /> : undefined,
        // The door into the universal unlock reveal: a claim that paid one cosmetic opens straight
        // into it, several make each row a tap into its own (reward-reveal's RevealPresenter).
        item,
      };
    }
    case 'badge':
      return { kind: 'rank', label: reward.label };
  }
}

export default function ForgePassScreen() {
  const router = useRouter();
  // Full-bleed (`edges={[]}`) so the sky reaches the status bar; this screen insets its own chrome.
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { embers, pass, refetch } = useInventory();
  const prices = useProductPrices();
  const [tab, setTab] = useState<'track' | 'xp'>('track');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Target | null>(null);
  // Mock 97 is a SPLIT card, so there are two capture targets: the placement flex and the reward
  // haul, each separately shareable.
  const placementCardRef = useRef<View>(null);
  const rewardsCardRef = useRef<View>(null);
  const [standing, setStanding] = useState<SeasonCard | null>(null);
  const shareRank = useShareRank();

  const ownsPremium = pass?.owns_premium ?? false;
  const { level, intoLevel, nextLevelCost } = levelFromXp(pass?.pass_xp ?? 0);
  const phase = seasonPhase();
  const displayName = profile?.display_name?.trim() || 'You';
  const firstName = displayName.split(/\s+/)[0];
  const price = prices[FORGE_PASS_PRODUCT_ID];

  const claimed = useMemo(() => {
    const set = new Set<string>();
    for (const c of pass?.claims ?? []) set.add(`${c.tier}:${c.lane}`);
    return set;
  }, [pass]);

  // Everything reached, unclaimed, and claimable by this user — the N in "Claim rewards (N)". A
  // non-owner's premium lane never counts: it is locked, not pending.
  const pending = useMemo(() => {
    const out: Target[] = [];
    for (const l of PASS_LEVELS) {
      if (l.level > level) break;
      if (!claimed.has(`${l.level}:free`)) out.push({ level: l, lane: 'free' });
      if (ownsPremium && !claimed.has(`${l.level}:premium`)) out.push({ level: l, lane: 'premium' });
    }
    return out;
  }, [level, claimed, ownsPremium]);

  // Open one row above your level, so the last thing you claimed frames the one you're on.
  const initialIndex = Math.max(0, Math.min(level - 2, PASS_LEVELS.length - 1));

  // Final standings only exist once the close job has run (migration 0075), so this is skipped
  // entirely while the season is live rather than polling for a row that cannot be there yet.
  useEffect(() => {
    if (phase === 'upcoming' || phase === 'live') return;
    let cancelled = false;
    fetchMySeasonCard()
      .then((s) => {
        if (!cancelled) setStanding(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase]);

  async function shareStanding(which: 'placement' | 'rewards') {
    try {
      await shareCardImage(
        which === 'placement' ? placementCardRef : rewardsCardRef,
        which === 'placement' ? 'Share your placement' : 'Share your season haul'
      );
    } catch (e) {
      Alert.alert("Couldn't share that", getErrorMessage(e, 'Something went wrong.'));
    }
  }

  // The one claim action. Sequential rather than batched: each level+lane is its own claim row
  // server-side, and stopping at the first failure leaves everything before it genuinely granted
  // instead of rolling back rewards the user already saw land.
  async function claimAll() {
    if (busy || pending.length === 0) return;
    setBusy(true);
    const paid: PassReward[] = [];
    const levels = new Set<number>();
    try {
      for (const target of pending) {
        const rewards = target.lane === 'free' ? target.level.free : target.level.premium;
        await claimPassLevel(target.level.level, target.lane, rewards);
        // Pushed only AFTER the await resolves, so a partial failure reveals exactly what was
        // actually paid rather than what was attempted.
        paid.push(...rewards);
        levels.add(target.level.level);
      }
      await refetch();
    } catch (e) {
      await refetch();
      Alert.alert('Stopped partway', getErrorMessage(e, 'Some rewards were claimed before this failed.'));
    } finally {
      setBusy(false);
    }
    if (paid.length > 0) {
      // ONE reveal for the batch. Counted in distinct LEVELS — both lanes of Level 37 is one level.
      const only = levels.size === 1 ? [...levels][0] : null;
      showRewardReveal({
        kind: 'pass_level',
        title: only !== null ? `Level ${only} claimed` : `${levels.size} levels claimed`,
        rewards: paid.map(passRewardLine),
      });
    }
  }

  // The paywall owns the season gate, the price and Restore, so the unlock bar only navigates.
  function onUnlock() {
    setDetail(null);
    router.push('/paywall');
  }

  // Apple REQUIRES a reachable Restore control for any app selling a non-consumable. It lives on
  // the paywall, in Settings, and here under the unlock bar.
  async function onRestore() {
    try {
      const { restoredPass } = await restorePurchases();
      await refetch();
      Alert.alert(
        restoredPass ? 'Restored' : 'Nothing to restore',
        restoredPass ? 'Your Flame Pass is back on this device.' : 'No previous Flame Pass purchase was found for this account.'
      );
    } catch (e) {
      Alert.alert('Couldn’t restore', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  const toSeal = Math.max(0, SEAL_LEVEL - level);
  const barPct = nextLevelCost ? Math.min(100, (intoLevel / nextLevelCost) * 100) : 100;
  const unlockBarH = ownsPremium ? 0 : UNLOCK_BAR_H;

  return (
    <Screen padded={false} backgroundColor="#040309" edges={[]}>
      {/* Behind everything and OUTSIDE the list: the sky and the rain hold still while the track
          scrolls over them — the paywall's ambient layer, so the two screens read as a pair. */}
      <EmberfallSky kind="paywall" />
      <FallingEmbers count={8} />

      <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={EMBER.warm} />
          </Pressable>
          <Text style={styles.title}>Flame Pass</Text>
          <Text style={styles.days}>
            {SEASON.name} · {countdownLabel(phase)}
          </Text>
        </View>

        {/* ── status ── */}
        <View style={styles.status}>
          <View style={styles.srow}>
            <View style={styles.lvlBig}>
              <Text style={styles.lvlNum}>{level}</Text>
              <Text style={styles.lvlKicker}>LEVEL</Text>
            </View>
            <View style={styles.sname}>
              <BurningName userId={profile?.id} owns={ownsPremium} style={styles.burn}>
                {displayName}
              </BurningName>
              <View style={styles.bal}>
                <EmberIcon size={13} />
                <Text style={styles.balText}>{formatEmbers(embers)} embers</Text>
              </View>
            </View>
          </View>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${barPct}%` }]} />
          </View>
          <View style={styles.barLabel}>
            <Text style={styles.barText}>
              {level < SEASON.totalLevels
                ? `${formatEmbers(intoLevel)} / ${formatEmbers(nextLevelCost)} XP to Level ${level + 1}`
                : `Level ${SEASON.totalLevels} · maxed`}
            </Text>
            <Text style={styles.barText}>
              {toSeal > 0
                ? `${toSeal} ${toSeal === 1 ? 'level' : 'levels'} to the Seal`
                : ownsPremium
                  ? 'The Seal is in reach'
                  : 'The Seal is Flame Pass only'}
            </Text>
          </View>
        </View>

        {/* ── the one claim action ── */}
        <Pressable
          style={[styles.claim, (pending.length === 0 || busy) && styles.claimOff]}
          disabled={pending.length === 0 || busy}
          onPress={claimAll}
          accessibilityRole="button">
          <Text style={[styles.claimText, pending.length === 0 && styles.claimTextOff]}>
            {busy
              ? 'Claiming…'
              : pending.length > 0
                ? `Claim rewards (${pending.length}) 🔥`
                : phase === 'upcoming'
                  ? `The climb opens with ${SEASON.name}`
                  : 'All caught up — keep climbing'}
          </Text>
        </Pressable>

        <View style={styles.tabs}>
          {(['track', 'xp'] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} hitSlop={6} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
              <Text style={[styles.tab, tab === t && styles.tabOn]}>{t === 'track' ? 'YOUR TRACK' : 'PASS XP'}</Text>
            </Pressable>
          ))}
        </View>

        {/* Season closed out — your final placing, and a card worth posting. Above the track because
            once the season is over the standing IS the headline, not the ladder. */}
        {standing ? (
          <View style={styles.standing}>
            <View style={styles.flex1}>
              <Text style={styles.standingRank}>
                #{standing.rank}
                <Text style={styles.standingOf}> of {standing.board_size.toLocaleString('en-US')}</Text>
              </Text>
              <Text style={styles.standingSub}>
                {standing.university} · finished Level {standing.pass_level} · top {standing.percentile}%
              </Text>
              {standing.title ? <Text style={styles.standingTitle}>“{standing.title.name}”</Text> : null}
            </View>
            <View style={styles.standingActions}>
              <Pressable onPress={() => shareStanding('placement')}>
                <Text style={styles.standingShare}>Placement</Text>
              </Pressable>
              <Pressable onPress={() => shareStanding('rewards')}>
                <Text style={styles.standingShare}>Rewards</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      {/* Off-screen capture targets for the share sheet, same pipeline as every other card. */}
      {standing ? (
        <View style={styles.offscreen} pointerEvents="none">
          <SeasonPlacementShareCard
            ref={placementCardRef}
            card={standing}
            handle={profile?.handle ?? null}
            tier={shareRank.tier}
            division={shareRank.division}
          />
          <SeasonRewardsShareCard
            ref={rewardsCardRef}
            card={standing}
            handle={profile?.handle ?? null}
            tier={shareRank.tier}
            division={shareRank.division}
          />
        </View>
      ) : null}

      {tab === 'track' ? (
        <>
          <View style={styles.laneHdr}>
            <View style={styles.nodeSpace} />
            <View style={styles.pair}>
              <Text style={[styles.laneLabel, styles.laneFree]}>FREE</Text>
              <Text style={[styles.laneLabel, styles.lanePass]}>🔥 FLAME PASS</Text>
            </View>
          </View>
          <FlatList
            data={PASS_LEVELS}
            keyExtractor={(l) => String(l.level)}
            initialScrollIndex={initialIndex}
            getItemLayout={(_, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
            renderItem={({ item }) => (
              <LevelRow
                level={item}
                current={level}
                ownsPremium={ownsPremium}
                claimed={claimed}
                onOpen={(lane) => setDetail({ level: item, lane })}
              />
            )}
            ListFooterComponent={
              <>
                <SealCapstone
                  toSeal={toSeal}
                  ownsPremium={ownsPremium}
                  onPress={() => setDetail({ level: PASS_LEVELS[SEAL_LEVEL - 1], lane: 'premium' })}
                />
                <Text style={styles.rule}>{PASS_FINE_PRINT}</Text>
              </>
            }
            contentContainerStyle={[styles.track, { paddingBottom: insets.bottom + unlockBarH + Spacing.three }]}
            showsVerticalScrollIndicator={false}
          />
        </>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.xpContent, { paddingBottom: insets.bottom + unlockBarH + Spacing.six }]}
          showsVerticalScrollIndicator={false}>
          <AchievementList earned={pass?.achievements ?? []} />
          <Text style={styles.rule}>
            Pass XP comes from achievements, never from rank XP — ranks stay their own long climb. Daily achievements are once
            per day, so the Pass rewards showing up, not marathoning.
          </Text>
        </ScrollView>
      )}

      {/* ── the free path: the Flame Pass lane is locked behind one bar ── */}
      {!ownsPremium ? (
        <View style={[styles.unlockWrap, { paddingBottom: insets.bottom + Spacing.two }]}>
          <Pressable style={styles.unlock} onPress={onUnlock} accessibilityRole="button">
            <Text style={styles.unlockLock}>🔒</Text>
            <View style={styles.flex1}>
              <Text style={styles.unlockTitle}>Unlock the Flame Pass</Text>
              <Text style={styles.unlockSub}>Every 🔥 reward on this track, and your name burns</Text>
            </View>
            {price ? <Text style={styles.unlockPrice}>{price}</Text> : null}
          </Pressable>
          <Pressable onPress={onRestore} hitSlop={8} accessibilityRole="button">
            <Text style={styles.restore}>Restore purchase</Text>
          </Pressable>
        </View>
      ) : null}

      <DetailSheet visible={detail !== null} onClose={() => setDetail(null)}>
        {detail ? (
          <LaneDetail
            target={detail}
            name={firstName}
            current={level}
            ownsPremium={ownsPremium}
            claimed={claimed}
            onUnlock={onUnlock}
          />
        ) : null}
      </DetailSheet>
    </Screen>
  );
}

/** "42 days left" / "opens in 4d" — the header pill, straight off the phase. */
function countdownLabel(phase: ReturnType<typeof seasonPhase>): string {
  const days = Math.ceil(msUntilSeasonBoundary() / 86_400_000);
  if (phase === 'upcoming') return `opens in ${days}d`;
  if (phase === 'live') return `${days} days left`;
  if (phase === 'claim-window') return `claim window · ${days}d`;
  return 'closed';
}

type ChipState = 'claimed' | 'ready' | 'locked';

function chipState(level: PassLevel, lane: Lane, current: number, ownsPremium: boolean, claimed: Set<string>): ChipState {
  if (claimed.has(`${level.level}:${lane}`)) return 'claimed';
  if (lane === 'premium' && !ownsPremium) return 'locked';
  return level.level <= current ? 'ready' : 'locked';
}

function LevelRow({
  level,
  current,
  ownsPremium,
  claimed,
  onOpen,
}: {
  level: PassLevel;
  current: number;
  ownsPremium: boolean;
  claimed: Set<string>;
  onOpen: (lane: Lane) => void;
}) {
  const reached = level.level <= current;
  const isNow = level.level === current;
  return (
    <View style={styles.row}>
      {/* The spine: lit through your level, cold above it. */}
      <View style={[styles.spine, reached && styles.spineLit]} pointerEvents="none" />
      <LevelNode level={level} reached={reached} isNow={isNow} />
      <View style={styles.pair}>
        <Chip
          rewards={level.free}
          state={chipState(level, 'free', current, ownsPremium, claimed)}
          dim={!reached}
          onPress={() => onOpen('free')}
        />
        <Chip
          rewards={level.premium}
          state={chipState(level, 'premium', current, ownsPremium, claimed)}
          dim={!reached || !ownsPremium}
          pass
          onPress={() => onOpen('premium')}
        />
      </View>
    </View>
  );
}

/** The level node. Your current level breathes; milestones keep the Mythic ring as landmarks. */
function LevelNode({ level, reached, isNow }: { level: PassLevel; reached: boolean; isNow: boolean }) {
  return (
    <View style={styles.nodeSpace}>
      {isNow ? <NowGlow /> : null}
      <View
        style={[
          styles.node,
          reached && !isNow && styles.nodeDone,
          isNow && styles.nodeNow,
          level.milestone && !reached && styles.nodeMilestone,
        ]}>
        <Text style={[styles.nodeText, reached && !isNow && styles.nodeTextDone, isNow && styles.nodeTextNow]}>
          {level.level}
        </Text>
      </View>
    </View>
  );
}

/** The mock's `@keyframes pulse` — a glow behind the current node, parked under Reduce Motion. */
function NowGlow() {
  const t = useBreath(2000, 0.6);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.45, 1]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.92, 1.08]) }],
  }));
  return (
    <View style={styles.nowGlowWrap} pointerEvents="none">
      <Animated.View style={[styles.nowGlow, style]} />
    </View>
  );
}

/**
 * One lane's chip for one level: the lead reward's art and label, "+N" when the lane carries more,
 * and a state mark. No button — the top Claim settles every ready chip at once.
 */
function Chip({
  rewards,
  state,
  dim,
  pass,
  onPress,
}: {
  rewards: PassReward[];
  state: ChipState;
  dim: boolean;
  pass?: boolean;
  onPress: () => void;
}) {
  if (rewards.length === 0) {
    return (
      <View style={[styles.chip, styles.chipEmpty]}>
        <Text style={styles.chipLabel}>—</Text>
      </View>
    );
  }
  const [lead, ...rest] = rewards;
  const item = lead.kind === 'item' ? getItem(lead.itemId) : undefined;
  return (
    <Pressable
      style={[styles.chip, pass && styles.chipPass, state === 'ready' && styles.chipReady, dim && styles.chipDim]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${pass ? 'Flame Pass' : 'Free'} reward: ${rewards.map(rewardName).join(', ')}. ${STATE_LABEL[state]}`}>
      <View style={styles.chipArt}>
        <RewardArt reward={lead} size={20} />
      </View>
      <Text style={[styles.chipLabel, item ? { color: RARITY_COLOR[item.rarity] } : null]} numberOfLines={1}>
        {chipLabel(lead)}
        {rest.length > 0 ? <Text style={styles.chipPlus}> +{rest.length}</Text> : null}
      </Text>
      <Text style={[styles.chipState, state === 'ready' && styles.chipStateReady]}>{STATE_MARK[state]}</Text>
    </Pressable>
  );
}

const STATE_MARK: Record<ChipState, string> = { claimed: '✓', ready: '●', locked: '🔒' };
const STATE_LABEL: Record<ChipState, string> = { claimed: 'Claimed', ready: 'Ready to claim', locked: 'Locked' };

/** Real art by catalog id / box key — never a stock icon. Motion off: a hundred rows of it scroll. */
function RewardArt({ reward, size }: { reward: PassReward; size: number }) {
  switch (reward.kind) {
    case 'embers':
      return <EmberIcon size={size * 0.75} />;
    case 'box':
      return <BoxArt boxKey={reward.box} size={size} motion="off" />;
    case 'item': {
      const item = getItem(reward.itemId);
      return item ? <ItemArt item={item} size={size} motion="off" /> : null;
    }
    case 'badge':
      return <Text style={{ fontSize: size * 0.6 }}>🏅</Text>;
  }
}

/** The chip's short label: the ember amount alone, the box or cosmetic by name. */
function chipLabel(reward: PassReward): string {
  return reward.kind === 'embers' ? formatEmbers(reward.amount) : rewardName(reward);
}

function rewardName(reward: PassReward): string {
  switch (reward.kind) {
    case 'embers':
      return `${formatEmbers(reward.amount)} embers`;
    case 'box':
      return BOXES[reward.box].name;
    case 'item':
      return getItem(reward.itemId)?.name ?? 'A new cosmetic';
    case 'badge':
      return reward.label;
  }
}

/**
 * The capstone, pinned under Level 100: the Emberfall Seal, off the catalog (name, rarity) and the
 * track (its level). Tapping it opens L100's Flame Pass lane in full.
 */
function SealCapstone({ toSeal, ownsPremium, onPress }: { toSeal: number; ownsPremium: boolean; onPress: () => void }) {
  const seal = getItem(SEAL_COSMETIC_KEY);
  if (!seal) return null;
  return (
    <Pressable style={styles.cap} onPress={onPress} accessibilityRole="button">
      <View style={styles.capBadge}>
        <Text style={styles.capBadgeText}>
          {RARITY_LABEL[seal.rarity]} · L{SEAL_LEVEL}
        </Text>
      </View>
      <View style={styles.capSeal}>
        <EmberfallSeal size={44} />
      </View>
      <Text style={styles.capName}>{seal.name}</Text>
      <Text style={styles.capSub}>
        Forge it at level {SEAL_LEVEL} — it burns beside your name forever.
        {ownsPremium ? '' : ' Flame Pass only.'}
      </Text>
      <Text style={styles.capLv}>{toSeal > 0 ? `${toSeal} ${toSeal === 1 ? 'LEVEL' : 'LEVELS'} AWAY` : 'LEVEL REACHED'}</Text>
    </Pressable>
  );
}

/**
 * A tapped chip: that level's lane in full. Cosmetics get the full <CosmeticDetail> (render, lore,
 * what it does); embers and crates get a line each. The state is stated, never actioned — except a
 * locked Flame Pass lane, which offers the paywall.
 */
function LaneDetail({
  target,
  name,
  current,
  ownsPremium,
  claimed,
  onUnlock,
}: {
  target: Target;
  name: string;
  current: number;
  ownsPremium: boolean;
  claimed: Set<string>;
  onUnlock: () => void;
}) {
  const { level, lane } = target;
  const rewards = lane === 'free' ? level.free : level.premium;
  const state = chipState(level, lane, current, ownsPremium, claimed);
  const needsPass = lane === 'premium' && !ownsPremium;

  return (
    <View>
      <Text style={styles.sheetKicker}>
        LEVEL {level.level} · {lane === 'free' ? 'FREE' : '🔥 FLAME PASS'}
        {level.milestone ? ' · ★ MILESTONE' : ''}
      </Text>
      <Text style={styles.sheetState}>
        {state === 'claimed'
          ? 'Claimed ✓'
          : needsPass
            ? 'Locked — Flame Pass only'
            : state === 'ready'
              ? 'Ready — tap “Claim rewards” to collect'
              : `Reach Level ${level.level} to claim`}
      </Text>

      {rewards.map((reward, i) => {
        const item = reward.kind === 'item' ? getItem(reward.itemId) : undefined;
        if (item) {
          return (
            <View key={i} style={styles.sheetItem}>
              <CosmeticDetail item={item} name={name} showLevel={false} />
            </View>
          );
        }
        return (
          <View key={i} style={styles.sheetLine}>
            <View style={styles.sheetLineArt}>
              <RewardArt reward={reward} size={34} />
            </View>
            <View style={styles.flex1}>
              <Text style={styles.sheetLineName}>{rewardName(reward)}</Text>
              <Text style={styles.sheetLineMeta}>
                {reward.kind === 'embers' ? 'Spend them in the shop and the forge' : reward.kind === 'box' ? 'A loot crate — open it in the shop' : 'Badge'}
              </Text>
            </View>
          </View>
        );
      })}

      {needsPass ? (
        <Pressable style={styles.sheetCta} onPress={onUnlock} accessibilityRole="button">
          <Text style={styles.sheetCtaText}>Unlock the Flame Pass 🔥</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AchievementList({ earned }: { earned: { key: string; period_key: string }[] }) {
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
        Climb the Pass by completing <Text style={styles.introBold}>achievements</Text> — not by grinding rank XP. Ranks stay
        their own long climb; this rewards showing up.
      </Text>
      {cadences.map((cadence) => (
        <View key={cadence} style={styles.achGroup}>
          <View style={styles.achHead}>
            <Text style={styles.achHeadText}>{CADENCE_LABEL[cadence].toUpperCase()}</Text>
            <Text style={styles.achHeadHint}>{CADENCE_RESET_HINT[cadence]}</Text>
          </View>
          {ACHIEVEMENTS.filter((a) => a.cadence === cadence).map((a) => {
            const complete = done.has(a.key);
            const at = progress[a.key];
            return (
              <View key={a.key} style={[styles.ach, complete && styles.achDone]}>
                <View style={[styles.check, complete && styles.checkOn]}>
                  {complete ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.achLabel}>{a.label}</Text>
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
    </View>
  );
}

/** Room the sticky unlock bar takes, so Level 100 and the Seal scroll clear of it. */
const UNLOCK_BAR_H = 96;
const NODE = 40;
const LINE = EMBER.line;
const CARD = 'rgba(22,14,34,0.72)';

const styles = StyleSheet.create({
  flex1: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 6,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.black,
    fontSize: 16,
    color: EMBER.ink,
  },
  days: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: EMBER.e2,
    backgroundColor: 'rgba(20,10,8,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,210,122,0.35)',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },

  // ── status ──
  status: {
    marginTop: 8,
    backgroundColor: 'rgba(10,6,16,0.4)',
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  srow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lvlBig: {
    width: 52,
    height: 52,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(224,97,44,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,210,122,0.4)',
  },
  lvlNum: {
    fontFamily: Fonts.black,
    fontSize: 22,
    lineHeight: 24,
    color: EMBER.ink,
  },
  lvlKicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 7.5,
    letterSpacing: 1,
    color: EMBER.e2,
  },
  sname: {
    flex: 1,
    minWidth: 0,
  },
  burn: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: EMBER.ink,
  },
  bal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  balText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: EMBER.e2,
  },
  bar: {
    height: 8,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    marginTop: 12,
  },
  barFill: {
    height: '100%',
    borderRadius: 99,
    backgroundColor: EMBER.e1,
  },
  barLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 5,
  },
  barText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: EMBER.warm2,
  },

  // ── claim ──
  claim: {
    marginTop: 10,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: EMBER.e2,
    alignItems: 'center',
    shadowColor: EMBER.e0,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  claimOff: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    shadowOpacity: 0,
    elevation: 0,
  },
  claimText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: '#20100a',
  },
  claimTextOff: {
    color: EMBER.warm2,
  },

  tabs: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 14,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  tab: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: 'rgba(255,243,214,0.45)',
    paddingBottom: 3,
  },
  tabOn: {
    color: EMBER.warm,
    borderBottomWidth: 2,
    borderBottomColor: EMBER.e1,
  },

  // ── season standing ──
  standing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: 8,
    padding: Spacing.two,
    borderRadius: 14,
    backgroundColor: 'rgba(42,22,44,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,180,90,0.4)',
  },
  standingRank: {
    fontFamily: Fonts.black,
    fontSize: 20,
    color: EMBER.e2,
  },
  standingOf: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: EMBER.warm2,
  },
  standingSub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: EMBER.warm2,
    marginTop: 2,
  },
  standingTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: EMBER.e2,
    marginTop: 3,
  },
  standingActions: {
    gap: 6,
    alignItems: 'flex-end',
  },
  standingShare: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: '#20100a',
    backgroundColor: EMBER.e2,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 10,
    overflow: 'hidden',
  },
  // Rendered far off-screen so view-shot can capture it at full size without it ever being seen.
  offscreen: {
    position: 'absolute',
    left: -9999,
    top: 0,
  },

  // ── the track ──
  laneHdr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  laneLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 1.1,
  },
  laneFree: {
    color: EMBER.mut,
  },
  lanePass: {
    color: EMBER.e2,
  },
  track: {
    paddingHorizontal: 16,
  },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  spine: {
    position: 'absolute',
    left: NODE / 2 - 1,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  spineLit: {
    backgroundColor: EMBER.e0,
  },
  nodeSpace: {
    width: NODE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: LINE,
    backgroundColor: '#1a1030',
  },
  nodeDone: {
    backgroundColor: EMBER.e1,
    borderColor: 'transparent',
  },
  nodeNow: {
    borderColor: EMBER.e2,
  },
  // The four milestones keep the Mythic ring while they're still ahead — landmarks on a fast scroll.
  nodeMilestone: {
    borderColor: '#FF6BD0',
  },
  nodeText: {
    fontFamily: Fonts.black,
    fontSize: 13,
    color: EMBER.mut,
  },
  nodeTextDone: {
    color: '#20100a',
  },
  nodeTextNow: {
    color: EMBER.e2,
  },
  nowGlowWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nowGlow: {
    width: NODE + 12,
    height: NODE + 12,
    borderRadius: (NODE + 12) / 2,
    backgroundColor: 'rgba(255,180,80,0.35)',
    shadowColor: '#FFB450',
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  pair: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 11,
    paddingVertical: 7,
    paddingHorizontal: 8,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: LINE,
  },
  chipPass: {
    borderColor: 'rgba(255,180,90,0.4)',
  },
  chipReady: {
    borderColor: 'rgba(255,210,122,0.8)',
  },
  chipDim: {
    opacity: 0.6,
  },
  chipEmpty: {
    justifyContent: 'center',
    opacity: 0.4,
  },
  chipArt: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#20182f',
    borderWidth: 1,
    borderColor: LINE,
  },
  chipLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: EMBER.ink,
  },
  chipPlus: {
    color: EMBER.e2,
  },
  chipState: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    color: EMBER.mut,
  },
  chipStateReady: {
    color: EMBER.e2,
    textShadowColor: 'rgba(255,180,80,0.8)',
    textShadowRadius: 6,
  },

  // ── the capstone ──
  cap: {
    marginTop: 14,
    marginBottom: 4,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(34,18,38,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,208,0.4)',
  },
  capBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#FF6BD0',
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderBottomLeftRadius: 10,
  },
  capBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    color: '#160a02',
  },
  capSeal: {
    width: 44,
    height: 44,
    marginBottom: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capName: {
    fontFamily: Fonts.black,
    fontSize: 14,
    color: EMBER.ink,
  },
  capSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 15.5,
    color: EMBER.dim,
    textAlign: 'center',
    marginTop: 3,
  },
  capLv: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1,
    color: EMBER.e2,
    marginTop: 8,
  },

  // ── the unlock bar (non-owners) ──
  unlockWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    paddingHorizontal: 16,
    gap: 6,
    backgroundColor: 'rgba(20,8,4,0.88)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,180,90,0.3)',
  },
  unlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: EMBER.e2,
  },
  unlockLock: {
    fontSize: 16,
  },
  unlockTitle: {
    fontFamily: Fonts.black,
    fontSize: 13.5,
    color: '#20100a',
  },
  unlockSub: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: 'rgba(32,16,10,0.75)',
    marginTop: 1,
  },
  unlockPrice: {
    fontFamily: Fonts.black,
    fontSize: 13,
    color: EMBER.e2,
    backgroundColor: '#20100a',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 9,
    overflow: 'hidden',
  },
  restore: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: EMBER.warm2,
    textAlign: 'center',
    paddingVertical: 2,
  },

  // ── lane sheet ──
  sheetKicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    color: EMBER.e2,
    textAlign: 'center',
  },
  sheetState: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: EMBER.warm2,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 10,
  },
  sheetItem: {
    marginBottom: 16,
  },
  sheetLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: LINE,
  },
  sheetLineArt: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#20182f',
  },
  sheetLineName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: EMBER.ink,
  },
  sheetLineMeta: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: EMBER.dim,
    marginTop: 2,
  },
  sheetCta: {
    marginTop: 6,
    paddingVertical: 13,
    borderRadius: 13,
    backgroundColor: EMBER.e2,
    alignItems: 'center',
  },
  sheetCtaText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: '#20100a',
  },

  // ── Pass XP tab ──
  xpContent: {
    paddingHorizontal: 16,
  },
  intro: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: EMBER.warm2,
    marginBottom: Spacing.two,
  },
  introBold: {
    fontFamily: Fonts.bodyBold,
    color: EMBER.ink,
  },
  achGroup: {
    marginBottom: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(10,6,16,0.45)',
    borderWidth: 1,
    borderColor: LINE,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  achHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  achHeadText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: EMBER.e2,
  },
  achHeadHint: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: EMBER.warm2,
  },
  ach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(58,43,82,0.6)',
  },
  achDone: {
    opacity: 0.6,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: EMBER.line2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: EMBER.e1,
    borderColor: EMBER.e1,
  },
  checkMark: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: '#20100a',
  },
  achLabel: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: EMBER.ink,
  },
  achProgress: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: EMBER.warm2,
    marginTop: 2,
  },
  achXp: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: EMBER.e2,
  },
  rule: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: EMBER.warm2,
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
});
