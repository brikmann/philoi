import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BoxArt } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { EmberPill, SectionLabel, formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { SeasonStandingShareCard } from '@/components/economy/season-standing-share-card';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { useAuth } from '@/lib/auth/auth-context';
import { claimPassLevel, fetchAchievementProgress, fetchMySeasonStanding, type SeasonStanding } from '@/lib/api/forge-pass';
import { shareCardImage } from '@/lib/share-card';
import { restorePurchases } from '@/lib/billing';
import { FORGE_PASS_PRODUCT_ID } from '@/lib/economy/iap';
import { useProductPrices, usePurchase } from '@/hooks/use-purchase';
import { BOXES } from '@/lib/economy/boxes';
import { getItem, type CatalogItem } from '@/lib/economy/catalog';
import {
  ACHIEVEMENTS,
  CADENCE_LABEL,
  CADENCE_RESET_HINT,
  LEVEL_ZERO_UNLOCK,
  PASS_FINE_PRINT,
  PASS_LEVELS,
  SEASON,
  levelCost,
  levelFromXp,
  msUntilSeasonBoundary,
  seasonPhase,
  type AchievementCadence,
  type PassLevel,
  type PassReward,
} from '@/lib/economy/forge-pass';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/economy/rarity';
import { getErrorMessage } from '@/lib/errors';

// The Flame Pass track (FORGE_PASS_DESLOP.md, mock 87).
//
// The old screen was a horizontally-scrolling grid of generic cells with emoji icons, which is
// exactly what the de-slop spec diagnoses: no theme, no hierarchy, no sense of a track you are
// climbing. This is the rebuild around one metaphor — a MOLTEN SEAM forged upward through the
// levels, lit below where you've reached and cold iron above. The rail IS the progress bar, which
// is why there's no second bar in the track itself.
//
// Two rules carry most of the visual weight:
//   1. Real cosmetic art in every tile, pulled by catalog id — the same ItemArt/BoxArt the shop
//      uses. Stock icons were the single biggest slop tell.
//   2. States must be unmistakable: claimed (dimmed ✓) · current (pulsing node) · upcoming (cold) ·
//      premium-locked (warm border + 🔒).
//
// COPY RULE: this screen counts in LEVELS. "Tier" belongs to the rank ladder and never appears here.

/** Fixed row height so the 100-level list can be virtualized and jumped into. */
const ROW_H = 74;
const MILESTONE_ROW_H = 88;

const rowHeight = (level: PassLevel) => (level.milestone ? MILESTONE_ROW_H : ROW_H);

export default function ForgePassScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { embers, pass, refetch } = useInventory();
  const [tab, setTab] = useState<'track' | 'xp'>('track');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<{ level: PassLevel; lane: 'free' | 'premium' } | null>(null);
  const listRef = useRef<FlatList<PassLevel>>(null);
  const cardRef = useRef<View>(null);
  const [standing, setStanding] = useState<SeasonStanding | null>(null);
  const { buy, busy: buying } = usePurchase();
  // Store-supplied localized prices. Empty until the offering loads, and empty forever in a build
  // with no SDK keys — every render site below degrades to omitting the price rather than quoting
  // a literal that could differ from the real charge.
  const prices = useProductPrices();

  const passXp = pass?.pass_xp ?? 0;
  const ownsPremium = pass?.owns_premium ?? false;
  const { level, intoLevel, nextLevelCost } = levelFromXp(passXp);
  const phase = seasonPhase();

  const claimed = useMemo(() => {
    const set = new Set<string>();
    for (const c of pass?.claims ?? []) set.add(`${c.tier}:${c.lane}`);
    return set;
  }, [pass]);

  // Everything reached, unclaimed, and actually claimable by this user. Drives the single CTA at
  // the bottom — the spec asks for ONE claim button, not one per tile, so it needs to know how many
  // are pending to decide between "Claim Level 7" and "Claim all (4)".
  const pending = useMemo(() => {
    const out: { level: PassLevel; lane: 'free' | 'premium' }[] = [];
    for (const l of PASS_LEVELS) {
      if (l.level > level) break;
      if (!claimed.has(`${l.level}:free`)) out.push({ level: l, lane: 'free' });
      if (ownsPremium && !claimed.has(`${l.level}:premium`)) out.push({ level: l, lane: 'premium' });
    }
    return out;
  }, [level, claimed, ownsPremium]);

  // Open on the level you're actually on rather than at Level 1 — with 100 rows, landing at the top
  // means every visit starts with a scroll past everything already claimed.
  const initialIndex = Math.max(0, Math.min(level - 1, PASS_LEVELS.length - 1));

  // Final standings only exist once the close job has run (migration 0075), so this is skipped
  // entirely while the season is live rather than polling for a row that cannot be there yet.
  useEffect(() => {
    if (phase === 'upcoming' || phase === 'live') return;
    let cancelled = false;
    fetchMySeasonStanding()
      .then((s) => {
        if (!cancelled) setStanding(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase]);

  async function shareStanding() {
    try {
      await shareCardImage(cardRef, 'Share your season');
    } catch (e) {
      Alert.alert("Couldn't share that", getErrorMessage(e, 'Something went wrong.'));
    }
  }

  async function claim(target: { level: PassLevel; lane: 'free' | 'premium' }) {
    const rewards = target.lane === 'free' ? target.level.free : target.level.premium;
    if (target.lane === 'premium' && !ownsPremium) {
      const priced = prices[FORGE_PASS_PRODUCT_ID];
      Alert.alert(
        'Premium locked',
        `This level is on the Premium track.${priced ? ` The Flame Pass is ${priced} for the season.` : ''}`
      );
      return;
    }
    setBusy(true);
    try {
      await claimPassLevel(target.level.level, target.lane, rewards);
      await refetch();
      setDetail(null);
    } catch (e) {
      Alert.alert("Couldn't claim that", getErrorMessage(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  // "Claim all" is a sequential loop rather than one batched call: each level is its own claim row
  // server-side, and stopping at the first failure leaves everything before it genuinely granted
  // instead of rolling back rewards the user already saw land.
  async function claimAll() {
    setBusy(true);
    try {
      for (const target of pending) {
        await claimPassLevel(target.level.level, target.lane, target.lane === 'free' ? target.level.free : target.level.premium);
      }
      await refetch();
    } catch (e) {
      await refetch();
      Alert.alert('Stopped partway', getErrorMessage(e, 'Some rewards were claimed before this failed.'));
    } finally {
      setBusy(false);
    }
  }

  // The season gate comes FIRST, before the store is ever asked. Buying outside the window is
  // refused server-side by grant_forge_pass anyway (0074), but letting the purchase sheet open and
  // then failing after payment would be the worst possible order to discover that in.
  function onUpgrade() {
    if (phase !== 'live') {
      Alert.alert(
        phase === 'upcoming' ? `${SEASON.name} hasn't started` : `${SEASON.name} has closed`,
        phase === 'upcoming'
          ? 'The Flame Pass goes on sale when the season opens on September 10.'
          : 'This season is over. Season 2 opens with its own pass.'
      );
      return;
    }
    void buy(FORGE_PASS_PRODUCT_ID);
  }

  // Apple REQUIRES a reachable Restore control for any app selling a non-consumable. It lives here
  // and in Settings. Ember packs are consumables and deliberately don't restore — they were spent
  // into a balance on grant, and "restoring" them would mint them twice.
  async function onRestore() {
    try {
      const { restoredPass } = await restorePurchases();
      await refetch();
      Alert.alert(
        restoredPass ? 'Restored' : 'Nothing to restore',
        restoredPass
          ? 'Your Flame Pass is back on this device.'
          : 'No previous Flame Pass purchase was found for this account.'
      );
    } catch (e) {
      Alert.alert('Couldn’t restore', getErrorMessage(e, 'Something went wrong.'));
    }
  }

  return (
    <Screen padded={false}>
      {/* ── Header: identity, level, molten XP bar, countdown ── */}
      <View style={styles.header}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={Colors.ink} />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.wordmark}>FLAME PASS</Text>
            <Text style={styles.season}>
              Season {SEASON.id.replace('S', '')} · {SEASON.name} — <Text style={styles.seasonHot}>{countdownLabel(phase)}</Text>
            </Text>
          </View>
          <EmberPill embers={embers} />
        </View>

        <View style={styles.levelRow}>
          <View>
            <Text style={styles.levelKicker}>Level</Text>
            <Text style={styles.levelBig}>{level}</Text>
          </View>
          <Text style={styles.xpCount}>
            {formatEmbers(intoLevel)} / {formatEmbers(nextLevelCost || levelCost(SEASON.totalLevels))} XP
            {level < SEASON.totalLevels ? ` to Level ${level + 1}` : ' · maxed'}
          </Text>
        </View>
        <View style={styles.xpTrack}>
          <View style={[styles.xpFill, { width: `${nextLevelCost ? (intoLevel / nextLevelCost) * 100 : 100}%` }]} />
        </View>
      </View>

      {/* ── The one gold upgrade strip, only while unowned ── */}
      {!ownsPremium ? (
        <>
          <Pressable style={[styles.upgrade, buying && styles.claimBusy]} disabled={buying} onPress={onUpgrade}>
            <View style={styles.upgradeCol}>
              <Text style={styles.upgradeTitle}>Unlock the Flame Pass</Text>
              <Text style={styles.upgradeSub}>
                {phase === 'live'
                  ? 'Every level’s premium reward, all season — plus the Mythic flare on day one'
                  : phase === 'upcoming'
                    ? 'On sale when Emberfall opens, September 10'
                    : 'This season has closed'}
              </Text>
            </View>
              {/* The store's own localized price, never a literal — a hardcoded '$9.99' that
                disagrees with App Store Connect is a price the user was quoted and not charged. */}
            <Text style={styles.upgradePrice}>
              {phase === 'live' ? (prices[FORGE_PASS_PRODUCT_ID] ?? '—') : '—'}
            </Text>
          </Pressable>
          <Pressable onPress={onRestore} hitSlop={8} accessibilityRole="button">
            <Text style={styles.restore}>Restore purchases</Text>
          </Pressable>
        </>
      ) : null}

      <View style={styles.tabs}>
        {(['track', 'xp'] as const).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'track' ? 'Track' : 'Pass XP'}</Text>
          </Pressable>
        ))}
      </View>

      {/* Season closed out — your final placing, and a card worth posting. Rendered above the
          track because once the season is over the standing IS the headline, not the ladder. */}
      {standing ? (
        <Pressable style={styles.standing} onPress={shareStanding}>
          <View style={styles.standingCol}>
            <Text style={styles.standingRank}>
              #{standing.rank}
              <Text style={styles.standingOf}> of {standing.board_size.toLocaleString('en-US')}</Text>
            </Text>
            <Text style={styles.standingSub}>
              {standing.university} · finished Level {standing.pass_level} · top {standing.percentile}%
            </Text>
          </View>
          <Text style={styles.standingShare}>Share</Text>
        </Pressable>
      ) : null}

      {/* Off-screen capture target for the share sheet, same pipeline as every other card. */}
      {standing ? (
        <View style={styles.offscreen} pointerEvents="none">
          <SeasonStandingShareCard
            ref={cardRef}
            rank={standing.rank}
            boardSize={standing.board_size}
            university={standing.university}
            passLevel={standing.pass_level}
            handle={profile?.handle ?? 'philoi'}
          />
        </View>
      ) : null}

      {tab === 'track' ? (
        <>
          <View style={styles.laneHeader}>
            <Text style={styles.laneLabel}>FREE</Text>
            <View style={styles.laneSpacer} />
            <Text style={[styles.laneLabel, styles.laneLabelPremium]}>PREMIUM</Text>
          </View>

          <FlatList
            ref={listRef}
            data={PASS_LEVELS}
            keyExtractor={(l) => String(l.level)}
            initialScrollIndex={initialIndex}
            // Rows are two fixed heights, so the offset is exact and the list can jump straight to
            // the player's level without measuring 100 rows first.
            getItemLayout={(data, index) => {
              let offset = 0;
              for (let i = 0; i < index; i += 1) offset += rowHeight((data as PassLevel[])[i]);
              return { length: rowHeight((data as PassLevel[])[index]), offset, index };
            }}
            renderItem={({ item }) => (
              <LevelRow
                level={item}
                reached={item.level <= level}
                isCurrent={item.level === level}
                ownsPremium={ownsPremium}
                claimed={claimed}
                onOpen={(lane) => setDetail({ level: item, lane })}
              />
            )}
            ListHeaderComponent={
              ownsPremium ? null : <LevelZeroRow onPress={onUpgrade} />
            }
            ListFooterComponent={<Text style={styles.rule}>{PASS_FINE_PRINT}</Text>}
            showsVerticalScrollIndicator={false}
          />

          {/* One Claim CTA for the whole screen (spec §5), not a button per tile. */}
          {pending.length > 0 ? (
            <Pressable style={[styles.claim, busy && styles.claimBusy]} disabled={busy} onPress={() => (pending.length === 1 ? claim(pending[0]) : claimAll())}>
              <Text style={styles.claimText}>
                {pending.length === 1 ? `Claim Level ${pending[0].level.level} reward` : `Claim all (${pending.length})`}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <ScrollView contentContainerStyle={styles.xpContent} showsVerticalScrollIndicator={false}>
          <AchievementList earned={pass?.achievements ?? []} />
          <Text style={styles.rule}>
            Pass XP comes from achievements, never from rank XP — ranks stay their own long climb. Daily achievements are
            once per day, so the Pass rewards showing up, not marathoning.
          </Text>
        </ScrollView>
      )}

      <RewardDetailSheet
        target={detail}
        ownsPremium={ownsPremium}
        claimed={claimed}
        reached={detail ? detail.level.level <= level : false}
        busy={busy}
        passPrice={prices[FORGE_PASS_PRODUCT_ID]}
        onClaim={claim}
        onUpgrade={onUpgrade}
        onClose={() => setDetail(null)}
      />
    </Screen>
  );
}

/** "23 days left" / "opens in 26 days" — the header's sense of urgency, straight off the phase. */
function countdownLabel(phase: ReturnType<typeof seasonPhase>): string {
  const ms = msUntilSeasonBoundary();
  const days = Math.ceil(ms / 86_400_000);
  if (phase === 'upcoming') return `opens in ${days}d`;
  if (phase === 'live') return `${days} days left`;
  if (phase === 'claim-window') return `claim window · ${days}d left`;
  return 'season closed';
}

/**
 * The Level 0 unlock, pinned above Level 1 for anyone who hasn't bought in
 * (FORGE_PASS_SEASON1 §"Level 0"). It sits at the top of the track rather than in the upgrade strip
 * because the track is where rewards live, and seeing the Mythic flare sitting one row above your
 * climb is a far stronger argument than a price tag.
 */
function LevelZeroRow({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.zeroRow} onPress={onPress}>
      <Text style={styles.zeroKicker}>LEVEL 0 · THE INSTANT YOU UNLOCK</Text>
      <View style={styles.zeroArt}>
        {LEVEL_ZERO_UNLOCK.map((reward, i) => (
          <View key={i} style={styles.zeroTile}>
            <RewardArt reward={reward} size={30} />
            <Text style={styles.zeroName} numberOfLines={1}>
              {rewardName(reward)}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function LevelRow({
  level,
  reached,
  isCurrent,
  ownsPremium,
  claimed,
  onOpen,
}: {
  level: PassLevel;
  reached: boolean;
  isCurrent: boolean;
  ownsPremium: boolean;
  claimed: Set<string>;
  onOpen: (lane: 'free' | 'premium') => void;
}) {
  return (
    <View style={[styles.row, level.milestone && styles.rowMilestone]}>
      {/* The seam behind everything — lit up to your level, cold iron above. This IS the progress
          bar; the track deliberately has no separate one. */}
      <View style={[styles.seam, reached && styles.seamLit]} pointerEvents="none" />

      <RewardTile
        rewards={level.free}
        claimed={claimed.has(`${level.level}:free`)}
        locked={!reached}
        onPress={() => onOpen('free')}
      />

      <View
        style={[
          styles.node,
          reached && !isCurrent && styles.nodeDone,
          isCurrent && styles.nodeCurrent,
          level.milestone && styles.nodeMilestone,
        ]}>
        <Text style={[styles.nodeText, isCurrent && styles.nodeTextCurrent, level.milestone && styles.nodeTextMilestone]}>
          {level.level}
        </Text>
      </View>

      <RewardTile
        rewards={level.premium}
        claimed={claimed.has(`${level.level}:premium`)}
        locked={!reached || !ownsPremium}
        premiumLocked={!ownsPremium}
        premium
        onPress={() => onOpen('premium')}
      />
    </View>
  );
}

/**
 * One lane's tile for one level. Renders the lane's FIRST reward as the art plus a "+N" when the
 * level hands over more than one thing — L50 premium is a Mythic halo and a sting, and shrinking
 * both into a 36px swatch would make neither legible. The detail sheet lists the full bundle.
 */
function RewardTile({
  rewards,
  claimed,
  locked,
  premium,
  premiumLocked,
  onPress,
}: {
  rewards: PassReward[];
  claimed: boolean;
  locked: boolean;
  premium?: boolean;
  premiumLocked?: boolean;
  onPress: () => void;
}) {
  if (rewards.length === 0) return <View style={[styles.tile, styles.tileEmpty]} />;
  const [lead, ...rest] = rewards;
  const item = lead.kind === 'item' ? getItem(lead.itemId) : undefined;

  return (
    <Pressable
      style={[styles.tile, premium && styles.tilePremium, (claimed || locked) && styles.tileDim]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${premium ? 'Premium' : 'Free'} reward: ${rewards.map(rewardName).join(', ')}`}>
      <RewardArt reward={lead} size={32} />
      <View style={styles.tileCol}>
        <Text style={styles.tileName} numberOfLines={1}>
          {rewardName(lead)}
          {rest.length > 0 ? <Text style={styles.tilePlus}> +{rest.length}</Text> : null}
        </Text>
        <Text style={[styles.tileMeta, item ? { color: RARITY_COLOR[item.rarity] } : null]} numberOfLines={1}>
          {rewardMeta(lead)}
        </Text>
      </View>
      {claimed ? <Text style={styles.tileCheck}>✓</Text> : premiumLocked ? <Text style={styles.tileLock}>🔒</Text> : null}
    </Pressable>
  );
}

/** Real cosmetic art by catalog id — never a stock icon (spec §"Reward tile"). */
function RewardArt({ reward, size }: { reward: PassReward; size: number }) {
  switch (reward.kind) {
    case 'embers':
      return <EmberIcon size={size * 0.8} />;
    case 'box':
      return <BoxArt boxKey={reward.box} size={size} />;
    case 'item': {
      const item = getItem(reward.itemId);
      return item ? <ItemArt item={item} size={size} /> : <View style={{ width: size, height: size }} />;
    }
    case 'badge':
      return <View style={[styles.badgeArt, { width: size, height: size, borderRadius: size / 4 }]} />;
  }
}

function rewardName(reward: PassReward): string {
  switch (reward.kind) {
    case 'embers':
      return `${formatEmbers(reward.amount)} Embers`;
    case 'box':
      return BOXES[reward.box].name;
    case 'item':
      return getItem(reward.itemId)?.name ?? reward.itemId;
    case 'badge':
      return reward.label;
  }
}

function rewardMeta(reward: PassReward): string {
  switch (reward.kind) {
    case 'embers':
      return 'CURRENCY';
    case 'box':
      return 'LOOT BOX';
    case 'item': {
      const item = getItem(reward.itemId);
      return item ? `${RARITY_LABEL[item.rarity].toUpperCase()} · ${item.type}` : 'COSMETIC';
    }
    case 'badge':
      return 'BADGE';
  }
}

/** Tap any tile → big art, name, rarity, lore, Claim (spec §"States"). */
function RewardDetailSheet({
  target,
  ownsPremium,
  claimed,
  reached,
  busy,
  passPrice,
  onClaim,
  onUpgrade,
  onClose,
}: {
  target: { level: PassLevel; lane: 'free' | 'premium' } | null;
  ownsPremium: boolean;
  claimed: Set<string>;
  reached: boolean;
  busy: boolean;
  /** The store's localized Pass price, or undefined until the offering loads. */
  passPrice?: string;
  onClaim: (t: { level: PassLevel; lane: 'free' | 'premium' }) => void;
  onUpgrade: () => void;
  onClose: () => void;
}) {
  if (!target) return null;
  const rewards = target.lane === 'free' ? target.level.free : target.level.premium;
  const isClaimed = claimed.has(`${target.level.level}:${target.lane}`);
  const needsPass = target.lane === 'premium' && !ownsPremium;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetGrip} />
          <Text style={styles.sheetKicker}>
            LEVEL {target.level.level} · {target.lane === 'free' ? 'FREE' : 'PREMIUM'}
            {target.level.milestone ? ' · ★ MILESTONE' : ''}
          </Text>

          {rewards.map((reward, i) => {
            const item: CatalogItem | undefined = reward.kind === 'item' ? getItem(reward.itemId) : undefined;
            return (
              <View key={i} style={styles.sheetReward}>
                <View style={styles.sheetArt}>
                  <RewardArt reward={reward} size={56} />
                </View>
                <View style={styles.sheetCol}>
                  <Text style={styles.sheetName}>{rewardName(reward)}</Text>
                  <Text style={[styles.sheetMeta, item ? { color: RARITY_COLOR[item.rarity] } : null]}>
                    {rewardMeta(reward)}
                  </Text>
                  {item ? <Text style={styles.sheetLore}>{item.lore}</Text> : null}
                </View>
              </View>
            );
          })}

          {isClaimed ? (
            <View style={[styles.sheetCta, styles.sheetCtaOff]}>
              <Text style={styles.sheetCtaOffText}>Claimed ✓</Text>
            </View>
          ) : needsPass ? (
            <Pressable style={styles.sheetCta} onPress={onUpgrade}>
              <Text style={styles.sheetCtaText}>
                Unlock the Flame Pass{passPrice ? ` · ${passPrice}` : ''}
              </Text>
            </Pressable>
          ) : !reached ? (
            <View style={[styles.sheetCta, styles.sheetCtaOff]}>
              <Text style={styles.sheetCtaOffText}>Reach Level {target.level.level} to claim</Text>
            </View>
          ) : (
            <Pressable style={[styles.sheetCta, busy && styles.claimBusy]} disabled={busy} onPress={() => onClaim(target)}>
              <Text style={styles.sheetCtaText}>Claim</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
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

const SEAM_W = 4;
const NODE = 44;
const NODE_MILESTONE = 54;

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  titleWrap: {
    flex: 1,
  },
  // The molten wordmark. RN can't gradient-fill text without a mask, and a mask for two words is
  // more machinery than it earns — the ember colour carries the same identity at this size.
  wordmark: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    letterSpacing: 0.6,
    color: '#FFD27A',
  },
  season: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  seasonHot: {
    color: '#caa96f',
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  levelKicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: '#FFD27A',
  },
  levelBig: {
    fontFamily: Fonts.bodyBold,
    fontSize: 32,
    lineHeight: 34,
    color: Colors.ink,
  },
  xpCount: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    marginBottom: 3,
  },
  xpTrack: {
    height: 9,
    borderRadius: Radius.pill,
    backgroundColor: '#241c38',
    marginTop: Spacing.one,
    overflow: 'hidden',
  },
  xpFill: {
    height: '100%',
    backgroundColor: Colors.ember,
  },
  upgrade: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#2a1c10',
    borderWidth: 1,
    borderColor: '#6b4a1e',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  upgradeCol: {
    flex: 1,
  },
  upgradeTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: '#FFD27A',
  },
  upgradeSub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: '#caa96f',
    marginTop: 1,
  },
  upgradePrice: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: '#1a1206',
    backgroundColor: '#FFD27A',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    overflow: 'hidden',
  },
  tabs: {
    flexDirection: 'row',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  tab: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.cardDark,
  },
  tabOn: {
    backgroundColor: Colors.selectedBg,
  },
  tabText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  tabTextOn: {
    color: Colors.ink,
  },
  laneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingBottom: 2,
  },
  laneLabel: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.7,
    color: Colors.textTertiary,
  },
  laneLabelPremium: {
    color: '#FFD27A',
    textAlign: 'right',
  },
  laneSpacer: {
    width: NODE,
  },
  // ── the rail ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    height: ROW_H,
  },
  rowMilestone: {
    height: MILESTONE_ROW_H,
  },
  seam: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: SEAM_W,
    marginLeft: -SEAM_W / 2,
    backgroundColor: '#241c38',
  },
  seamLit: {
    backgroundColor: Colors.ember,
  },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#241c38',
    borderWidth: 1,
    borderColor: '#33294a',
  },
  nodeDone: {
    backgroundColor: '#20182f',
  },
  nodeCurrent: {
    backgroundColor: Colors.ember,
    borderColor: '#FFE0A6',
  },
  // The four Mythic milestones get the violet anvil — bigger, and the only non-ember colour on the
  // rail, so they read as landmarks from a fast scroll.
  nodeMilestone: {
    width: NODE_MILESTONE,
    height: NODE_MILESTONE,
    borderRadius: 16,
    backgroundColor: '#2f1c4d',
    borderColor: '#a06cd5',
  },
  nodeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.textTertiary,
  },
  nodeTextCurrent: {
    color: '#2a0f06',
  },
  nodeTextMilestone: {
    color: '#e7ddf5',
    fontSize: 16,
  },
  tile: {
    flex: 1,
    minHeight: 56,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 13,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tilePremium: {
    borderColor: '#4a3a1e',
    backgroundColor: '#1c1710',
  },
  tileDim: {
    opacity: 0.48,
  },
  tileEmpty: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  tileCol: {
    flex: 1,
  },
  tileName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.ink,
  },
  tilePlus: {
    color: '#FFD27A',
  },
  tileMeta: {
    fontFamily: Fonts.body,
    fontSize: 8.5,
    letterSpacing: 0.4,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  tileCheck: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: '#7CCB8E',
  },
  tileLock: {
    fontSize: 11,
  },
  badgeArt: {
    backgroundColor: '#8A4E18',
  },
  // ── Level 0 ──
  zeroRow: {
    marginHorizontal: Spacing.two,
    marginBottom: Spacing.two,
    padding: Spacing.two,
    borderRadius: 14,
    backgroundColor: '#221436',
    borderWidth: 1,
    borderColor: '#a06cd5',
  },
  zeroKicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.8,
    color: '#c9a9ff',
    marginBottom: Spacing.one,
  },
  zeroArt: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  zeroTile: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  zeroName: {
    fontFamily: Fonts.body,
    fontSize: 9,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  restore: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingVertical: Spacing.one,
    marginTop: 6,
  },
  // ── season standing ──
  standing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.two,
    marginBottom: Spacing.one,
    padding: Spacing.two,
    borderRadius: 14,
    backgroundColor: '#2a1c10',
    borderWidth: 1,
    borderColor: '#6b4a1e',
  },
  standingCol: {
    flex: 1,
  },
  standingRank: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: '#FFD27A',
  },
  standingOf: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  standingSub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: '#caa96f',
    marginTop: 2,
  },
  standingShare: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: '#1a1206',
    backgroundColor: '#FFD27A',
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
  // ── claim ──
  claim: {
    margin: Spacing.two,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: '#FFD27A',
    alignItems: 'center',
  },
  claimBusy: {
    opacity: 0.6,
  },
  claimText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: '#2a0f06',
  },
  // ── detail sheet ──
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.cardDark,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.line,
  },
  sheetKicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    color: '#FFD27A',
  },
  sheetReward: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  sheetArt: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: Colors.forgeBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCol: {
    flex: 1,
  },
  sheetName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  sheetMeta: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    letterSpacing: 0.5,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  sheetLore: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
    marginTop: 5,
  },
  sheetCta: {
    marginTop: Spacing.one,
    paddingVertical: 13,
    borderRadius: 13,
    backgroundColor: '#FFD27A',
    alignItems: 'center',
  },
  sheetCtaText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: '#2a0f06',
  },
  sheetCtaOff: {
    backgroundColor: Colors.selectedBg,
  },
  sheetCtaOffText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.textTertiary,
  },
  // ── Pass XP tab ──
  xpContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
  },
  intro: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    color: Colors.textTertiary,
    marginBottom: Spacing.two,
  },
  introBold: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
  },
  ach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  achDone: {
    opacity: 0.6,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: Colors.ember,
    borderColor: Colors.ember,
  },
  checkMark: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: '#2a0f06',
  },
  achCol: {
    flex: 1,
  },
  achLabel: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.ink,
  },
  achProgress: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  achXp: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: '#FFD27A',
  },
  rule: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
});
