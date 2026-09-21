import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useId } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import { EarnSummary, PassLadder } from '@/components/pass/pass-ladder';
import { RisingEmbers, ShineSweep, SpinRays, useBreath, usePassMotion } from '@/components/pass/pass-motion';
import { ProfileFlex } from '@/components/pass/profile-flex';
import { SetShowcase, useEmberfallSet } from '@/components/pass/set-showcase';
import { FlameLogo } from '@/components/ui/flame-logo';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { useProductPrices, usePurchase } from '@/hooks/use-purchase';
import { useAuth } from '@/lib/auth/auth-context';
import { restorePurchases } from '@/lib/billing';
import { SEASON, levelFromXp, passOnSale, seasonPhase } from '@/lib/economy/forge-pass';
import { FORGE_PASS_PRODUCT_ID } from '@/lib/economy/iap';
import { getErrorMessage } from '@/lib/errors';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE FLAME PASS PAYWALL (design-mocks/200-flamepass-paywall-v2).
//
// A scroll over a full-screen rising-flares layer, in five beats: the hero ("Own {season}."), the
// user's own profile WITHOUT vs WITH the pass, the Emberfall set, the two-lane season pass, and
// the price. Sections live in components/pass/; this file owns the purchase wiring and the order.
//
// 🔴 COPY SAYS "FLAME PASS", CODE SAYS `forge_pass`. Every id on this screen — the product id, the
// entitlement, the route, the RPCs — is bound to the Play Console, App Store Connect and the
// RevenueCat dashboard. Renaming any of them to match the user-facing name is not a rename, it is a
// purchase that succeeds and grants nothing. See lib/economy/iap.ts.
//
// 🔴 NO HARDCODED PRICE. The big number is the store's own localized `priceString` (via
// useProductPrices), never a literal. An offering that hasn't loaded shows a dash and says the price
// is coming — it does not invent $8.99.
//
// 🔴 NOTHING HERE IS HAND-LISTED. The set is EMBERFALL_SET, the ladder and the earn summary read
// LEVEL_ZERO_UNLOCK / PASS_LEVELS, the season name is SEASON.name — so next season re-themes this
// screen by changing data, and a retuned track can't leave the pitch advertising the old one.
//
// 🔴 THE CLIENT GRANTS NOTHING. `buy()` ends at "the store charged them"; the entitlement and the
// embers are written by the RevenueCat webhook. That is why success routes to /purchase-success,
// which is honest about the timing, rather than this screen congratulating anyone itself.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export default function PaywallScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { pass, refetch } = useInventory();
  const prices = useProductPrices();
  // 'replace', not 'push': this modal's whole job was to take the money, and leaving it in the
  // stack means a back gesture off the receipt lands on "buy the Flame Pass" for a pass they own.
  const { buy, busy } = usePurchase({ navigate: 'replace' });
  const set = useEmberfallSet();

  const phase = seasonPhase();
  const onSale = passOnSale(phase, profile?.is_dev);
  const ownsPremium = pass?.owns_premium ?? false;
  const { level } = levelFromXp(pass?.pass_xp ?? 0);
  const price = prices[FORGE_PASS_PRODUCT_ID];

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
      {/* Behind everything and OUTSIDE the scroll, so the flares keep rising past the content as it
          scrolls — the mock's sticky ambient layer. */}
      <RisingEmbers count={12} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Hero />

        <View style={styles.body}>
          <SectionHeader title="Own your profile" sub="The status the whole campus sees" />
          <ProfileFlex />

          <SectionHeader
            title={`${set.length} items to be unlocked`}
            sub="See how each one flexes your profile · never re-issued"
          />
          <SetShowcase items={set} />

          <SectionHeader title="The season pass" sub={`Two lanes · ${SEASON.totalLevels} levels · all semester`} />
          <PassLadder level={level} />
          <EarnSummary />

          {/* ── Price · one-time, non-renewing ── */}
          <View style={styles.price}>
            <Text style={styles.priceBig}>{price ?? '—'}</Text>
            <Text style={styles.pricePer}>
              {price
                ? // NON-RENEWING, per the Phase 4 decision — FORGE_PASS_PRODUCT_ID is a non-renewing
                  // store product, so nothing here may promise a renewal.
                  '/ season · one-time, no subscription'
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
              <View>
                <PrimaryButton
                  label={onSale ? 'Buy Flame Pass 🔥' : phase === 'upcoming' ? 'Opens October 1' : 'Season closed'}
                  onPress={onBuy}
                  disabled={!onSale}
                  loading={busy}
                  pulse
                />
                {onSale && !busy ? (
                  <View style={styles.ctaShine} pointerEvents="none">
                    <ShineSweep period={2000} opacity={0.55} />
                  </View>
                ) : null}
              </View>
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

/** Centred orange section header with a small grey line under it (mock 200-v2's `.sect`). */
function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={styles.sect}>
      <Text style={styles.sectTitle}>{title.toUpperCase()}</Text>
      <Text style={styles.sectSub}>{sub}</Text>
    </View>
  );
}

// ─────────────────────────────── the hero ───────────────────────────────

function Hero() {
  const seasonNumber = SEASON.id.replace('S', '');
  return (
    <View style={styles.hero}>
      <View style={styles.crest}>
        <Text style={styles.crestText}>
          <Text style={styles.crestDiamond}>◆</Text> Season {seasonNumber} · {SEASON.name}{' '}
          <Text style={styles.crestDiamond}>◆</Text>
        </Text>
        <ShineSweep period={2800} opacity={0.7} />
      </View>

      <View style={styles.heroFlame}>
        <View style={styles.centred} pointerEvents="none">
          <SpinRays size={210} period={14000} opacity={0.5} />
        </View>
        <HeroGlow />
        <RoaringFlame />
      </View>

      {/* Two Texts rather than one with a gradient mask: the season name takes the ember ramp's
          brightest stop (no masked-view in this app — see PrimaryButton on why gradients are SVG). */}
      <Text style={styles.heroTitle}>
        Own <Text style={styles.heroTitleFire}>{SEASON.name}.</Text>
      </Text>
      <Text style={styles.heroSub}>A look nobody else can earn — worn where the whole campus sees it.</Text>
    </View>
  );
}

/** The mock's `.glow` — a soft coral radial behind the flame, breathing. */
function HeroGlow() {
  // Gradient ids are GLOBAL in react-native-svg: a hardcoded one blanks every instance after the
  // first on Android. Same reason FlameLogo, EmberIcon and Crown each carry a useId.
  const grad = `paywallGlow-${useId()}`;
  const breath = useBreath(1500, 0.6);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(breath.value, [0, 1], [0.65, 1]),
    transform: [{ scale: interpolate(breath.value, [0, 1], [1, 1.16]) }],
  }));
  return (
    <Animated.View style={[styles.centred, style]} pointerEvents="none">
      <Svg width={170} height={130}>
        <Defs>
          <RadialGradient id={grad} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={Colors.coral} stopOpacity="0.75" />
            <Stop offset="0.66" stopColor={Colors.coral} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={85} cy={72} rx={85} ry={58} fill={`url(#${grad})`} />
      </Svg>
    </Animated.View>
  );
}

/** The mock's `flick` — a squash-and-stretch on the brand mark, anchored at its base. */
function RoaringFlame() {
  const run = usePassMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!run) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 1050, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [run, t]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(t.value, [0, 1], [0, -3]) },
      { scaleY: interpolate(t.value, [0, 1], [1, 1.1]) },
      { scaleX: interpolate(t.value, [0, 1], [1, 0.92]) },
    ],
  }));

  return (
    <Animated.View style={style}>
      <FlameLogo size={84} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: Spacing.five,
  },

  // ── hero ──
  hero: {
    alignItems: 'center',
    overflow: 'hidden',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    paddingHorizontal: Spacing.four,
    // A warm wash over the app's own purple ground, so the top reads as firelight without a second
    // full-screen gradient fighting ScreenBackground.
    backgroundColor: 'rgba(90,42,24,0.45)',
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
  crest: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.5)',
    backgroundColor: 'rgba(0,0,0,0.34)',
    paddingVertical: 5,
    paddingHorizontal: 13,
  },
  crestText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 2.4,
    color: Colors.ember,
    textTransform: 'uppercase',
  },
  crestDiamond: {
    color: Colors.coral,
  },
  heroFlame: {
    height: 118,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  // A COMPLETE RECT, so centring inside it puts the rays' and the glow's centres on the flame's.
  centred: {
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
    fontSize: 36,
    letterSpacing: -1.2,
    lineHeight: 38,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 2,
  },
  heroTitleFire: {
    color: Colors.amber,
  },
  heroSub: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    lineHeight: 18,
    color: '#D6C8E8',
    textAlign: 'center',
    marginTop: Spacing.two,
    maxWidth: 300,
  },

  // ── body ──
  body: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.twelve,
  },
  sect: {
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  sectTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 0.5,
    color: Colors.amber,
    textAlign: 'center',
  },
  sectSub: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 9.5,
    color: '#8a7fa6',
    marginTop: 3,
    textAlign: 'center',
  },

  // ── price + trust ──
  price: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: Spacing.three,
  },
  priceBig: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 30,
    letterSpacing: -1,
    color: Colors.ink,
  },
  pricePer: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.muted,
  },
  ctaShine: {
    ...StyleSheet.absoluteFill,
    borderRadius: Radius.button,
    overflow: 'hidden',
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
