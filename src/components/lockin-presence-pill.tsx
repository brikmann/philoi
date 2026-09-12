import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import type { LockInPresence, LockInPresenceKey } from '@/types/database';

/**
 * "540 studying right now" — the live presence pill, beside the flame on the running lock-in
 * screen (CODE_PROMPT_live_presence_counter.md).
 *
 * A pill and not a card. Someone glances at this between sets or when they look up from a page;
 * it is social proof, not a dashboard, and anything with a header and a breakdown would be
 * competing with the timer it sits under for the one thing the screen is for.
 *
 * Aggregate only. No avatars, no names, no identities — at this size the number IS the feature,
 * and "who" is a different (and far more sensitive) product than "how many".
 */

// ── COPY ───────────────────────────────────────────────────────────────────────────────────
//
// 🔴 The label and the number are one sentence and must be generated together. Every line below
// says exactly what the server counted: a 'today' count never wears a "right now", and a campus
// count always names the campus. That is not pedantry — the entire value of this pill is that a
// member who cross-checks it finds it true, and a number that quietly over-claims its window is
// indistinguishable from a fabricated one the moment anyone notices.
//
// Every cell is written out in full rather than assembled from parts. The assembled version is
// tempting and produces "120 at Laurier at the gym right now" — the campus phrasing and the gym
// phrasing both want the word "at", and no amount of cleverness fixes that from the outside.
type Line = (n: string, campus: string | null) => string;

const LINE: Record<LockInPresenceKey, Record<'now' | 'today' | 'week', Line>> = {
  study: {
    now: (n, c) => (c ? `${n} studying at ${c} right now` : `${n} studying right now`),
    today: (n, c) => (c ? `${n} studied at ${c} today` : `${n} studied today`),
    week: (n, c) => (c ? `${n} studied at ${c} this week` : `${n} studied this week`),
  },
  fitness: {
    now: (n, c) => (c ? `${n} on Fitness at ${c} right now` : `${n} locked in on Fitness right now`),
    today: (n, c) => (c ? `${n} on Fitness at ${c} today` : `${n} locked in on Fitness today`),
    week: (n, c) => (c ? `${n} on Fitness at ${c} this week` : `${n} locked in on Fitness this week`),
  },
  gym: {
    now: (n, c) => (c ? `${n} from ${c} at the gym right now` : `${n} at the gym right now`),
    today: (n, c) => (c ? `${n} from ${c} at the gym today` : `${n} at the gym today`),
    week: (n, c) => (c ? `${n} from ${c} at the gym this week` : `${n} at the gym this week`),
  },
};

/**
 * Display-only, and it never touches the number.
 *
 * "1,204 at Wilfrid Laurier University studying today" does not fit a pill, and the long form is
 * the only spelling `profiles.university` holds (it has to be — it is the campus leaderboard's
 * join key). So the school's own word is kept and the generic tail dropped: "University of
 * Toronto" -> "Toronto", "Wilfrid Laurier University" -> "Wilfrid Laurier". Anything this does
 * not recognise falls through unchanged, which is merely long rather than wrong.
 */
export function shortCampusName(name: string): string {
  const trimmed = name.trim();
  const of = trimmed.match(/^(?:University|Université|Universite|College) (?:of|de|du|des) (.+)$/i);
  if (of) return of[1];
  return trimmed.replace(/\s+(University|Université|Universite|College|Institute|Polytechnic)$/i, '');
}

function lineFor(presence: LockInPresence): string | null {
  if (presence.display === 'hidden') return null;

  if (presence.display === 'floor') {
    // 🔴 The floor state NEVER shows a number. "3 studying right now" reads as a dead app and
    // does the opposite of what this pill is for, and inflating it to something respectable
    // would be a lie — so below the threshold the pill stops being a count and becomes an
    // invitation. `alone` is the only thing the server tells us about the suppressed number, and
    // it is what keeps "be the first" from being said to someone who demonstrably is not.
    return presence.alone
      ? 'Be the first to light the fire today'
      : "You're locked in — you're not the only one";
  }

  // A room you can picture beats a global number you cannot — so when the server chose the campus
  // scope, the campus is named. When it chose global, the line says nothing about where, because
  // claiming a place for a number that spans every campus would be the same over-claim as
  // stretching a window.
  const campus = presence.scope === 'campus' && presence.campus ? shortCampusName(presence.campus) : null;
  return LINE[presence.key][presence.window](presence.count.toLocaleString(), campus);
}

/**
 * A short count-up (or down) when the number moves.
 *
 * 🔴 Bounded and self-terminating — it runs ~360ms on a CHANGE and then stops. There is no
 * rAF loop, no `withRepeat`, nothing ticking while the number is steady, which matters because
 * this component sits on a screen people leave running for two hours (see
 * CODE_PROMPT_perf_battery). A change arrives at most once per 30s, from a broadcast.
 *
 * It also skips itself entirely on the first value: counting up from 0 to 540 on mount would
 * animate a number that was never 0, which is a small lie told very visibly.
 */
function useCountUp(target: number | null, enabled: boolean): number | null {
  // The tween carries the target it is animating TOWARD, which is what lets a stale one be
  // ignored rather than cleared: when a new number arrives, `tween.target` no longer matches and
  // the render below falls straight through to the real value. The alternative — resetting the
  // tween whenever the target changes — is a setState in an effect body, i.e. a cascading render
  // on a screen that must not re-render for anything but its own clock.
  const [tween, setTween] = useState<{ target: number; value: number } | null>(null);
  const prevRef = useRef<number | null>(target);

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    // Nothing to animate: the first value ever (counting up from a 0 that was never true), a
    // number that did not move, or a member who has asked for reduced motion.
    if (target === null || from === null || from === target || !enabled) return;

    const STEPS = 6;
    let step = 0;
    const id = setInterval(() => {
      step += 1;
      if (step >= STEPS) {
        clearInterval(id);
        setTween(null);
        return;
      }
      setTween({ target, value: Math.round(from + ((target - from) * step) / STEPS) });
    }, 60);
    return () => clearInterval(id);
  }, [target, enabled]);

  return tween && tween.target === target ? tween.value : target;
}

export function LockInPresencePill({
  presence,
  compact = false,
}: {
  presence: LockInPresence | null;
  /** Gym's header rail, where the flame is a background layer and space is tight. */
  compact?: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const target = presence?.display === 'count' ? presence.count : null;
  const shownCount = useCountUp(target, !reduceMotion);

  if (!presence) return null;
  // Nothing at all while the pill has nothing true to say. An empty pill outline is a broken
  // control; the absence of one is just a screen that never mentioned it.
  const line =
    presence.display === 'count' && shownCount !== null
      ? lineFor({ ...presence, count: shownCount })
      : lineFor(presence);
  if (!line) return null;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(320)}
      style={[styles.pill, compact && styles.pillCompact]}
      // One label for the whole pill: a screen reader announcing a glyph and then a number as two
      // nodes turns a glance into a sentence read twice.
      accessibilityRole="text"
      accessibilityLabel={line}>
      <Ionicons
        name={presence.display === 'floor' ? 'flame-outline' : 'flame'}
        size={compact ? 11 : 13}
        color={Colors.ember}
      />
      <Text style={[styles.text, compact && styles.textCompact]} numberOfLines={1}>
        {line}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Matches the focus-nudge pill on the same screen — they are siblings in the same stack and a
  // second pill shape here would read as a second kind of thing.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing.two,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(242,163,60,0.3)',
    backgroundColor: 'rgba(36,26,46,0.7)',
    maxWidth: '92%',
  },
  pillCompact: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    gap: Spacing.one,
  },
  text: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ember,
    flexShrink: 1,
  },
  textCompact: {
    fontSize: 11,
  },
});
