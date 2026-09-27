import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useId } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { EMBER, EmberTag, EmberfallSky, FallingEmbers, FlashText, GreekKeyDivider, HadesConstellation } from '@/components/pass/emberfall-art';
import { EmberfallGallery, trackHighlights } from '@/components/pass/emberfall-gallery';
import { ShineSweep } from '@/components/pass/pass-motion';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { useProductPrices, usePurchase } from '@/hooks/use-purchase';
import { useAuth } from '@/lib/auth/auth-context';
import { restorePurchases } from '@/lib/billing';
import { SEASON, levelFromXp, passOnSale, seasonPhase } from '@/lib/economy/forge-pass';
import { FORGE_PASS_PRODUCT_ID } from '@/lib/economy/iap';
import { getErrorMessage } from '@/lib/errors';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE FLAME PASS PAYWALL — "Own Emberfall" (design-mocks/223, lore from LORE_EMBERFALL.md).
//
// One gradient sky the full height of the screen (void → deep blue → purple → ember → orange), the
// season's embers FALLING across all of it, Hades' constellation burning over the headline. Top to
// bottom: the tag and "Own Emberfall", the constellation, the tale in two beats, the price, a
// Greek-key divider, the season's cosmetics (laurel-framed, rendered on YOU), and a sticky CTA.
//
// 🔴 COPY SAYS "FLAME PASS", CODE SAYS `forge_pass`. Every id on this screen — the product id, the
// entitlement, the route, the RPCs — is bound to the Play Console, App Store Connect and the
// RevenueCat dashboard. Renaming any of them to match the user-facing name is not a rename, it is a
// purchase that succeeds and grants nothing. See lib/economy/iap.ts.
//
// 🔴 NO HARDCODED PRICE. Both price lines are the store's own localized `priceString` (via
// useProductPrices), never a literal. An offering that hasn't loaded shows a dash — it does not
// invent $8.99. The mock's "≈ $2.25/mo" is not reproduced: dividing a localized string is how an
// app ends up quoting a per-month figure the store never charged.
//
// 🔴 NOTHING HERE IS HAND-LISTED. The gallery reads names, lore and rarities from catalog.ts and
// unlock levels from the pass track (emberfall-gallery.tsx); the chip row reads the premium lane;
// the season name is SEASON.name.
//
// 🔴 THE CLIENT GRANTS NOTHING. `buy()` ends at "the store charged them"; the entitlement and the
// embers are written by the RevenueCat webhook. That is why success routes to /purchase-success,
// which is honest about the timing, rather than this screen congratulating anyone itself.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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
  const firstName = profile?.display_name?.trim().split(/\s+/)[0] || 'You';
  const seasonNumber = SEASON.id.replace('S', '');

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

  // Reached from the tutorial by `replace`, there may be nothing underneath to go back to.
  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  const chips = trackHighlights();

  return (
    <Screen padded={false} backgroundColor="#040309" edges={[]}>
      {/* Behind everything and OUTSIDE the scroll: the sky and the rain hold still while the pitch
          scrolls over them, so the embers keep falling past the content — the mock's full-height
          ambient layer. */}
      <EmberfallSky kind="paywall" />
      <FallingEmbers count={16} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + Spacing.four, paddingBottom: CTA_H + insets.bottom + Spacing.four }]}
        showsVerticalScrollIndicator={false}>
        {/* ── 1 · the tag and the headline ── */}
        <View style={styles.tophead}>
          <EmberTag>
            Flame Pass · Season {seasonNumber}
          </EmberTag>
          <View style={styles.ownRow}>
            <Text style={styles.own}>Own </Text>
            <FlashText style={styles.own}>{SEASON.name}</FlashText>
          </View>
        </View>

        {/* ── 2 · Hades, in stars ── */}
        <View style={styles.hero}>
          <HadesConstellation width={width} height={(width * 212) / 394} />
        </View>

        {/* ── 3 · the tale, in two beats ── */}
        <Text style={styles.hook}>
          Hades escaped from the underworld and unleashed Hellfire onto Earth. This semester, every ember of that
          fire can <Text style={styles.hi}>raise you or ruin you</Text>.
        </Text>
        <Text style={[styles.hook, styles.hookGap]}>
          Harness the fire with your fellow students and earn shards of Hades&apos; power as{' '}
          <Text style={styles.hi}>exclusive, permanent rewards</Text> — all for less than a cup of coffee. ☕
        </Text>

        {/* ── 4 · the price ── */}
        <View style={styles.priceLead}>
          <Text style={styles.priceBig}>{price ?? '—'}</Text>
          <Text style={styles.priceSub}>{price ? '/ semester' : 'Pricing is loading from the store…'}</Text>
        </View>

        {/* ── 5 · the season's cosmetics ── */}
        <View style={styles.body}>
          <GreekKeyDivider />
          <Text style={styles.galleryHead}>THE SEASON&apos;S COSMETICS</Text>
          <Text style={styles.seclead}>One lands the moment you buy — the rest you forge by climbing.</Text>
          <EmberfallGallery name={firstName} />

          <Text style={styles.sec}>ACROSS THE {SEASON.totalLevels}-LEVEL TRACK</Text>
          <Text style={styles.seclead}>Every level drops something — more looks, and embers each rung. A few of what&apos;s waiting:</Text>
          <View style={styles.chips}>
            {chips.map((c) => (
              <Text key={c} style={styles.chip}>
                ◆ {c}
              </Text>
            ))}
            <Text style={styles.chip}>🔥 embers each level</Text>
            <Text style={styles.chip}>+ more</Text>
          </View>

          <Text style={styles.trust}>
            <Text style={styles.trustStrong}>You can’t buy XP, rank, or streaks.</Text>
            {'\n'}The Flame Pass unlocks looks and rewards — effort stays earned.
          </Text>
        </View>
      </ScrollView>

      {/* ── 6 · the sticky CTA ── */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + Spacing.three }]}>
        <CtaScrim />
        {ownsPremium ? (
          // Already paid. Selling it again is the fastest way to make someone think the first
          // purchase failed, so the CTA becomes the way into what they bought.
          <>
            <Text style={styles.ctaNote}>
              <Text style={styles.ctaNoteStrong}>You own {SEASON.name}.</Text> Every premium reward up to Level {level} is
              waiting.
            </Text>
            <PrimaryButton label="Open the track 🔥" onPress={() => router.replace('/forge-pass')} />
          </>
        ) : (
          <>
            <View style={styles.priceRow}>
              <Text style={styles.ctaPrice}>{price ?? '—'}</Text>
              {/* NON-RENEWING, per the Phase 4 decision — FORGE_PASS_PRODUCT_ID is a non-renewing
                  store product, so nothing here may promise a renewal. */}
              <Text style={styles.ctaPer}>· whole semester · one-time · no subscription</Text>
            </View>
            <View>
              <PrimaryButton
                label={onSale ? `Own ${SEASON.name} 🔥` : phase === 'upcoming' ? 'Opens October 1' : 'Season closed'}
                onPress={onBuy}
                disabled={!onSale}
                loading={busy}
                pulse
              />
              {onSale && !busy ? (
                <View style={styles.ctaShine} pointerEvents="none">
                  <ShineSweep period={3400} opacity={0.6} />
                </View>
              ) : null}
            </View>
          </>
        )}
        <Pressable onPress={onRestore} hitSlop={10} accessibilityRole="button">
          <Text style={styles.restore}>Restore purchase</Text>
        </Pressable>
      </View>

      {/* Last in the tree so it sits over the sky and the rain without needing a zIndex. */}
      <Pressable style={[styles.close, { top: insets.top + Spacing.two }]} onPress={close} hitSlop={12} accessibilityLabel="Close">
        <Ionicons name="close" size={18} color={EMBER.warm} />
      </Pressable>
    </Screen>
  );
}

/** The mock's CTA fade: clear at the top, deep ember-brown at the foot, so the buttons read over
 *  the brightest band of the sky. */
function CtaScrim() {
  // Gradient ids are GLOBAL in react-native-svg — every SVG primitive in this app carries a useId.
  const grad = `paywallScrim-${useId()}`;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#140804" stopOpacity={0} />
            <Stop offset="0.4" stopColor="#140804" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#140804" stopOpacity={0.85} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${grad})`} />
      </Svg>
    </View>
  );
}

/** Room the sticky CTA takes, so the last card scrolls clear of it. */
const CTA_H = 170;

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 0,
  },
  close: {
    position: 'absolute',
    right: 15,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── headline ──
  tophead: {
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  ownRow: {
    flexDirection: 'row',
    // Centre, not baseline: FlashText is a View, and a View has no baseline to align — the two
    // halves share a font, size and line height, so centring lands them on the same line.
    alignItems: 'center',
    marginTop: 9,
  },
  own: {
    fontFamily: Fonts.black,
    fontSize: 35,
    lineHeight: 40,
    letterSpacing: -0.7,
    color: EMBER.ink,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 24,
  },
  hero: {
    marginTop: 4,
    marginBottom: -4,
  },

  // ── the tale ──
  hook: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 12.5,
    lineHeight: 20,
    color: EMBER.warm,
    textAlign: 'center',
    paddingHorizontal: 22,
  },
  hookGap: {
    marginTop: 10,
  },
  hi: {
    fontFamily: Fonts.bodyBold,
    fontStyle: 'italic',
    color: EMBER.e2,
  },

  // ── price ──
  priceLead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  priceBig: {
    fontFamily: Fonts.black,
    fontSize: 32,
    color: EMBER.e2,
  },
  priceSub: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: EMBER.warm2,
  },

  // ── gallery ──
  body: {
    paddingHorizontal: 15,
    marginTop: 20,
  },
  galleryHead: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.6,
    color: EMBER.e2,
    textAlign: 'center',
    marginTop: 14,
  },
  sec: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.6,
    color: EMBER.warm,
    marginTop: 22,
    marginHorizontal: 4,
  },
  seclead: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16.5,
    color: EMBER.warm2,
    marginTop: 6,
    marginBottom: 14,
    marginHorizontal: 4,
    textAlign: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginHorizontal: 4,
    marginTop: -4,
  },
  chip: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: EMBER.warm,
    backgroundColor: 'rgba(22,14,34,0.75)',
    borderWidth: 1,
    borderColor: EMBER.line,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  trust: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: EMBER.warm2,
    textAlign: 'center',
    marginTop: Spacing.four,
  },
  trustStrong: {
    fontFamily: Fonts.bodyBold,
    color: EMBER.warm,
  },

  // ── sticky CTA ──
  cta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    paddingHorizontal: 18,
    gap: 10,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  ctaPrice: {
    fontFamily: Fonts.black,
    fontSize: 23,
    color: '#FFFFFF',
  },
  ctaPer: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: EMBER.warm2,
  },
  ctaNote: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: EMBER.warm2,
    textAlign: 'center',
  },
  ctaNoteStrong: {
    fontFamily: Fonts.bodyBold,
    color: EMBER.e2,
  },
  ctaShine: {
    ...StyleSheet.absoluteFill,
    borderRadius: Radius.button,
    overflow: 'hidden',
  },
  restore: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: EMBER.warm2,
    textAlign: 'center',
    paddingVertical: 2,
  },
});
