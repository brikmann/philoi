import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { fetchGlobalLeaderboard } from '@/lib/api/leaderboard-social';
import { useAuth } from '@/lib/auth/auth-context';
import { getSeenPlacement, setSeenPlacement } from '@/lib/placement-watch';

type Move = { current: number; seen: number | null };

// Mock 204's placement beat, Global scope only for v1: where you stand on the season board after
// this session, and how that moved since the last time we showed you. Distinct from the tier-rank
// chip above it — tier is the Primordial ladder, this is your row on get_global_leaderboard.
//
// Self-contained on purpose: it fetches, reads the baseline, and writes the new one itself, so any
// post-session screen can drop it in (the plain done screen and the daily-fire payout both do).
// When the full-screen rank-up forge takes the stop instead, nothing mounts this and the baseline
// is left alone — the climb isn't lost, it folds into the next done screen's "up N".
export function PlacementMove({ style }: { style?: StyleProp<ViewStyle> }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [move, setMove] = useState<Move | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        // p_limit 1: the RPC always appends the caller's own row wherever they stand, so this is
        // the #1 row plus ours rather than 50 rows for one number. A dedicated get_my_placement()
        // returning {rank, total} would be leaner still (and would give us "of N") — not needed yet.
        const [rows, seen] = await Promise.all([fetchGlobalLeaderboard(1), getSeenPlacement(userId)]);
        const me = rows.find((r) => r.is_me);
        // Not on the board (0208: no score yet) → render nothing rather than "#null".
        if (cancelled || !me) return;
        setMove({ current: me.rank, seen });
        // Written only once shown, and skipped for a cancelled run — StrictMode's double-mount
        // would otherwise read back its own write and turn every climb into "Holding".
        await setSeenPlacement(userId, me.rank);
      } catch {
        // A bonus beat, not core data — a failed fetch just hides the card.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!move) return null;
  return <PlacementCard current={move.current} seen={move.seen} style={style} />;
}

function PlacementCard({ current, seen, style }: Move & { style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReduceMotion();
  const climbed = seen !== null && current < seen;
  const held = seen !== null && current === seen;
  const slipped = seen !== null && current > seen;

  // Only a climb ticks — mock 204's position counting down to where you landed.
  const [ticking, setTicking] = useState(seen ?? current);
  // reduceMotion resolves async and can flip mid-tick; reading `current` then keeps the number
  // from freezing wherever the cancelled tick left it.
  const shown = climbed && !reduceMotion ? ticking : current;
  useEffect(() => {
    if (!climbed || reduceMotion || seen === null) return;
    const durationMs = 1100;
    let raf: ReturnType<typeof requestAnimationFrame>;
    let t0 = 0;
    const delay = setTimeout(() => {
      t0 = Date.now();
      const step = () => {
        const p = Math.min((Date.now() - t0) / durationMs, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setTicking(Math.round(seen + (current - seen) * eased));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, 450);
    return () => {
      clearTimeout(delay);
      cancelAnimationFrame(raf);
    };
  }, [climbed, reduceMotion, seen, current]);

  const kick = climbed ? '🔥 You climbed' : held ? 'Holding your spot' : 'Season standing';
  // Never a red "you dropped": a slip here is other people's sessions, not this one's failure.
  const caption = climbed
    ? `up from #${seen!.toLocaleString()}`
    : held
      ? 'defend it'
      : slipped
        ? 'others have been busy'
        : "you're on the board";

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.delay(350).duration(400)}
      style={[styles.card, climbed && styles.cardClimbed, style]}
      accessible
      accessibilityLabel={
        climbed
          ? `You climbed to number ${current.toLocaleString()} on the global board, up ${(seen! - current).toLocaleString()} from ${seen!.toLocaleString()}`
          : `Number ${current.toLocaleString()} on the global board, ${caption}`
      }>
      <Text style={[styles.kick, climbed && styles.kickClimbed]}>{kick}</Text>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Text style={styles.iconGlyph}>🌎</Text>
        </View>
        <View style={styles.mid}>
          <Text style={styles.label}>Global</Text>
          <Text style={[styles.pos, climbed && styles.posClimbed]}>#{shown.toLocaleString()}</Text>
          <Text style={styles.caption} numberOfLines={1}>
            {caption}
          </Text>
        </View>
        {climbed && (
          <Animated.View entering={reduceMotion ? undefined : ZoomIn.delay(900).springify()} style={styles.delta}>
            <Ionicons name="arrow-up" size={12} color={Colors.ember} />
            <Text style={styles.deltaText}>up {(seen! - current).toLocaleString()}</Text>
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    marginTop: 14,
    backgroundColor: Colors.cardDark,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 18,
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 14,
  },
  // The glow is the climb's alone — hold and slip sit on the plain card.
  cardClimbed: {
    borderColor: 'rgba(242,163,60,0.35)',
    shadowColor: Colors.amber,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  kick: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.muted,
    textAlign: 'center',
    marginBottom: 8,
  },
  kickClimbed: {
    color: Colors.amber,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 15,
  },
  mid: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.muted,
  },
  pos: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 21,
    color: Colors.ink,
    fontVariant: ['tabular-nums'],
  },
  posClimbed: {
    color: Colors.ember,
  },
  caption: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.muted,
  },
  delta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.achieverBg,
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  deltaText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.ember,
  },
});
