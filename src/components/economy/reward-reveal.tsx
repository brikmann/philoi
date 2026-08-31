import { useEffect, useId, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { getRewardPreferencesSync } from '@/lib/reward-settings';
import { playRewardSound, type RewardCue } from '@/lib/sound';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE RAYS — one reveal language for every reward the app pays out.
//
// Six things can pay you: a rank-up, a pass level, the daily fire, and the three challenge
// settlements. Before this, each one had drawn its own rays or none at all — `rank-up-celebration`,
// `challenge-reward-screen`, `box-crack` and `forge-strike` each carry their own fan of wedges, and
// pass-level claims paid silently with no reveal whatsoever. Four implementations of one idea drift
// by definition; this is the one they can share.
//
// 🔒 PRESENTATION ONLY. NOTHING HERE GRANTS ANYTHING. Every figure on screen is read from a result
// the server already wrote — the unseen-rewards RPC, the claim's return, the rank-up event. A
// reveal that awarded on presentation would pay twice for one event, which is the exact bug the
// challenge settlement watcher's header warns about.
//
// WHAT IS DELIBERATELY NOT HERE: the rank-up celebration. It stays its own 1,500-line component
// with tier ladders, anthems and per-tier signatures, because the brief is explicit that rank-up
// stays the biggest and reducing it to this primitive would be a downgrade, not a unification. It
// shares the QUEUE below instead, which is the part that actually needed to be common.
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type RewardRevealKind =
  | 'rank_up'
  | 'pass_level'
  | 'daily_fire'
  | 'challenge_solo'
  | 'challenge_team'
  | 'challenge_placement';

/** One "what you got" line. `icon` picks the glyph; `label` is already formatted for display. */
export type RewardLine = {
  kind: 'embers' | 'box' | 'xp' | 'cosmetic' | 'rank';
  label: string;
};

export type RewardRevealEvent = {
  kind: RewardRevealKind;
  /** The headline — "Level 12 claimed", "Today's fire is lit". */
  title: string;
  /** One quiet line under it. Optional. */
  subtitle?: string;
  /** What the server actually paid. Empty renders the reveal with no reward block. */
  rewards: RewardLine[];
};

// ─────────────────────────── THE TUNING TABLE ───────────────────────────
//
// Everything Noah will want to move on device is one row of this. Per event: how hard the rays
// read, what colour they are, how big the whole thing sits, and which cue fires.
//
// `priority` is the queue's ordering key, not a visual property — see enqueue(). Higher wins, and
// rank-up is highest so a session that ends as a rank-up AND a daily fire plays the small one first
// and the crescendo last.
export const REVEAL_TUNING: Record<
  RewardRevealKind,
  {
    tint: string;
    /** Wedges in the fan. More reads as brighter and busier at the same opacity. */
    rays: number;
    /** Overall size multiplier on the fan. Rank-up is the biggest by design. */
    scale: number;
    /** Peak opacity of the fan. */
    intensity: number;
    cue: RewardCue;
    /** The small caps label above the title. */
    eyebrow: string;
    priority: number;
  }
> = {
  // Present for completeness and for the queue's ordering. The rank-up celebration draws itself;
  // this row's visual fields are unused by it today, and are here so that if it is ever folded in
  // it lands in the same table as everything else rather than in a second one.
  rank_up: { tint: Colors.ember, rays: 18, scale: 1.15, intensity: 0.9, cue: 'rankup', eyebrow: 'RANK UP', priority: 100 },
  // The four win rows now carry the real fanfare (#185) instead of 'settle'/'spark' — the quiet
  // Post-confirmation tick and the per-ember landing blip, which were only ever standing in
  // because no bespoke win cue existed. Winning a duel sounded quieter than opening a common box.
  //
  // WHICH CUT, AND WHY IT IS A FIELD: 'victory-short' (2.53s) on the frequent row, 'victory'
  // (3.84s) on the rare ones. A pass level gets claimed many times a season and a four-second
  // tail would still be ringing after the card is gone; a settled challenge happens once and
  // should get the whole thing. Both cuts are loaded, so A/B-ing on device is editing the cue
  // here — no asset swap, no rebuild.
  pass_level: { tint: Colors.amber, rays: 14, scale: 1, intensity: 0.72, cue: 'victory-short', eyebrow: 'FLAME PASS', priority: 60 },
  // Untouched: the daily fire is the day's small beat, not a win, and 'ignite' is its own cue.
  daily_fire: { tint: Colors.coral, rays: 12, scale: 0.92, intensity: 0.66, cue: 'ignite', eyebrow: "TODAY'S FIRE", priority: 40 },
  challenge_solo: { tint: Colors.amber, rays: 13, scale: 0.96, intensity: 0.7, cue: 'victory', eyebrow: 'CHALLENGE WON', priority: 50 },
  challenge_team: { tint: Colors.sky, rays: 15, scale: 1.02, intensity: 0.74, cue: 'victory', eyebrow: 'TEAM CHALLENGE', priority: 55 },
  challenge_placement: { tint: Colors.ember, rays: 16, scale: 1.05, intensity: 0.78, cue: 'victory', eyebrow: 'PLACEMENT', priority: 58 },
};

/** How long the rays take to bloom in, and how long one full rotation takes. */
const BLOOM_MS = 620;
const SPIN_MS = 22000;

// ─────────────────────────── the fan ───────────────────────────

/**
 * The rays themselves — a fan of soft wedges behind the card, blooming out once and then turning
 * slowly forever.
 *
 * Wedges rather than lines, and each one fades to nothing at its outer end, because a hard-ended
 * spoke reads as a diagram. The slow rotation is what stops the fan reading as a static starburst
 * sticker; it is deliberately far slower than anything else on screen so it never competes with
 * the numbers it is behind.
 */
export function RewardRays({ kind, size }: { kind: RewardRevealKind; size: number }) {
  const id = `rays-${useId()}`;
  const tuning = REVEAL_TUNING[kind];
  const reducedMotion = useReducedMotion();
  const bloom = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    bloom.value = withTiming(1, { duration: reducedMotion ? 0 : BLOOM_MS, easing: Easing.out(Easing.cubic) });
    if (reducedMotion) return;
    spin.value = withRepeat(withTiming(1, { duration: SPIN_MS, easing: Easing.linear }), -1, false);
  }, [bloom, spin, reducedMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: bloom.value * tuning.intensity,
    transform: [{ scale: 0.72 + bloom.value * 0.28 }, { rotate: `${spin.value * 360}deg` }],
  }));

  const r = size / 2;
  const half = Math.PI / tuning.rays / 2.6;

  return (
    <Animated.View pointerEvents="none" style={[styles.rays, { width: size, height: size }, style]}>
      <Svg width={size} height={size} pointerEvents="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={tuning.tint} stopOpacity={0.85} />
            <Stop offset="1" stopColor={tuning.tint} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {Array.from({ length: tuning.rays }, (_, i) => {
          const a = (i / tuning.rays) * Math.PI * 2;
          // A thin triangle from the centre out — its far edge is where the gradient has already
          // reached zero, so there is no visible end to the spoke.
          const x1 = r + Math.cos(a - half) * r;
          const y1 = r + Math.sin(a - half) * r;
          const x2 = r + Math.cos(a + half) * r;
          const y2 = r + Math.sin(a + half) * r;
          return (
            <Path
              key={i}
              d={`M ${r} ${r} L ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)} Z`}
              fill={`url(#${id})`}
            />
          );
        })}
      </Svg>
    </Animated.View>
  );
}

const REWARD_GLYPH: Record<RewardLine['kind'], string> = {
  embers: '🔥',
  box: '🎁',
  xp: '✦',
  cosmetic: '◆',
  rank: '⚔',
};

// ─────────────────────────── the card ───────────────────────────

function RevealCard({ event, onDismiss }: { event: RewardRevealEvent; onDismiss: () => void }) {
  const tuning = REVEAL_TUNING[event.kind];
  const reducedMotion = useReducedMotion();
  const enter = useSharedValue(0);

  useEffect(() => {
    // Sound and haptics fire once, on entry, gated on the same two prefs the reward burst reads —
    // a reveal is exactly as opt-out-able as every other celebration in the app.
    const prefs = getRewardPreferencesSync();
    if (prefs.reward_sfx_enabled) playRewardSound(tuning.cue);
    enter.value = withDelay(
      60,
      withSequence(
        withTiming(1.04, { duration: reducedMotion ? 0 : 300, easing: Easing.out(Easing.back(1.6)) }),
        withTiming(1, { duration: reducedMotion ? 0 : 160 })
      )
    );
  }, [enter, tuning.cue, reducedMotion]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, enter.value * 1.4),
    transform: [{ scale: 0.9 + enter.value * 0.1 }],
  }));

  return (
    <Pressable style={styles.scrim} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss reward">
      <RewardRays kind={event.kind} size={340 * tuning.scale} />
      <Animated.View style={[styles.card, cardStyle]}>
        <Text style={[styles.eyebrow, { color: tuning.tint }]}>{tuning.eyebrow}</Text>
        <Text style={styles.title}>{event.title}</Text>
        {event.subtitle ? <Text style={styles.subtitle}>{event.subtitle}</Text> : null}

        {event.rewards.length > 0 && (
          <View style={styles.rewards}>
            {event.rewards.map((line, i) => (
              <View key={`${line.kind}-${i}`} style={styles.rewardRow}>
                <Text style={styles.rewardGlyph}>{REWARD_GLYPH[line.kind]}</Text>
                <Text style={styles.rewardLabel}>{line.label}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.dismiss}>Tap to continue</Text>
      </Animated.View>
    </Pressable>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE FLOOR — one celebration on screen at a time, across presenters that render nothing alike.
//
// The queue below owns the shared card, but two of the six rewards do not use it: the rank-up
// celebration is 1,500 lines of tier ladders and anthems, and the challenge reveal is its own
// full-screen result screen. Both are right to stay bespoke, and both used to present themselves
// the instant they had something — so a lock-in that ended as a rank-up AND settled a challenge
// stacked two modals, and adding the pass-level card would have made three.
//
// So the arbiter does not own RENDERING, it owns PERMISSION. Every presenter asks for the floor
// and draws only while it holds it. That is what lets a component keep its own UI, its own state
// and its own share sheet while still taking its turn.
//
// Ordering is the crescendo again: the LOWEST priority holds the floor first, so the small payouts
// clear and the rank-up is what you are left looking at.
//
// Listeners are notified on a microtask, not synchronously. A synchronous notify inside
// requestFloor would land the resulting setState in the caller's effect body, which is the
// cascading-render lint error this repo already carries in two dozen files.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

type FloorWaiter = { id: string; priority: number };

let waiters: FloorWaiter[] = [];
const floorListeners = new Set<() => void>();

function notifyFloor(): void {
  queueMicrotask(() => {
    for (const listener of floorListeners) listener();
  });
}

function floorHolder(): string | null {
  if (waiters.length === 0) return null;
  return [...waiters].sort((a, b) => a.priority - b.priority)[0].id;
}

/**
 * Ask for the floor, or update the priority of a request already in flight.
 *
 * The update matters: RewardRevealHost's kind changes as its own queue advances, so the same
 * waiter can legitimately want a different priority without releasing and re-requesting (which
 * would let another presenter cut in between the two calls).
 */
function requestFloor(id: string, priority: number): void {
  const existing = waiters.find((w) => w.id === id);
  if (existing) {
    if (existing.priority === priority) return;
    waiters = waiters.map((w) => (w.id === id ? { ...w, priority } : w));
  } else {
    waiters = [...waiters, { id, priority }];
  }
  notifyFloor();
}

function releaseFloor(id: string): void {
  if (!waiters.some((w) => w.id === id)) return;
  waiters = waiters.filter((w) => w.id !== id);
  notifyFloor();
}

/**
 * Hold the floor while `wants` is true. Returns whether this caller may draw right now.
 *
 * A presenter with something to show but no floor renders nothing and keeps waiting — it does not
 * lose the event, because `wants` stays true until it has actually been shown and dismissed.
 */
export function useRevealFloor(kind: RewardRevealKind, wants: boolean): boolean {
  const id = useId();
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    const sync = () => setGranted(floorHolder() === id);
    floorListeners.add(sync);
    if (wants) requestFloor(id, REVEAL_TUNING[kind].priority);
    else releaseFloor(id);
    return () => {
      // Unsubscribe BEFORE releasing, so this component's own listener cannot be called back for a
      // notify it triggered on the way out.
      floorListeners.delete(sync);
      releaseFloor(id);
    };
  }, [id, kind, wants]);

  return granted;
}

// ─────────────────────────── the queue ───────────────────────────
//
// One reveal at a time, app-wide.
//
// Before this there were two independent presenters — RankUpWatcher and ChallengeSettlementWatcher
// — each with its own `pending` slot and no knowledge of the other. A lock-in that ended as a
// rank-up AND settled a challenge showed both at once, stacked. Anything new would have been a
// third.

/** Queue entries carry an id so the card can be keyed without mutating anything during render. */
type QueuedReveal = RewardRevealEvent & { id: number };

let enqueueImpl: ((event: RewardRevealEvent) => void) | null = null;
let nextRevealId = 0;

/**
 * Queue a reward reveal from anywhere. No-ops if the host is not mounted (before sign-in), which
 * matches how showRankUp() behaves and means a caller never has to check.
 */
export function showRewardReveal(event: RewardRevealEvent): void {
  enqueueImpl?.(event);
}

/**
 * Mounted once, in the root layout, beside the other watchers.
 *
 * Ordering is by REVEAL_TUNING.priority and it is a CRESCENDO, not arrival order: the small
 * payouts play first and the rank-up last, because ending on the biggest is the whole reason to
 * sequence them rather than show them at once. Ties keep arrival order, so two challenges settle in
 * the order the server returned them.
 */
export function RewardRevealHost() {
  const [queue, setQueue] = useState<QueuedReveal[]>([]);

  useEffect(() => {
    enqueueImpl = (event) => {
      // The id is assigned HERE and used as the card's key. RankUpWatcher solves the same problem
      // with a token bumped at presentation time; doing that here would mean mutating a ref during
      // render, which React Compiler's purity rule rejects — and rightly, since a memo is free to
      // re-run. Without a changing key React reuses the card instance, so the second reveal in a
      // queue plays no sound and never replays its entrance.
      nextRevealId += 1;
      const queued: QueuedReveal = { ...event, id: nextRevealId };
      setQueue((current) => {
        const next = [...current, queued];
        // Stable sort by priority ascending — smallest first, crescendo last.
        return next
          .map((e, i) => ({ e, i }))
          .sort((a, b) => REVEAL_TUNING[a.e.kind].priority - REVEAL_TUNING[b.e.kind].priority || a.i - b.i)
          .map(({ e }) => e);
      });
    };
    return () => {
      enqueueImpl = null;
    };
  }, []);

  const current = queue[0] ?? null;
  // The host is just another presenter — it waits its turn behind a rank-up like everyone else.
  const hasFloor = useRevealFloor(current?.kind ?? 'daily_fire', current !== null);

  return (
    <Modal
      visible={current !== null && hasFloor}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setQueue((q) => q.slice(1))}>
      {current && hasFloor ? (
        <RevealCard key={current.id} event={current} onDismiss={() => setQueue((q) => q.slice(1))} />
      ) : (
        <View />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(10,8,16,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  rays: {
    position: 'absolute',
  },
  card: {
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.four,
    minWidth: 260,
    gap: Spacing.two,
  },
  eyebrow: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 1.6,
  },
  title: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 21,
    color: Colors.ink,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
    textAlign: 'center',
  },
  rewards: {
    marginTop: Spacing.two,
    gap: Spacing.two,
    alignSelf: 'stretch',
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Colors.selectedBg,
    borderRadius: Radius.card,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  rewardGlyph: {
    fontSize: 16,
  },
  rewardLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
    flex: 1,
  },
  dismiss: {
    marginTop: Spacing.three,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
  },
});
