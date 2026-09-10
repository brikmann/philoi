import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { revealFloorBusy } from '@/components/economy/reward-reveal';
import { EquippedFlameSvg } from '@/components/flame-icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { track } from '@/lib/analytics';
import { COACH_MARKS, markCoachMarkSeen, type CoachMarkKey } from '@/lib/coach-marks';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE COACH-MARK OVERLAY — CODE_PROMPT_coach_marks.md. Client/OTA, no native, no migration.
//
// One Cindy line, pointing at one real control, the first time you reach a surface. Copy and
// eligibility live in lib/coach-marks.ts; the ANCHOR is supplied by hooks/use-coach-mark.ts; this
// file is only the drawing of it.
//
// ─────────────────────────── WHY THIS IS NOT A <Modal> ───────────────────────────
//
// Every other overlay in this tree is one (the reward reveals, the nav drawer), and this one
// deliberately is not. A Modal renders into its OWN native window, and everything here is drawn
// from `measureInWindow` coordinates taken in the APP's window. Those two agree today — Android is
// edge-to-edge from SDK 54 and `statusBarTranslucent` matches it — but they agree by a coincidence
// of platform configuration, and a spotlight one status-bar height off its control is a worse bug
// than no spotlight at all, because it points confidently at the wrong thing.
//
// Mounted as a sibling of the navigator instead (see _layout.tsx), so the rectangle it dims and
// the rectangle the anchor measured are the same rectangle, by construction. The two things a
// Modal would have given for free are re-added by hand below: the hardware back button, and
// tearing down when the screen underneath goes away.
//
// 🔒 IT TOUCHES NOTHING. One AsyncStorage flag on dismiss, and two analytics events. It cannot
// start a lock-in, spend an ember or send a duel — the only control it has is "Got it".
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Window-space rectangle of the control being pointed at, straight out of `measureInWindow`. */
export type AnchorRect = { x: number; y: number; width: number; height: number };

export type CoachMarkRequest = { key: CoachMarkKey; rect: AnchorRect };

/** Breathing room between the control and the edge of the lit area. */
const SPOTLIGHT_PAD = 8;
/** How far the bubble sits off the spotlight. */
const BUBBLE_GAP = 12;
const BUBBLE_MAX_WIDTH = 300;
const SCREEN_MARGIN = 20;
/** Enough to decide above-or-below before the bubble has laid out. Generous on purpose — guessing
 *  too tall only flips a bubble that would have fit below to above, which never looks wrong. */
const BUBBLE_ESTIMATED_HEIGHT = 132;
const TAIL = 12;

// ─────────────────────────── the registry ───────────────────────────
//
// Module-level, matching how reward-reveal.tsx's floor and queue are wired: the requester is a hook
// on some screen deep in the navigator and the presenter is mounted once at the root, and there is
// no shared React ancestor worth threading a context through for a single mutually-exclusive slot.

let presentImpl: ((request: CoachMarkRequest | null) => void) | null = null;
/** Non-null while a mark is on screen. The "never stack two" rule, in one variable. */
let showingKey: CoachMarkKey | null = null;

/**
 * Ask to draw a mark. Returns whether it was accepted.
 *
 * 🔴 A REJECTED REQUEST IS DROPPED, NOT QUEUED, and its key is NOT marked seen — so the mark simply
 * fires on the next visit to that surface, which is what the spec's "show the next one on the next
 * qualifying screen" amounts to in practice. A real queue would be worse here, not better: a queued
 * request carries a RECTANGLE, and by the time it came up the screen that measured it could be
 * unmounted, scrolled or replaced, leaving a spotlight lighting empty background. A rect is only
 * trustworthy on the frame it was taken.
 */
export function presentCoachMark(request: CoachMarkRequest): boolean {
  if (showingKey !== null || presentImpl === null) return false;
  // Yield to any celebration that is on screen or one microtask from it. Checked here rather than
  // subscribed to in the host, so there is no `busy` state to react to and nothing to tear down.
  if (revealFloorBusy()) return false;
  showingKey = request.key;
  presentImpl(request);
  return true;
}

/**
 * Take a mark down WITHOUT marking it seen, because the screen it was measured against is going
 * away — the anchor hook calls this from its focus cleanup.
 *
 * 🔴 THE SPOTLIGHT IS ONLY VALID ON THE SCREEN THAT MEASURED IT. Any navigation out from under it —
 * a deep link, a push notification, a back gesture — would otherwise leave a hole lit over whatever
 * screen arrived next. A <Modal> would have blocked all of that for free; this is the price of not
 * being one, and it is charged to the screen that raised the mark, which is the only party that
 * knows when its own rectangle stopped meaning anything.
 *
 * Deferred to a microtask for the reason reward-reveal.tsx's `notifyFloor` gives: a synchronous
 * setState from inside a caller's effect cleanup is the cascading-render lint error, and the
 * dismissal has nothing to gain from landing a frame earlier.
 */
export function dismissCoachMark(key: CoachMarkKey): void {
  if (showingKey !== key) return;
  showingKey = null;
  const dismiss = presentImpl;
  queueMicrotask(() => dismiss?.(null));
}

/**
 * Mounted once, at the root, beside the reward watchers.
 *
 * Renders nothing until some screen's anchor asks for it, which is almost always never — seven
 * marks across the life of an install.
 */
export function CoachMarkHost() {
  const [current, setCurrent] = useState<CoachMarkRequest | null>(null);
  const reduceMotion = useReduceMotion();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  useEffect(() => {
    presentImpl = setCurrent;
    return () => {
      presentImpl = null;
      // Sign-out unmounts this whole subtree. Leaving the module flag set would mean no mark ever
      // draws again for the next account signed in on this device.
      showingKey = null;
    };
  }, []);

  /**
   * The read path — the user tapped Got it, tapped the dim, or pressed back. Only THIS burns the
   * key; `dismissCoachMark` is the other exit, and it deliberately does not, so a mark taken down
   * because its screen went away still gets another go.
   */
  const close = useCallback((key: CoachMarkKey) => {
    showingKey = null;
    setCurrent(null);
    markCoachMarkSeen(key).catch(() => {});
    track('coach_mark_dismissed', { key });
  }, []);

  const activeKey = current?.key ?? null;

  useEffect(() => {
    if (activeKey === null) return;
    track('coach_mark_shown', { key: activeKey });
  }, [activeKey]);

  // A celebration that arrives mid-tooltip is NOT handled here. It renders in its own <Modal>, so
  // it covers this without being asked to, and when it is dismissed the tooltip underneath is still
  // pointing at the same control on the same screen — there is nothing to repair. The only case
  // worth spending code on is the floor being busy BEFORE a mark is raised, which presentCoachMark
  // refuses outright.

  // Android's back button, which without a Modal to swallow it would pop the
  // route out from under the mark. Dismissing IS what back should do here, so it counts as read.
  useEffect(() => {
    if (activeKey === null) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close(activeKey);
      return true;
    });
    return () => subscription.remove();
  }, [activeKey, close]);

  if (!current) return null;

  const copy = COACH_MARKS[current.key];
  const dismiss = () => close(current.key);

  // The lit rectangle, padded and then clamped — an anchor partly off-screen (a FAB under the
  // keyboard, a row half-scrolled) must not produce negative-width dim panels.
  const left = Math.max(0, current.rect.x - SPOTLIGHT_PAD);
  const top = Math.max(0, current.rect.y - SPOTLIGHT_PAD);
  const right = Math.min(screenWidth, current.rect.x + current.rect.width + SPOTLIGHT_PAD);
  const bottom = Math.min(screenHeight, current.rect.y + current.rect.height + SPOTLIGHT_PAD);
  const spotWidth = Math.max(0, right - left);
  const spotHeight = Math.max(0, bottom - top);
  // A circular control needs a circular hole; a card needs the app's own card radius. Anything
  // between reads as a sticker over the control rather than a light on it.
  const radius = copy.round ? spotHeight / 2 : Radius.input;

  const bubbleWidth = Math.min(BUBBLE_MAX_WIDTH, screenWidth - SCREEN_MARGIN * 2);
  const anchorCentreX = left + spotWidth / 2;
  const bubbleLeft = clamp(
    anchorCentreX - bubbleWidth / 2,
    SCREEN_MARGIN,
    Math.max(SCREEN_MARGIN, screenWidth - SCREEN_MARGIN - bubbleWidth),
  );
  // Below by default — the bubble must not cover the thing it is describing, and a control sits in
  // the lower half of a screen more often than the upper.
  const below = bottom + BUBBLE_GAP + BUBBLE_ESTIMATED_HEIGHT < screenHeight - SCREEN_MARGIN;
  // ...unless there is no room either side of it, which happens when the anchor is most of the
  // screen. Then the bubble is pinned near the bottom and OVERLAPS the spotlight, and the tail is
  // dropped — a tail pointing at something it is sitting on top of reads as a rendering fault.
  // Without this, `bottom: screenHeight - top` on a spotlight that starts at y=0 puts the bubble
  // an entire screen below the bottom edge, i.e. nowhere.
  const aboveFits = top - BUBBLE_GAP - BUBBLE_ESTIMATED_HEIGHT > SCREEN_MARGIN;
  const floating = !below && !aboveFits;
  // Tail x is relative to the bubble, clamped inside its corners so it never floats past one.
  const tailLeft = clamp(
    anchorCentreX - bubbleLeft - TAIL / 2,
    Spacing.three,
    Math.max(Spacing.three, bubbleWidth - Spacing.three - TAIL),
  );

  return (
    // box-none on the frame so the four dim panels take the taps, not this wrapper — it is only a
    // positioning context.
    <View style={styles.overlay} pointerEvents="box-none">
      {/* Tap ANYWHERE dismisses (the spec's "never blocks"). Four panels rather than one full-screen
          scrim with a masked hole: RN has no CSS mask, four Views are cheaper than an SVG mask, and
          the real control stays drawn at full brightness underneath, which is the whole effect. The
          hole itself is deliberately not covered, so the anchor is never dimmed. */}
      <DimPanel style={{ left: 0, top: 0, width: screenWidth, height: top }} onPress={dismiss} />
      <DimPanel
        style={{ left: 0, top: bottom, width: screenWidth, height: Math.max(0, screenHeight - bottom) }}
        onPress={dismiss}
      />
      <DimPanel style={{ left: 0, top, width: left, height: spotHeight }} onPress={dismiss} />
      <DimPanel
        style={{ left: right, top, width: Math.max(0, screenWidth - right), height: spotHeight }}
        onPress={dismiss}
      />

      {/* The ring. Non-interactive: a tap here lands on the control's own hit target, which is the
          correct thing for it to do — the hole is a window, not a button. */}
      <View
        pointerEvents="none"
        style={[styles.ring, { left, top, width: spotWidth, height: spotHeight, borderRadius: radius }]}
      />

      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(220)}
        style={[
          styles.bubbleWrap,
          { left: bubbleLeft, width: bubbleWidth },
          below
            ? { top: bottom + BUBBLE_GAP }
            : floating
              ? { bottom: SCREEN_MARGIN }
              : { bottom: Math.max(0, screenHeight - top) + BUBBLE_GAP },
        ]}
        /* Announced on arrival, but NOT marked `accessible` as a whole: collapsing the bubble into
           one accessibility element would swallow the Got it button inside it, leaving a screen
           reader user with a tooltip and no way to dismiss it. */
        accessibilityLiveRegion="polite">
        {below ? <View style={[styles.tail, styles.tailUp, { left: tailLeft }]} /> : null}
        <View style={styles.bubble}>
          <View accessible accessibilityRole="text" accessibilityLabel={`Cindy says: ${copy.line}`}>
            <View style={styles.head}>
              <EquippedFlameSvg width={13} height={16} />
              <Text style={styles.who}>CINDY</Text>
            </View>
            <Text style={styles.line}>{copy.line}</Text>
          </View>
          <Pressable
            onPress={dismiss}
            hitSlop={10}
            style={styles.got}
            accessibilityRole="button"
            accessibilityLabel="Got it">
            <Text style={styles.gotText}>Got it</Text>
          </Pressable>
        </View>
        {below || floating ? null : <View style={[styles.tail, styles.tailDown, { left: tailLeft }]} />}
      </Animated.View>
    </View>
  );
}

function DimPanel({
  style,
  onPress,
}: {
  style: { left: number; top: number; width: number; height: number };
  onPress: () => void;
}) {
  if (style.width <= 0 || style.height <= 0) return null;
  return (
    <Pressable style={[styles.dim, style]} onPress={onPress} accessibilityRole="button" accessibilityLabel="Dismiss this tip" />
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  overlay: {
    // Spelled out rather than StyleSheet.absoluteFillObject — RN 0.86's types no longer carry it.
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    // Above the navigator and above the rank-up celebration's own in-tree overlay (zIndex 100),
    // which is the only other thing drawn in this window rather than in a Modal.
    zIndex: 200,
    elevation: 200,
  },
  dim: {
    position: 'absolute',
    // Light enough that the surrounding screen is still legible — this is a hint, not a lightbox.
    backgroundColor: 'rgba(10,7,16,0.66)',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: Colors.amber,
  },
  bubbleWrap: {
    position: 'absolute',
    alignItems: 'flex-start',
  },
  bubble: {
    alignSelf: 'stretch',
    backgroundColor: Colors.selectedBg,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.35)',
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: Spacing.twelve,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: Spacing.one,
  },
  who: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: Colors.amber,
  },
  line: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.ink,
  },
  got: {
    alignSelf: 'flex-end',
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(242,163,60,0.16)',
  },
  gotText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.amber,
  },
  // Same rotated-square trick CindyBubble uses — RN has no border-triangle, and a 45° square is the
  // only shape that keeps the 1px border continuous around the point.
  tail: {
    position: 'absolute',
    width: TAIL,
    height: TAIL,
    backgroundColor: Colors.selectedBg,
    borderColor: 'rgba(242,163,60,0.35)',
    transform: [{ rotate: '45deg' }],
  },
  // Bubble below the control: the point is on top, so the two lit edges are top and left.
  tailUp: {
    top: -TAIL / 2,
    borderTopWidth: 1,
    borderLeftWidth: 1,
  },
  tailDown: {
    bottom: -TAIL / 2,
    borderBottomWidth: 1,
    borderRightWidth: 1,
  },
});
