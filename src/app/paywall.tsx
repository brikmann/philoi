import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useId, useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import { BoxArt } from '@/components/economy/box-art';
import { EmberIcon } from '@/components/economy/ember-icon';
import { formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { FlameLogo } from '@/components/ui/flame-logo';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { useMotionActive } from '@/hooks/use-motion-active';
import { useProductPrices, usePurchase } from '@/hooks/use-purchase';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useAuth } from '@/lib/auth/auth-context';
import { restorePurchases } from '@/lib/billing';
import { getItem } from '@/lib/economy/catalog';
import {
  LEVEL_ZERO_UNLOCK,
  PASS_LEVELS,
  SEASON,
  levelFromXp,
  msUntilSeasonBoundary,
  passOnSale,
  seasonPhase,
  type PassReward,
  type SeasonPhase,
} from '@/lib/economy/forge-pass';
import { FORGE_PASS_PRODUCT_ID } from '@/lib/economy/iap';
import { getErrorMessage } from '@/lib/errors';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE FLAME PASS PAYWALL (design-mocks/200, supersedes 39).
//
// WHAT THIS REPLACED. This file used to be "Philoi Membership — coming later": a monthly/yearly
// toggle over MEMBERSHIP_PRICING, a bulleted pitch, and a "Join (coming later)" button wired to a
// function whose entire body threw. That model was abandoned — Philoi sells the Flame Pass and
// ember packs, cosmetics only — and the screen stayed behind as a preview of a product that will
// never exist. It is now the purchase surface for the thing that does.
//
// 🔴 COPY SAYS "FLAME PASS", CODE SAYS `forge_pass`. Every id on this screen — the product id, the
// entitlement, the route, the RPCs — is bound to App Store Connect and the RevenueCat dashboard.
// Renaming any of them to match the user-facing name is not a rename, it is a purchase that
// succeeds and grants nothing. The two names coexist on purpose; see lib/economy/iap.ts.
//
// 🔴 NO HARDCODED PRICE. The big number is the store's own localized `priceString` (via
// useProductPrices), never a literal. `PASS_PRICE_LABEL` was deleted from forge-pass.ts precisely
// because a literal can disagree with what App Store Connect actually charges, in the one screen
// where being wrong costs real money. An offering that hasn't loaded shows a dash and says the
// price is coming — it does not invent $9.99.
//
// 🔴 THE CLIENT GRANTS NOTHING. `buy()` ends at "the store charged them"; the entitlement and the
// embers are written by the RevenueCat webhook. That is why success routes to /purchase-success,
// which is honest about the timing, rather than this screen congratulating anyone itself.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The season track's visible columns: the first five levels, an ellipsis, and the apex. */
const TRACK_COLUMNS = [1, 2, 3, 4, 5] as const;

export default function PaywallScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { pass, refetch } = useInventory();
  const prices = useProductPrices();
  // 'replace', not 'push': this modal's whole job was to take the money, and leaving it in the
  // stack means a back gesture off the receipt lands on "buy the Flame Pass" for a pass they own.
  const { buy, busy } = usePurchase({ navigate: 'replace' });

  const phase = seasonPhase();
  const onSale = passOnSale(phase, profile?.is_dev);
  const ownsPremium = pass?.owns_premium ?? false;
  const { level } = levelFromXp(pass?.pass_xp ?? 0);
  const price = prices[FORGE_PASS_PRODUCT_ID];
  const firstName = profile?.display_name?.trim().split(/\s+/)[0] ?? '';

  // The store is the only thing that knows whether this account already paid, and it can know
  // before our own inventory row does (the webhook lands a beat after the charge). Refetching on
  // mount is what stops someone who bought on another device from being sold the same season twice.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  // The season gate comes FIRST, before the store is ever asked. grant_forge_pass (0074) refuses
  // outside the window anyway, but discovering that AFTER payment is the worst possible order.
  function onBuy() {
    if (!onSale) {
      Alert.alert(
        phase === 'upcoming' ? `${SEASON.name} hasn't started` : `${SEASON.name} has closed`,
        phase === 'upcoming'
          ? 'The Flame Pass goes on sale when the season opens on October 1.'
          : 'This season is over. Season 2 opens with its own pass.'
      );
      return;
    }
    void buy(FORGE_PASS_PRODUCT_ID);
  }

  // Apple REQUIRES a reachable Restore control for any app selling a non-consumable, and a paywall
  // is the first place a user who already paid will look. Settings carries the other copy.
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
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Hero phase={phase} />

        <View style={styles.body}>
          <Text style={styles.sect}>What you unlock</Text>
          <RewardShowcase />

          <SeasonTrack level={level} />

          {/* ── Price · one-time, non-renewing ── */}
          <View style={styles.price}>
            <Text style={styles.priceBig}>
              {price ?? '—'}
              <Text style={styles.pricePer}> / season</Text>
            </Text>
            <Text style={styles.priceAlt}>
              {price
                ? // NON-RENEWING, per the Phase 4 decision — FORGE_PASS_PRODUCT_ID is a
                  // non-renewing store product, so nothing here may promise a renewal.
                  'One season = one semester · one-time, no subscription'
                : 'Pricing is loading from the store…'}
            </Text>
          </View>

          {ownsPremium ? (
            // Already paid. Selling it again is the fastest way to make someone think the first
            // purchase failed, so the CTA becomes the way into what they bought.
            <>
              <PrimaryButton label="Your Flame Pass is live — open the track" onPress={() => router.replace('/forge-pass')} />
              <Text style={styles.trust}>
                <Text style={styles.trustStrong}>You already own this season.</Text>
                {'\n'}Every premium reward up to Level {level} is waiting to be claimed.
              </Text>
            </>
          ) : (
            <>
              <PrimaryButton
                label={
                  onSale
                    ? `Welcome to the club${firstName ? `, ${firstName}` : ''}`
                    : phase === 'upcoming'
                      ? 'Opens October 1'
                      : 'Season closed'
                }
                onPress={onBuy}
                disabled={!onSale}
                loading={busy}
                pulse
              />
              <Text style={styles.trust}>
                <Text style={styles.trustStrong}>You can’t buy XP, rank, or streaks.</Text>
                {'\n'}The Flame Pass unlocks looks and rewards — effort stays earned.
              </Text>
            </>
          )}

          <Pressable onPress={onRestore} hitSlop={10} accessibilityRole="button">
            <Text style={styles.restore}>Restore purchases</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Last in the tree so it sits over the hero's ambient layer without needing a zIndex. */}
      <Pressable style={styles.close} onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
        <Ionicons name="close" size={22} color={Colors.textTertiary} />
      </Pressable>
    </Screen>
  );
}

// ─────────────────────────────── the hero ───────────────────────────────

function Hero({ phase }: { phase: SeasonPhase }) {
  return (
    <View style={styles.hero}>
      <HeroEmbers />
      <Text style={styles.eyebrow}>THE FLAME PASS</Text>

      <View style={styles.heroFlame}>
        <HeroGlow />
        <RoaringFlame />
      </View>

      {/* Two Texts rather than one with a nested span: the second half takes the ember ramp's
          brightest stop, which is what carries the mock's gradient wordmark without a mask layer
          (no masked-view in this app — see PrimaryButton's note on why the gradient is SVG). */}
      <Text style={styles.heroTitle}>
        Own the <Text style={styles.heroTitleFire}>season.</Text>
      </Text>
      <Text style={styles.heroSub}>
        Unlock the premium track. Earn the skins, flares and crown nobody else can — and let the whole campus see it.
      </Text>

      <View style={styles.seasonChip}>
        <View style={styles.seasonDot} />
        <Text style={styles.seasonText}>
          Season {SEASON.id.replace('S', '')} · <Text style={styles.seasonName}>{SEASON.name}</Text> ·{' '}
          {seasonRemaining(phase)}
        </Text>
      </View>
    </View>
  );
}

/**
 * How long is left, in the unit the mock asks for.
 *
 * WEEKS, not days, and computed from the live season rather than typed in. Mock 200 reads "5 weeks
 * left", which was true on the day it was drawn and is a lie on every other day — the whole reason
 * SEASON.endsAt exists client-side is to render this without a round trip. Under a week it falls
 * back to days, because "0 weeks left" is worse than useless on the surface asking for money.
 */
function seasonRemaining(phase: SeasonPhase): string {
  const days = Math.ceil(msUntilSeasonBoundary() / 86_400_000);
  if (phase === 'upcoming') return `opens in ${days}d`;
  if (phase === 'closed') return 'closed';
  if (phase === 'claim-window') return `claim window · ${days}d left`;
  if (days <= 7) return days === 1 ? '1 day left' : `${days} days left`;
  const weeks = Math.round(days / 7);
  return weeks === 1 ? '1 week left' : `${weeks} weeks left`;
}

/** The mock's `.glow` — a soft radial behind the flame. SVG because a rounded View bands badly. */
function HeroGlow() {
  // Gradient ids are GLOBAL in react-native-svg: a hardcoded one blanks every instance after the
  // first on Android — which is what a second mount, while the first is still in the modal stack,
  // would be. Same reason FlameLogo, EmberIcon and Crown each carry a useId.
  const grad = `paywallGlow-${useId()}`;
  return (
    <View style={styles.glow} pointerEvents="none">
      <Svg width={150} height={130}>
        <Defs>
          <RadialGradient id={grad} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={Colors.coral} stopOpacity="0.6" />
            <Stop offset="0.66" stopColor={Colors.coral} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={75} cy={65} rx={75} ry={65} fill={`url(#${grad})`} />
      </Svg>
    </View>
  );
}

/** The mock's `flick` — a 1.15s squash-and-stretch on the brand mark, anchored at its base. */
function RoaringFlame() {
  const reduceMotion = useReduceMotion();
  const motionActive = useMotionActive();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || !motionActive) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 1150, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduceMotion, motionActive, t]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(t.value, [0, 1], [0, -2]) },
      { scaleY: interpolate(t.value, [0, 1], [1, 1.08]) },
      { scaleX: interpolate(t.value, [0, 1], [1, 0.94]) },
    ],
  }));

  return (
    <Animated.View style={style}>
      <FlameLogo size={84} />
    </Animated.View>
  );
}

/** Mock 200's `.amb` — embers rising through the hero only, not the whole screen. */
const HERO_EMBERS: { left: string; drift: number; delay: number }[] = [
  { left: '14%', drift: 10, delay: 0 },
  { left: '30%', drift: -8, delay: 800 },
  { left: '50%', drift: 6, delay: 1600 },
  { left: '68%', drift: -10, delay: 400 },
  { left: '84%', drift: 8, delay: 1200 },
  { left: '42%', drift: -6, delay: 2200 },
];

function HeroEmbers() {
  const reduceMotion = useReduceMotion();
  // Same contract as DriftingEmbers: unmount rather than freeze. A particle parked mid-air reads as
  // a rendering bug, and six worklets running behind a backgrounded modal are pure waste.
  const motionActive = useMotionActive();
  if (reduceMotion || !motionActive) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {HERO_EMBERS.map((e) => (
        <HeroEmber key={e.left + e.delay} {...e} />
      ))}
    </View>
  );
}

function HeroEmber({ left, drift, delay }: { left: string; drift: number; delay: number }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 3400, easing: Easing.out(Easing.quad) }), -1, false));
  }, [delay, t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.14, 1], [0, 0.9, 0]),
    transform: [
      { translateY: interpolate(t.value, [0, 1], [0, -230]) },
      { translateX: interpolate(t.value, [0, 1], [0, drift]) },
      { scale: interpolate(t.value, [0, 1], [1, 0.2]) },
    ],
  }));

  return <Animated.View style={[styles.heroEmber, { left: left as `${number}%` }, style]} />;
}

// ─────────────────────────── what you unlock ───────────────────────────

/**
 * The four showcase tiles, each pointing at a reward the Pass ACTUALLY grants.
 *
 * Deliberately not the mock's emoji. Mock 200 draws a 🪙 and a 👑 because an HTML artboard has no
 * access to the catalog; this app does, and the same `ItemArt` the shop, the track and the reveal
 * use is what makes a tile a promise rather than a picture. The crown is the real Level 100
 * capstone (`medal-emberfall-crown`), not an invented "Founder's badge" — a paywall that shows a
 * reward the track cannot pay out is a refund waiting to happen.
 */
const SHOWCASE: { itemId: string; label: string; sub: string; badge: string; aura?: boolean }[] = [
  { itemId: 'flame-forge', label: 'Flame skins', sub: 'Season-only colours', badge: 'LEVEL 0' },
  { itemId: 'flare-emberfall-ascendant', label: 'Flare auras', sub: 'Glow the whole screen', badge: 'MYTHIC', aura: true },
  { itemId: 'medal-emberfall-crown', label: 'The Emberfall Crown', sub: 'The Level 100 capstone', badge: 'APEX' },
];

function RewardShowcase() {
  // The stipend's amount comes off LEVEL_ZERO_UNLOCK, which is the same array grant_forge_pass pays
  // against — so if the Level 0 grant is ever retuned, this tile retunes with it instead of quietly
  // advertising the old number. (The mock says +500; the pass actually pays 1,000.)
  const stipend = useMemo(
    () => LEVEL_ZERO_UNLOCK.find((r): r is Extract<PassReward, { kind: 'embers' }> => r.kind === 'embers'),
    []
  );

  return (
    <View style={styles.rewards}>
      {SHOWCASE.map((tile) => {
        const item = getItem(tile.itemId);
        if (!item) return null;
        return (
          <View key={tile.itemId} style={styles.rw}>
            <Text style={styles.rwBadge}>{tile.badge}</Text>
            <View style={styles.rwArt}>
              {tile.aura ? (
                <View style={styles.aura}>
                  <ItemArt item={item} size={26} />
                </View>
              ) : (
                <ItemArt item={item} size={42} />
              )}
            </View>
            <Text style={styles.rwLabel}>{tile.label}</Text>
            <Text style={styles.rwSub}>{tile.sub}</Text>
          </View>
        );
      })}

      {stipend ? (
        <View style={styles.rw}>
          <Text style={styles.rwBadge}>+{formatEmbers(stipend.amount)}</Text>
          <View style={styles.rwArt}>
            <EmberIcon size={40} />
          </View>
          <Text style={styles.rwLabel}>Ember stipend</Text>
          <Text style={styles.rwSub}>Spend it on crates</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─────────────────────────── the season track ───────────────────────────

/**
 * The schematic: premium lane on top (locked), the level number, the free lane below.
 *
 * COPY RULE — THIS COUNTS IN LEVELS. Mock 200 says "100 tiers" and "You're on Tier 1", but `tier`
 * is reserved for the RANK ladder everywhere in this codebase (see forge-pass.ts's copy rule): the
 * two meaning different things in the same app was the single most confusing thing about the old
 * build. The mock's word loses to the rule.
 *
 * Rewards are read from PASS_LEVELS, the same table the track screen draws and claim_pass_level
 * pays against, so what the paywall shows locked is exactly what the purchase unlocks.
 */
function SeasonTrack({ level }: { level: number }) {
  // Level 0 means nothing has been climbed yet; the marker belongs on Level 1, which is what they
  // are about to climb, rather than on a column that does not exist.
  const here = Math.max(1, level);
  const apex = PASS_LEVELS[SEASON.totalLevels - 1];

  return (
    <View style={styles.trackBox}>
      <View style={styles.trackTop}>
        <Text style={styles.trackTitle}>The season track</Text>
        <Text style={styles.trackMeta}>{SEASON.totalLevels} levels · all semester</Text>
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.legendPremium]} />
          <Text style={styles.legendText}>Premium — Flame Pass</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.legendFree]} />
          <Text style={styles.legendText}>Free</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trackCols}>
        {TRACK_COLUMNS.map((n) => (
          <TrackColumn key={n} level={PASS_LEVELS[n - 1]} here={n === here} />
        ))}
        <View style={styles.trackCol}>
          <View style={[styles.node, styles.nodePremium, styles.nodeFaded]}>
            <Text style={styles.nodeEllipsis}>···</Text>
          </View>
          <Text style={styles.trackNum}>…</Text>
          <View style={[styles.node, styles.nodeFree, styles.nodeFaded]}>
            <Text style={styles.nodeEllipsis}>···</Text>
          </View>
        </View>
        <TrackColumn level={apex} here={here >= SEASON.totalLevels} />
      </ScrollView>

      <Text style={styles.hereTag}>
        ▲ You’re on Level {here} — climb it all semester
      </Text>
    </View>
  );
}

function TrackColumn({ level, here }: { level: (typeof PASS_LEVELS)[number]; here: boolean }) {
  return (
    <View style={styles.trackCol}>
      <View style={[styles.node, styles.nodePremium, here && styles.nodeHere]}>
        <TrackArt reward={level.premium[0]} size={20} />
        {/* The lock is the argument: every one of these is drawn, reachable, and not theirs yet. */}
        <View style={styles.lock}>
          <Ionicons name="lock-closed" size={8} color={Colors.onEmber} />
        </View>
      </View>
      <Text style={[styles.trackNum, here && styles.trackNumHere]}>{level.level}</Text>
      <View style={[styles.node, styles.nodeFree]}>
        <TrackArt reward={level.free[0]} size={17} />
      </View>
    </View>
  );
}

/** A reward at node size. Same switch as the track screen's RewardArt, minus the badge branch. */
function TrackArt({ reward, size }: { reward: PassReward | undefined; size: number }) {
  if (!reward) return null;
  switch (reward.kind) {
    case 'embers':
      return <EmberIcon size={size} />;
    case 'box':
      return <BoxArt boxKey={reward.box} size={size} />;
    case 'item': {
      const item = getItem(reward.itemId);
      return item ? <ItemArt item={item} size={size} /> : null;
    }
    case 'badge':
      return <Ionicons name="ribbon" size={size} color={Colors.ember} />;
  }
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: Spacing.five,
  },

  // ── hero ──
  hero: {
    alignItems: 'center',
    overflow: 'hidden',
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    paddingHorizontal: Spacing.four,
    // A warm wash over the app's own purple radial, so the top of the screen reads as firelight
    // without a second full-screen gradient layer fighting ScreenBackground for the ground.
    backgroundColor: 'rgba(58,30,24,0.55)',
  },
  heroEmber: {
    position: 'absolute',
    bottom: 0,
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.ember,
  },
  close: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 2,
    color: Colors.ember,
  },
  heroFlame: {
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.one,
  },
  // A COMPLETE RECT, not `bottom: 0` alone. An absolutely-positioned View with no opposing edges
  // sizes to its content and keeps its static-flow origin, so the 150pt glow would sit off to one
  // side of the flame rather than behind it. Pinning all four edges makes this box the flame's box,
  // and centring inside it puts the two centres on the same point by construction.
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 30,
    letterSpacing: -0.6,
    color: Colors.ink,
    textAlign: 'center',
  },
  heroTitleFire: {
    color: Colors.amber,
  },
  heroSub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.two,
    maxWidth: 300,
  },
  seasonChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.twelve,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.35)',
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: Spacing.twelve,
  },
  seasonDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.coral,
  },
  seasonText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10.5,
    color: Colors.ink,
  },
  seasonName: {
    color: Colors.ember,
    fontFamily: Fonts.bodyBold,
  },

  // ── body ──
  body: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.twelve,
  },
  sect: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    color: Colors.textTertiary,
  },

  // ── showcase tiles ──
  rewards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  rw: {
    // Two per row, with the 9pt gap taken out of each half.
    width: '48%',
    flexGrow: 1,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 14,
    paddingVertical: Spacing.twelve,
    paddingHorizontal: Spacing.twelve,
    gap: Spacing.two,
  },
  rwBadge: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    fontFamily: Fonts.bodyBold,
    fontSize: 7.5,
    letterSpacing: 0.4,
    color: Colors.ember,
    backgroundColor: 'rgba(242,163,60,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.4)',
    borderRadius: Radius.pill,
    paddingVertical: 1,
    paddingHorizontal: 5,
    overflow: 'hidden',
  },
  rwArt: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  aura: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.cardDark,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(242,163,60,0.5)',
    shadowColor: Colors.coral,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 6,
  },
  rwLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.ink,
  },
  rwSub: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: Colors.textTertiary,
  },

  // ── track schematic ──
  trackBox: {
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.18)',
    borderRadius: 15,
    padding: Spacing.twelve,
  },
  trackTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  trackTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  trackMeta: {
    fontFamily: Fonts.body,
    fontSize: 9,
    color: Colors.textTertiary,
  },
  legend: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginBottom: Spacing.twelve,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendSwatch: {
    width: 9,
    height: 9,
    borderRadius: 3,
  },
  legendPremium: {
    backgroundColor: Colors.amber,
  },
  legendFree: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.trackAlt,
  },
  legendText: {
    fontFamily: Fonts.body,
    fontSize: 8.5,
    color: Colors.textTertiary,
  },
  trackCols: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  trackCol: {
    alignItems: 'center',
    gap: 5,
  },
  node: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodePremium: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#4A2F1C',
    borderWidth: 1,
    borderColor: Colors.amber,
  },
  nodeFree: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: Colors.card,
  },
  nodeHere: {
    borderColor: Colors.ember,
    borderWidth: 2,
  },
  nodeFaded: {
    opacity: 0.45,
    borderStyle: 'dashed',
  },
  nodeEllipsis: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  lock: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: Colors.ember,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackNum: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    color: Colors.textTertiary,
  },
  trackNumHere: {
    color: Colors.ember,
  },
  hereTag: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.3,
    color: Colors.ember,
    textAlign: 'center',
    marginTop: 9,
  },

  // ── price + trust ──
  price: {
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  priceBig: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 30,
    letterSpacing: -1,
    color: Colors.ink,
  },
  pricePer: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.muted,
  },
  priceAlt: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 3,
  },
  trust: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    lineHeight: 15,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  trustStrong: {
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
  },
  restore: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.muted,
    textAlign: 'center',
    textDecorationLine: 'underline',
    paddingVertical: Spacing.two,
  },
});
