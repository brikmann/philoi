import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { BoxArt } from '@/components/economy/box-art';
import { EmberFlight, type FlightPoint } from '@/components/economy/ember-flight';
import { EmberIcon } from '@/components/economy/ember-icon';
import { formatEmbers } from '@/components/economy/economy-bits';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { BOX_KEYS, type BoxKey } from '@/lib/economy/boxes';
import { requestInventoryRefresh } from '@/lib/economy/wallet-refresh';
import { fireEmberClaimLift, fireEmberSettle, fireLightTap, fireXpTick } from '@/lib/reward-feedback';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CLAIMING, ONE REWARD AT A TIME — the box into the bag, then the embers into the balance.
//
// What this replaces: a single `Collect · +N` that swallowed a settlement whole. A challenge can
// pay a box AND embers, and one button firing once said nothing about either — the box in
// particular landed in the inventory with no moment on screen at all, which is why Noah kept
// asking where it went. Two rewards, two taps, two flights, both aimed at the corner the thing
// actually lives in.
//
// 🔒 PRESENTATION ONLY. NOTHING HERE GRANTS ANYTHING. grant_reward / economy_award_goal_day moved
// the embers and minted the box at settlement, usually while the app was shut; "claiming" here
// animates toward a wallet and an inventory that already hold them. The number the pill LANDS on is
// the wallet's own — see `walletEmbers` below — and `requestInventoryRefresh()` on dismiss is what
// reconciles every other mounted surface. A claim that awarded on tap would pay twice for one
// settlement, which is the bug the settlement watcher's header exists to warn about.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const FLY_COUNT = 12;
const FLY_STAGGER = 55;
const FLY_DURATION = 900;
/** The number starts moving as the first embers arrive, not when they set off. */
const TICK_START_MS = 620;
const TICK_MS = 1000;
/**
 * The floor on how often the counter is allowed to re-render the screen.
 *
 * 🐛 THIS IS WHY THE CLAIM WAS CHOPPY. The count-up ran a requestAnimationFrame loop calling
 * setDisplay every frame — so for the full second the embers were in the air, React re-rendered the
 * entire reveal about sixty times: the full-screen ray fan and its sixteen paths, nine smoke puffs,
 * twelve ember particles, the rows. The FLIGHTS were always on the UI thread and fine; it was the
 * JS thread being asked to reconcile the whole tree underneath them.
 *
 * Two fixes together. The components above are memoised so a counter tick no longer rebuilds them,
 * and the counter itself only pushes a render when the number it would DISPLAY has actually
 * changed, and never more than this often. A balance ticking at ~16fps is indistinguishable from
 * one ticking at 60 — it is digits, not motion — and the animation it was stepping on is the part
 * the eye is actually watching.
 */
const TICK_RENDER_MS = 60;
const BOX_FLY_MS = 820;
/** How long the new balance is left standing before the reveal closes itself. */
const SETTLE_MS = 950;
/**
 * When to take the geometry again, after the reveal's entrance has finished moving.
 *
 * The reveals build in now (§A) — a back-eased scale from 0.9, which is a transform on the very box
 * the hero sits in. `measureInWindow` reports the view where it IS, so a single measurement on the
 * first frame captures the hero mid-build and aims both flights, and the ray anchor, a few points
 * off. Measuring TWICE is what keeps both true: once immediately, so the rays have something to
 * anchor on while they bloom, and again here, once nothing is moving. Nothing is in the air yet at
 * this point, so the second result can only correct the first.
 */
const SETTLED_REMEASURE_MS = 560;

// ─────────────────────────── the smoke ───────────────────────────

/**
 * Mock 100's `puff` layer, transcribed. Nine soft rounds curling up off the payout as the embers
 * lift out of it — the sell flow's "the item dissolves and what you get back is smoke and embers",
 * pointed the other way: here the smoke is what the fire leaves behind as it pays you.
 *
 * Fixed table rather than `Math.random()`, for the reason `SPARKS` in flame-meter-complete is one:
 * a random value read during render is impure, re-rolls on every parent state change, and would
 * restart nine animations mid-flight the first time the balance ticked.
 *
 * There is no blur filter in react-native-svg, so the mock's `filter: blur(7px)` is a radial
 * gradient that is already soft at its edge instead — same read, one draw, no offscreen pass.
 */
const PUFFS = [
  { dx: -30, dy: 10, size: 46, driftX: -22, riseY: -128, duration: 1500, delay: 0 },
  { dx: 18, dy: -4, size: 58, driftX: 16, riseY: -150, duration: 1750, delay: 60 },
  { dx: -8, dy: 14, size: 40, driftX: -6, riseY: -112, duration: 1400, delay: 120 },
  { dx: 32, dy: 8, size: 52, driftX: 24, riseY: -140, duration: 1900, delay: 180 },
  { dx: -22, dy: -10, size: 66, driftX: -14, riseY: -166, duration: 2050, delay: 240 },
  { dx: 6, dy: 12, size: 44, driftX: 9, riseY: -120, duration: 1600, delay: 300 },
  { dx: -36, dy: 2, size: 50, driftX: -25, riseY: -158, duration: 1850, delay: 360 },
  { dx: 26, dy: -12, size: 62, driftX: 19, riseY: -134, duration: 1700, delay: 420 },
  { dx: 0, dy: -2, size: 72, driftX: 4, riseY: -175, duration: 2100, delay: 480 },
] as const;

// Memoised for the same reason EmberFlight is: nine of these are alive while the balance ticks.
const Puff = memo(function Puff({ spec, origin }: { spec: (typeof PUFFS)[number]; origin: FlightPoint }) {
  const id = `puff-${useId()}`;
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(spec.delay, withTiming(1, { duration: spec.duration, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot puff per mount
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.18, 1], [0, 0.75, 0]),
    transform: [
      { translateX: t.value * spec.driftX },
      { translateY: t.value * spec.riseY },
      { scale: 0.5 + t.value * 1.6 },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.puff,
        {
          left: origin.x + spec.dx - spec.size / 2,
          top: origin.y + spec.dy - spec.size / 2,
          width: spec.size,
          height: spec.size,
        },
        style,
      ]}>
      <Svg width={spec.size} height={spec.size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="45%" r="50%">
            <Stop offset="0" stopColor="#B4AACD" stopOpacity={0.42} />
            <Stop offset="0.55" stopColor="#786E96" stopOpacity={0.2} />
            <Stop offset="0.72" stopColor="#786E96" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={spec.size / 2} cy={spec.size / 2} r={spec.size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
});

/** The whole smoke layer. Coordinates are relative to whatever container this renders into. */
export function SmokeWisps({ origin }: { origin: FlightPoint }) {
  return (
    <>
      {PUFFS.map((spec, i) => (
        <Puff key={i} spec={spec} origin={origin} />
      ))}
    </>
  );
}

// ─────────────────────────── the box's flight ───────────────────────────

/**
 * The box drifting off the reveal and into the top-right, where the inventory lives.
 *
 * Same raised-bezier arc as `EmberFlight` — deliberately, so the two claims read as one family —
 * but a single heavy object rather than a spray, so it is slower, it does not fan, and it shrinks
 * as it goes instead of popping. It ends small and faint rather than at full size: the box is
 * going somewhere off this screen, and something that arrives at full opacity looks like it
 * stopped.
 */
export function BoxFlight({
  boxKey,
  from,
  to,
  size = 76,
  onLand,
}: {
  boxKey: BoxKey;
  from: FlightPoint;
  to: FlightPoint;
  size?: number;
  onLand?: () => void;
}) {
  const progress = useSharedValue(0);
  const midX = (from.x + to.x) / 2;
  const midY = Math.min(from.y, to.y) - 96;

  useEffect(() => {
    progress.value = withTiming(1, { duration: BOX_FLY_MS, easing: Easing.inOut(Easing.cubic) });
    const timer = setTimeout(() => onLand?.(), BOX_FLY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot flight per mount
  }, []);

  const style = useAnimatedStyle(() => {
    const t = progress.value;
    const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * midX + t * t * to.x;
    const y = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * midY + t * t * to.y;
    return {
      opacity: interpolate(t, [0, 0.1, 0.78, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: x - size / 2 },
        { translateY: y - size / 2 },
        { scale: interpolate(t, [0, 1], [1, 0.34]) },
        { rotate: `${interpolate(t, [0, 1], [0, 22])}deg` },
      ],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[styles.boxFlight, style]}>
      <BoxArt boxKey={boxKey} size={size} />
    </Animated.View>
  );
}

// ─────────────────────────── the target ───────────────────────────

/**
 * The top-right balance the embers fly into.
 *
 * Neither reveal had one. The goal screen's own header note says why that mattered — a payout with
 * no number on screen to move is a payout the user is told about rather than shown — and it had
 * been solving it with a "→ wallet · 1,240" string on the ember row, which states the answer before
 * the animation gets to give it. This is the thing that moves, so the row can go back to saying
 * where the embers went and nothing more.
 *
 * Local to the reveals rather than `EmberPill` because this one has to be MEASURABLE (it is the
 * drift target) and lit while embers land, neither of which the static header pill should carry.
 * Same shape as the sell flow's, which is the other screen where a balance is the destination of
 * an animation.
 */
export function ClaimBalancePill({
  embers,
  innerRef,
  lit,
}: {
  /** Null while the wallet read is still in flight — a skeleton, never a dash and never a guess. */
  embers: number | null;
  innerRef?: React.RefObject<View | null>;
  lit?: boolean;
}) {
  return (
    <View
      ref={innerRef}
      collapsable={false}
      style={[styles.pill, lit && styles.pillLit]}
      accessibilityLabel={embers == null ? 'Loading your ember balance' : `${formatEmbers(embers)} embers`}>
      <EmberIcon size={15} />
      {/* 🐛 WAS AN EM DASH, AND A DASH IS A STATEMENT. It reads as "you have no balance" rather
          than "the balance has not arrived yet" — which is exactly how the relic reveal's pill
          landed on device, since that screen never passed a wallet figure at all. A skeleton the
          width of a four-digit balance says the same thing honestly and reserves the layout, so
          the number does not shove the pill sideways when the read lands. It never renders once
          `embers` is a number, and the pill is still MEASURABLE either way — it is the flights'
          drift target, and a target that changed width mid-flight would aim them at nothing. */}
      {embers == null ? (
        <View style={styles.pillSkeleton} />
      ) : (
        <Text style={styles.pillText}>{formatEmbers(embers)}</Text>
      )}
    </View>
  );
}

// ─────────────────────────── the sequence ───────────────────────────

/**
 * The three things a settlement can pay that a row can hand back.
 *
 * 'xp' JOINED LATE and does not fly. Noah's ask was that every row carry its own claim, not that
 * XP grow an animation it never had: the challenge and goal reveals have no rank bar for it to
 * travel to, and inventing a destination for it would be the one flight on these screens that
 * pointed at nothing. It ticks in place, and a screen that DOES own a bar — flame-meter-complete —
 * drives that bar from `onXpClaimed` instead. See `claim` below.
 */
export type RewardClaimKind = 'box' | 'embers' | 'xp';

/** The old name, from when this was an index into a sequence. Kept so nothing has to churn. */
export type RewardClaimStep = RewardClaimKind;

/** `award.box` and `result.box.key` are both plain strings off the wire — this is the gate. */
export function asBoxKey(key: string | null | undefined): BoxKey | null {
  return key != null && (BOX_KEYS as readonly string[]).includes(key) ? (key as BoxKey) : null;
}

/** How long an XP claim is left standing before a reveal with nothing else left closes itself. */
const XP_SETTLE_MS = 780;
/** The same, for a claim with no flight to watch (reduce motion, or geometry that never landed). */
const STILL_SETTLE_MS = 320;

type RewardClaimOptions = {
  /** The box the settlement minted, or null when it paid none. */
  boxKey: BoxKey | null;
  /** Its display name, for the claim CTA. */
  boxName?: string | null;
  /** What the server paid. 0 skips the ember row entirely. */
  embers: number;
  /** XP the same settlement paid. 0 leaves XP out of the claimable set. */
  xp?: number;
  /**
   * The wallet's own figure AFTER the grant — `useInventory().embers` — or null while that read is
   * in flight. The pill counts UP TO this, and starts from `walletEmbers - embers`, because the
   * grant already landed before the reveal mounted: the pre-payout balance is the derived figure
   * here, and the post-payout one is the ledger's. Deriving it the other way round (`before + paid`)
   * is the bug the goal screen's `newBalance` note describes.
   */
  walletEmbers: number | null;
  /**
   * Run when the XP row is claimed. This is where a screen that has a rank bar puts the fill —
   * flame-meter-complete's `trkFill` and its `+N XP` plus-label were already animating on a timer,
   * and this is what moves them onto the tap instead.
   */
  onXpClaimed?: () => void;
  /** Close the reveal. Called after the LAST claim has landed and settled. */
  onDone: () => void;
};

/**
 * Drives per-row claiming — box to the bag, embers to the balance, XP in place — and hands back
 * everything the reveals need to draw it.
 *
 * WHAT THIS REPLACED, and why. This used to be a SEQUENCE: an index into `steps`, one `ctaLabel`,
 * one `onCta`, and a single footer button you tapped once per reward. Noah: "I want the other
 * buttons to have claim options as well and not just tap the bottom button many times." The
 * sequence was never the point — it existed because there was one control, so the rewards had to
 * queue up behind it. Give every row its own control and the queue disappears: `claim(kind)` is
 * public, any row can go first, and the footer becomes "Claim all", which is the sequence for
 * anyone who wants it rather than the only way through.
 *
 * ONE FLIGHT AT A TIME, THOUGH. `flying` is a single value, not a set, and every claim is disabled
 * while it is non-null. Two arcs crossing the same screen toward two different corners is not
 * "independent", it is unreadable — and the flight layer below draws one. Independence here means
 * you choose the order and can take just the one thing you came for.
 *
 * A hook rather than a component because the pieces mount in different places: the flights are an
 * absolute layer over the whole screen, the pill is in the top bar, the claims are inside the rows
 * and the CTA is in the footer. A component owning all of that would need a portal.
 */
export function useRewardClaim({
  boxKey,
  boxName,
  embers,
  xp = 0,
  walletEmbers,
  onXpClaimed,
  onDone,
}: RewardClaimOptions) {
  const reduceMotion = useReduceMotion();

  const rootRef = useRef<View>(null);
  const originRef = useRef<View>(null);
  const pillRef = useRef<View>(null);

  // BOX, EMBERS, XP — the order "Claim all" runs them in, and the order buildRows lists them. The
  // object you can hold comes before the currency, which comes before the number that only moves a
  // bar; collapsing them into one "Collect" is what made the box invisible in the first place.
  const kinds = useMemo<RewardClaimKind[]>(() => {
    const list: RewardClaimKind[] = [];
    if (boxKey) list.push('box');
    if (embers > 0) list.push('embers');
    if (xp > 0) list.push('xp');
    return list;
  }, [boxKey, embers, xp]);

  const [claimed, setClaimed] = useState<Partial<Record<RewardClaimKind, boolean>>>({});
  const [flying, setFlying] = useState<RewardClaimKind | null>(null);
  const [geo, setGeo] = useState<{ from: FlightPoint; to: FlightPoint; root: FlightPoint } | null>(
    null
  );
  const [display, setDisplay] = useState<number | null>(null);

  const bump = useSharedValue(0);
  const landed = useRef(0);
  const tickStarted = useRef(false);
  const tickDone = useRef(false);
  const emberClaimed = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const raf = useRef<number | undefined>(undefined);

  // ── the refs the claim logic actually reads ──────────────────────────────────────────────────
  //
  // `claim` is handed to N rows and to the "Claim all" chain, and it fires from inside setTimeout
  // callbacks scheduled one flight ago. Reading `claimed`/`flying` STATE in there would read
  // whatever the closure captured when the timer was set, which for the chain is always the set as
  // it stood before the first claim — so "Claim all" would re-claim the box forever. State is what
  // renders; these are what decides.
  const claimedRef = useRef(claimed);
  const flyingRef = useRef<RewardClaimKind | null>(null);
  const kindsRef = useRef(kinds);
  /** Set while the footer's "Claim all" is walking the remaining rows. */
  const chaining = useRef(false);

  // MIRRORED IN AN EFFECT, not assigned during render. A ref written on the render pass is what
  // react-hooks/refs rejects, and the effect is early enough for every reader here: nothing touches
  // these until a user taps or a flight timer fires, both of which are after paint.
  useEffect(() => {
    kindsRef.current = kinds;
  }, [kinds]);

  // `onDone` and `onXpClaimed` are inline arrows at the call sites, so a new identity every render.
  // Held in refs so the settle timers below do not have to be torn down and restarted each time the
  // parent re-renders — which, with a balance ticking, is ~16 times a second during the flight.
  const doneRef = useRef(onDone);
  const onXpRef = useRef(onXpClaimed);
  useEffect(() => {
    doneRef.current = onDone;
    onXpRef.current = onXpClaimed;
  }, [onDone, onXpClaimed]);

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    },
    []
  );

  // Measured in window coordinates and rebased onto the root, so the arcs run between two real
  // on-screen points. The pill's x depends on how many digits the balance has — exactly what a
  // hardcoded corner gets wrong for the players with the most embers.
  const measure = useCallback(() => {
    rootRef.current?.measureInWindow((ox, oy) => {
      originRef.current?.measureInWindow((fx, fy, fw, fh) => {
        pillRef.current?.measureInWindow((px, py, pw, ph) => {
          setGeo({
            from: { x: fx + fw / 2 - ox, y: fy + fh / 2 - oy },
            to: { x: px + pw * 0.3 - ox, y: py + ph / 2 - oy },
            // Where the reveal's root sits in the window. The flights do not need it — they are
            // already in root space — but the full-bleed rays do, to escape the safe-area
            // wrappers this screen is nested in. Same measurement, so it costs nothing.
            root: { x: ox, y: oy },
          });
        });
      });
    });
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(measure);
    const settled = setTimeout(measure, SETTLED_REMEASURE_MS);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(settled);
    };
  }, [measure]);

  // The pill shows the PRE-payout figure until the embers are claimed, so the tick has somewhere to
  // travel from; afterwards the wallet is the only authority left and the pill follows it, however
  // late that read lands.
  useEffect(() => {
    if (walletEmbers == null) return;
    if (!emberClaimed.current) {
      setDisplay(Math.max(0, walletEmbers - embers));
    } else if (tickDone.current || !tickStarted.current) {
      // `!tickStarted` is the case where the wallet read was STILL IN FLIGHT when the embers were
      // claimed: there was no figure to count from, so there is no count-up to interrupt and the
      // ledger's number simply appears. Without it the pill would sit on its dash forever.
      setDisplay(walletEmbers);
    }
  }, [walletEmbers, embers]);

  const startTick = useCallback(() => {
    if (walletEmbers == null) return;
    tickStarted.current = true;
    const start = Math.max(0, walletEmbers - embers);
    const timer = setTimeout(() => {
      const t0 = Date.now();
      // Both gates below — see TICK_RENDER_MS. Held in the closure rather than in state, because
      // they exist precisely to avoid causing renders.
      let shown = start;
      let lastRenderAt = 0;
      const step = () => {
        const now = Date.now();
        const p = Math.min((now - t0) / TICK_MS, 1);
        const eased = 1 - (1 - p) * (1 - p);
        const next = Math.round(start + (walletEmbers - start) * eased);
        if (next !== shown && now - lastRenderAt >= TICK_RENDER_MS) {
          shown = next;
          lastRenderAt = now;
          setDisplay(next);
        }
        if (p < 1) {
          raf.current = requestAnimationFrame(step);
        } else {
          tickDone.current = true;
          // Always lands exactly on the wallet's own figure, whatever the throttle skipped.
          setDisplay(walletEmbers);
        }
      };
      raf.current = requestAnimationFrame(step);
    }, TICK_START_MS);
    timers.current.push(timer);
  }, [walletEmbers, embers]);

  /** Reconcile every other mounted surface, then close. Also what the X in the corner runs. */
  const dismiss = useCallback(() => {
    requestInventoryRefresh();
    doneRef.current();
  }, []);

  const remaining = useMemo(() => kinds.filter((k) => !claimed[k]), [kinds, claimed]);
  const allClaimed = kinds.length > 0 && remaining.length === 0;

  const markClaimed = useCallback((kind: RewardClaimKind) => {
    claimedRef.current = { ...claimedRef.current, [kind]: true };
    setClaimed(claimedRef.current);
  }, []);

  // `settle` below calls the NEXT claim from inside a timer that `claim` itself scheduled, so it
  // cannot close over `claim` directly without a cycle. One ref, assigned every render, breaks it.
  const claimRef = useRef<(kind: RewardClaimKind) => void>(() => {});

  const claim = useCallback(
    (kind: RewardClaimKind) => {
      // Claimed already, or something else is in the air. Both are the same guard from the row's
      // point of view — its button is disabled — but a chained "Claim all" can also arrive here a
      // frame early, and this is what makes that harmless.
      if (flyingRef.current || claimedRef.current[kind] || !kindsRef.current.includes(kind)) return;

      fireLightTap();
      // MARKED ON THE TAP, not on the landing. The row has to dim and go un-tappable the instant it
      // is pressed, or the 900ms the embers spend in the air is 900ms in which it can be pressed
      // again — and a second press would re-run the count-up from a balance that had already moved.
      markClaimed(kind);
      if (kind === 'embers') emberClaimed.current = true;
      const wasLast = kindsRef.current.every((k) => claimedRef.current[k]);

      /** Hand off to the next row if the footer is walking them, otherwise close if this was it. */
      const settle = (delayMs: number) => {
        flyingRef.current = null;
        setFlying(null);
        if (!wasLast) {
          if (chaining.current) {
            const next = kindsRef.current.find((k) => !claimedRef.current[k]);
            if (next) claimRef.current(next);
          }
          return;
        }
        chaining.current = false;
        timers.current.push(setTimeout(dismiss, delayMs));
      };

      // XP: NO FLIGHT, BY DESIGN — see RewardClaimKind. The tick sound and the row's own value are
      // the whole animation here; a screen with a rank bar hangs its fill off `onXpClaimed`.
      if (kind === 'xp') {
        fireXpTick();
        onXpRef.current?.();
        settle(XP_SETTLE_MS);
        return;
      }

      // Reduce-motion, or a measurement that never landed: no flight to watch, so the value lands
      // and the row is done. The balance still visibly changes — that is the part that is
      // information, not decoration.
      if (reduceMotion || !geo) {
        if (kind === 'embers' && walletEmbers != null) {
          tickDone.current = true;
          setDisplay(walletEmbers);
        }
        settle(STILL_SETTLE_MS);
        return;
      }

      flyingRef.current = kind;
      setFlying(kind);

      if (kind === 'box') {
        timers.current.push(setTimeout(() => settle(0), BOX_FLY_MS + 140));
        return;
      }

      // One sound for one gesture, on the lift — not a tick per landing ember. See
      // fireEmberClaimLift for what this replaces and why it sits under the fanfare rather than
      // across it.
      fireEmberClaimLift();
      startTick();
      const inTheAir = FLY_STAGGER * (FLY_COUNT - 1) + FLY_DURATION;
      timers.current.push(setTimeout(() => settle(SETTLE_MS), inTheAir));
    },
    [markClaimed, reduceMotion, geo, walletEmbers, startTick, dismiss]
  );


  // A STABLE identity for the public claim, deliberately. The screens memoise their row list on
  // the handful of claim fields that can actually change a row (`claimed`, `busy`, `claimFor`), and
  // an inline arrow in the return object below would be a new value on every render — including the
  // ~16 a second the balance counter pushes while embers are in the air. That would rebuild every
  // spec, defeat RewardRow's memo and reintroduce the choppy claim TICK_RENDER_MS exists to fix.
  const claimNow = useCallback((kind: RewardClaimKind) => claimRef.current(kind), []);

  useEffect(() => {
    claimRef.current = claim;
  }, [claim]);

  /** The footer: take everything still on the table, one flight after another. */
  const claimAll = useCallback(() => {
    if (flyingRef.current) return;
    const next = kindsRef.current.find((k) => !claimedRef.current[k]);
    if (!next) {
      dismiss();
      return;
    }
    chaining.current = true;
    claimRef.current(next);
  }, [dismiss]);

  // Not a useCallback: writing to a shared value that is also a dep is what react-hooks/immutability
  // rejects, and the identity is free here — EmberFlight captures `onLand` once, in a mount effect.
  function handleEmberLand() {
    landed.current += 1;
    bump.value = withSequence(withTiming(1, { duration: 90 }), withTiming(0, { duration: 260 }));
    // Every third arrival, not every one: twelve taps inside 1.5s is a buzzing phone rather than a
    // run of ticks — the same reasoning the sell flow and fireBoxOpen use. Haptic only now; the
    // sound moved to the lift.
    if (landed.current % 3 === 1) fireEmberSettle();
  }

  const pillStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + bump.value * 0.12 }] }));

  // "Claim all" only when there is actually more than one left to take — with a single row it would
  // be a plural describing one thing, and with none left it is the way out.
  const ctaLabel = remaining.length > 1 ? 'Claim all' : remaining.length === 1 ? 'Claim' : 'Done';

  /**
   * A row's own control, or undefined once that row has been taken.
   *
   * Handed straight to `RewardRowSpec.claim`, so a screen builds its rows by asking this per kind
   * rather than by tracking whose turn it is — there are no turns any more.
   */
  const claimFor = useCallback(
    (kind: RewardClaimKind, label = 'Claim') =>
      claimed[kind] || !kinds.includes(kind)
        ? undefined
        : { label, onPress: () => claimRef.current(kind), disabled: flying !== null },
    [claimed, kinds, flying]
  );

  const layer = (
    <View pointerEvents="none" style={styles.flightLayer}>
      {flying === 'box' && geo && boxKey ? <BoxFlight boxKey={boxKey} from={geo.from} to={geo.to} /> : null}
      {flying === 'embers' && geo ? (
        <>
          <SmokeWisps origin={geo.from} />
          {Array.from({ length: FLY_COUNT }, (_, i) => (
            <EmberFlight
              key={i}
              index={i}
              count={FLY_COUNT}
              from={geo.from}
              to={geo.to}
              delay={i * FLY_STAGGER}
              duration={FLY_DURATION}
              size={13}
              lift={70}
              onLand={handleEmberLand}
            />
          ))}
        </>
      ) : null}
    </View>
  );

  return {
    /** Put these on the root, on the hero the rewards fly out of, and on the balance pill. */
    rootRef,
    originRef,
    pillRef,
    /** Where the hero sits inside the root — also what the full-screen rays anchor on. */
    heroAnchor: geo?.from ?? null,
    /** The root's origin in window coordinates, for the rays' full-bleed layer. */
    rootOffset: geo?.root ?? null,
    /** Everything this settlement can pay, in claim order. */
    kinds,
    /** Which rows have been taken — a row reads this for its dim-and-tick state. */
    claimed,
    /** Still on the table. */
    remaining,
    allClaimed,
    /** Build a row's claim control, or undefined once that row is done. */
    claimFor,
    /** Fire one row's claim directly — what the box row's Open runs before it navigates. */
    claim: claimNow,
    /** A flight is in the air; no claim should take a tap. */
    busy: flying !== null,
    ctaLabel,
    /** The footer: take everything left, or close when there is nothing. */
    onCta: claimAll,
    dismiss,
    displayBalance: display,
    pillStyle,
    layer,
    /** The box's display name, for a caller that labels its own Open control. */
    boxName,
  };
}

const styles = StyleSheet.create({
  // Above the content, below nothing — the flights have to cross the rows and the top bar on their
  // way to the corner.
  flightLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
  },
  puff: {
    position: 'absolute',
  },
  boxFlight: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,210,122,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,210,122,0.28)',
    borderRadius: Radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 13,
  },
  pillLit: {
    borderColor: 'rgba(255,210,122,0.5)',
  },
  pillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ember,
    fontVariant: ['tabular-nums'],
  },
  // Sized to the tabular width of "1,240" at 15pt so the pill does not jump when the read lands.
  pillSkeleton: {
    width: 42,
    height: 13,
    borderRadius: 6,
    backgroundColor: 'rgba(255,210,122,0.22)',
  },
});
