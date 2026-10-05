import { useEffect, useId, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { usePassMotion } from '@/components/pass/pass-motion';
import { Fonts } from '@/constants/theme';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// EMBERFALL — the season's visual kit (mocks 223 paywall · 224 shop banner · 225 purchase success ·
// 226 tutorial). Every piece is SVG or plain views: no image assets, no native modules.
//
// ── WHY THESE EMBERS FALL ──
// pass-motion's RisingEmbers rise on purpose — the brand is a fire that climbs. Emberfall is the one
// place the embers come DOWN: the season's story is Hades cracking the sky and the fire raining out
// of it. The Emberfall Ascendant flare is the item that climbs AGAINST that rain, which only reads
// if the rain is really falling around it.
//
// Same motion contract as pass-motion: under Reduce Motion, or while the screen is blurred, looping
// layers unmount or park on a still frame rather than freezing mid-flight.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export const EMBER = {
  e0: '#E0612C',
  e1: '#F2A33C',
  e2: '#FFD27A',
  e3: '#FFF3D6',
  warm: 'rgba(255,243,214,0.92)',
  warm2: 'rgba(255,243,214,0.72)',
  ink: '#F7F1FF',
  dim: '#CDBFE6',
  mut: '#B7A9CE',
  card: '#160E22',
  line: '#3a2b52',
  line2: '#4c3a6a',
} as const;

// ─────────────────────────── the sky ───────────────────────────

/** Void black → deep blue → purple → ember → bold orange, top to bottom. */
const SKIES = {
  // Mock 223's `.phone` — the paywall, one gradient the whole scroll height.
  paywall: [
    [0, '#040309'],
    [0.12, '#05081F'],
    [0.26, '#0A1440'],
    [0.4, '#14174A'],
    [0.54, '#2C1548'],
    [0.72, '#5A2018'],
    [0.88, '#A83C18'],
    [1, '#E86A2A'],
  ],
  // Mock 224's `.banner`.
  banner: [
    [0, '#050308'],
    [0.34, '#0A1440'],
    [0.62, '#2C1548'],
    [0.88, '#7E2A18'],
    [1, '#C9481A'],
  ],
  // Mock 225's `.phone`.
  success: [
    [0, '#050308'],
    [0.26, '#0A1440'],
    [0.52, '#2C1548'],
    [0.78, '#7E2A18'],
    [1, '#E86A2A'],
  ],
  // The Flame Pass track — the --ember identity (mocks 247/259), not the paywall's night sky. No
  // blue or purple anywhere: charcoal ember at the top, where the light text sits, burning down to
  // the leaderboard splash's mid-ember (#7a2a08) at the foot.
  pass: [
    [0, '#0B0503'],
    [0.3, '#170803'],
    [0.62, '#2E1004'],
    [0.86, '#521C06'],
    [1, '#7a2a08'],
  ],
  // Mock 227's `.mini.fire` — the tutorial's premium shift.
  tutorial: [
    [0, '#0C0812'],
    [0.3, '#0A1440'],
    [0.6, '#2C1548'],
    [0.9, '#7E2A18'],
    [1, '#C9481A'],
  ],
} as const;

export type SkyKind = keyof typeof SKIES;

/** The season's sky, filling its parent. Put it first so everything else paints over it. */
export function EmberfallSky({ kind, style }: { kind: SkyKind; style?: ViewStyle }) {
  const grad = `efSky-${useId()}`;
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
            {SKIES[kind].map(([at, color]) => (
              <Stop key={at} offset={at} stopColor={color} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${grad})`} />
      </Svg>
    </View>
  );
}

// ─────────────────────────── falling embers ───────────────────────────

/**
 * Embers raining from the top edge to the bottom of their parent. `fall` is how far they travel —
 * the parent's height; a short card passes its own, a full-screen layer defaults to the window.
 * Deterministic spread (golden-ratio offsets), so a re-render cannot reshuffle the field.
 */
export function FallingEmbers({ count = 12, fall, style }: { count?: number; fall?: number; style?: ViewStyle }) {
  const run = usePassMotion();
  const { height } = useWindowDimensions();
  const travel = fall ?? height + 40;
  if (!run) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.clip, style]} pointerEvents="none">
      {Array.from({ length: count }, (_, i) => {
        const f = (i * 0.618034) % 1;
        const g = (i * 0.414214) % 1;
        // Long and short falls interleaved, as in the mock: some cross the whole sky, some burn out.
        const reach = i % 3 === 0 ? travel : travel * (0.35 + g * 0.4);
        return (
          <FallingEmber
            key={i}
            left={`${4 + f * 92}%`}
            drift={(g - 0.5) * 18}
            duration={Math.round((reach / travel) * (9000 + g * 5000)) + 3000}
            delay={Math.round(((i * 0.37) % 1) * 6000)}
            fall={reach}
            size={2.6 + (i % 2) * 0.8}
          />
        );
      })}
    </View>
  );
}

function FallingEmber({
  left,
  drift,
  duration,
  delay,
  fall,
  size,
}: {
  left: string;
  drift: number;
  duration: number;
  delay: number;
  fall: number;
  size: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false));
  }, [delay, duration, t]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.06, 0.88, 1], [0, 1, 0.85, 0]),
    transform: [{ translateY: interpolate(t.value, [0, 1], [0, fall]) }, { translateX: interpolate(t.value, [0, 1], [0, drift]) }],
  }));

  // Two translucent rings for the glow — Android draws no coloured shadow on a tiny view (see
  // RisingEmber in pass-motion for the device bug that taught this).
  const halo = size * 3.4;
  return (
    <Animated.View style={[styles.ember, { left: left as `${number}%`, width: halo, height: halo, marginLeft: -halo / 2 }, style]}>
      <View style={[styles.emberHalo, { width: halo, height: halo, borderRadius: halo / 2 }]} />
      <View style={[styles.emberCore, { width: size, height: size, borderRadius: size / 2 }]} />
    </Animated.View>
  );
}

// ─────────────────────────── Hades' constellation ───────────────────────────

/** Mock 223's figure, in its own 394×212 space: the horned head, the arms, the chained legs. */
const FIGURE_LINES = [
  'M150 60 L165 30 L178 58',
  'M244 60 L229 30 L216 58',
  'M178 58 L197 48 L216 58',
  'M197 48 L197 74',
  'M197 74 L160 96 M197 74 L234 96',
  'M160 96 L120 78 L96 96',
  'M234 96 L274 78 L298 96',
  'M160 96 L176 150 M234 96 L218 150',
  'M176 150 L218 150',
];
const FIGURE_FADES = [
  { d: 'M120 168 L176 150 M218 150 L274 168', o: 0.6 },
  { d: 'M96 176 L120 168 M274 168 L298 176', o: 0.45 },
];
const FIGURE_STARS: [number, number, number][] = [
  [165, 30, 2.2], [229, 30, 2.2], [197, 48, 2.6], [197, 74, 2], [160, 96, 2.4], [234, 96, 2.4],
  [96, 96, 2], [298, 96, 2], [120, 78, 1.6], [274, 78, 1.6], [176, 150, 2], [218, 150, 2],
  [178, 58, 1.6], [216, 58, 1.6],
];
/** The field around the figure — twinkles in two phases. */
const FIELD_A: [number, number, number][] = [
  [120, 42, 1.5], [150, 118, 1.3], [188, 20, 1.3], [292, 120, 1.5], [304, 74, 1.3], [214, 184, 1.4],
  [256, 66, 1.2], [130, 98, 1.2], [134, 52, 1.7], [296, 96, 1.5],
];
const FIELD_B: [number, number, number][] = [
  [272, 46, 1.5], [248, 126, 1.4], [108, 132, 1.3], [92, 66, 1.2], [176, 184, 1.4], [140, 70, 1.2],
  [197, 120, 1.4], [264, 100, 1.2], [260, 56, 1.7], [100, 100, 1.5], [197, 100, 1.5],
];
const HOT = new Set(['134,52', '260,56', '100,100', '296,96', '197,100']);

/**
 * The Hades constellation — burning stars joined into the god's figure. Scales to its box; the
 * figure keeps its aspect and centres.
 */
export function HadesConstellation({ width, height }: { width: number; height: number }) {
  const run = usePassMotion();
  const a = useSharedValue(0.5);
  const b = useSharedValue(0.5);

  useEffect(() => {
    if (!run) {
      cancelAnimation(a);
      cancelAnimation(b);
      a.value = 0.7;
      b.value = 0.7;
      return;
    }
    a.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }), -1, true);
    b.value = withDelay(1100, withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [run, a, b]);

  const aStyle = useAnimatedStyle(() => ({ opacity: interpolate(a.value, [0, 1], [0.35, 1]) }));
  const bStyle = useAnimatedStyle(() => ({ opacity: interpolate(b.value, [0, 1], [1, 0.35]) }));

  const box = { width, height };
  const vb = '0 0 394 212';

  return (
    <View style={box} pointerEvents="none">
      <Svg width={width} height={height} viewBox={vb}>
        {/* A soft bloom under each figure star, standing in for the mock's drop-shadow filter. */}
        <G fill="#FFC870" opacity={0.28}>
          {FIGURE_STARS.map(([x, y, r]) => (
            <Circle key={`g${x},${y}`} cx={x} cy={y} r={r * 3} />
          ))}
        </G>
        <G stroke="#FFEAC0" strokeWidth={1.1} strokeLinecap="round" fill="none" opacity={0.95}>
          {FIGURE_LINES.map((d) => (
            <Path key={d} d={d} />
          ))}
          {FIGURE_FADES.map((l) => (
            <Path key={l.d} d={l.d} opacity={l.o} />
          ))}
        </G>
        <G fill="#FFF6E0">
          {FIGURE_STARS.map(([x, y, r]) => (
            <Circle key={`s${x},${y}`} cx={x} cy={y} r={r} />
          ))}
        </G>
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, aStyle]}>
        <StarField stars={FIELD_A} width={width} height={height} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, bStyle]}>
        <StarField stars={FIELD_B} width={width} height={height} />
      </Animated.View>
    </View>
  );
}

function StarField({ stars, width, height }: { stars: [number, number, number][]; width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 394 212">
      {stars.map(([x, y, r]) => (
        <Circle key={`${x},${y}`} cx={x} cy={y} r={r} fill={HOT.has(`${x},${y}`) ? '#FFB861' : '#FFF6E0'} />
      ))}
    </Svg>
  );
}

// ─────────────────────────── "Own Emberfall" — the gold flash ───────────────────────────

/**
 * Gold text with a bright band sweeping across it on a loop (the mock's `ownflash`: a 230%-wide
 * gradient scrolled through background-clip:text).
 *
 * No text clip in RN, so the sweep is a WINDOW: a narrow clipped view slides across the word, and
 * inside it a pale copy of the same Text slides the opposite way by the same amount, so the copy's
 * glyphs stay registered on the gold ones underneath. Three windows of falling width and rising
 * brightness give the band a soft edge.
 */
export function FlashText({ children, style }: { children: string; style: TextStyle }) {
  const run = usePassMotion();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const t = useSharedValue(0);

  useEffect(() => {
    if (!run || !box) return;
    t.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [run, box, t]);

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    if (!box || Math.abs(box.w - width) > 0.5) setBox({ w: width, h: height });
  }

  return (
    <View>
      <Text style={[style, { color: EMBER.e2 }]} onLayout={onLayout}>
        {children}
      </Text>
      {box && run
        ? SWEEP.map((s) => (
            <SweepWindow key={s.color} t={t} box={box} frac={s.frac} color={s.color} style={style}>
              {children}
            </SweepWindow>
          ))
        : null}
    </View>
  );
}

const SWEEP = [
  { frac: 0.42, color: '#FFE3A0' },
  { frac: 0.26, color: '#FFF1CC' },
  { frac: 0.12, color: '#FFFEF7' },
] as const;

function SweepWindow({
  t,
  box,
  frac,
  color,
  style,
  children,
}: {
  t: { value: number };
  box: { w: number; h: number };
  frac: number;
  color: string;
  style: TextStyle;
  children: string;
}) {
  const win = box.w * frac;
  // The window's CENTRE travels from well left of the word to well right of it, so the band enters
  // and leaves cleanly instead of popping in at the first glyph.
  const outer = useAnimatedStyle(() => {
    const x = interpolate(t.value, [0, 1], [-box.w * 0.55, box.w * 1.55]) - win / 2;
    return { transform: [{ translateX: x }] };
  });
  const inner = useAnimatedStyle(() => {
    const x = interpolate(t.value, [0, 1], [-box.w * 0.55, box.w * 1.55]) - win / 2;
    return { transform: [{ translateX: -x }] };
  });
  return (
    <Animated.View style={[styles.sweepWindow, { width: win, height: box.h }, outer]} pointerEvents="none">
      <Animated.View style={[{ width: box.w }, inner]}>
        {/* No shadow on the copies: a dark drop-shadow drawn over the gold word would read as a
            smudge travelling with the band. */}
        <Text style={[style, styles.noShadow, { color, width: box.w }]}>{children}</Text>
      </Animated.View>
    </Animated.View>
  );
}

// ─────────────────────────── laurel + Greek key ───────────────────────────

/** Mock 223's laurel branch (filled gold leaves on a curved stem), in a 40×86 box. */
export function Laurel({ height = 86, flip = false }: { height?: number; flip?: boolean }) {
  const grad = `efLaurel-${useId()}`;
  const width = (height * 40) / 86;
  const leaves: [number, number, number, number, number, number?][] = [
    [30.5, 74, 6.2, 2.7, -30],
    [28, 64, 6.6, 2.8, -38],
    [25.5, 54, 6.8, 2.9, -45],
    [23.5, 44, 6.8, 2.9, -51],
    [22, 34, 6.4, 2.8, -57],
    [21.2, 24.5, 5.6, 2.6, -63],
    [21, 16, 4.6, 2.3, -70],
    [31.5, 68.5, 4.2, 2.1, -15, 0.82],
    [29, 58.5, 4.6, 2.2, -22, 0.82],
    [26.5, 48.5, 4.6, 2.2, -28, 0.82],
  ];
  return (
    <View style={flip ? styles.flip : undefined} pointerEvents="none">
      <Svg width={width} height={height} viewBox="0 0 40 86">
        <Defs>
          <LinearGradient id={grad} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#E0912C" />
            <Stop offset="0.55" stopColor="#FFD27A" />
            <Stop offset="1" stopColor="#FFF6E0" />
          </LinearGradient>
        </Defs>
        <Path d="M35 84 C25 68 20.5 44 21 6" stroke={`url(#${grad})`} strokeWidth={1.7} fill="none" strokeLinecap="round" />
        <G fill={`url(#${grad})`} stroke="#6e3f10" strokeWidth={0.35}>
          {leaves.map(([cx, cy, rx, ry, rot, o]) => (
            <Ellipse key={`${cx},${cy}`} cx={cx} cy={cy} rx={rx} ry={ry} rotation={rot} origin={`${cx}, ${cy}`} opacity={o ?? 1} />
          ))}
        </G>
      </Svg>
    </View>
  );
}

/** The Greek-key divider between the pitch and the gallery. */
export function GreekKeyDivider() {
  const l = `efKeyL-${useId()}`;
  const r = `efKeyR-${useId()}`;
  return (
    <View style={styles.divider} pointerEvents="none">
      <Svg width={64} height={2}>
        <Defs>
          <LinearGradient id={l} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={EMBER.e2} stopOpacity={0} />
            <Stop offset="1" stopColor={EMBER.e2} stopOpacity={0.65} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="64" height="1" fill={`url(#${l})`} />
      </Svg>
      <Svg width={34} height={12} viewBox="0 0 34 12">
        <Path d="M2 9 h6 v-6 h4 v6 h6 v-6 h4 v6 h6" stroke={EMBER.e2} strokeWidth={1.2} strokeLinecap="square" fill="none" />
      </Svg>
      <Svg width={64} height={2}>
        <Defs>
          <LinearGradient id={r} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={EMBER.e2} stopOpacity={0.65} />
            <Stop offset="1" stopColor={EMBER.e2} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="64" height="1" fill={`url(#${r})`} />
      </Svg>
    </View>
  );
}

// ─────────────────────────── the Emberfall Seal ───────────────────────────

/**
 * The Seal sigil (`medal-emberfall-crown`, "The Emberfall Seal"): a molten disc, a dark ring, a
 * black core — the lid on the underworld. Eight rune ticks on the rim are what make the slow spin
 * visible; a radially symmetric disc turning looks exactly like one standing still.
 */
export function EmberfallSeal({ size, spin = true }: { size: number; spin?: boolean }) {
  const run = usePassMotion();
  const grad = `efSeal-${useId()}`;
  const glow = `efSealGlow-${useId()}`;
  const r = useSharedValue(0);

  useEffect(() => {
    if (!run || !spin) {
      cancelAnimation(r);
      return;
    }
    r.value = 0;
    r.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.linear }), -1, false);
  }, [run, spin, r]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 360}deg` }] }));
  const pad = size * 0.35;
  const full = size + pad * 2;
  const ticks = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);

  return (
    <View style={{ width: full, height: full, alignItems: 'center', justifyContent: 'center', margin: -pad }} pointerEvents="none">
      <Svg width={full} height={full} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={glow} cx="50%" cy="50%" r="50%">
            <Stop offset="0.45" stopColor="#FF8C3C" stopOpacity={0.7} />
            <Stop offset="1" stopColor="#FF8C3C" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={full / 2} cy={full / 2} r={full / 2} fill={`url(#${glow})`} />
      </Svg>
      <Animated.View style={style}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={grad} cx="50%" cy="45%" r="55%">
              <Stop offset="0" stopColor="#FFF3D6" />
              <Stop offset="0.4" stopColor="#FFB347" />
              <Stop offset="1" stopColor="#7a1e0e" />
            </RadialGradient>
          </Defs>
          <Circle cx="50" cy="50" r="50" fill={`url(#${grad})`} />
          <Circle cx="50" cy="50" r="35" fill="none" stroke="rgba(20,8,4,0.6)" strokeWidth={3} />
          {ticks.map((a) => (
            <Line
              key={a}
              x1={50 + Math.cos(a) * 38}
              y1={50 + Math.sin(a) * 38}
              x2={50 + Math.cos(a) * 46}
              y2={50 + Math.sin(a) * 46}
              stroke="rgba(20,8,4,0.55)"
              strokeWidth={3}
              strokeLinecap="round"
            />
          ))}
          <Circle cx="50" cy="50" r="19" fill="#1a0a04" stroke="rgba(255,210,122,0.55)" strokeWidth={4} />
        </Svg>
      </Animated.View>
    </View>
  );
}

// ─────────────────────────── the pill tag ───────────────────────────

/** "FLAME PASS · SEASON 1" — the small bordered kicker over every Emberfall headline. */
export function EmberTag({ children }: { children: ReactNode }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  ember: {
    position: 'absolute',
    top: -12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emberHalo: {
    position: 'absolute',
    backgroundColor: 'rgba(242,163,60,0.28)',
  },
  emberCore: {
    backgroundColor: EMBER.e2,
  },
  sweepWindow: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
  },
  flip: {
    transform: [{ scaleX: -1 }],
  },
  noShadow: {
    textShadowRadius: 0,
    textShadowColor: 'transparent',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
  },
  tag: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,210,122,0.5)',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(20,10,8,0.35)',
  },
  tagText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 2.2,
    color: EMBER.e2,
    textTransform: 'uppercase',
  },
});
