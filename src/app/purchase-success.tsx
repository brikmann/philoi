import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BurningName } from '@/components/burning-name';
import { EmberIcon } from '@/components/economy/ember-icon';
import { formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { EMBER, EmberfallSeal, EmberfallSky, FallingEmbers } from '@/components/pass/emberfall-art';
import { ShineSweep } from '@/components/pass/pass-motion';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useAuth } from '@/lib/auth/auth-context';
import { getItem } from '@/lib/economy/catalog';
import { LEVEL_ZERO_UNLOCK, SEASON, type PassReward } from '@/lib/economy/forge-pass';
import { emberPackForProduct, isForgePassProduct } from '@/lib/economy/iap';
import { RARITY_LABEL } from '@/lib/economy/rarity';
import { fireReveal } from '@/lib/reward-feedback';

// What you see the moment a real-money purchase clears (#71). The Flame Pass gets the Emberfall
// reveal (design-mocks/225): the Seal, "The fire is yours.", YOUR NAME CATCHING FIRE, and the
// instant unlock. An ember pack gets none of the cinematic — a full-screen reveal for a currency
// top-up would spend the biggest moment in the app on the smallest purchase.
//
// 🔴 THE PART THAT IS NOT DECORATION, AND MUST NOT BE REGRESSED. The grant is ASYNCHRONOUS: the store
// charged them on the device; the embers and the entitlement are written by the RevenueCat webhook a
// beat later. So this renders the expected contents immediately and refetches inventory underneath,
// rather than blocking on a spinner. The unlock row carries its own stamp, reading "LANDING…" until
// the inventory actually shows the Pass — only then does it flip to "⚡ NEW". The fire is layered ON
// TOP of that; it never gates it, and it never claims a grant it hasn't seen.
//
// The burning name here is a PREVIEW by design ("Your name, for this semester") — it is the thing
// they just bought, shown to them first. Everywhere else it burns only once the server says so.
//
// THE SEQUENCE (mock 225), all one-shot off `intro`:
//   0.00s  the Seal pops and starts to turn
//   0.35s  tag · headline · subline rise, staggered
//   0.90s  the name box rises; 1.05s the name IGNITES, grey → fire, over a second
//   1.40s  the instant unlock slides in
//   1.60s  "Start climbing"
//
// The unlock row is LEVEL_ZERO_UNLOCK — the same array grant_forge_pass pays — so this screen cannot
// announce a receipt the grant doesn't hand over. Reached with ?product=<store product id>.

/** The whole one-shot intro, in ms. Every entrance below is a slice of this one clock. */
const INTRO_MS = 2200;
const at = (ms: number) => ms / INTRO_MS;

/** How the webhook's landing is watched: poll inventory this often, this many times. */
const POLL_MS = 2500;
const POLL_TRIES = 6;

export default function PurchaseSuccessScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { product } = useLocalSearchParams<{ product?: string }>();
  const { profile } = useAuth();
  const { pass, refetch } = useInventory();
  const [settled, setSettled] = useState(false);
  const reduceMotion = useReduceMotion();

  const productId = product ?? '';
  const isPass = isForgePassProduct(productId);
  const pack = emberPackForProduct(productId);
  const displayName = profile?.display_name?.trim() || 'You';
  // The grant is confirmed only when OUR inventory says so — not when the store did.
  const confirmed = isPass && Boolean(pass?.owns_premium);

  // One clock for the entire entrance. Separate timings per element would drift on a slow first
  // frame, and this is the one screen where the order of the beats IS the effect.
  const intro = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      intro.value = 1;
      return;
    }
    intro.value = withTiming(1, { duration: INTRO_MS, easing: Easing.linear });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one play per mount
  }, []);

  useEffect(() => {
    // The Legendary sting for the flare — the Pass's day-one unlock gets the same audio a box reveal
    // gives one. Not Mythic: since 0219 the pass's only mythics are its L90/L100 capstones, and the
    // purchase shouldn't sound like one. Ember packs get nothing: a currency top-up isn't a pull.
    if (isPass) fireReveal('legendary', false);
  }, [isPass]);

  // Watch for the webhook. It usually lands within a second or two, so a single immediate refetch
  // would almost always miss it; this polls until the Pass shows (or gives up after ~15s, at which
  // point the settle line says what to do). `settled` flips after the first beat either way.
  useEffect(() => {
    if (confirmed) return;
    let tries = 0;
    void refetch();
    const id = setInterval(() => {
      tries += 1;
      setSettled(true);
      void refetch();
      if (tries >= POLL_TRIES) clearInterval(id);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refetch, confirmed]);

  function done() {
    // "Done" goes back to wherever the purchase started. The paywall REPLACED itself with this
    // screen, so one step back is the screen the user opened the paywall from.
    if (router.canGoBack()) router.back();
    else router.replace('/shop');
  }

  if (!isPass) {
    return (
      <Screen padded={false}>
        <ScrollView contentContainerStyle={styles.packContent} showsVerticalScrollIndicator={false}>
          {pack ? (
            <>
              <Text style={styles.packKicker}>EMBERS ADDED</Text>
              <View style={styles.emberHero}>
                <EmberIcon size={54} />
                <Text style={styles.emberAmount}>{formatEmbers(pack.embers)}</Text>
              </View>
              <Text style={styles.packTitle}>{pack.name}</Text>
              {pack.bonus > 0 ? (
                <Text style={styles.bonusLine}>
                  {formatEmbers(pack.base)} + {formatEmbers(pack.bonus)} bonus
                </Text>
              ) : null}
              <Text style={styles.packSub}>
                Spend them on boxes or buy a cosmetic outright. Embers never buy XP, rank, or a place on any
                leaderboard.
              </Text>
              {/* The ember path has no confirmation signal to watch (a balance delta can't be told
                  apart from a lock-in payout), so it keeps the plain honest line. */}
              <Text style={styles.packSettle}>
                {settled
                  ? 'If they’re not in your balance yet, reopen the app — the store receipt is on file and will reconcile.'
                  : 'Landing in your balance…'}
              </Text>
            </>
          ) : (
            // An id neither branch recognises. Rare (the store sold something this build has no row
            // for), and deliberately quiet: no claim about what landed, because nothing here knows.
            <>
              <Text style={styles.packTitle}>Purchase complete</Text>
              <Text style={styles.packSub}>Your reward is on its way to your inventory.</Text>
            </>
          )}

          <View style={styles.packFooter}>
            <PrimaryButton label="Done" onPress={done} />
            <Pressable onPress={() => router.replace('/inventory')} hitSlop={8} accessibilityRole="button">
              <Text style={styles.secondary}>View inventory</Text>
            </Pressable>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  const [instant, ...alsoLanded] = LEVEL_ZERO_UNLOCK;

  return (
    <Screen padded={false} backgroundColor="#050308" edges={[]}>
      <EmberfallSky kind="success" />
      <FallingEmbers count={8} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.five, paddingBottom: insets.bottom + 150 }]}
        showsVerticalScrollIndicator={false}>
        <SealPop intro={intro} />

        <RiseIn intro={intro} from={at(350)}>
          <Text style={styles.tag}>FLAME PASS · {SEASON.name.toUpperCase()}</Text>
        </RiseIn>
        <RiseIn intro={intro} from={at(500)}>
          <Text style={styles.h1}>The fire is yours.</Text>
        </RiseIn>
        <RiseIn intro={intro} from={at(650)}>
          <Text style={styles.sub}>You&apos;ve joined the climb. Now your name burns wherever the campus can see it.</Text>
        </RiseIn>

        <RiseIn intro={intro} from={at(900)}>
          <View style={styles.burnBox}>
            <Text style={styles.burnCap}>YOUR NAME, FOR THIS SEMESTER</Text>
            <IgniteName intro={intro} name={displayName} />
          </View>
        </RiseIn>

        <RiseIn intro={intro} from={at(1400)}>
          <UnlockedRow reward={instant} confirmed={confirmed} />
          {alsoLanded.length > 0 ? (
            <Text style={styles.also}>+ {alsoLanded.map(rewardName).filter(Boolean).join(' · ')}</Text>
          ) : null}
        </RiseIn>

        {/* 🔴 THE HONEST LINE, only when it's needed: the webhook hasn't shown after the first beat.
            In the happy path the stamp above carries the truth and this never appears. */}
        {settled && !confirmed ? (
          <Text style={styles.settle}>
            Still landing. If anything is missing, reopen the app — the store receipt is on file and will reconcile.
          </Text>
        ) : null}
      </ScrollView>

      <RiseIn intro={intro} from={at(1600)} style={[styles.cta, { paddingBottom: insets.bottom + Spacing.four }]}>
        <View style={styles.ctaWrap}>
          <PrimaryButton label="Start climbing 🔥" onPress={() => router.replace('/forge-pass')} />
          <View style={styles.ctaShine} pointerEvents="none">
            <ShineSweep period={2600} opacity={0.45} />
          </View>
        </View>
        <Pressable onPress={() => router.replace('/inventory')} hitSlop={8} accessibilityRole="button">
          <Text style={styles.secondary}>View inventory</Text>
        </Pressable>
      </RiseIn>
    </Screen>
  );
}

// ─────────────────────────── the entrance ───────────────────────────

/** The mock's `up`: 16pt rise + fade over 0.5s, starting at `from` on the intro clock. */
function RiseIn({
  intro,
  from,
  children,
  style,
}: {
  intro: { value: number };
  from: number;
  children: React.ReactNode;
  style?: object;
}) {
  const span = at(500);
  const animated = useAnimatedStyle(() => ({
    opacity: interpolate(intro.value, [from, from + span], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(intro.value, [from, from + span], [16, 0], 'clamp') }],
  }));
  return <Animated.View style={[styles.riseIn, style, animated]}>{children}</Animated.View>;
}

/** The mock's `pop`: .4 → 1.08 → 1 over 0.7s. The Seal's own spin runs underneath. */
function SealPop({ intro }: { intro: { value: number } }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(intro.value, [0, at(350)], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(intro.value, [0, at(490), at(700)], [0.4, 1.08, 1], 'clamp') }],
  }));
  return (
    <Animated.View style={[styles.seal, style]}>
      <EmberfallSeal size={96} />
    </Animated.View>
  );
}

/**
 * The name catching fire: a grey, dim copy of the name sits over the burning one and fades out while
 * the fire fades up underneath it (the mock's `ignite`, 1.05s → 2.05s).
 */
function IgniteName({ intro, name }: { intro: { value: number }; name: string }) {
  const from = at(1050);
  const to = Math.min(1, at(2050));
  const fire = useAnimatedStyle(() => ({ opacity: interpolate(intro.value, [from, to], [0.35, 1], 'clamp') }));
  const ash = useAnimatedStyle(() => ({ opacity: interpolate(intro.value, [from, to], [1, 0], 'clamp') }));
  return (
    <View>
      <Animated.View style={fire}>
        <BurningName owns style={styles.burnName} hero>
          {name}
        </BurningName>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, ash]} pointerEvents="none">
        <Text style={[styles.burnName, styles.ashName]} numberOfLines={1}>
          {name}
        </Text>
      </Animated.View>
    </View>
  );
}

function rewardName(reward: PassReward): string {
  if (reward.kind === 'embers') return `${formatEmbers(reward.amount)} embers`;
  if (reward.kind !== 'item') return '';
  return getItem(reward.itemId)?.name.replace(/^"|"$/g, '') ?? '';
}

/** The instant unlock (LEVEL_ZERO_UNLOCK[0]) with its honest stamp. */
function UnlockedRow({ reward, confirmed }: { reward: PassReward | undefined; confirmed: boolean }) {
  if (!reward || reward.kind !== 'item') return null;
  const item = getItem(reward.itemId);
  if (!item) return null;
  const typeWord = item.type.charAt(0) + item.type.slice(1).toLowerCase();
  return (
    <View style={styles.unlocked}>
      <View style={[styles.swatch, { borderColor: `${item.art.to}99`, shadowColor: item.art.from }]}>
        <ItemArt item={item} size={26} />
      </View>
      <View style={styles.unlockedText}>
        <Text style={styles.unlockedName}>{item.name}</Text>
        <Text style={styles.unlockedSub}>
          Unlocked instantly · {RARITY_LABEL[item.rarity]} {typeWord}
        </Text>
      </View>
      <View style={[styles.badge, !confirmed && styles.badgePending]}>
        <Text style={[styles.badgeText, !confirmed && styles.badgeTextPending]}>{confirmed ? '⚡ NEW' : 'LANDING…'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 26,
    alignItems: 'center',
  },
  riseIn: {
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  seal: {
    marginBottom: 22,
  },

  // ── copy ──
  tag: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 2.3,
    color: EMBER.e2,
    marginBottom: 8,
  },
  h1: {
    fontFamily: Fonts.black,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.6,
    color: EMBER.ink,
    textAlign: 'center',
    marginBottom: 8,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 21,
    color: EMBER.dim,
    textAlign: 'center',
    maxWidth: 290,
    marginBottom: 26,
  },

  // ── the burning name ──
  burnBox: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,160,70,0.4)',
    backgroundColor: 'rgba(10,6,16,0.35)',
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 22,
    marginBottom: 26,
    maxWidth: '100%',
  },
  burnCap: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.3,
    color: EMBER.e2,
    marginBottom: 14,
  },
  burnName: {
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  ashName: {
    fontFamily: Fonts.black,
    color: '#6e6478',
  },

  // ── the instant unlock ──
  unlocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    alignSelf: 'stretch',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: EMBER.line,
    backgroundColor: 'rgba(10,6,16,0.35)',
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: EMBER.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  unlockedText: {
    flex: 1,
    minWidth: 0,
  },
  unlockedName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: EMBER.ink,
  },
  unlockedSub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: EMBER.dim,
    marginTop: 1,
  },
  badge: {
    borderRadius: 999,
    backgroundColor: EMBER.e2,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  badgePending: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  badgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 8,
    letterSpacing: 0.4,
    color: '#160a02',
  },
  badgeTextPending: {
    color: Colors.textTertiary,
  },
  also: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: EMBER.warm2,
    textAlign: 'center',
    marginTop: 10,
  },
  settle: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    lineHeight: 15,
    color: EMBER.warm2,
    textAlign: 'center',
    marginTop: Spacing.three,
    maxWidth: 290,
  },

  // ── CTA ──
  cta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 26,
    paddingTop: 18,
  },
  ctaWrap: {
    alignSelf: 'stretch',
  },
  ctaShine: {
    ...StyleSheet.absoluteFill,
    borderRadius: Radius.button,
    overflow: 'hidden',
  },
  secondary: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: EMBER.dim,
    textDecorationLine: 'underline',
    marginTop: Spacing.twelve,
    paddingVertical: Spacing.one,
  },

  // ── ember pack ──
  packContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.five + Spacing.two,
    paddingBottom: Spacing.four,
    alignItems: 'center',
  },
  packKicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 3,
    color: Colors.ember,
    marginTop: Spacing.twelve,
  },
  packTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: -0.6,
    color: Colors.ink,
    marginTop: Spacing.two,
    textAlign: 'center',
    maxWidth: 280,
  },
  packSub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: '#B8ABCF',
    textAlign: 'center',
    marginTop: Spacing.two,
    maxWidth: 280,
  },
  packSettle: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    lineHeight: 15,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.three,
    maxWidth: 290,
  },
  packFooter: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: Spacing.four,
  },
  emberHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  emberAmount: {
    fontFamily: Fonts.bodyBold,
    fontSize: 44,
    color: Colors.ember,
  },
  bonusLine: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.achieverText,
    marginTop: Spacing.one,
  },
});
