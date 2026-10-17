import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { useMotionActive } from '@/hooks/use-motion-active';
import { formatRelativeTime } from '@/lib/format';
import type { PresenceRow } from '@/types/database';

// The "Locked in now" badge (mock 273, migration 0245). Renders the HIGHEST state that applies:
//
//   🔥 Locked in · STUDY   → 🟢 Online   → ⚪ Active 7m ago (friends only)   → nothing
//
// Every gate lives in get_presence; this only picks which of the already-safe fields to paint.
// `lastActive` is opt-in per call site. get_presence only ever returns last_active_at to a FRIEND
// (reciprocally), so wherever it renders it is a statement about a friend — which is why a board row
// can tag it "· friend" (mock 273) without knowing the relationship itself.

/** Mock 273's live green — brighter than Colors.green so the dot reads as "on" against dark rows. */
const LIVE = '#46D17A';

/** discipline KEY (0245) → label. Unknown keys render a bare "Locked in". */
export const DISCIPLINE_LABEL: Record<string, string> = {
  study: 'STUDY',
  deep_work: 'DEEP WORK',
  strength: 'LIFTING',
  cardio: 'CARDIO',
};

function lastActiveLabel(iso: string): string {
  const rel = formatRelativeTime(iso);
  if (rel === 'just now') return 'Active just now';
  if (rel === '1d ago') return 'Active yesterday';
  return `Active ${rel}`;
}

export function LiveStatusBadge({
  presence,
  variant = 'row',
  lastActive = false,
  tagFriend = false,
  centered = false,
}: {
  presence: PresenceRow | undefined;
  /** 'row' = the small line under a name; 'pill' = the profile header's chip. */
  variant?: 'row' | 'pill';
  /** Show the friends-only "Active x ago" tier. Only pass where a friendship is known. */
  lastActive?: boolean;
  /** Append "· friend" to last-active, for lists that mix friends and strangers (boards, search). */
  tagFriend?: boolean;
  /** Centre a 'row' badge under a centred name (the podium). */
  centered?: boolean;
}) {
  if (!presence) return null;
  const pill = variant === 'pill';
  const wrap = [styles.wrap, centered && styles.centered];

  if (presence.locked_in) {
    const label = presence.discipline ? DISCIPLINE_LABEL[presence.discipline] : undefined;
    return (
      <View
        style={[wrap, pill && styles.pill]}
        accessible
        accessibilityLabel={label ? `Locked in now, ${label.toLowerCase()}` : 'Locked in now'}>
        <LiveDot size={pill ? 8 : 7} />
        <Text style={[styles.text, styles.live, pill && styles.textPill]} numberOfLines={1}>
          Locked in{label ? ' · ' : ''}
          {label ? <Text style={styles.discipline}>{label}</Text> : null}
        </Text>
      </View>
    );
  }

  if (presence.online) {
    return (
      <View style={[wrap, pill && styles.pill]} accessible accessibilityLabel="Online now">
        <View style={[styles.dot, { width: pill ? 8 : 7, height: pill ? 8 : 7, borderRadius: 4 }]} />
        <Text style={[styles.text, styles.live, pill && styles.textPill]}>Online now</Text>
      </View>
    );
  }

  if (lastActive && presence.last_active_at) {
    return (
      <View style={[wrap, pill && styles.pillMuted]}>
        <View style={[styles.dot, styles.dotMuted]} />
        <Text style={[styles.text, styles.muted, pill && styles.textPill]} numberOfLines={1}>
          {lastActiveLabel(presence.last_active_at)}
          {tagFriend ? ' · friend' : ''}
        </Text>
      </View>
    );
  }

  return null;
}

// The blinking dot. Opacity only (mock 273's `blink`), parked lit when motion is off — a
// half-faded dot frozen mid-cycle would read as "not quite live".
function LiveDot({ size }: { size: number }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const motionActive = useMotionActive();
  const blink = useSharedValue(1);
  const ring = useSharedValue(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion || !motionActive) return;
    blink.value = withRepeat(withSequence(withTiming(0.35, { duration: 700 }), withTiming(1, { duration: 700 })), -1);
    ring.value = withRepeat(withTiming(1, { duration: 1800 }), -1);
    return () => {
      cancelAnimation(blink);
      cancelAnimation(ring);
      blink.value = 1;
      ring.value = 0;
    };
  }, [reduceMotion, motionActive, blink, ring]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: blink.value }));
  // The expanding halo (mock 273's `pulse`), as scale + fade rather than a growing box-shadow.
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - ring.value),
    transform: [{ scale: 1 + ring.value * 1.4 }],
  }));

  const box = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={box}>
      {!reduceMotion && <Animated.View style={[StyleSheet.absoluteFill, styles.dot, box, ringStyle]} />}
      <Animated.View style={[styles.dot, box, dotStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
    alignSelf: 'flex-start',
  },
  centered: {
    alignSelf: 'center',
  },
  pill: {
    alignSelf: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(70,209,122,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(70,209,122,0.35)',
  },
  pillMuted: {
    alignSelf: 'center',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: LIVE,
  },
  // Mock 273's `.lastact .d` — smaller and dimmer than a live dot, so "was here" never reads as "is here".
  dotMuted: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#6B6480',
  },
  text: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    flexShrink: 1,
  },
  textPill: {
    fontSize: 12,
  },
  live: {
    color: LIVE,
  },
  discipline: {
    color: Colors.ember,
    letterSpacing: 0.5,
  },
  muted: {
    color: Colors.muted,
    fontFamily: Fonts.bodySemiBold,
  },
});
