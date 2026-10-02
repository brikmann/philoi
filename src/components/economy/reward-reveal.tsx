import { useRouter } from "expo-router";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import {
  FullscreenRays,
  REVEAL_TUNING,
  type RewardRevealKind,
} from "@/components/economy/reward-rays";
import { UnlockReveal } from "@/components/economy/unlock-reveal";
import { Colors, Fonts, Radius, Spacing } from "@/constants/theme";
import type { CatalogItem } from "@/lib/economy/catalog";
import { RARITY_ORDER } from "@/lib/economy/rarity";
import { getRewardPreferencesSync } from "@/lib/reward-settings";
import { playRewardSound } from "@/lib/sound";

// The fan and its tuning table live in reward-rays.tsx (so the unlock reveal can draw the same light
// without a require cycle); re-exported here so every existing import keeps working.
export {
  FullscreenRays,
  REVEAL_TUNING,
  RewardRays,
  type RewardRevealKind,
} from "@/components/economy/reward-rays";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE RAYS — one reveal language for every reward the app pays out.
//
// Six things can pay you: a rank-up, a pass level, the daily fire, and the three challenge
// settlements. Before this, each one had drawn its own rays or none at all — `rank-up-celebration`,
// `challenge-reward-screen`, `crate-open` and `forge-strike` each carry their own fan of wedges, and
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

/** One "what you got" line. `icon` picks the glyph; `label` is already formatted for display. */
export type RewardLine = {
  kind: "embers" | "box" | "xp" | "cosmetic" | "rank";
  label: string;
  /**
   * The thing's own art, drawn in place of the kind glyph (mock 216).
   *
   * `cosmetic: '◆'` below is the flat generic glyph the 2.5D pass is removing: every cosmetic in
   * the catalog has a drawing, and a reveal that names one while showing a black diamond is the
   * one place the user is being told what they won. Optional, because not every line has an id
   * behind it — an XP or ember line has no object to draw, and those keep their glyph.
   */
  art?: ReactNode;
  /**
   * The cosmetic this line paid, when it paid one. Makes the row a door into the universal unlock
   * reveal (unlock-reveal.tsx) — the item as itself, on your profile, in action. An event with
   * exactly one item opens straight into that reveal; with several, each row opens its own on a tap.
   */
  item?: CatalogItem;
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

/**
 * Play a reveal's tuned cue once, on mount, gated on the SFX preference.
 *
 * Extracted because the cue table only ever reached the SHARED CARD. The two bespoke reveals —
 * the goal-complete screen and the challenge settlement screen — draw their own UI and so never
 * ran this line: the goal screen played `RewardBurst`'s quiet 'settle' tick and nothing else, and
 * the challenge screen, the loudest payout in the app, was silent. `victory` has been sitting in
 * three rows of REVEAL_TUNING with nothing reading them.
 *
 * Fire-once per mount, which is why `kind` is not a dep: both presenters key their screen on the
 * settlement so a second queued reveal is a fresh mount, and re-firing a fanfare because a parent
 * re-rendered with a different kind would double the sound rather than replace it.
 *
 * NOT the rank-up. It keeps its own tier ladder and its anthem — see the header.
 */
export function useRevealCue(kind: RewardRevealKind): void {
  useEffect(() => {
    if (getRewardPreferencesSync().reward_sfx_enabled)
      playRewardSound(REVEAL_TUNING[kind].cue);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one fanfare per mount
  }, []);
}

const REWARD_GLYPH: Record<RewardLine["kind"], string> = {
  embers: "🔥",
  box: "🎁",
  xp: "✦",
  cosmetic: "◆",
  rank: "⚔",
};

// ─────────────────────────── the card ───────────────────────────

function RevealCard({
  event,
  onDismiss,
  onOpenItem,
}: {
  event: RewardRevealEvent;
  onDismiss: () => void;
  onOpenItem: (item: CatalogItem) => void;
}) {
  const tuning = REVEAL_TUNING[event.kind];
  const reducedMotion = useReducedMotion();
  const enter = useSharedValue(0);

  // Gated on the same pref the reward burst reads — a reveal is exactly as opt-out-able as every
  // other celebration in the app. Shared with the two bespoke reveals, which is the point of it.
  useRevealCue(event.kind);

  useEffect(() => {
    enter.value = withDelay(
      60,
      withSequence(
        withTiming(1.04, {
          duration: reducedMotion ? 0 : 300,
          easing: Easing.out(Easing.back(1.6)),
        }),
        withTiming(1, { duration: reducedMotion ? 0 : 160 }),
      ),
    );
  }, [enter, reducedMotion]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, enter.value * 1.4),
    transform: [{ scale: 0.9 + enter.value * 0.1 }],
  }));

  return (
    <Pressable
      style={styles.scrim}
      onPress={onDismiss}
      accessibilityRole="button"
      accessibilityLabel="Dismiss reward"
    >
      <FullscreenRays kind={event.kind} />
      <Animated.View style={[styles.card, cardStyle]}>
        <Text style={[styles.eyebrow, { color: tuning.tint }]}>
          {tuning.eyebrow}
        </Text>
        <Text style={styles.title}>{event.title}</Text>
        {event.subtitle ? (
          <Text style={styles.subtitle}>{event.subtitle}</Text>
        ) : null}

        {event.rewards.length > 0 && (
          <View style={styles.rewards}>
            {event.rewards.map((line, i) =>
              line.item ? (
                <Pressable
                  key={`${line.kind}-${i}`}
                  style={styles.rewardRow}
                  onPress={() => line.item && onOpenItem(line.item)}
                  accessibilityRole="button"
                  accessibilityLabel={`See ${line.label}`}
                >
                  {line.art ?? (
                    <Text style={styles.rewardGlyph}>
                      {REWARD_GLYPH[line.kind]}
                    </Text>
                  )}
                  <Text style={styles.rewardLabel}>{line.label}</Text>
                  <Text style={styles.rewardSee}>See it ›</Text>
                </Pressable>
              ) : (
                <View key={`${line.kind}-${i}`} style={styles.rewardRow}>
                  {line.art ?? (
                    <Text style={styles.rewardGlyph}>
                      {REWARD_GLYPH[line.kind]}
                    </Text>
                  )}
                  <Text style={styles.rewardLabel}>{line.label}</Text>
                </View>
              ),
            )}
          </View>
        )}

        <Text style={styles.dismiss}>Tap to continue</Text>
      </Animated.View>
    </Pressable>
  );
}

/** The items an event paid, rarest first — the order the reveal grid uses (mock 256). */
function itemsOf(event: RewardRevealEvent): CatalogItem[] {
  return event.rewards
    .flatMap((l) => (l.item ? [l.item] : []))
    .sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity]);
}

/**
 * One queued event, presented: the card, with the universal unlock reveal over it for a cosmetic.
 *
 * ×1 → straight to the full reveal; back (or "Add to inventory") lands on the card with the rest of
 * what the event paid. ×N → the card, each item row a tap into its own reveal. Never a chain of
 * reveals that plays itself. A bare `showUnlockReveal` event has no card worth landing on, so its
 * reveal closes the whole thing.
 */
function RevealPresenter({
  event,
  onDismiss,
}: {
  event: RewardRevealEvent;
  onDismiss: () => void;
}) {
  const router = useRouter();
  const items = itemsOf(event);
  const bare = event.kind === "item_unlock";
  const [open, setOpen] = useState<CatalogItem | null>(
    items.length === 1 ? items[0] : null,
  );

  if (open) {
    return (
      <UnlockReveal
        key={open.id}
        item={open}
        onBack={bare ? undefined : () => setOpen(null)}
        onClose={bare ? onDismiss : () => setOpen(null)}
        closeLabel={bare ? "Add to inventory" : "Back"}
        // Equipped: the whole reveal steps aside and the loadout picker shows it applied.
        onEquipped={() => {
          onDismiss();
          router.push("/loadout");
        }}
      />
    );
  }
  return (
    <RevealCard event={event} onDismiss={onDismiss} onOpenItem={setOpen} />
  );
}

/**
 * Queue the universal unlock reveal for one cosmetic from anywhere — the entry point for a source
 * that has an item and nothing else to say (a placement grant, a rank-up exclusive, once the server
 * reports them). Waits its turn on the floor like every other reveal.
 */
export function showUnlockReveal(item: CatalogItem): void {
  showRewardReveal({
    kind: "item_unlock",
    title: item.name,
    rewards: [{ kind: "cosmetic", label: item.name, item }],
  });
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
export function useRevealFloor(
  kind: RewardRevealKind,
  wants: boolean,
): boolean {
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

/**
 * Whether ANY presenter currently holds or wants the floor — i.e. whether a celebration is on
 * screen or about to be.
 *
 * Exists for the coach-marks (CODE_PROMPT_coach_marks.md), which are NOT a reveal and must never
 * take a turn in the crescendo: a one-line tooltip is not something to make a rank-up wait behind,
 * and `useRevealFloor` has no way to express "yield to everyone, queue behind no one". So they read
 * the floor instead of joining it, and simply decline to appear while it is occupied.
 *
 * A PLAIN FUNCTION, NOT A HOOK, deliberately. The one caller asks this once, in a timer callback,
 * at the moment it is deciding whether to raise a tooltip — it has no use for a subscription, and a
 * hook would have meant a `busy` state in the presenter and a setState-in-effect to act on it.
 *
 * `waiters.length > 0` rather than "someone is granted": a presenter that has asked but not yet been
 * granted is one microtask away from covering the screen, and a tooltip that appears for a single
 * frame under a forge animation is worse than one that waits for the next visit.
 */
export function revealFloorBusy(): boolean {
  return waiters.length > 0;
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
          .sort(
            (a, b) =>
              REVEAL_TUNING[a.e.kind].priority -
                REVEAL_TUNING[b.e.kind].priority || a.i - b.i,
          )
          .map(({ e }) => e);
      });
    };
    return () => {
      enqueueImpl = null;
    };
  }, []);

  const current = queue[0] ?? null;
  // The host is just another presenter — it waits its turn behind a rank-up like everyone else.
  const hasFloor = useRevealFloor(
    current?.kind ?? "daily_fire",
    current !== null,
  );

  return (
    <Modal
      visible={current !== null && hasFloor}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setQueue((q) => q.slice(1))}
    >
      {current && hasFloor ? (
        <RevealPresenter
          key={current.id}
          event={current}
          onDismiss={() => setQueue((q) => q.slice(1))}
        />
      ) : (
        <View />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(10,8,16,0.86)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
  card: {
    alignItems: "center",
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
    textAlign: "center",
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.muted,
    textAlign: "center",
  },
  rewards: {
    marginTop: Spacing.two,
    gap: Spacing.two,
    alignSelf: "stretch",
  },
  rewardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    backgroundColor: Colors.selectedBg,
    borderRadius: Radius.card,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  rewardGlyph: {
    fontSize: 16,
  },
  rewardSee: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.amber,
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
