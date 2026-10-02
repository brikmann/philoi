import { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useMotionActive } from '@/hooks/use-motion-active';
import { useReduceMotion } from '@/hooks/use-reduce-motion';

// The ACTIVITY GAUGE (mock 93). One `heat` in [0,1] drives three states, and the same mapping
// serves every campfire surface — the valley nodes, the campfire card, the banner hero.
//
// This is deliberately NOT FlameLogo. The brand mark is one clean silhouette (and it is what Home
// wears now — Home is *you*, and you don't go cold); a gauge has to read as a different *thing* at
// each state, not the same glyph at three opacities. So every state here is its own composition
// over a PERSISTENT LOG LAY (mock 257; it replaced the old coal bed, which at valley size read as
// "a clutch of eggs"). The lay is what makes it a fire rather than an icon: it stays put while what
// burns on top changes.
//
//   >= 0.6  roaring    — a staggered cluster of tongues off the logs, ember glow + rising sparks
//   0.15-0.6 simmering — a few low, slow licks off the logs, a dim smoulder in the gaps
//   < 0.15  cold       — bare logs, no glow, drifting smoke puffs (the "relight" nudge)
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

// The LOG LAY (mock 257) — a built campfire, four logs in two crossed pairs. This REPLACES the old
// five-ellipse coal bed, which at valley size read as "a clutch of eggs" (device report): a cold
// fire is one that is laid and waiting, not a spill of grey stones. Identical in every state — cold
// shows the bare wood; lit states keep their tongues, which rise out from behind the logs exactly as
// they rose from behind the coals. Coordinates are mock 257's, in the same 120-unit scene.
//
//   grad     'logBtm' = the darker back pair, 'logTop' = the lighter front pair (a little depth)
//   endCx    which end shows its cut face (the end-grain rings), dropped below size 70
//   pivot*   the rotate origin, so a log leans from its own centre
type LogSpec = {
  x: number; y: number; w: number; h: number; rot: number; pivotX: number; pivotY: number;
  grad: 'logTop' | 'logBtm'; endCx: number;
};
const LOGS: LogSpec[] = [
  // bottom crossed pair — darker, sits behind
  { x: 26, y: 92, w: 68, h: 12, rot: 13, pivotX: 60, pivotY: 98, grad: 'logBtm', endCx: 26 },
  { x: 26, y: 92, w: 68, h: 12, rot: -13, pivotX: 60, pivotY: 98, grad: 'logBtm', endCx: 94 },
  // top crossed pair — lighter, sits in front
  { x: 30, y: 84, w: 60, h: 11, rot: -22, pivotX: 60, pivotY: 89, grad: 'logTop', endCx: 30 },
  { x: 30, y: 84, w: 60, h: 11, rot: 22, pivotX: 60, pivotY: 89, grad: 'logTop', endCx: 90 },
];

/** Simmering and cold sit the lay one unit lower than roaring — the fire has burned down into it. */
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
function Tongue({ spec, size, still }: { spec: TongueSpec; size: number; still: boolean }) {
  // Ids are global to react-native-svg even though lookups are not, so two instances sharing one
  // id blank each other on Android (the FlameLogo/EmberIcon bug). Per-mount id, per tongue.
  const gradId = `heatTongue-${useId()}`;
  const t = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    t.value = withDelay(spec.delay, withRepeat(withTiming(1, { duration: spec.ms, easing: Easing.inOut(Easing.quad) }), -1, true));
    // Without this, blurring the screen re-runs the effect, hits the early return, and leaves the
    // PREVIOUS loop running — the one thing this whole gate exists to stop.
    return () => cancelAnimation(t);
  }, [t, spec.delay, spec.ms, still]);

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
  still,
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
  still: boolean;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.quad) }), -1, false));
    return () => {
      cancelAnimation(t);
      // Parked at 0 rather than frozen mid-flight. This one does not ping-pong — it rises from
      // nothing and fades out — so a cancel partway up would strand a spark hanging in the air at
      // half opacity, which is what the screen would be showing on the way back.
      t.value = 0;
    };
  }, [t, delay, duration, still]);
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
  // ONE focus subscription per flame, not one per tongue. A roaring flame is eleven looping
  // children (7 tongues + 3 sparks + the coal bed) and the campfire valley renders a dozen
  // flames, so a `useMotionActive()` inside `Tongue` would mean ~130 navigation subscriptions on
  // a single screen — bookkeeping about whether to animate, costing more than the animation.
  const motionActive = useMotionActive();
  const still = reduceMotion || !motionActive;
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

  const bedDrop = state === 'roaring' ? 0 : COOLED_BED_DROP;
  const ambColour = state === 'roaring' ? '#E0612C' : '#B33A15';

  // The ember glow's slow pulse (the mock's `.coalpulse`, .85 -> 1). Drives the smoulder in the log
  // gaps, not the logs themselves — wood does not flicker. Cold has no glow at all, so it never
  // pulses, which is half of what sells "burnt out".
  const coalPulse = useSharedValue(1);
  useEffect(() => {
    if (still || state === 'cold') {
      coalPulse.value = 1;
      return;
    }
    coalPulse.value = 0.85;
    coalPulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => {
      cancelAnimation(coalPulse);
      // Full opacity while parked: the bed's resting state is lit, and the pulse only ever dips
      // it. Leaving it frozen at 0.85 would dim every unfocused flame by a hair.
      coalPulse.value = 1;
    };
  }, [coalPulse, still, state]);
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
        <Tongue key={spec.d} spec={spec} size={size} still={still} />
      ))}

      {/* The log lay, drawn OVER the tongue bases exactly as the coal bed was — the licks rise out
          from behind the wood, which roots them to the ground instead of floating. Static: wood
          does not flicker (the smoulder below does). */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
          <Defs>
            <LinearGradient id={id('logTop')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#6b5a46" />
              <Stop offset="1" stopColor="#4a3c2e" />
            </LinearGradient>
            <LinearGradient id={id('logBtm')} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#5a4b3a" />
              <Stop offset="1" stopColor="#3b2f24" />
            </LinearGradient>
          </Defs>
          {/* ground contact shadow */}
          <Ellipse cx={60} cy={104 + bedDrop} rx={34} ry={7} fill="#000000" opacity={0.28} />
          {LOGS.map((l) => (
            <G key={`${l.grad}-${l.endCx}`} rotation={l.rot} origin={`${l.pivotX}, ${l.pivotY + bedDrop}`}>
              <Rect x={l.x} y={l.y + bedDrop} width={l.w} height={l.h} rx={l.h / 2} fill={`url(#${id(l.grad)})`} />
              {/* End-grain rings on the cut face. Fine detail — dropped below 70px, where the
                  valley renders a dozen of these and the four logs carry the read on their own. */}
              {size >= 70 ? (
                <>
                  <Ellipse cx={l.endCx} cy={l.y + l.h / 2 + bedDrop} rx={l.h * 0.34} ry={l.h / 2} fill="#8a7860" />
                  <Ellipse cx={l.endCx} cy={l.y + l.h / 2 + bedDrop} rx={l.h * 0.17} ry={l.h / 4} fill="#53432f" />
                </>
              ) : null}
            </G>
          ))}
          {/* Cold: a couple of ash flecks on the wood. */}
          {state === 'cold' ? (
            <>
              <Circle cx={54} cy={97 + bedDrop} r={1.3} fill="#6b6480" />
              <Circle cx={66} cy={99 + bedDrop} r={1.1} fill="#5a5470" />
            </>
          ) : null}
        </Svg>
      </View>

      {/* Lit: embers smouldering in the log gaps, pulsing (the old coal-bed glow, relocated). Cold
          has none — that absence is the "burnt out" signal. */}
      {state !== 'cold' ? (
        <Animated.View style={[StyleSheet.absoluteFill, coalStyle]} pointerEvents="none">
          <Svg width={size} height={size} viewBox={`0 0 ${VB} ${VB}`}>
            <Defs>
              <RadialGradient id={id('logGlow')} cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={state === 'roaring' ? '#FFD27A' : '#F2A33C'} stopOpacity={state === 'roaring' ? 0.9 : 0.6} />
                <Stop offset="1" stopColor="#F2A33C" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Ellipse cx={60} cy={95 + bedDrop} rx={18} ry={9} fill={`url(#${id('logGlow')})`} />
          </Svg>
        </Animated.View>
      ) : null}

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
              still={still}
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
              still={still}
            />
          ))
        : null}
    </View>
  );
}
