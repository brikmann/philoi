import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { Colors, Fonts, Radius } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { fetchMyPlacements } from '@/lib/api/leaderboard-social';
import { useAuth } from '@/lib/auth/auth-context';
import { getSeenPlacements, setSeenPlacements } from '@/lib/placement-watch';
import type { PlacementScope } from '@/types/database';

type Row = { scope: PlacementScope; current: number; total: number; seen: number | null };

// Mock 204's order: the people you know first, then your school, then everyone.
const SCOPE_ORDER: PlacementScope[] = ['friends', 'uni', 'global'];
const SCOPE_GLYPH: Record<PlacementScope, string> = { friends: '👥', uni: '🎓', global: '🌎' };

// Mock 204's placement beat: where you stand on Friends, your uni and Global after this session,
// and how each moved since the last time we showed you. Distinct from the tier-rank chip above it
// — tier is the Primordial ladder, this is your row on each board (get_my_placements, 0214).
//
// Self-contained on purpose: it fetches, reads the baseline, and writes the new one itself, so any
// post-session screen can drop it in (the plain done screen and the daily-fire payout both do).
// When the full-screen rank-up forge takes the stop instead, nothing mounts this and the baseline
// is left alone — the climb isn't lost, it folds into the next done screen's "up N".
export function PlacementMove({ style }: { style?: StyleProp<ViewStyle> }) {
  const { session, profile } = useAuth();
  const userId = session?.user.id ?? null;
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const [placements, seen] = await Promise.all([fetchMyPlacements(), getSeenPlacements(userId)]);
        // A board of one is just you — "#1 of 1" isn't a standing, so that row is left out. A
        // scope you're not on (no score yet, unverified uni, no friends) has no row to begin with.
        const shown = SCOPE_ORDER.flatMap((scope) => {
          const p = placements.find((x) => x.scope === scope);
          return p && p.total > 1 ? [{ scope, current: p.rank, total: p.total, seen: seen[scope] ?? null }] : [];
        });
        if (cancelled || shown.length === 0) return;
        setRows(shown);
        // Written only once shown, and skipped for a cancelled run — StrictMode's double-mount
        // would otherwise read back its own write and turn every climb into "Holding". Scopes not
        // shown this time keep their older baseline.
        await setSeenPlacements(userId, {
          ...seen,
          ...Object.fromEntries(shown.map((r) => [r.scope, r.current])),
        });
      } catch {
        // A bonus beat, not core data — a failed fetch just hides the card.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!rows) return null;
  const anyClimb = rows.some((r) => r.seen !== null && r.current < r.seen);
  const allHeld = rows.every((r) => r.seen !== null && r.current === r.seen);
  const kick = anyClimb ? '🔥 You climbed' : allHeld ? 'Holding your spot' : 'Where you stand';
  const uniLabel = profile?.university ?? 'Your uni';

  return (
    <PlacementCard kick={kick} climbed={anyClimb} style={style}>
      {rows.map((r, i) => (
        <PlacementRow
          key={r.scope}
          row={r}
          label={r.scope === 'friends' ? 'Friends' : r.scope === 'uni' ? uniLabel : 'Global'}
          index={i}
        />
      ))}
    </PlacementCard>
  );
}

function PlacementCard({
  kick,
  climbed,
  style,
  children,
}: {
  kick: string;
  climbed: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.delay(350).duration(400)}
      style={[styles.card, climbed && styles.cardClimbed, style]}>
      <Text style={[styles.kick, climbed && styles.kickClimbed]}>{kick}</Text>
      {children}
    </Animated.View>
  );
}

function PlacementRow({ row, label, index }: { row: Row; label: string; index: number }) {
  const { current, total, seen } = row;
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

  // Never a red "you dropped": a slip here is other people's sessions, not this one's failure.
  const status = climbed
    ? `up from #${seen!.toLocaleString()}`
    : held
      ? 'defend it'
      : slipped
        ? 'others have been busy'
        : null;
  const caption = status ? `of ${total.toLocaleString()} · ${status}` : `of ${total.toLocaleString()}`;

  return (
    <View
      style={[styles.row, index > 0 && styles.rowDivider]}
      accessible
      accessibilityLabel={
        climbed
          ? `${label}: you climbed to number ${current.toLocaleString()} of ${total.toLocaleString()}, up ${(seen! - current).toLocaleString()} from ${seen!.toLocaleString()}`
          : `${label}: number ${current.toLocaleString()} ${caption}`
      }>
      <View style={styles.icon}>
        <Text style={styles.iconGlyph}>{SCOPE_GLYPH[row.scope]}</Text>
      </View>
      <View style={styles.mid}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.pos, climbed && styles.posClimbed]}>#{shown.toLocaleString()}</Text>
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      </View>
      {climbed && (
        // Staggered like the mock (.7s / 1.0s / 1.3s) so the pills land one board at a time.
        <Animated.View
          entering={reduceMotion ? undefined : ZoomIn.delay(700 + index * 300).springify()}
          style={styles.delta}>
          <Ionicons name="arrow-up" size={12} color={Colors.ember} />
          <Text style={styles.deltaText}>up {(seen! - current).toLocaleString()}</Text>
        </Animated.View>
      )}
    </View>
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
    paddingBottom: 4,
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
    marginBottom: 4,
  },
  kickClimbed: {
    color: Colors.amber,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 8,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: Colors.line,
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
