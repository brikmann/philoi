import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOutDown, SlideInDown } from 'react-native-reanimated';

import { NavGlyph } from '@/components/ui/nav-glyph';
import { SessionGlyph } from '@/components/ui/glyphs-session';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts } from '@/constants/theme';
import { useAppActive } from '@/hooks/use-motion-active';
import type { ActiveSession } from '@/lib/active-session-context';
import { friendActivityLabel } from '@/lib/api/lockin-cheers';
import { formatDurationClock } from '@/lib/format';
import { categoryForGoalType } from '@/lib/goal-types';
import { creditedSeconds } from '@/lib/lock-in-clock';

// THE RUNNING-TIMER BAR (v2 fixes §6, mock 408) — a Strava-style pill docked directly above the
// bottom nav while a lock-in is live. Presentational: global-footer.tsx owns when it shows (only
// where the footer itself shows, spark only) and hands it the ONE active session and the SAME
// pause/resume the lock-in screen calls (lib/active-session-context), so there is no second clock
// and no second pause path:
//
//   - The time is creditedSeconds(session) — the exact derivation useElapsedSeconds gives the
//     lock-in screen, mirroring the server's lock_in_credited_seconds (0218). Paused time is
//     excluded and the readout freezes on the paused second. The interval below only forces a
//     re-render; it never counts anything itself.
//   - Pause/resume is the context's pause()/resume(): optimistic freeze on the tap, settled on the
//     server row, rolled back + reconciled on failure.
//
// Why not useElapsedSeconds itself: its tick is gated on useIsFocused(), and this bar lives under
// the root navigator, outside any screen — there is no focus to read. The tick here is gated on the
// app being foregrounded instead, with the same catch-up-on-resume property (every render
// recomputes from Date.now()). It keeps ticking while paused for the reason useElapsedSeconds
// documents: resume would otherwise render one frame against a stale `now` and jump backwards.

// The lock-in screen's on-ember ink for the play glyph on the lit resume disc.
const PAUSE_RESUME_INK = '#2A0F05';

export function LiveLockInBar({
  session,
  onOpen,
  onPause,
  onResume,
}: {
  session: ActiveSession;
  /** Opens the full lock-in screen — the same route the Feed's "Your session" CTA pushes. */
  onOpen: () => void;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
}) {
  const foreground = useAppActive();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  // A pause RPC can outlive this bar (the footer hides on route change). A ref the effect sets and
  // clears only on true unmount — empty deps, so its cleanup never runs on a re-render.
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!foreground) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the catch-up tick on foreground: the clock is the external system
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [foreground]);

  const paused = session.pausedAt !== null;
  const seconds = creditedSeconds(session, now);
  // "Deep Work" / "Gym" / "Cardio" / "Study" — the friend-strip's label helper, fed the category the
  // server derived goal_type from (Deep Work is stored as the flat 'custom', 0186).
  const typeLabel = friendActivityLabel({ live: true, goalType: session.goalType, ...categoryForGoalType(session.goalType) });

  async function togglePause() {
    if (busy) return;
    setBusy(true);
    // Re-read the clock on the tap, so the optimistic freeze/resume renders against this second
    // rather than up to a second-old `now` (which would flash the readout backwards on resume).
    setNow(Date.now());
    try {
      await (paused ? onResume() : onPause());
    } catch {
      // The context already rolled the optimistic state back and asked the server what is true;
      // the full screen is where an error line belongs, not a pill over the nav.
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }

  return (
    <Animated.View entering={SlideInDown.duration(260)} exiting={FadeOutDown.duration(200)} style={styles.dock}>
      <Pressable
        onPress={onOpen}
        style={styles.pill}
        accessibilityRole="button"
        accessibilityLabel={`${paused ? 'Paused' : 'Locked in'}, ${typeLabel}, ${formatDurationClock(seconds)}. Open your session`}>
        <View style={styles.flameTile}>
          <NavGlyph name="flame" size={19} color={Colors.gold} />
          {paused ? null : <View style={styles.liveDot} />}
        </View>
        <View style={styles.body}>
          <Text style={styles.kicker} numberOfLines={1}>
            {paused ? 'Paused' : 'Locked in'} · {typeLabel}
          </Text>
          <Text style={[styles.timer, paused && styles.timerPaused]}>{formatDurationClock(seconds)}</Text>
        </View>
        <Pressable
          onPress={togglePause}
          disabled={busy}
          hitSlop={6}
          style={[styles.pauseBtn, paused && styles.resumeBtn, busy && styles.busy]}
          accessibilityRole="button"
          accessibilityLabel={paused ? 'Resume lock-in' : 'Pause lock-in'}>
          <SessionGlyph name={paused ? 'play' : 'pause'} size={16} color={paused ? PAUSE_RESUME_INK : Colors.navEmber2} />
        </Pressable>
        <UiGlyph name="forward" size={16} color={Colors.spaceDim} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dock: {
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  // Mock 408: ember wash left-to-right, ember rim, a soft ember glow under it.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: '#2E1A2A',
    borderWidth: 1,
    borderColor: 'rgba(255,176,90,0.5)',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: Colors.navEmber,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  flameTile: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.navEmber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#FF4D4D',
    borderWidth: 2,
    borderColor: '#0E0A1C',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.navEmber2,
  },
  timer: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 20,
    letterSpacing: 0.5,
    marginTop: 1,
    color: Colors.ink,
    // No jitter as the digits change width.
    fontVariant: ['tabular-nums'],
  },
  timerPaused: {
    color: Colors.spaceDim,
  },
  pauseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: 'rgba(255,176,90,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Paused: the lit ember disc, as on the lock-in screen — the one control a paused session wants.
  resumeBtn: {
    backgroundColor: Colors.navEmber,
    borderColor: Colors.navEmber,
  },
  busy: {
    opacity: 0.5,
  },
});
