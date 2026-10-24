import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { Fragment, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, G, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

import { HouseMedallion } from '@/components/house/program-picker';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchMyProgram, loreParagraphs } from '@/lib/api/house';
import { markCeremonyDone, skipCeremonyThisSession } from '@/lib/house/ceremony';
import { getRewardPreferencesSync } from '@/lib/reward-settings';
import { fadeOutRewardSound, playRewardSound } from '@/lib/sound';
import type { MyProgramRow } from '@/types/house';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PHASE 3 — CLAIM YOUR HOUSE (ONBOARDING_FLOW_3phase.md; mocks 286 + 287).
//
// Two beats in one route, so the pledge hands straight into the seal without a navigation the root
// layout's gates would re-evaluate mid-moment:
//
//   LORE  (286)  the Agora at dusk, the crest medallion, "A patron has claimed you", the patron's
//                name + title and the program's lore, then "You pledge loyalty to {Patron}".
//   SEAL  (287)  "You are now shown to the world as an Heir to {Patron}" — the seal slams in beside
//                the @handle with a flash and a shake, and the choir hits on impact.
//
// Everything is DERIVED from the program (get_my_program). The patron is never a choice here; the
// quiet opt-out is "Choose a different program", which goes to /house/change-program and comes
// back to this screen with whatever house the new program grants.
//
// Reached from the root layout's ceremony gate (first run, after the tour, profile has a program)
// and from /house/change-program?ceremony=1 (an existing user claiming a house for the first time).
// ══════════════════════════════════════════════════════════════════════════════════════════════

const GOLD = Colors.ember;
const TITLE_GOLD = '#E9C879';
const LORE_INK = '#CFC6EA';

export default function ClaimHouseScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const userId = session?.user?.id ?? null;
  // Read here, long before the pledge, so the seal mounts already knowing — a fresh hook inside it
  // would start `false` and flip mid-timeline.
  const reduceMotion = useReduceMotion();

  const [program, setProgram] = useState<MyProgramRow | null>(null);
  const [phase, setPhase] = useState<'loading' | 'lore' | 'seal'>('loading');

  // No house to show. Stand the gate down for this launch (persisting nothing) so Home can't bounce
  // straight back here, and leave.
  function leaveWithoutHouse() {
    skipCeremonyThisSession(userId);
    router.replace('/');
  }

  useEffect(() => {
    let live = true;
    fetchMyProgram()
      .then((row) => {
        if (!live) return;
        if (!row) {
          leaveWithoutHouse();
          return;
        }
        setProgram(row);
        setPhase('lore');
      })
      .catch((e) => {
        console.warn('[house] could not read your program — skipping the claim for now:', e);
        if (live) leaveWithoutHouse();
      });
    return () => {
      live = false;
    };
    // Once per mount — the screen is replaced, never re-entered with new inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'loading' || !program) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.amber} />
        </View>
      </Screen>
    );
  }

  if (phase === 'seal') {
    return (
      <SealClaim
        program={program}
        handle={profile?.handle ?? null}
        userId={userId}
        reduceMotion={reduceMotion}
        onEnter={() => {
          // The landing already recorded the account (in memory first), so the gate's re-check on
          // this navigation reads true. Set again anyway: it is idempotent and costs nothing.
          markCeremonyDone(userId).catch(() => {});
          fadeOutRewardSound('seal-claim', 1200);
          router.replace('/');
        }}
      />
    );
  }

  return (
    <LoreScreen
      program={program}
      onPledge={() => setPhase('seal')}
      onChangeProgram={() => router.replace({ pathname: '/house/change-program', params: { then: 'claim' } })}
    />
  );
}

// ─────────────────────────── LORE (mock 286) ───────────────────────────

function LoreScreen({
  program,
  onPledge,
  onChangeProgram,
}: {
  program: MyProgramRow;
  onPledge: () => void;
  onChangeProgram: () => void;
}) {
  const insets = useSafeAreaInsets();
  const paragraphs = loreParagraphs(program);
  // A program with no lore yet still gets the one line that ties it to the house.
  const lore = paragraphs.length > 0 ? paragraphs : [`As a ${program.name} student, you walk ${program.patron_name}'s path.`];

  return (
    <Screen padded={false} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <ScrollView contentContainerStyle={styles.loreContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.scene, { height: SCENE_H + insets.top }]}>
          <AgoraAtDusk />
          <Text style={[styles.claimed, { top: insets.top + 12 }]}>A patron has claimed you</Text>
        </View>

        <View style={styles.medalWrap}>
          <HouseMedallion patronKey={program.patron_key} patronName={program.patron_name} size={84} />
        </View>

        <View style={styles.body}>
          <Text style={styles.pname}>{program.patron_name}</Text>
          {program.patron_title ? <Text style={styles.ptitle}>{program.patron_title}</Text> : null}
          <Text style={styles.yourprog}>
            Your program is <Text style={styles.yourprogName}>{program.name}</Text>
          </Text>
          <Meander />
          {lore.map((p, i) => (
            <Text key={i} style={[styles.lore, i > 0 && styles.loreNext]}>
              <HighlightProgram text={p} program={program.name} />
            </Text>
          ))}
        </View>

        <View style={styles.foot}>
          <PrimaryButton label={`You pledge loyalty to ${program.patron_name}`} pulse onPress={onPledge} />
          <Pressable onPress={onChangeProgram} accessibilityRole="button" hitSlop={8} style={styles.skip}>
            <Text style={styles.skipText}>Choose a different program</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

/** "As a Kinesiology student…" — the program's own name lit gold inside the italic lore (mock 286). */
function HighlightProgram({ text, program }: { text: string; program: string }) {
  const parts = text.split(program);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 ? <Text style={styles.loreDrop}>{program}</Text> : null}
        </Fragment>
      ))}
    </>
  );
}

const SCENE_H = 150;

/**
 * The Agora at dusk — mock 286's band: a violet-to-ember sky, a low sun glowing up from the horizon,
 * and the square in silhouette (temple columns either side, market stalls, an orator and his crowd).
 * Drawn bottom-anchored so a taller notch only adds sky.
 */
function AgoraAtDusk() {
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 300 150" preserveAspectRatio="xMidYMax slice">
      <Defs>
        <LinearGradient id="agoraSky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2A1C3A" />
          <Stop offset="0.4" stopColor="#3A2440" />
          <Stop offset="1" stopColor="#1A1226" />
        </LinearGradient>
        <RadialGradient id="agoraSun" cx="150" cy="170" r="110" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#FFD28C" stopOpacity="0.85" />
          <Stop offset="0.45" stopColor="#FF8C3C" stopOpacity="0.3" />
          <Stop offset="1" stopColor="#FF8C3C" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="-200" y="-400" width="700" height="550" fill="url(#agoraSky)" />
      <Rect x="-200" y="-400" width="700" height="550" fill="url(#agoraSun)" />
      <G fill="#140D20" opacity={0.92}>
        <Rect x="18" y="58" width="7" height="92" />
        <Rect x="30" y="58" width="7" height="92" />
        <Rect x="42" y="58" width="7" height="92" />
        <Polygon points="12,58 55,58 44,46 23,46" />
        <Rect x="78" y="104" width="34" height="46" />
        <Polygon points="72,104 118,104 110,92 80,92" />
        <Rect x="124" y="112" width="26" height="38" />
        <Polygon points="120,112 154,112 148,102 126,102" />
        <Rect x="170" y="120" width="30" height="30" />
        <Circle cx="185" cy="112" r="5" />
        <Rect x="182" y="116" width="6" height="12" />
        <Circle cx="210" cy="132" r="4" />
        <Rect x="207" y="136" width="6" height="12" />
        <Circle cx="228" cy="134" r="4" />
        <Rect x="225" y="138" width="6" height="11" />
        <Rect x="250" y="64" width="7" height="86" />
        <Rect x="262" y="64" width="7" height="86" />
        <Rect x="274" y="64" width="7" height="86" />
        <Polygon points="244,64 287,64 276,52 255,52" />
      </G>
    </Svg>
  );
}

/** The Greek-key rule between the title and the lore. */
function Meander() {
  return (
    <Svg width={120} height={12} viewBox="0 0 120 12" style={styles.meander}>
      <G stroke={GOLD} strokeWidth={2} fill="none" opacity={0.85}>
        <Path d="M2 10 h12 v-7 h7 v7 h12 v-7 h7 v7 h12" />
        <Path d="M52 10 h12 v-7 h7 v7 h12 v-7 h7 v7 h12" />
      </G>
    </Svg>
  );
}

// ─────────────────────────── SEAL (mock 287) ───────────────────────────
//
// Mock 287's CSS timeline, kept to the millisecond so the choir's own attack lands on the slap:
//
//   0.30s rays bloom (then turn slowly)     1.70s @handle row fades up
//   0.35s "You are now shown to the world"  2.25s the seal slaps in from 6× (−18° → 4° → 0°)
//   1.00s "Heir to {Patron}" springs in     2.30s flash · shake · choir · haptic   3.00s sub-line
//
// Reduce motion: one fade to the settled frame, no rays turning and no shake — the choir and the
// haptic still land, at the fade (motion is what's cut, not the moment).

const RAYS_AT = 300;
const PRE_AT = 350;
const HEIR_AT = 1000;
const ROW_AT = 1700;
const SLAP_AT = 2250;
const IMPACT_AT = 2300;
const SUB_AT = 3000;
const CTA_AT = 3500;

function safeHaptic(fn: () => Promise<void>): void {
  fn().catch(() => {});
}

function SealClaim({
  program,
  handle,
  userId,
  reduceMotion,
  onEnter,
}: {
  program: MyProgramRow;
  handle: string | null;
  userId: string | null;
  reduceMotion: boolean;
  onEnter: () => void;
}) {
  const rays = useSharedValue(0);
  const spin = useSharedValue(0);
  const pre = useSharedValue(0);
  const heir = useSharedValue(0);
  const row = useSharedValue(0);
  const slap = useSharedValue(0);
  const flash = useSharedValue(0);
  const shake = useSharedValue(0);
  const sub = useSharedValue(0);
  const [showCta, setShowCta] = useState(false);

  // The impact fires once per mount — sound, haptic and the done flag must never double.
  const landedRef = useRef(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const impact = () => {
      if (landedRef.current) return;
      landedRef.current = true;
      const prefs = getRewardPreferencesSync();
      if (prefs.reward_sfx_enabled) playRewardSound('seal-claim');
      if (prefs.haptics) safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
      // Claimed the instant the seal lands — a user who kills the app on the sub-line has seen it.
      markCeremonyDone(userId).catch(() => {});
    };

    if (reduceMotion) {
      const fade = { duration: 400 };
      rays.value = withTiming(0.5, fade);
      pre.value = withTiming(1, fade);
      heir.value = withTiming(1, fade);
      row.value = withTiming(1, fade);
      slap.value = withTiming(1, fade);
      sub.value = withTiming(1, fade);
      impact();
      timers.push(setTimeout(() => setShowCta(true), 600));
      return () => timers.forEach(clearTimeout);
    }

    const fadeUp = { duration: 600, easing: Easing.out(Easing.cubic) };
    rays.value = withDelay(
      RAYS_AT,
      withSequence(withTiming(0.9, { duration: 1560, easing: Easing.out(Easing.quad) }), withTiming(0.5, { duration: 1040 }))
    );
    spin.value = withDelay(1000, withRepeat(withTiming(1, { duration: 14000, easing: Easing.linear }), -1, false));
    pre.value = withDelay(PRE_AT, withTiming(1, fadeUp));
    heir.value = withDelay(HEIR_AT, withTiming(1, { duration: 700, easing: Easing.bezier(0.2, 0.9, 0.3, 1.3) }));
    row.value = withDelay(ROW_AT, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
    // 0 → 0.7 is the fall to the overshoot (scale .86, +4°), 0.7 → 1 the settle.
    slap.value = withDelay(SLAP_AT, withTiming(1, { duration: 420, easing: Easing.bezier(0.2, 0.8, 0.2, 1) }));
    flash.value = withDelay(IMPACT_AT, withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) }));
    shake.value = withDelay(
      IMPACT_AT,
      withSequence(
        withTiming(-1, { duration: 80 }),
        withTiming(1, { duration: 80 }),
        withTiming(-0.66, { duration: 80 }),
        withTiming(0.5, { duration: 80 }),
        withTiming(0, { duration: 80 })
      )
    );
    sub.value = withDelay(SUB_AT, withTiming(1, fadeUp));
    timers.push(setTimeout(impact, IMPACT_AT));
    timers.push(setTimeout(() => setShowCta(true), CTA_AT));
    return () => timers.forEach(clearTimeout);
  }, [reduceMotion, userId, rays, spin, pre, heir, row, slap, flash, shake, sub]);

  // Leaving by any route (unmount included) lets the choir's long tail die away rather than cut.
  useEffect(() => () => fadeOutRewardSound('seal-claim', 1200), []);

  const stageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value * 6 }] }));
  const raysStyle = useAnimatedStyle(() => ({
    opacity: rays.value,
    transform: [{ scale: 0.2 + 0.8 * Math.min(1, rays.value / 0.9) }, { rotate: `${spin.value * 360}deg` }],
  }));
  const preStyle = useAnimatedStyle(() => ({ opacity: pre.value, transform: [{ translateY: (1 - pre.value) * 10 }] }));
  const rowStyle = useAnimatedStyle(() => ({ opacity: row.value, transform: [{ translateY: (1 - row.value) * 10 }] }));
  const subStyle = useAnimatedStyle(() => ({ opacity: sub.value, transform: [{ translateY: (1 - sub.value) * 10 }] }));
  const heirStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, heir.value),
    transform: [{ scale: 0.6 + 0.4 * heir.value }],
  }));
  const sealStyle = useAnimatedStyle(() => {
    const t = slap.value;
    // Two legs, matching mock 287's `slap` keyframes: 6× / −18° → .86× / +4° at 70%, then → 1× / 0°.
    const a = Math.min(1, t / 0.7);
    const b = t <= 0.7 ? 0 : (t - 0.7) / 0.3;
    const scale = t <= 0.7 ? 6 + (0.86 - 6) * a : 0.86 + 0.14 * b;
    const rotate = t <= 0.7 ? -18 + 22 * a : 4 - 4 * b;
    return { opacity: Math.min(1, t / 0.2), transform: [{ scale }, { rotate: `${rotate}deg` }] };
  });
  const flashStyle = useAnimatedStyle(() => {
    const t = flash.value;
    return {
      opacity: t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7,
      transform: [{ scale: 0.3 + 1.2 * t }],
    };
  });

  return (
    <Screen padded={false} backgroundColor={Colors.forgeBg}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <Animated.View style={[styles.stage, stageStyle]}>
        <Animated.View style={[styles.rays, raysStyle]} pointerEvents="none">
          <Rays />
        </Animated.View>
        <Animated.View style={[styles.flash, flashStyle]} pointerEvents="none">
          <FlashDisc />
        </Animated.View>

        <Animated.Text style={[styles.pre, preStyle]}>You are now shown to the world as</Animated.Text>
        <Animated.View style={[styles.heirWrap, heirStyle]}>
          <Text style={styles.heirSmall}>Heir to</Text>
          <Text style={styles.heir}>{program.patron_name}</Text>
        </Animated.View>

        <Animated.View style={[styles.nameRow, rowStyle]}>
          <Text style={styles.uname} numberOfLines={1}>
            {handle ? `@${handle}` : 'You'}
          </Text>
          <View style={styles.sealSlot}>
            <Animated.View style={sealStyle}>
              <HouseMedallion patronKey={program.patron_key} patronName={program.patron_name} size={36} />
            </Animated.View>
          </View>
        </Animated.View>

        <Animated.Text style={[styles.sub, subStyle]}>
          This is how others will know you across Philoi — <Text style={styles.subStrong}>by your program.</Text> Your
          seal flies beside your name on every board.
        </Animated.Text>
      </Animated.View>

      <View style={styles.sealFoot}>
        {showCta ? <PrimaryButton label="Enter Philoi →" onPress={onEnter} /> : <View style={styles.ctaPlaceholder} />}
      </View>
    </Screen>
  );
}

const RAYS_SIZE = 520;

/** Mock 287's conic rays as twelve thin gold wedges — RN has no conic gradient. */
function Rays() {
  const c = RAYS_SIZE / 2;
  const wedges = Array.from({ length: 12 }, (_, i) => {
    const a0 = ((i * 30 - 3) * Math.PI) / 180;
    const a1 = ((i * 30 + 3) * Math.PI) / 180;
    return `M${c} ${c} L${c + c * Math.cos(a0)} ${c + c * Math.sin(a0)} L${c + c * Math.cos(a1)} ${c + c * Math.sin(a1)} Z`;
  });
  return (
    <Svg width={RAYS_SIZE} height={RAYS_SIZE}>
      <Defs>
        <RadialGradient id="sealRays" cx={c} cy={c} r={c} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#FFD166" stopOpacity="0.32" />
          <Stop offset="1" stopColor="#FFD166" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      {wedges.map((d, i) => (
        <Path key={i} d={d} fill="url(#sealRays)" />
      ))}
    </Svg>
  );
}

const FLASH_SIZE = 240;

function FlashDisc() {
  const c = FLASH_SIZE / 2;
  return (
    <Svg width={FLASH_SIZE} height={FLASH_SIZE}>
      <Defs>
        <RadialGradient id="sealFlash" cx={c} cy={c} r={c} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#FFF0C8" stopOpacity="0.9" />
          <Stop offset="0.6" stopColor="#FFB45A" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx={c} cy={c} r={c} fill="url(#sealFlash)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loreContent: {
    flexGrow: 1,
    paddingBottom: Spacing.three,
  },
  scene: {
    width: '100%',
    overflow: 'hidden',
  },
  claimed: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: '#FFE3B0',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  medalWrap: {
    alignItems: 'center',
    marginTop: -48,
  },
  body: {
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: Spacing.twelve,
  },
  pname: {
    fontFamily: Fonts.black,
    fontSize: 27,
    letterSpacing: 0.5,
    color: Colors.ink,
    textAlign: 'center',
  },
  ptitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: TITLE_GOLD,
    textAlign: 'center',
    marginTop: 5,
  },
  yourprog: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.amber,
    marginTop: Spacing.three,
    textAlign: 'center',
  },
  yourprogName: {
    color: Colors.ink,
  },
  meander: {
    marginTop: 14,
    marginBottom: 4,
  },
  lore: {
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    fontSize: 13.5,
    lineHeight: 23,
    color: LORE_INK,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  loreNext: {
    marginTop: Spacing.three,
  },
  loreDrop: {
    fontStyle: 'normal',
    fontFamily: Fonts.bodyBold,
    color: GOLD,
  },
  foot: {
    marginTop: 'auto',
    paddingTop: 22,
    paddingHorizontal: 22,
  },
  skip: {
    alignSelf: 'center',
    paddingVertical: Spacing.twelve,
  },
  skipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    overflow: 'hidden',
  },
  rays: {
    position: 'absolute',
    top: '42%',
    left: '50%',
    width: RAYS_SIZE,
    height: RAYS_SIZE,
    marginLeft: -RAYS_SIZE / 2,
    marginTop: -RAYS_SIZE / 2,
  },
  flash: {
    position: 'absolute',
    top: '42%',
    left: '50%',
    width: FLASH_SIZE,
    height: FLASH_SIZE,
    marginLeft: -FLASH_SIZE / 2,
    marginTop: -FLASH_SIZE / 2,
  },
  pre: {
    fontFamily: Fonts.body,
    fontSize: 13,
    letterSpacing: 0.3,
    color: Colors.muted,
    textAlign: 'center',
    marginBottom: 6,
  },
  heirWrap: {
    alignItems: 'center',
  },
  heirSmall: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: TITLE_GOLD,
    marginBottom: 4,
  },
  heir: {
    fontFamily: Fonts.black,
    fontSize: 30,
    color: GOLD,
    textAlign: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 30,
    maxWidth: '100%',
  },
  uname: {
    fontFamily: Fonts.black,
    fontSize: 22,
    color: Colors.ink,
    flexShrink: 1,
  },
  sealSlot: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textTertiary,
    textAlign: 'center',
    maxWidth: 240,
    marginTop: 20,
  },
  subStrong: {
    color: Colors.muted,
    fontFamily: Fonts.bodyBold,
  },
  sealFoot: {
    paddingHorizontal: 22,
    paddingBottom: Spacing.three,
  },
  // Holds the button's height so the stage doesn't jump up when the CTA arrives.
  ctaPlaceholder: {
    height: 56,
  },
});
