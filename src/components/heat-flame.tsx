import { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { useReduceMotion } from '@/hooks/use-reduce-motion';

// The ACTIVITY GAUGE (mock 93). One `heat` in [0,1] drives three states, and the same mapping
// serves every campfire surface — the valley nodes, the campfire card, the banner hero.
//
// This is deliberately NOT FlameLogo. The brand mark is one clean silhouette (and it is what Home
// wears now — Home is *you*, and you don't go cold); a gauge has to read as a different *thing* at
// each state, not the same glyph at three opacities. So every state here is its own composition
// over a PERSISTENT COAL BED. The bed is what makes it a fire rather than an icon: it stays put
// while what burns on top changes.
//
//   >= 0.6  roaring    — a staggered cluster of tongues off a bright bed, plus rising sparks
//   0.15-0.6 simmering — a few low, slow licks off a glowing ember bed
//   < 0.15  cold       — dead grey coals, no glow, drifting smoke puffs (the "relight" nudge)
//
// GEOMETRY IS MOCK 93'S, LITERALLY. The first build drew each tongue as an Animated.View with a
// borderRadius — a rounded rectangle, which renders as a yellow lozenge on a brown ellipse, not a
// flame (punchlist 20.1: "rendered horribly"). A tongue is POINTED: two beziers sweeping from a
// wide base to a single apex, and that shape only exists as an SVG <Path>. So every path below is
// copied verbatim out of design-mocks/93-flame-heat-states.html rather than re-derived.

export type HeatState = 'roaring' | 'simmering' | 'cold';

export function heatToState(heat: number): HeatState {
  if (heat >= 0.6) return 'roaring';
  if (heat >= 0.15) return 'simmering';
  return 'cold';
}

/** Mock 93's scene viewBox. Every coordinate in this file is in these units, scaled by size/120. */
const VB = 120;

/** The baseline every tongue stands on (`M.. 100` in the mock) — the scale/rotate pivot. */
const TONGUE_BASE_Y = 100;

// The mock's two flicker keyframes. `flick` and `flick2` are mirror images of each other: a tongue
// leaning left while its neighbour leans right is what stops a cluster reading as one pulsing
// blob. Interpolated from t=0 (rest) to t=1 (peak) — Reanimated's `reverse: true` supplies the
// return leg, exactly like the CSS `0%,100%` bookends.
const FLICK = { scaleFrom: 0.82, scaleTo: 1.08, rotFrom: -2.5, rotTo: 2.5 };
const FLICK2 = { scaleFrom: 0.9, scaleTo: 1.12, rotFrom: 2, rotTo: -2 };

type TongueSpec = {
  d: string;
  /** Which gradient fills it — `outer` is the ember body, `inner` the pale core. */
  fill: 'outer' | 'inner' | 'lick';
  flick: typeof FLICK;
  /** Seconds in the mock, milliseconds here. */
  ms: number;
  delay: number;
  /** The mock's `.tongue.outer` carries `filter: blur(1px)`; RN has no SVG blur, so the two
   *  outermost licks soften with opacity instead — same job (they sit behind), no native dep. */
  soft?: boolean;
};

// ── ROARING: seven staggered licks, tallest through the middle (mock 93 `.tile.roar`) ──
const ROARING_TONGUES: TongueSpec[] = [
  { d: 'M37 100 C38 84 41 74 44 56 C47 74 50 84 51 100 Z', fill: 'outer', flick: FLICK, ms: 1050, delay: 0, soft: true },
  { d: 'M69 100 C70 84 73 75 76 58 C79 75 82 84 83 100 Z', fill: 'outer', flick: FLICK2, ms: 1150, delay: 200, soft: true },
  { d: 'M48 100 C49 82 51 70 54 40 C57 70 59 82 60 100 Z', fill: 'outer', flick: FLICK, ms: 900, delay: 120 },
  { d: 'M62 100 C63 82 65 71 68 42 C71 71 73 82 74 100 Z', fill: 'outer', flick: FLICK2, ms: 950, delay: 50 },
  { d: 'M53 100 C54 80 57 66 60 28 C63 66 66 80 67 100 Z', fill: 'outer', flick: FLICK, ms: 800, delay: 180 },
  { d: 'M54 100 C55 86 56 74 58 52 C60 74 61 86 62 100 Z', fill: 'inner', flick: FLICK2, ms: 700, delay: 100 },
  { d: 'M59 100 C60 86 61 73 63 50 C65 73 66 86 67 100 Z', fill: 'inner', flick: FLICK, ms: 750, delay: 220 },
];

// ── SIMMERING: three low licks, slow (mock 93 `.tile.sim`) ──
const SIMMERING_TONGUES: TongueSpec[] = [
  { d: 'M49 100 C50 90 52 84 54 74 C56 84 58 90 59 100 Z', fill: 'lick', flick: FLICK, ms: 1500, delay: 0 },
  { d: 'M55 100 C56 88 58 80 60 62 C62 80 64 88 65 100 Z', fill: 'lick', flick: FLICK2, ms: 1350, delay: 200 },
  { d: 'M62 100 C63 90 65 85 67 76 C69 85 71 90 72 100 Z', fill: 'lick', flick: FLICK, ms: 1600, delay: 100 },
];

/** The coal bed — five overlapping ellipses, identical in every state; only the fill changes. */
const COALS = [
  { cx: 46, cy: 103, rx: 12, ry: 7 },
  { cx: 74, cy: 103, rx: 12, ry: 7 },
  { cx: 60, cy: 106, rx: 15, ry: 8 },
  { cx: 55, cy: 99, rx: 9, ry: 5.5 },
  { cx: 68, cy: 99, rx: 9, ry: 5.5 },
];

/** Simmering and cold sit the bed one unit lower than roaring — the fire has burned down into it. */
const COOLED_BED_DROP = 1;

const SPARKS = [
  { cx: 50, cy: 70, r: 2, colour: '#FFD27A', delay: 0 },
  { cx: 72, cy: 66, r: 1.6, colour: '#F2A33C', delay: 1000 },
  { cx: 61, cy: 58, r: 1.8, colour: '#FFE6B0', delay: 1700 },
];

// Mock 93's puffL / puffC / puffR. The sideways drift is what makes five puffs read as smoke
// curling off a dead fire rather than as bubbles rising in a line.
const PUFFS = [
  { cx: 54, cy: 94, r: 4, colour: '#6b6480', dx: -9, ms: 3400, delay: 0 },
  { cx: 60, cy: 92, r: 4.5, colour: '#7a7290', dx: 2, ms: 3800, delay: 600 },
  { cx: 66, cy: 94, r: 3.6, colour: '#6b6480', dx: 10, ms: 3200, delay: 1200 },
  { cx: 58, cy: 90, r: 3.2, colour: '#5a5470', dx: 2, ms: 3600, delay: 1800 },
  { cx: 63, cy: 93, r: 3, colour: '#7a7290', dx: 10, ms: 3500, delay: 2400 },
];

/**
 * The three fills, as stop lists rather than as <LinearGradient> elements — because each tongue
 * has to declare its own copy (see Tongue below), so what's shared is the DATA, not the node.
 */
const TONGUE_STOPS: Record<TongueSpec['fill'], { offset: string; colour: string; opacity?: number }[]> = {
  outer: [
    { offset: '0', colour: '#E0612C' },
    { offset: '0.75', colour: '#F2A33C' },
    { offset: '1', colour: '#F2A33C', opacity: 0 },
  ],
  inner: [
    { offset: '0', colour: '#F2A33C' },
    { offset: '0.8', colour: '#FFE6B0' },
    { offset: '1', colour: '#FFE6B0', opacity: 0 },
  ],
  lick: [
    { offset: '0', colour: '#E0612C' },
    { offset: '1', colour: '#F2A33C' },
  ],
};

/**
 * One licking tongue: a real pointed <Path> in its own full-scene <Svg>, wrapped in the
 * Animated.View that flicks it.
 *
 * The animation lives on the WRAPPER, not on SVG props: react-native-svg's `transform` is not
 * reliably drivable from the UI thread, whereas a view transform is — and since the Svg carries
 * the whole 120x120 viewBox, a percentage `transformOrigin` puts the pivot exactly on the tongue's
 * base line (y=100 of 120) with no per-path maths. Cost is one extra view per tongue, which buys
 * the mock's geometry at 60fps with nothing re-rendering in React.
 *
 * EACH TONGUE DECLARES ITS OWN GRADIENT. The first build followed the HTML mock and hoisted all
 * three into one hidden `<svg width=0 height=0>` full of <Defs>, referenced by `url(#id)` from the
 * other roots. That works in a browser, where ids are document-global — it does not work here:
 * every <Svg> is its own rendering context, and a zero-sized one may never mount its Defs at all.
 * The fill resolved to nothing and the whole fire rendered as a bare coal bed. A <Defs> is only
 * ever visible to the <Svg> it lives in.
 */
function Tongue({ spec, size, reduceMotion }: { spec: TongueSpec; size: number; reduceMotion: boolean }) {
  // Ids are global to react-native-svg even though lookups are not, so two instances sharing one
  // id blank each other on Android (the FlameLogo/EmberIcon bug). Per-mount id, per tongue.
  const gradId = `heatTongue-${useId()}`;
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    t.value = withDelay(spec.delay, withRepeat(withTiming(1, { duration: spec.ms, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [t, spec.delay, spec.ms, reduceMotion]);

  const flick = spec.flick;
  const style = useAnimatedStyle(() => ({
    transform: [
      { scaleY: flick.scaleFrom + (flick.scaleTo - flick.scaleFrom) * t.value },
      { rotateZ: `${flick.rotFrom + (flick.rotTo - flick.rotFrom) * t.value}deg` },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        // The pivot: dead centre horizontally, on the tongue's base line vertically.
        { transformOrigin: `50% ${(TONGUE_BASE_Y / VB) * 100}%`, opacity: spec.soft ? 0.72 : 1 },
        style,
      ]}>
      <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
            {TONGUE_STOPS[spec.fill].map((s) => (
              <Stop key={s.offset} offset={s.offset} stopColor={s.colour} stopOpacity={s.opacity ?? 1} />
            ))}
          </LinearGradient>
        </Defs>
        <Path d={spec.d} fill={`url(#${gradId})`} />
      </Svg>
    </Animated.View>
  );
}

/** A rising spark (roaring) or smoke puff (cold) — same motion, opposite meaning. */
function Rising({
  colour,
  left,
  top,
  size,
  delay,
  duration,
  travel,
  drift,
  peak,
  grow,
  reduceMotion,
}: {
  colour: string;
  left: number;
  top: number;
  size: number;
  delay: number;
  duration: number;
  travel: number;
  drift: number;
  peak: number;
  grow: number;
  reduceMotion: boolean;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.quad) }), -1, false));
  }, [t, delay, duration, reduceMotion]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -t.value * travel }, { translateX: t.value * drift }, { scale: 1 + t.value * grow }],
    opacity: Math.sin(t.value * Math.PI) * peak,
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left, top, width: size, height: size, borderRadius: size, backgroundColor: colour }, style]}
    />
  );
}

export function HeatFlame({ heat, size = 132 }: { heat: number; size?: number }) {
  const state = heatToState(heat);
  const reduceMotion = useReduceMotion();
  const uid = useId();
  const id = (name: string) => `heat-${name}-${uid}`;
  // Scene units -> pixels, for the sparks and puffs that live outside an <Svg>.
  const k = size / VB;

  // Below roughly 70px the two blur-softened outer licks are a couple of pixels wide and cost a
  // view each — the valley renders a dozen of these at once, so small instances drop them. The
  // five that carry the silhouette stay.
  const tongues =
    state === 'cold'
      ? []
      : state === 'roaring'
        ? size < 70
          ? ROARING_TONGUES.filter((t) => !t.soft)
          : ROARING_TONGUES
        : SIMMERING_TONGUES;

  const coalFill = `url(#${id(state === 'roaring' ? 'coalHot' : state === 'simmering' ? 'coalWarm' : 'coalDead')})`;
  const bedDrop = state === 'roaring' ? 0 : COOLED_BED_DROP;
  const ambColour = state === 'roaring' ? '#E0612C' : '#B33A15';

  // The bed's slow pulse (the mock's `.coalpulse`, .85 -> 1). Cold coals are dead — they never
  // pulse, which is half of what sells "burnt out".
  const coalPulse = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion || state === 'cold') {
      coalPulse.value = 1;
      return;
    }
    coalPulse.value = 0.85;
    coalPulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [coalPulse, reduceMotion, state]);
  const coalStyle = useAnimatedStyle(() => ({ opacity: coalPulse.value }));

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      {/* Ambient warmth on the ground, under everything. Cold has none at all — that absence IS
          the signal, so there is no grey stand-in for it. */}
      {state !== 'cold' ? (
        <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient
              id={id('amb')}
              cx="50%"
              cy={state === 'roaring' ? '72%' : '80%'}
              r={state === 'roaring' ? '55%' : '42%'}>
              <Stop offset="0" stopColor={ambColour} stopOpacity={state === 'roaring' ? 0.65 : 0.38} />
              <Stop offset="1" stopColor={ambColour} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          {state === 'roaring' ? (
            <Ellipse cx={60} cy={86} rx={52} ry={34} fill={`url(#${id('amb')})`} />
          ) : (
            <Ellipse cx={60} cy={98} rx={40} ry={22} fill={`url(#${id('amb')})`} />
          )}
        </Svg>
      ) : null}

      {tongues.map((spec) => (
        <Tongue key={spec.d} spec={spec} size={size} reduceMotion={reduceMotion} />
      ))}

      {/* The coal bed, drawn OVER the tongues exactly as the mock stacks it — the licks rise out
          from behind the coals, which is what roots them to the ground instead of floating. */}
      <Animated.View style={[StyleSheet.absoluteFill, coalStyle]} pointerEvents="none">
        <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
          <Defs>
            <RadialGradient id={id('coalHot')} cx="50%" cy="35%" r="75%">
              <Stop offset="0" stopColor="#FFD27A" />
              <Stop offset="0.45" stopColor="#F2A33C" />
              <Stop offset="1" stopColor="#6e2610" />
            </RadialGradient>
            <RadialGradient id={id('coalWarm')} cx="50%" cy="35%" r="80%">
              <Stop offset="0" stopColor="#F2A33C" />
              <Stop offset="0.4" stopColor="#B33A15" />
              <Stop offset="1" stopColor="#3a1c10" />
            </RadialGradient>
            <RadialGradient id={id('coalDead')} cx="50%" cy="35%" r="80%">
              <Stop offset="0" stopColor="#453f55" />
              <Stop offset="1" stopColor="#211d2b" />
            </RadialGradient>
          </Defs>
          <G>
            {COALS.map((c) => (
              <Ellipse key={`${c.cx}-${c.cy}`} cx={c.cx} cy={c.cy + bedDrop} rx={c.rx} ry={c.ry} fill={coalFill} />
            ))}
            {/* Live embers glinting in the bed (simmering) / ash flecks on dead coals (cold). */}
            {state === 'simmering' ? (
              <>
                <Circle cx={50} cy={103} r={2.4} fill="#FFB84D" />
                <Circle cx={70} cy={104} r={2} fill="#FF8A3D" />
              </>
            ) : null}
            {state === 'cold' ? (
              <>
                <Circle cx={52} cy={101} r={1.3} fill="#6b6480" />
                <Circle cx={66} cy={103} r={1.1} fill="#6b6480" />
                <Circle cx={60} cy={99} r={1.2} fill="#5a5470" />
              </>
            ) : null}
          </G>
        </Svg>
      </Animated.View>

      {/* Roaring throws sparks; cold pushes smoke. Simmering does neither — it just glows. */}
      {state === 'roaring'
        ? SPARKS.map((s) => (
            <Rising
              key={s.cx}
              colour={s.colour}
              left={(s.cx - s.r) * k}
              top={(s.cy - s.r) * k}
              size={s.r * 2 * k}
              delay={s.delay}
              duration={2400}
              travel={46 * k}
              drift={0}
              peak={0.95}
              grow={0}
              reduceMotion={reduceMotion}
            />
          ))
        : null}
      {state === 'cold'
        ? PUFFS.map((p) => (
            <Rising
              key={`${p.cx}-${p.delay}`}
              colour={p.colour}
              left={(p.cx - p.r) * k}
              top={(p.cy - p.r) * k}
              size={p.r * 2 * k}
              delay={p.delay}
              duration={p.ms}
              travel={43 * k}
              drift={p.dx * k}
              peak={0.5}
              grow={0.9}
              reduceMotion={reduceMotion}
            />
          ))
        : null}
    </View>
  );
}
