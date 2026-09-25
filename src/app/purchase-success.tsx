import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useId, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { EmberIcon } from '@/components/economy/ember-icon';
import { formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { RewardRays } from '@/components/economy/reward-reveal';
import { RisingEmbers, ShineSweep, usePassMotion } from '@/components/pass/pass-motion';
import { FlameLogo } from '@/components/ui/flame-logo';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useAuth } from '@/lib/auth/auth-context';
import { getItem, type ItemType } from '@/lib/economy/catalog';
import { LEVEL_ZERO_UNLOCK, SEASON, type PassReward } from '@/lib/economy/forge-pass';
import { emberPackForProduct, isForgePassProduct } from '@/lib/economy/iap';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/economy/rarity';
import { fireReveal } from '@/lib/reward-feedback';

// What you see the moment a real-money purchase clears (#71), in the cinematic cut (mock 201-v2).
//
// 🔴 THE PART THAT IS NOT DECORATION, AND MUST NOT BE REGRESSED. The grant is ASYNCHRONOUS: the store
// charged them on the device; the embers and the entitlement are written by the RevenueCat webhook a
// beat later. So this renders the expected contents immediately and refetches inventory underneath,
// rather than blocking on a spinner. What changed in v2 is where the honesty lives: each reward card
// carries its own stamp, and it reads "LANDING…" until the inventory actually shows the Pass — only
// then does it flip to "✓ UNLOCKED". The fire is layered ON TOP of that; it never gates it, and it
// never claims a grant it hasn't seen.
//
// THE SEQUENCE (mock 201-v2), all one-shot off `intro`:
//   0.00s  screen shake + white pop → fiery bloom, twice
//   0.00s  the flame bursts in; rays and halo bloom from ITS centre, not the screen's
//   0.40s  kicker / headline / subline rise in
//   0.62s  the three reward cards pop in, staggered 120ms
//   ambient, forever: rising flares across the screen and a layered firewall along the bottom
//
// The reward cards are LEVEL_ZERO_UNLOCK — the same array grant_forge_pass pays — so this screen
// cannot announce a receipt the grant doesn't hand over. Reached with ?product=<store product id>.
// An ember pack gets NONE of the cinematic: a full-screen fire blast for a currency top-up would
// spend the biggest moment in the app on the smallest purchase.

/** The whole one-shot intro, in ms. Every entrance below is a slice of this one clock. */
const INTRO_MS = 2100;

/** The flame's box inside the scrolling column. */
const FLAME_BOX_H = 150;

/** Top padding of the column — the flame sits this far down the stage. */
const TOP_PAD = Spacing.five + Spacing.two;

/**
 * Where the flame's centre sits, measured down from the top of the stage.
 *
 * 🔴 WHY THE LIGHT IS NOT A CHILD OF THE FLAME. The fan is wider than the screen diagonal, and a
 * child that large inside a 150pt box nested in a ScrollView is at the mercy of Android's child
 * clipping. So the light layer is a SIBLING of the ScrollView, pinned to the stage, and centred on
 * this offset: the column's top padding plus half the flame's box. Exact at mount, which is the
 * only moment the burst plays.
 */
const FLAME_CENTER_Y = TOP_PAD + FLAME_BOX_H / 2;

/** How the webhook's landing is watched: poll inventory this often, this many times. */
const POLL_MS = 2500;
const POLL_TRIES = 6;

export default function PurchaseSuccessScreen() {
  const router = useRouter();
  const { product } = useLocalSearchParams<{ product?: string }>();
  const { profile } = useAuth();
  const { pass, refetch } = useInventory();
  const [settled, setSettled] = useState(false);
  const reduceMotion = useReduceMotion();

  const productId = product ?? '';
  const isPass = isForgePassProduct(productId);
  const pack = emberPackForProduct(productId);
  const firstName = profile?.display_name?.trim().split(/\s+/)[0] ?? '';
  // The grant is confirmed only when OUR inventory says so — not when the store did.
  const confirmed = isPass && Boolean(pass?.owns_premium);

  // One clock for the entire entrance. Separate timings per element would drift on a slow first
  // frame — the flash could finish before the flame had begun — and this is the one screen where
  // the order of the beats IS the effect.
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

  // Mock 201's `shake` — 0.55s, twice, starting almost immediately. Small amplitude on purpose: this
  // is the room reacting to the flash, not the phone being dropped. Clamped at both ends — a one-shot
  // inside a longer timeline must not extrapolate past its keyframes.
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(intro.value, SHAKE_AT, SHAKE_X, 'clamp') }],
  }));

  function done() {
    // "Done" goes back to wherever the purchase started. The paywall REPLACED itself with this
    // screen, so one step back is the screen the user opened the paywall from.
    if (router.canGoBack()) router.back();
    else router.replace(isPass ? '/forge-pass' : '/shop');
  }

  return (
    <Screen padded={false}>
      <Animated.View style={[styles.stage, isPass && !reduceMotion ? shakeStyle : null]}>
        {isPass ? (
          <>
            <RisingEmbers count={8} />
            {/* The light comes off the flame, so it is centred on the flame — see FLAME_CENTER_Y. */}
            <View style={styles.lightLayer} pointerEvents="none">
              <Rays />
              <Halo />
            </View>
          </>
        ) : null}

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {isPass ? (
            <>
              <BurstFlame intro={intro} />
              <RiseIn intro={intro} at={0.19}>
                <Text style={styles.kicker}>FLAME PASS UNLOCKED</Text>
                {/* Plain and weighty: no gradient word, no tick. A green check is the visual
                    language of a form that submitted; this is the moment the season opens. */}
                <Text style={styles.title}>
                  Welcome to the club{firstName ? `, ${firstName}` : ''}
                </Text>
                <Text style={styles.sub}>{SEASON.name} is now yours — and the whole campus can see it.</Text>
              </RiseIn>

              <RiseIn intro={intro} at={0.24} style={styles.rewardsWrap}>
                <Text style={styles.rewardsLabel}>DROPPED INTO YOUR INVENTORY</Text>
              </RiseIn>
              <View style={styles.rewards}>
                {LEVEL_ZERO_UNLOCK.map((reward, i) => (
                  <RewardCard key={i} reward={reward} intro={intro} at={0.3 + i * 0.057} confirmed={confirmed} />
                ))}
              </View>

              {/* 🔴 THE HONEST LINE, only when it's needed: the webhook hasn't shown after the first
                  beat. In the happy path the stamps above carry the truth and this never appears. */}
              {settled && !confirmed ? (
                <Text style={styles.settle}>
                  Still landing. If anything is missing, reopen the app — the store receipt is on file and will
                  reconcile.
                </Text>
              ) : null}
            </>
          ) : pack ? (
            <>
              <Text style={styles.kicker}>EMBERS ADDED</Text>
              <View style={styles.emberHero}>
                <EmberIcon size={54} />
                <Text style={styles.emberAmount}>{formatEmbers(pack.embers)}</Text>
              </View>
              <Text style={styles.title}>{pack.name}</Text>
              {pack.bonus > 0 ? (
                <Text style={styles.bonusLine}>
                  {formatEmbers(pack.base)} + {formatEmbers(pack.bonus)} bonus
                </Text>
              ) : null}
              <Text style={styles.sub}>
                Spend them on boxes or buy a cosmetic outright. Embers never buy XP, rank, or a place on any
                leaderboard.
              </Text>
              {/* The ember path has no confirmation signal to watch (a balance delta can't be told
                  apart from a lock-in payout), so it keeps the plain honest line. */}
              <Text style={styles.settle}>
                {settled
                  ? 'If they’re not in your balance yet, reopen the app — the store receipt is on file and will reconcile.'
                  : 'Landing in your balance…'}
              </Text>
            </>
          ) : (
            // An id neither branch recognises. Rare (the store sold something this build has no row
            // for), and deliberately quiet: no claim about what landed, because nothing here knows.
            <>
              <Text style={styles.title}>Purchase complete</Text>
              <Text style={styles.sub}>Your reward is on its way to your inventory.</Text>
            </>
          )}

          <RiseIn intro={intro} at={0.45} style={styles.footer} disabled={!isPass}>
            <View style={styles.ctaWrap}>
              <PrimaryButton label="Done" onPress={done} />
              <View style={styles.ctaShine} pointerEvents="none">
                <ShineSweep period={2400} opacity={0.4} />
              </View>
            </View>
            <Pressable onPress={() => router.replace('/inventory')} hitSlop={8} accessibilityRole="button">
              <Text style={styles.secondary}>View inventory</Text>
            </Pressable>
          </RiseIn>

          {/* Room for the firewall, so the footer never sits inside the flames. */}
          {isPass ? <View style={styles.fireSpacer} /> : null}
        </ScrollView>

        {isPass ? <Firewall /> : null}
      </Animated.View>

      {/* Last in the tree so it paints over everything, including the footer. */}
      {isPass && !reduceMotion ? <FireFlash intro={intro} /> : null}
    </Screen>
  );
}

// ─────────────────────────── the entrance ───────────────────────────

/** `shake`'s keyframes, as fractions of INTRO_MS: 0.55s ease, delay 0.05s, twice. */
const SHAKE_AT = [0.024, 0.076, 0.128, 0.18, 0.233, 0.285, 0.337, 0.39, 0.442, 0.494, 0.546];
const SHAKE_X = [0, -4, 4, -2, 2, 0, -4, 4, -2, 2, 0];

/**
 * Content rising in from below, behind the flame. `at` is where in the intro clock the rise STARTS,
 * as a fraction; it always takes 0.6s. One shared clock means nothing lands out of order on a device
 * that dropped the first frame.
 */
function RiseIn({
  intro,
  at,
  children,
  style,
  disabled = false,
}: {
  intro: { value: number };
  at: number;
  children: React.ReactNode;
  style?: object;
  /** Renders statically — the ember-pack path, which gets no cinematic. */
  disabled?: boolean;
}) {
  const span = 600 / INTRO_MS;
  const animated = useAnimatedStyle(() => ({
    opacity: interpolate(intro.value, [at, at + span], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(intro.value, [at, at + span], [12, 0], 'clamp') }],
  }));
  return <Animated.View style={[styles.riseIn, style, disabled ? null : animated]}>{children}</Animated.View>;
}

/** The flame bursting in from nothing (0.15 → 1.25 → 1 over 0.7s), then flickering forever. */
function BurstFlame({ intro }: { intro: { value: number } }) {
  const run = usePassMotion();
  const flick = useSharedValue(0);

  useEffect(() => {
    if (!run) {
      flick.value = 0;
      return;
    }
    flick.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [run, flick]);

  // The overshoot is the burst; without it the flame simply grows, which reads as a loading state.
  const burst = useAnimatedStyle(() => ({
    opacity: interpolate(intro.value, [0, 0.18], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(intro.value, [0, 0.18, 0.33], [0.15, 1.25, 1], 'clamp') }],
  }));

  const flicker = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(flick.value, [0, 1], [0, -3]) },
      { scaleY: interpolate(flick.value, [0, 1], [1, 1.09]) },
      { scaleX: interpolate(flick.value, [0, 1], [1, 0.93]) },
    ],
  }));

  return (
    <View style={styles.flameWrap}>
      <Animated.View style={burst}>
        <Animated.View style={flicker}>
          <FlameLogo size={104} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/**
 * The fan, blooming from the flame's centre. `RewardRays` is the app's ONE starburst — the same
 * wedges every reveal draws — and it carries the Android raster clamp a full-screen fan needs (a
 * naive one crashed SvgView with a 179MB bitmap). `pass_level` is the row whose tint already means
 * "Flame Pass".
 */
function Rays() {
  const { width, height } = useWindowDimensions();
  const size = Math.hypot(width, FLAME_CENTER_Y) + Math.hypot(width, height - FLAME_CENTER_Y);
  return <RewardRays kind="pass_level" size={size} intensity={0.55} />;
}

/** The mock's `.halo` — a warm bloom under the flame, breathing. */
function Halo() {
  const run = usePassMotion();
  // Gradient ids are GLOBAL in react-native-svg — a hardcoded one renders every instance after the
  // first as blank on Android. Every SVG primitive in this app carries a useId for that reason.
  const grad = `psHalo-${useId()}`;
  const t = useSharedValue(0);

  useEffect(() => {
    if (!run) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [run, t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.75, 1]),
    transform: [{ scale: interpolate(t.value, [0, 1], [1, 1.14]) }],
  }));

  return (
    <Animated.View style={[styles.centred, style]} pointerEvents="none">
      <Svg width={180} height={180}>
        <Defs>
          <RadialGradient id={grad} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={Colors.coral} stopOpacity="0.6" />
            <Stop offset="0.62" stopColor={Colors.coral} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={90} cy={90} rx={90} ry={90} fill={`url(#${grad})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * The full-screen fire flash — white pop into a fiery bloom, twice. Two layers because they do
 * different jobs: the white is the POP (very short, very bright), the radial is the BLOOM behind it.
 * `pointerEvents="none"` throughout: this paints over the CTA and must never eat a tap meant for it.
 */
function FireFlash({ intro }: { intro: { value: number } }) {
  const { width, height } = useWindowDimensions();
  const grad = `psFlash-${useId()}`;

  const whiteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(intro.value, [0, 0.03, 0.09, 1], [0, 0.8, 0, 0], 'clamp'),
  }));
  const fireStyle = useAnimatedStyle(() => ({
    opacity: interpolate(intro.value, [0, 0.05, 0.18, 0.3, 0.48, 1], [0, 1, 0.25, 0.85, 0.1, 0], 'clamp'),
  }));

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, fireStyle]} pointerEvents="none">
        <Svg width={width} height={height}>
          <Defs>
            <RadialGradient id={grad} cx="50%" cy="40%" rx="80%" ry="80%">
              <Stop offset="0" stopColor="#FFF3D6" />
              <Stop offset="0.18" stopColor={Colors.ember} />
              <Stop offset="0.38" stopColor={Colors.amber} />
              <Stop offset="0.6" stopColor={Colors.coral} />
              <Stop offset="0.82" stopColor={Colors.coral} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={width} height={height} fill={`url(#${grad})`} />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.whiteFlash, whiteStyle]} pointerEvents="none" />
    </>
  );
}

// ─────────────────────────── the reward cards ───────────────────────────

/** What a card's rarity line calls each type — "LEGENDARY SKIN", not "LEGENDARY FLAME". */
const TYPE_WORD: Partial<Record<ItemType, string>> = { FLAME: 'SKIN' };

function RewardCard({
  reward,
  intro,
  at,
  confirmed,
}: {
  reward: PassReward;
  intro: { value: number };
  at: number;
  confirmed: boolean;
}) {
  const span = 550 / INTRO_MS;
  // The mock's `pop`: scale .5 → 1.08 → 1 while rising 14pt, with a little overshoot.
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(intro.value, [at, at + span * 0.5], [0, 1], 'clamp'),
    transform: [
      { translateY: interpolate(intro.value, [at, at + span * 0.7], [14, 0], 'clamp') },
      { scale: interpolate(intro.value, [at, at + span * 0.7, at + span], [0.5, 1.08, 1], 'clamp') },
    ],
  }));

  const card = cardContent(reward);
  if (!card) return null;

  return (
    <Animated.View
      style={[styles.card, { borderColor: `${card.color}80`, shadowColor: card.color }, style]}>
      <ShineSweep period={3000} opacity={0.16} delay={900} />
      <Text style={[styles.stamp, !confirmed && styles.stampPending]}>
        {confirmed ? (reward.kind === 'embers' ? '✓ ADDED' : '✓ UNLOCKED') : 'LANDING…'}
      </Text>
      <View style={styles.cardArt}>{card.art}</View>
      <Text style={styles.cardName} numberOfLines={2}>
        {card.name}
      </Text>
      <Text style={[styles.cardMeta, { color: card.color }]}>{card.meta}</Text>
    </Animated.View>
  );
}

function cardContent(reward: PassReward) {
  if (reward.kind === 'embers') {
    return {
      art: <EmberIcon size={34} />,
      name: `${formatEmbers(reward.amount)} Embers`,
      meta: 'SPEND ANYTIME',
      color: Colors.ember,
    };
  }
  if (reward.kind !== 'item') return null;
  const item = getItem(reward.itemId);
  if (!item) return null;
  return {
    art: <ItemArt item={item} size={40} />,
    name: item.name.replace(/^"|"$/g, ''),
    meta: `${RARITY_LABEL[item.rarity]} ${TYPE_WORD[item.type] ?? item.type}`,
    color: RARITY_COLOR[item.rarity],
  };
}

// ─────────────────────────── the firewall ───────────────────────────

/**
 * The layered firewall along the bottom edge (mock 201-v2) — replacing v1's four cheap licks. Four
 * layers, back to front: a hot base wash, five screen-blended tongues of varied height each
 * flickering on its own rhythm, embers lifting off the top, and a white-hot glow line on the floor.
 * Under Reduce Motion the tongues and embers stop and the base + glow line remain: a fire, still lit,
 * just not moving.
 */
const TONGUES = [
  { left: '4%', w: 70, h: 120, dur: 1150, delay: 0, sway: 4 },
  { left: '22%', w: 56, h: 96, dur: 1350, delay: 200, sway: -5 },
  { left: '40%', w: 80, h: 140, dur: 1050, delay: 350, sway: 4 },
  { left: '60%', w: 58, h: 104, dur: 1250, delay: 150, sway: -5 },
  { left: '78%', w: 72, h: 124, dur: 1200, delay: 300, sway: 4 },
] as const;

function Firewall() {
  const run = usePassMotion();
  const base = `psBase-${useId()}`;
  const line = `psLine-${useId()}`;

  return (
    <View style={styles.firewall} pointerEvents="none">
      <View style={styles.fireBase}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={base} x1="0" y1="1" x2="0" y2="0">
              <Stop offset="0" stopColor={Colors.coral} stopOpacity="0.6" />
              <Stop offset="0.46" stopColor={Colors.amber} stopOpacity="0.22" />
              <Stop offset="1" stopColor={Colors.amber} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${base})`} />
        </Svg>
      </View>

      {run ? TONGUES.map((t) => <Tongue key={t.left} {...t} />) : null}
      {run ? <FireEmbers /> : null}

      <View style={styles.glowHalo}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={line} x1="0" y1="1" x2="0" y2="0">
              <Stop offset="0" stopColor={Colors.ember} stopOpacity="0.9" />
              <Stop offset="1" stopColor={Colors.ember} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${line})`} />
        </Svg>
      </View>
      <View style={styles.glowLine} />
    </View>
  );
}

function Tongue({
  left,
  w,
  h,
  dur,
  delay,
  sway,
}: {
  left: string;
  w: number;
  h: number;
  dur: number;
  delay: number;
  sway: number;
}) {
  const grad = `psTongue-${useId()}`;
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: dur / 2, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [delay, dur, t]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { scaleY: interpolate(t.value, [0, 1], [1, 1.22]) },
      { scaleX: interpolate(t.value, [0, 1], [1, 0.86]) },
      { skewX: `${interpolate(t.value, [0, 1], [0, sway])}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[styles.tongue, { left: left as `${number}%`, width: w, height: h }, style]}
      pointerEvents="none">
      <Svg width={w} height={h}>
        <Defs>
          {/* Soft all the way out, so each tongue reads as blurred light without a blur filter. */}
          <RadialGradient id={grad} cx="50%" cy="88%" rx="50%" ry="70%">
            <Stop offset="0" stopColor="#FFE7B0" stopOpacity="0.95" />
            <Stop offset="0.34" stopColor={Colors.amber} stopOpacity="0.75" />
            <Stop offset="0.62" stopColor={Colors.coral} stopOpacity="0.45" />
            <Stop offset="0.85" stopColor={Colors.coral} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={w / 2} cy={h * 0.62} rx={w / 2} ry={h * 0.62} fill={`url(#${grad})`} />
      </Svg>
    </Animated.View>
  );
}

const FIRE_EMBERS = [
  { left: '12%', drift: 10, delay: 0 },
  { left: '30%', drift: -8, delay: 600 },
  { left: '50%', drift: 6, delay: 1200 },
  { left: '68%', drift: -10, delay: 300 },
  { left: '86%', drift: 8, delay: 1600 },
] as const;

/** Embers lifting off the top of the flames — short hops, not the full-screen rise. */
function FireEmbers() {
  return (
    <>
      {FIRE_EMBERS.map((e) => (
        <FireEmber key={e.left} {...e} />
      ))}
    </>
  );
}

function FireEmber({ left, drift, delay }: { left: string; drift: number; delay: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2800, easing: Easing.out(Easing.quad) }), -1, false));
  }, [delay, t]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.12, 1], [0, 1, 0]),
    transform: [
      { translateY: interpolate(t.value, [0, 1], [0, -150]) },
      { translateX: interpolate(t.value, [0, 1], [0, drift]) },
      { scale: interpolate(t.value, [0, 1], [1, 0.2]) },
    ],
  }));
  return <Animated.View style={[styles.fireEmber, { left: left as `${number}%` }, style]} />;
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    // The flares and the firewall run past the screen edges; clipping them here keeps them from
    // painting over the system bars on Android.
    overflow: 'hidden',
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: TOP_PAD,
    paddingBottom: Spacing.four,
    alignItems: 'center',
  },
  riseIn: {
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  centred: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── hero ──
  flameWrap: {
    height: FLAME_BOX_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pinned to the stage and exactly twice FLAME_CENTER_Y tall, so centring inside it lands the
  // light's origin on the flame's centre — without either of them having to measure the other.
  lightLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: FLAME_CENTER_Y * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whiteFlash: {
    backgroundColor: '#FFFFFF',
  },

  // ── copy ──
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 3,
    color: Colors.ember,
    marginTop: Spacing.twelve,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: -0.6,
    color: Colors.ink,
    marginTop: Spacing.two,
    textAlign: 'center',
    maxWidth: 280,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: '#B8ABCF',
    textAlign: 'center',
    marginTop: Spacing.two,
    maxWidth: 280,
  },

  // ── rewards ──
  rewardsWrap: {
    marginTop: Spacing.four,
  },
  rewardsLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.4,
    color: '#8a7fa6',
    marginBottom: Spacing.twelve,
  },
  rewards: {
    flexDirection: 'row',
    gap: 9,
    alignSelf: 'stretch',
  },
  card: {
    flex: 1,
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 15,
    borderWidth: 1,
    backgroundColor: '#1F1629',
    paddingTop: 12,
    paddingBottom: 11,
    paddingHorizontal: 8,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 6,
  },
  stamp: {
    fontFamily: Fonts.bodyBold,
    fontSize: 7,
    letterSpacing: 0.6,
    color: Colors.green,
  },
  stampPending: {
    color: Colors.textTertiary,
  },
  cardArt: {
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  cardName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    lineHeight: 13,
    color: Colors.ink,
    textAlign: 'center',
    marginTop: 8,
  },
  cardMeta: {
    fontFamily: Fonts.bodyBold,
    fontSize: 7.5,
    letterSpacing: 0.5,
    marginTop: 3,
    textAlign: 'center',
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

  // ── footer ──
  settle: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    lineHeight: 15,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.three,
    maxWidth: 290,
  },
  footer: {
    marginTop: Spacing.four,
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
    color: '#A99CBD',
    textDecorationLine: 'underline',
    marginTop: Spacing.twelve,
    paddingVertical: Spacing.one,
  },
  fireSpacer: {
    height: 90,
  },

  // ── firewall ──
  firewall: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 150,
    overflow: 'hidden',
  },
  fireBase: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 96,
  },
  tongue: {
    position: 'absolute',
    bottom: -14,
    // Anchored at the base, so the stretch reads as a tongue rising rather than a blob growing.
    transformOrigin: 'bottom',
    // Screen-blend so overlapping tongues brighten into each other like real flame, not stack
    // into an opaque orange slab.
    mixBlendMode: 'screen',
  },
  fireEmber: {
    position: 'absolute',
    bottom: 8,
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.ember,
  },
  glowHalo: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 18,
  },
  glowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: Colors.ember,
    shadowColor: Colors.ember,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
  },
});
