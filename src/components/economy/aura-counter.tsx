import * as Haptics from 'expo-haptics';
import { useEffect, useId, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Fonts } from '@/constants/theme';
import { useElapsedSeconds } from '@/hooks/use-elapsed-seconds';
import { useGatedInterval } from '@/hooks/use-motion-active';
import { useActiveSession } from '@/lib/active-session-context';
import { getRewardPreferencesSync } from '@/lib/reward-settings';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// +1000 AURA (Meme Monday, migration 0243) — the flare whose effect is a number.
//
// While a lock-in runs, a counter reads "+N AURA", N = credited seconds + 1, capped at +9999
// (2h 46m 39s). It is read off the session's own clock (useElapsedSeconds → creditedSeconds, the
// 0218 definition), never counted locally, so it survives backgrounding, remounts and pauses
// exactly like the timer does: paused time freezes it, and a fresh session starts it at +1 again.
//
// At the cap the screen goes "ballistic" ONCE per session: a full-screen rainbow glow swells, spins
// and settles, then holds faintly for the rest of the session. Once = the first time this build sees
// the session at the cap — tracked per session id in memory, so leaving and re-opening the lock-in
// screen does not replay it (a cold app restart past the cap can, once).
//
// No server state: owning + equipping the flare is the whole entitlement.
//
// Outside a session (the gallery, a preview) there is no clock to read, so it runs the art's demo:
// the number races up to +9999, bursts, and loops.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export const AURA_CAP = 9999;

const AURA_GOLD = '#FFE08A';
const AURA_GREEN = '#8BE06A';
const RAINBOW = ['#FF5A5A', '#FFD27A', '#8BE06A', '#46E0E0', '#B98CFF', '#FF6FD8'] as const;

/** Sessions whose cap burst has already played in this process. */
const burstPlayed = new Set<string>();

/** The counter value for a credited duration: +1 at 0:00, +1 per second, never past the cap. */
export function auraCount(creditedSeconds: number): number {
  return Math.min(AURA_CAP, Math.floor(creditedSeconds) + 1);
}

export function AuraCounter({ width, height }: { width: number; height: number }) {
  const { session } = useActiveSession();
  return session ? (
    <LiveAura sessionId={session.id} clock={session} width={width} height={height} />
  ) : (
    <DemoAura width={width} height={height} />
  );
}

function LiveAura({
  sessionId,
  clock,
  width,
  height,
}: {
  sessionId: string;
  clock: Parameters<typeof useElapsedSeconds>[0];
  width: number;
  height: number;
}) {
  const count = auraCount(useElapsedSeconds(clock));
  return <AuraFace count={count} burstKey={sessionId} width={width} height={height} />;
}

/** The art's own demo curve (MEME_MONDAY.html): a geometric race to the cap, a beat at the top, again. */
function DemoAura({ width, height }: { width: number; height: number }) {
  const [tick, setTick] = useState({ step: 0, loop: 0 });
  useGatedInterval(() => setTick((t) => (t.step >= 79 ? { step: 0, loop: t.loop + 1 } : { step: t.step + 1, loop: t.loop })), 80);
  // ~60 steps to the cap, ~20 held there. Each loop is its own burst key, so the burst replays.
  let n = 1;
  for (let i = 0; i < tick.step && n < AURA_CAP; i += 1) n = Math.min(AURA_CAP, n + Math.ceil(n * 0.06) + 5);
  return <AuraFace count={n} burstKey={`demo-${tick.loop}`} width={width} height={height} />;
}

function AuraFace({ count, burstKey, width, height }: { count: number; burstKey: string; width: number; height: number }) {
  const maxed = count >= AURA_CAP;
  const reducedMotion = useReducedMotion();
  // 0 → 1 → the held level. Driven, never mounted/unmounted, so there is no setState in an effect.
  const burst = useSharedValue(maxed ? HOLD : 0);

  useEffect(() => {
    if (!maxed) {
      burst.value = 0;
      return;
    }
    if (burstPlayed.has(burstKey)) {
      burst.value = HOLD;
      return;
    }
    burstPlayed.add(burstKey);
    if (getRewardPreferencesSync().haptics) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    if (reducedMotion) {
      burst.value = HOLD;
      return;
    }
    burst.value = 0;
    burst.value = withSequence(
      withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 900 }),
      withTiming(HOLD, { duration: 1400, easing: Easing.inOut(Easing.quad) })
    );
  }, [maxed, burstKey, burst, reducedMotion]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {maxed ? <Ballistic width={width} height={height} burst={burst} still={reducedMotion} /> : null}
      <View style={[styles.counter, { top: Math.round(height * 0.19) }]} accessibilityLabel={`Plus ${count} aura`}>
        <Text style={[styles.number, maxed && styles.numberMaxed]}>+{count}</Text>
        <Text style={styles.label}>AURA</Text>
      </View>
    </View>
  );
}

/** How strong the rainbow stays after the burst, for the rest of the session. */
const HOLD = 0.18;

/**
 * The rainbow: six soft glows of the spectrum ringed round the screen's centre, in a square big
 * enough that turning it never uncovers a corner. The whole layer turns slowly and its opacity is
 * the burst value — a swell to full, a beat, then down to HOLD.
 */
function Ballistic({
  width,
  height,
  burst,
  still,
}: {
  width: number;
  height: number;
  burst: ReturnType<typeof useSharedValue<number>>;
  still: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const side = Math.ceil(Math.hypot(width, height));
  const spin = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    spin.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.linear }), -1, false);
  }, [spin, still]);
  const style = useAnimatedStyle(() => ({
    opacity: burst.value,
    transform: [{ rotate: `${spin.value * 360}deg` }, { scale: 0.92 + 0.08 * Math.min(1, burst.value * 1.2) }],
  }));
  const glow = side * 0.42;
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: (width - side) / 2, top: (height - side) / 2, width: side, height: side, opacity: 0 }, style]}>
      <Svg width={side} height={side}>
        <Defs>
          {RAINBOW.map((c, i) => (
            <RadialGradient key={c} id={`auraRainbow${i}-${uid}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={c} stopOpacity={0.75} />
              <Stop offset="0.55" stopColor={c} stopOpacity={0.25} />
              <Stop offset="1" stopColor={c} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {RAINBOW.map((c, i) => {
          const a = (i / RAINBOW.length) * Math.PI * 2;
          const cx = side / 2 + Math.cos(a) * side * 0.3;
          const cy = side / 2 + Math.sin(a) * side * 0.3;
          return <Rect key={c} x={cx - glow / 2} y={cy - glow / 2} width={glow} height={glow} fill={`url(#auraRainbow${i}-${uid})`} />;
        })}
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  counter: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  number: {
    fontFamily: Fonts.black,
    fontSize: 30,
    color: AURA_GOLD,
    fontVariant: ['tabular-nums'],
    textShadowColor: AURA_GREEN,
    textShadowRadius: 14,
    textShadowOffset: { width: 0, height: 0 },
  },
  numberMaxed: {
    color: '#FFFFFF',
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 5,
    color: AURA_GREEN,
    marginTop: 2,
  },
});
