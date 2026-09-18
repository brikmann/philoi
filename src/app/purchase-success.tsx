import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useId, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop, LinearGradient } from 'react-native-svg';

import { EmberIcon } from '@/components/economy/ember-icon';
import { formatEmbers } from '@/components/economy/economy-bits';
import { ItemArt } from '@/components/economy/item-art';
import { RewardRays } from '@/components/economy/reward-reveal';
import { FlameLogo } from '@/components/ui/flame-logo';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useInventory } from '@/hooks/use-inventory';
import { useMotionActive } from '@/hooks/use-motion-active';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useAuth } from '@/lib/auth/auth-context';
import { getItem } from '@/lib/economy/catalog';
import { LEVEL_ZERO_UNLOCK, SEASON, type PassReward } from '@/lib/economy/forge-pass';
import { emberPackForProduct, isForgePassProduct } from '@/lib/economy/iap';
import { RARITY_COLOR, RARITY_LABEL } from '@/lib/economy/rarity';
import { fireReveal } from '@/lib/reward-feedback';

// What you see the moment a real-money purchase clears (#71), in the cinematic cut (mock 201).
//
// 🔴 THE PART THAT IS NOT DECORATION, AND MUST NOT BE REGRESSED. The important thing this screen
// does is NOT celebrate — it's to show the user what they actually received, because the grant is
// asynchronous. The store charged them on the device; the embers and the entitlement are written by
// the RevenueCat webhook a beat later. So this renders the expected contents immediately and
// refetches inventory underneath, rather than blocking on a spinner while a webhook lands. If the
// refetch shows nothing yet, the copy says "landing shortly" instead of claiming a grant that
// hasn't happened. The fire below is layered ON TOP of that behaviour; it does not gate it.
//
// THE SEQUENCE (mock 201), all one-shot off `intro`:
//   0.00s  white pop → fiery bloom, twice, over the whole screen, plus a quick shake
//   0.00s  the flame bursts in from nothing; rays bloom from ITS centre, not the screen's
//   0.35s  kicker / headline / subline rise in
//   0.60s  the unlocked tiles rise in
//   ambient, forever: a firewall licking up from the bottom edge and embers showering past it
//
// Reached with ?product=<store product id>. An ember pack gets NONE of this — the cinematic is the
// Flame Pass's, and a full-screen fire blast for a currency top-up would spend the biggest moment
// in the app on the smallest purchase.

/** The whole one-shot intro, in ms. Every entrance below is a slice of this one clock. */
const INTRO_MS = 2100;

/** The flame's box inside the scrolling column. */
const FLAME_BOX_H = 150;

/**
 * Where the flame's centre sits, measured down from the top of the stage.
 *
 * 🔴 WHY THE LIGHT IS NOT A CHILD OF THE FLAME. The fan is wider than the screen diagonal, and a
 * child that large inside a 150pt box nested in a ScrollView is at the mercy of Android's child
 * clipping — the same class of problem that made FullscreenRays measure a root offset rather than
 * simply filling its parent. So the light layer is a SIBLING of the ScrollView, pinned to the stage
 * (the only thing on this screen that clips, and it clips to the phone), and centred on this
 * offset: the column's top padding plus half the flame's box. Deterministic, and exact at mount,
 * which is the only moment the burst plays.
 */
const FLAME_CENTER_Y = Spacing.six + FLAME_BOX_H / 2;

export default function PurchaseSuccessScreen() {
  const router = useRouter();
  const { product } = useLocalSearchParams<{ product?: string }>();
  const { profile } = useAuth();
  const { refetch } = useInventory();
  const [settled, setSettled] = useState(false);
  const reduceMotion = useReduceMotion();

  const productId = product ?? '';
  const isPass = isForgePassProduct(productId);
  const pack = emberPackForProduct(productId);
  const firstName = profile?.display_name?.trim().split(/\s+/)[0] ?? '';

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
    // The Mythic sting for the flare — the Pass's headline unlock is a Mythic and deserves the same
    // audio the box reveals give one. Ember packs get nothing: a currency top-up isn't a pull.
    if (isPass) fireReveal('mythic', false);
  }, [isPass]);

  // Refetch twice: once now, once after a short delay. The webhook usually lands within a second or
  // two, and a single immediate refetch would almost always miss it — which would leave a correct
  // purchase looking like a failed one.
  useEffect(() => {
    let cancelled = false;
    void refetch();
    const t = setTimeout(() => {
      if (cancelled) return;
      void refetch();
      setSettled(true);
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [refetch]);

  // Mock 201's `shake` — 0.5s, twice, starting almost immediately. Small amplitude on purpose: this
  // is the room reacting to the flash, not the phone being dropped.
  //
  // 🐛 CLAMPED. `interpolate` extrapolates past its range by default, and these keyframes stop at
  // 0.5 of the clock — so after the shake the screen would go on sliding along the last segment's
  // slope for the remaining second, and before it, along the first segment's. A one-shot inside a
  // longer timeline has to pin both ends.
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(intro.value, SHAKE_AT, SHAKE_X, 'clamp') }],
  }));

  return (
    <Screen padded={false}>
      <Animated.View style={[styles.stage, isPass && !reduceMotion ? shakeStyle : null]}>
        {isPass ? (
          <>
            <Firewall />
            <EmberShower />
            {/* The light comes off the flame, so it is centred on the flame — see FLAME_CENTER_Y. */}
            <View style={styles.lightLayer} pointerEvents="none">
              <Halo />
              <Rays />
            </View>
          </>
        ) : null}

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {isPass ? (
            <>
              <BurstFlame intro={intro} />
              <RiseIn intro={intro} at={0.17}>
                <Text style={styles.kicker}>FLAME PASS UNLOCKED</Text>
                {/* NO CHECK MARK (mock 201). A green tick is the visual language of a form that
                    submitted; this is the moment the season opens. */}
                <Text style={styles.title}>
                  Welcome to the <Text style={styles.titleFire}>best</Text>
                  {firstName ? `, ${firstName}` : ''}
                </Text>
                <Text style={styles.sub}>
                  The premium track is yours, and the whole campus can see it. Go get after it.
                </Text>
              </RiseIn>

              <RiseIn intro={intro} at={0.29} style={styles.gridWrap}>
                <Text style={styles.clbl}>UNLOCKED JUST NOW</Text>
                <View style={styles.grid}>
                  {LEVEL_ZERO_UNLOCK.map((reward, i) => (
                    <UnlockTile key={i} reward={reward} />
                  ))}
                </View>
              </RiseIn>
            </>
          ) : pack ? (
            <>
              <Text style={styles.kicker}>EMBERS ADDED</Text>
              <View style={styles.emberHero}>
                <EmberIcon size={54} />
                <Text style={styles.emberAmount}>{formatEmbers(pack.embers)}</Text>
              </View>
              <Text style={styles.title}>{pack.name}</Text>
              <Text style={styles.sub}>
                Spend them on boxes or buy a cosmetic outright. Embers never buy XP, rank, or a place on any
                leaderboard.
              </Text>
            </>
          ) : (
            // An id neither branch recognises. Rare (it means the store sold something this build
            // has no row for), and deliberately quiet: no kicker repeating the headline, and no
            // claim about what landed, because nothing here knows.
            <>
              <Text style={styles.title}>Purchase complete</Text>
              <Text style={styles.sub}>Your reward is on its way to your inventory.</Text>
            </>
          )}

          {/* 🔴 THE HONEST LINE. Unchanged in substance: it is the only thing on screen that tells
              the truth about a grant the client has not seen land yet. It rises in with the tiles it
              is describing rather than sitting there alone while they fade up around it. */}
          <RiseIn intro={intro} at={0.29} disabled={!isPass}>
            <Text style={styles.settle}>
              {settled
                ? 'If anything is missing, reopen the app — the store receipt is on file and will reconcile.'
                : 'Landing in your inventory…'}
            </Text>
          </RiseIn>

          <RiseIn intro={intro} at={0.36} style={styles.footer} disabled={!isPass}>
            <Pressable style={styles.cta} onPress={() => router.replace(isPass ? '/forge-pass' : '/shop')}>
              <Text style={styles.ctaText}>{isPass ? 'See your Flame Pass' : 'Back to the shop'}</Text>
            </Pressable>
            <Pressable onPress={() => router.replace('/inventory')} hitSlop={8}>
              <Text style={styles.secondary}>View inventory</Text>
            </Pressable>
            {isPass ? (
              <Text style={styles.receipt}>
                Flame Pass · Season {SEASON.id.replace('S', '')} {SEASON.name} · manage in Settings
              </Text>
            ) : null}
          </RiseIn>
        </ScrollView>
      </Animated.View>

      {/* Last in the tree so it paints over everything, including the footer. */}
      {isPass && !reduceMotion ? <FireFlash intro={intro} /> : null}
    </Screen>
  );
}

// ─────────────────────────── the entrance ───────────────────────────

/** `shake`'s keyframes, as fractions of INTRO_MS: 0.5s ease, delay 0.05s, twice. */
const SHAKE_AT = [0.024, 0.071, 0.119, 0.167, 0.214, 0.262, 0.31, 0.357, 0.405, 0.452, 0.5];
const SHAKE_X = [0, -3, 3, -2, 2, 0, -3, 3, -2, 2, 0];

/**
 * The copy and the tiles coming up from below, staggered behind the flame.
 *
 * `at` is where in the intro clock the rise STARTS, as a fraction; it always takes 0.6s. One shared
 * clock rather than a per-child delay means nothing can land out of order on a device that dropped
 * the first frame.
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
  style?: StyleProp<ViewStyle>;
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

/**
 * The flame bursting in from nothing, with the ray fan blooming from ITS centre.
 *
 * The fan is `RewardRays` — the app's one starburst, the same one every reveal draws — rather than
 * a ninth hand-rolled set of spokes, and it carries the Android raster clamp that a full-screen fan
 * needs. It is absolutely centred inside this wrapper, so the fan's origin and the flame's centre
 * are the same point by construction rather than by two matching offsets that can drift.
 */
function BurstFlame({ intro }: { intro: { value: number } }) {
  const reduceMotion = useReduceMotion();
  const motionActive = useMotionActive();
  const flick = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || !motionActive) {
      flick.value = 0;
      return;
    }
    flick.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduceMotion, motionActive, flick]);

  // `burstin`: 0.15 → 1.25 → 1 over 0.7s. The overshoot is the burst; without it the flame simply
  // grows, which reads as a loading state.
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
          <FlameLogo size={98} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/**
 * The fan, blooming from the flame's centre.
 *
 * `RewardRays` is the app's ONE starburst — the same wedges every reveal draws, taking the equipped
 * flame's colourway — rather than a ninth hand-rolled set of spokes, and it already carries the
 * Android raster clamp a full-screen fan needs (a naive one crashed SvgView with a 179MB bitmap).
 * `pass_level` is the row whose tint already means "Flame Pass".
 */
function Rays() {
  const { width, height } = useWindowDimensions();
  // Reaches the far corners from an origin sitting HIGH on the screen. A fixed multiple of the long
  // edge leaves dark triangles in the bottom corners whenever the anchor is not centred, which is
  // exactly the case here.
  const size = Math.hypot(width, FLAME_CENTER_Y) + Math.hypot(width, height - FLAME_CENTER_Y);
  return <RewardRays kind="pass_level" size={size} intensity={0.5} />;
}

/** The mock's `.halo` — a warm bloom sitting under the flame, breathing. */
function Halo() {
  const reduceMotion = useReduceMotion();
  const motionActive = useMotionActive();
  // Gradient ids are GLOBAL in react-native-svg — a hardcoded one renders every instance after the
  // first as blank on Android. Every SVG primitive in this app carries a useId for that reason.
  const grad = `psHalo-${useId()}`;
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || !motionActive) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduceMotion, motionActive, t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.75, 1]),
    transform: [{ scale: interpolate(t.value, [0, 1], [1, 1.12]) }],
  }));

  return (
    <Animated.View style={[styles.halo, style]} pointerEvents="none">
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
 * The full-screen fire flash — white pop into a fiery bloom, twice.
 *
 * Two layers rather than one, because they do different jobs: the white is the POP (very short,
 * very bright, gone) and the radial is the BLOOM behind it (slower, warmer, wider). Collapsing them
 * into a single fading orange loses the snap entirely.
 *
 * `pointerEvents="none"` throughout: this paints over the CTA for two seconds and must never eat a
 * tap meant for it.
 */
function FireFlash({ intro }: { intro: { value: number } }) {
  const { width, height } = useWindowDimensions();
  const grad = `psFlash-${useId()}`;

  const whiteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(intro.value, [0, 0.04, 0.1, 0.26, 0.34, 1], [0, 0.85, 0, 0.6, 0, 0], 'clamp'),
  }));
  const fireStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      intro.value,
      [0, 0.05, 0.16, 0.28, 0.46, 0.62, 1],
      [0, 1, 0.3, 0.92, 0.12, 0.5, 0],
      'clamp'
    ),
  }));

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, fireStyle]} pointerEvents="none">
        <Svg width={width} height={height}>
          <Defs>
            <RadialGradient id={grad} cx="50%" cy="62%" rx="80%" ry="80%">
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

// ─────────────────────────── the ambient fire ───────────────────────────

const LICKS = [
  { left: '8%', delay: 0 },
  { left: '34%', delay: 300 },
  { left: '60%', delay: 150 },
  { left: '82%', delay: 450 },
] as const;

/** The wall of fire licking up from the bottom edge, with four tongues rising out of it. */
function Firewall() {
  const reduceMotion = useReduceMotion();
  const motionActive = useMotionActive();
  const grad = `psWall-${useId()}`;
  if (reduceMotion || !motionActive) return null;

  return (
    <View style={styles.firewall} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={grad} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={Colors.coral} stopOpacity="0.55" />
            <Stop offset="0.45" stopColor={Colors.amber} stopOpacity="0.25" />
            <Stop offset="1" stopColor={Colors.coral} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${grad})`} />
      </Svg>
      {LICKS.map((l) => (
        <Lick key={l.left} left={l.left} delay={l.delay} />
      ))}
    </View>
  );
}

function Lick({ left, delay }: { left: string; delay: number }) {
  const grad = `psLick-${useId()}`;
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true)
    );
  }, [delay, t]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { scaleY: interpolate(t.value, [0, 1], [1, 1.4]) },
      { scaleX: interpolate(t.value, [0, 1], [1, 0.8]) },
    ],
  }));

  return (
    <Animated.View style={[styles.lick, { left: left as `${number}%` }, style]} pointerEvents="none">
      <Svg width={64} height={112}>
        <Defs>
          <RadialGradient id={grad} cx="50%" cy="90%" rx="55%" ry="55%">
            <Stop offset="0" stopColor={Colors.ember} stopOpacity="0.9" />
            <Stop offset="0.4" stopColor={Colors.amber} stopOpacity="0.7" />
            <Stop offset="0.7" stopColor={Colors.coral} stopOpacity="0.4" />
            <Stop offset="0.88" stopColor={Colors.coral} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={32} cy={72} rx={32} ry={56} fill={`url(#${grad})`} />
      </Svg>
    </Animated.View>
  );
}

/** Mock 201's `.sp` — sparks off the firewall, crossing the whole screen rather than a hero. */
const SHOWER: { left: string; drift: number; delay: number }[] = [
  { left: '10%', drift: 14, delay: 0 },
  { left: '22%', drift: -10, delay: 500 },
  { left: '34%', drift: 8, delay: 1100 },
  { left: '46%', drift: -14, delay: 300 },
  { left: '58%', drift: 12, delay: 900 },
  { left: '68%', drift: -6, delay: 1500 },
  { left: '78%', drift: 10, delay: 200 },
  { left: '88%', drift: -12, delay: 1200 },
  { left: '16%', drift: 6, delay: 1800 },
  { left: '52%', drift: -8, delay: 2000 },
  { left: '72%', drift: 14, delay: 1700 },
];

function EmberShower() {
  const reduceMotion = useReduceMotion();
  const motionActive = useMotionActive();
  const { height } = useWindowDimensions();
  if (reduceMotion || !motionActive) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {SHOWER.map((s) => (
        <Spark key={s.left + s.delay} {...s} rise={height} />
      ))}
    </View>
  );
}

function Spark({ left, drift, delay, rise }: { left: string; drift: number; delay: number; rise: number }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 2600, easing: Easing.out(Easing.quad) }), -1, false)
    );
  }, [delay, t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.12, 1], [0, 1, 0]),
    transform: [
      { translateY: interpolate(t.value, [0, 1], [0, -rise]) },
      { translateX: interpolate(t.value, [0, 1], [0, drift]) },
      { scale: interpolate(t.value, [0, 1], [1, 0.2]) },
    ],
  }));

  return <Animated.View style={[styles.spark, { left: left as `${number}%` }, style]} />;
}

// ─────────────────────────── the manifest ───────────────────────────

function UnlockTile({ reward }: { reward: PassReward }) {
  if (reward.kind === 'embers') {
    return (
      <View style={styles.tile}>
        <EmberIcon size={34} />
        <Text style={styles.tileName}>{formatEmbers(reward.amount)}</Text>
        <Text style={styles.tileMeta}>EMBERS</Text>
      </View>
    );
  }
  if (reward.kind !== 'item') return null;
  const item = getItem(reward.itemId);
  if (!item) return null;
  return (
    <View style={styles.tile}>
      <ItemArt item={item} size={40} />
      <Text style={styles.tileName} numberOfLines={1}>
        {item.name}
      </Text>
      <Text style={[styles.tileMeta, { color: RARITY_COLOR[item.rarity] }]}>
        {RARITY_LABEL[item.rarity].toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    // The shower and the firewall run past the screen edges; clipping them here keeps the sparks
    // from painting over the system bars on Android.
    overflow: 'hidden',
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.six,
    paddingBottom: Spacing.six,
    alignItems: 'center',
  },
  riseIn: {
    alignItems: 'center',
    alignSelf: 'stretch',
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
  halo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── flash ──
  whiteFlash: {
    backgroundColor: '#FFFFFF',
  },

  // ── ambient fire ──
  firewall: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
  },
  lick: {
    position: 'absolute',
    bottom: -12,
    // Anchored at the base, so the stretch reads as a tongue rising rather than as a blob growing.
    transformOrigin: 'bottom',
  },
  spark: {
    position: 'absolute',
    bottom: -8,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.ember,
  },

  // ── copy ──
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1.6,
    color: Colors.ember,
    marginTop: Spacing.two,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 26,
    color: Colors.ink,
    marginTop: Spacing.two,
    textAlign: 'center',
  },
  titleFire: {
    color: Colors.amber,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.two,
    maxWidth: 300,
  },

  // ── manifest ──
  gridWrap: {
    marginTop: Spacing.four,
  },
  clbl: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.7,
    color: Colors.textTertiary,
    alignSelf: 'flex-start',
    marginBottom: Spacing.two,
  },
  grid: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignSelf: 'stretch',
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: 14,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.18)',
  },
  tileName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    color: Colors.ink,
    textAlign: 'center',
  },
  tileMeta: {
    fontFamily: Fonts.body,
    fontSize: 8,
    letterSpacing: 0.6,
    color: Colors.textTertiary,
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

  // ── footer ──
  settle: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.five,
    maxWidth: 290,
  },
  footer: {
    alignItems: 'center',
  },
  cta: {
    marginTop: Spacing.four,
    paddingVertical: 14,
    paddingHorizontal: 34,
    borderRadius: 14,
    backgroundColor: Colors.ember,
  },
  ctaText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.onEmber,
  },
  secondary: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.textTertiary,
    marginTop: Spacing.three,
    paddingVertical: Spacing.one,
  },
  receipt: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    lineHeight: 14,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
});
