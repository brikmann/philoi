import { type Ref } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { RoundAvatar } from '@/components/economy/king-statue';
import { Crown } from '@/components/ui/crown';
import { Colors, Fonts } from '@/constants/theme';
import type { PodiumRacer } from '@/hooks/use-challenge-podium';
import { formatMetricValue } from '@/lib/challenge-metric';
import type { SocialChallengeRaceMetric } from '@/types/database';

// THE PODIUM (design-mocks/267) — three pillars for a settled board race, drawn twice: full size in
// the reward reveal's step one, and scaled for the 9:16 story card. One component so the screen and
// the card it is shared from are the same picture, the way the duel's KingStatue already is.
//
// Gold centre, silver left, bronze right. The pillars are POSITIONAL (first three of the settled
// order), the number on each is the racer's own `place` — so a tie the RPC ranks 1, 1, 3 shows two
// gold-numbered 1s rather than inventing a 2nd.

export const METAL = {
  gold: { ring: '#F5C542', text: '#F5C542', edge: '#F5C542' },
  silver: { ring: '#C4CBD6', text: '#C4CBD6', edge: '#3A4252' },
  bronze: { ring: '#CD7F32', text: '#CD7F32', edge: '#5A3D22' },
} as const;
type Metal = keyof typeof METAL;

// "Noah Brikman" → "Noah B." — the leaderboard's own convention, so a full name doesn't truncate to
// "Noah Brik…" on a pillar (and the hero share card). Already-short names ("Maya K.", "You") are
// returned unchanged. The avatar keeps the full name for its initial.
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  const initial = parts[parts.length - 1].replace(/[^A-Za-z]/g, '').charAt(0);
  return initial ? `${parts[0]} ${initial}.` : parts[0];
}

const SIZES = {
  screen: { col: 92, gap: 10, av: 52, avWin: 60, h: { gold: 128, silver: 104, bronze: 86 }, rank: 19, name: 11, fig: 12, crown: 26 },
  card: { col: 66, gap: 7, av: 36, avWin: 44, h: { gold: 88, silver: 70, bronze: 56 }, rank: 15, name: 9.5, fig: 9.5, crown: 20 },
} as const;

type Props = {
  /** The settled field. Only the first three are drawn. */
  racers: PodiumRacer[];
  myId: string | null | undefined;
  metric: SocialChallengeRaceMetric | null | undefined;
  size?: keyof typeof SIZES;
  /**
   * Put on the WINNER's avatar — the reveal's rays and reward flights anchor on whatever holds this,
   * and mock 267 is explicit that the light comes off the champion, not the top of the screen.
   */
  winnerRef?: Ref<View>;
  onWinnerLayout?: (e: LayoutChangeEvent) => void;
};

export function Podium({ racers, myId, metric, size = 'screen', winnerRef, onWinnerLayout }: Props) {
  const s = SIZES[size];
  const [first, second, third] = racers;
  return (
    <View style={[styles.podium, { gap: s.gap }]}>
      {second ? <Pillar racer={second} metal="silver" mine={second.id === myId} metric={metric} size={size} /> : null}
      {first ? (
        <Pillar
          racer={first}
          metal="gold"
          mine={first.id === myId}
          metric={metric}
          size={size}
          avatarRef={winnerRef}
          onAvatarLayout={onWinnerLayout}
        />
      ) : null}
      {third ? <Pillar racer={third} metal="bronze" mine={third.id === myId} metric={metric} size={size} /> : null}
    </View>
  );
}

function Pillar({
  racer,
  metal,
  mine,
  metric,
  size,
  avatarRef,
  onAvatarLayout,
}: {
  racer: PodiumRacer;
  metal: Metal;
  mine: boolean;
  metric: SocialChallengeRaceMetric | null | undefined;
  size: keyof typeof SIZES;
  avatarRef?: Ref<View>;
  onAvatarLayout?: (e: LayoutChangeEvent) => void;
}) {
  const s = SIZES[size];
  const m = METAL[metal];
  const gold = metal === 'gold';
  const av = gold ? s.avWin : s.av;
  const h = s.h[metal];
  return (
    <View style={[styles.col, { width: s.col }]}>
      <View
        ref={avatarRef}
        onLayout={onAvatarLayout}
        collapsable={false}
        style={[styles.avatarSlot, { marginBottom: -Math.round(av / 4) }]}>
        {gold ? (
          <View style={[styles.crown, { top: -s.crown * 0.62 }]} pointerEvents="none">
            <Crown size={s.crown} />
          </View>
        ) : null}
        <RoundAvatar url={racer.avatarUrl} name={racer.name} size={av} ring={m.ring} ringWidth={gold ? 3 : 2.5} />
      </View>
      <View
        style={[
          styles.pill,
          {
            minHeight: h,
            borderColor: mine ? m.ring : m.edge,
            borderWidth: mine ? 1.5 : 1,
            paddingTop: Math.round(av / 4) + (size === 'card' ? 3 : 5),
          },
        ]}>
        {/* The pillar wash — a vertical fill from the metal's tint down to the dark ground. Drawn
            with expo-linear-gradient (not react-native-svg) so it reliably fills the pill edge to
            edge; the old SVG `width="100%"` + absoluteFill combo rendered the band off-centre. */}
        <LinearGradient
          colors={[`${m.ring}${gold ? '3D' : '26'}`, '#1A1328']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <Text style={[styles.rank, { color: m.text, fontSize: s.rank }]}>{racer.place ?? '–'}</Text>
        <Text style={[styles.name, { fontSize: s.name, maxWidth: s.col - 8 }]} numberOfLines={1}>
          {shortName(racer.name)}
        </Text>
        {racer.score != null ? (
          <Text style={[styles.figure, { fontSize: s.fig }]} numberOfLines={1}>
            {formatMetricValue(metric, racer.score)}
          </Text>
        ) : null}
        {mine && size === 'screen' ? (
          <View style={[styles.youTag, { backgroundColor: m.ring }]}>
            <Text style={styles.youText}>YOU</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The rest of the field under the podium — "4 · Priya S. · 8.4 km".
 *
 * Capped, because a 48-person campfire would push the footer off the phone: the next few after the
 * podium, then — if you finished further down than that — a gap and YOUR row, so the screen always
 * says where you came.
 */
export function FieldRest({
  racers,
  myId,
  metric,
  max = 3,
}: {
  racers: PodiumRacer[];
  myId: string | null | undefined;
  metric: SocialChallengeRaceMetric | null | undefined;
  max?: number;
}) {
  const rest = racers.slice(3);
  if (rest.length === 0) return null;
  const shown = rest.slice(0, max);
  const me = rest.find((r) => r.id === myId);
  const mePinned = me && !shown.includes(me) ? me : null;
  const hidden = rest.length - shown.length - (mePinned ? 1 : 0);
  return (
    <View style={styles.rest}>
      {shown.map((r) => (
        <RestRow key={r.id} racer={r} mine={r.id === myId} metric={metric} />
      ))}
      {mePinned ? (
        <>
          <Text style={styles.more}>···</Text>
          <RestRow racer={mePinned} mine metric={metric} />
        </>
      ) : null}
      {hidden > 0 ? <Text style={styles.more}>+{hidden} more</Text> : null}
    </View>
  );
}

function RestRow({
  racer,
  mine,
  metric,
}: {
  racer: PodiumRacer;
  mine: boolean;
  metric: SocialChallengeRaceMetric | null | undefined;
}) {
  return (
    <View style={[styles.restRow, mine && styles.restRowMine]}>
      <Text style={[styles.restRank, mine && { color: Colors.ember }]}>{racer.place ?? '–'}</Text>
      <Text style={styles.restName} numberOfLines={1}>
        {shortName(racer.name)}
      </Text>
      {mine ? (
        <View style={[styles.youTag, styles.youTagInline, { backgroundColor: Colors.ember }]}>
          <Text style={styles.youText}>YOU</Text>
        </View>
      ) : null}
      {racer.score != null ? <Text style={styles.restFigure}>{formatMetricValue(metric, racer.score)}</Text> : null}
    </View>
  );
}

/**
 * YOUR row, pinned under the podium on the off-podium share card — ember-lit so a 4th of 6 reads as
 * a result worth posting rather than as someone else's podium with you missing from it.
 */
export function PinnedYouRow({
  racer,
  metric,
}: {
  racer: PodiumRacer;
  metric: SocialChallengeRaceMetric | null | undefined;
}) {
  return (
    <View style={styles.pinned}>
      <Text style={styles.pinnedRank}>{racer.place ?? '–'}</Text>
      <RoundAvatar url={racer.avatarUrl} name={racer.name} size={30} ring={Colors.emberForward} ringWidth={1.5} />
      <View style={styles.pinnedMid}>
        <Text style={styles.pinnedName} numberOfLines={1}>
          {shortName(racer.name)}
        </Text>
        <View style={[styles.youTag, styles.youTagInline, { backgroundColor: Colors.ember }]}>
          <Text style={styles.youText}>YOU</Text>
        </View>
      </View>
      {racer.score != null ? <Text style={styles.pinnedFigure}>{formatMetricValue(metric, racer.score)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginTop: 18,
  },
  col: {
    alignItems: 'center',
  },
  avatarSlot: {
    zIndex: 2,
    alignItems: 'center',
  },
  crown: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 3,
  },
  pill: {
    width: '100%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomWidth: 0,
    alignItems: 'center',
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  rank: {
    fontFamily: Fonts.bodyExtraBold,
    textAlign: 'center',
  },
  name: {
    fontFamily: Fonts.bodyBold,
    color: Colors.ink,
    marginTop: 1,
    textAlign: 'center',
  },
  figure: {
    fontFamily: Fonts.bodyBold,
    color: '#D8CCEB',
    marginTop: 1,
    textAlign: 'center',
  },
  youTag: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginTop: 4,
  },
  youTagInline: {
    marginTop: 0,
  },
  youText: {
    fontFamily: Fonts.bodyExtraBold,
    fontSize: 8.5,
    letterSpacing: 0.7,
    color: Colors.onEmber,
  },
  rest: {
    alignSelf: 'stretch',
    marginTop: 4,
  },
  restRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  restRowMine: {
    backgroundColor: 'rgba(255,140,66,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,140,66,0.45)',
  },
  restRank: {
    width: 22,
    textAlign: 'center',
    fontFamily: Fonts.bodyExtraBold,
    fontSize: 13,
    color: Colors.muted,
  },
  restName: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
  },
  restFigure: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: '#D8CCEB',
  },
  more: {
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.textTertiary,
    paddingVertical: 2,
  },
  pinned: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FF8C42',
    backgroundColor: 'rgba(255,140,66,0.16)',
  },
  pinnedRank: {
    width: 22,
    textAlign: 'center',
    fontFamily: Fonts.bodyExtraBold,
    fontSize: 15,
    color: '#F5C542',
  },
  pinnedMid: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pinnedName: {
    flexShrink: 1,
    fontFamily: Fonts.bodyExtraBold,
    fontSize: 14,
    color: Colors.ink,
  },
  pinnedFigure: {
    fontFamily: Fonts.bodyExtraBold,
    fontSize: 14,
    color: '#D8CCEB',
  },
});
