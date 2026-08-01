import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { HexagonBadge } from '@/components/hexagon-badge';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { RANK_TIER_METAL } from '@/lib/rank-tiers';
import { getUniversityCrest } from '@/lib/university-crests';
import type { RankTierName } from '@/types/database';

// The Parthenon podium — top 3 rise as ascending marble columns, #1 tallest in the center
// (PHILOI_UI_SPEC.md §15, mock 42). One-off marble/stone gradient colors, not theme tokens (this
// repo's convention for mock-specific colors that aren't part of the shared palette).
const MARBLE_CAPITAL: [string, string] = ['#EFE7D6', '#D3C6AE'];
const MARBLE_SHAFT: [string, string] = ['#E9DFCB', '#C7B99F'];
const MARBLE_BASE: [string, string] = ['#D8CBB2', '#B7A88C'];

// Position medal metal reuses RANK_TIER_METAL's gold/silver/bronze exactly (§15: "the metals
// match RANK_TIER_METAL") — the medal signals TODAY'S standing on this board, distinct from the
// rank hexagon (overall tier) shown alongside it.
const POSITION_TIER: RankTierName[] = ['gold', 'silver', 'bronze'];
// Column shaft heights, tallest (#1) in the center — index 0 = #1.
const SHAFT_HEIGHT = [104, 76, 62];
const SHAFT_WIDTH = [62, 54, 54];
const COLUMN_GAP = 5;
// Render order left-to-right for however many columns are present (1, 2, or 3 — "fewer than 3
// rankable people... gracefully fall back", §15's small-board rule; this component just never
// lays out a broken 3-slot podium when there are fewer items).
const RENDER_ORDER: number[][] = [[0], [1, 0], [1, 0, 2]];
// The base slab is a pedestal, deliberately wider than the columns it sits under (mock 42) —
// this much overhang on each side, added to the columns' own real rendered footprint so the
// slab always lines up under the actual pillar feet instead of a guessed fixed width.
const BASE_OVERHANG = 20;

// "Noah Brikman" -> "Noah B." — the narrow podium truncates to first name + last initial (the
// full row list / profile still show the full name); a bare first name with no last initial
// stays as-is.
function podiumName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length < 2) return displayName;
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

export type PodiumPersonItem = {
  kind: 'person';
  key: string;
  displayName: string;
  avatarUrl?: string | null;
  tier: RankTierName;
  division: number;
  value: string;
  isMe?: boolean;
};

export type PodiumUniversityItem = {
  kind: 'university';
  key: string;
  name: string;
  value: string;
  isMe?: boolean;
};

export type PodiumItem = PodiumPersonItem | PodiumUniversityItem;

function MarbleRect({ width, height, colors, radius = 0 }: { width: number; height: number; colors: [string, string]; radius?: number }) {
  const gradId = `g-${colors[0].replace('#', '')}-${width}-${height}`;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors[0]} />
          <Stop offset="1" stopColor={colors[1]} />
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} rx={radius} fill={`url(#${gradId})`} />
    </Svg>
  );
}

function PositionMedal({ position }: { position: number }) {
  const metal = RANK_TIER_METAL[POSITION_TIER[position]];
  return (
    <View style={[styles.medal, { backgroundColor: metal.inner, borderColor: metal.outer }]}>
      <Text style={[styles.medalText, { color: metal.numeral }]}>{position + 1}</Text>
    </View>
  );
}

function PodiumColumn({ item, position, isFirst }: { item: PodiumItem; position: number; isFirst: boolean }) {
  const avatarSize = isFirst ? 56 : 46;
  const shaftWidth = SHAFT_WIDTH[isFirst ? 0 : position];
  const capitalWidth = shaftWidth + 6;
  const ringColor = RANK_TIER_METAL[POSITION_TIER[position]].inner;

  return (
    <View style={styles.col}>
      {/* This outer wrapper stays overflow-visible so the position medal can poke out past the
          bottom rim (mock 42); the actual circular clip + metal ring lives one level in, and
          only applies to a PERSON avatar — a university crest keeps its own rounded-square
          shape (mock's `.crest`, distinct from `.avatar`), not a circle. */}
      <View style={[styles.apex, { width: avatarSize, height: avatarSize }]}>
        {item.kind === 'person' ? (
          <View style={[styles.avatarClip, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, borderColor: ringColor }]}>
            {item.avatarUrl ? (
              <Image source={{ uri: item.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <Text style={[styles.avatarInitial, { fontSize: avatarSize * 0.34 }]}>{item.displayName.charAt(0).toUpperCase()}</Text>
            )}
          </View>
        ) : (
          (() => {
            const crest = getUniversityCrest(item.name);
            return (
              <View style={[styles.crest, { width: avatarSize, height: avatarSize, backgroundColor: crest.bg }]}>
                <Text style={[styles.crestText, { color: crest.text, fontSize: avatarSize * 0.24 }]} numberOfLines={1}>
                  {crest.monogram}
                </Text>
              </View>
            );
          })()
        )}
        <PositionMedal position={position} />
      </View>

      <Text style={styles.name} numberOfLines={1}>
        {item.kind === 'person' ? podiumName(item.displayName) : item.name}
        {item.isMe ? ' · you' : ''}
      </Text>
      <View style={styles.valueRow}>
        {item.kind === 'person' && <HexagonBadge tier={item.tier} division={item.division} size={15} />}
        <Text style={styles.value}>{item.value}</Text>
      </View>

      <View style={{ marginTop: 6 }}>
        <MarbleRect width={capitalWidth} height={9} colors={MARBLE_CAPITAL} radius={3} />
      </View>
      <MarbleRect width={shaftWidth} height={SHAFT_HEIGHT[position]} colors={MARBLE_SHAFT} />
    </View>
  );
}

type ParthenonPodiumProps = {
  /** Rank-ordered top-N items, 1 to 3 of them. Never called with 0 — the caller shows an empty
   * state instead (see leaderboards.tsx). */
  top: PodiumItem[];
  onPressItem?: (item: PodiumItem) => void;
};

export function ParthenonPodium({ top, onPressItem }: ParthenonPodiumProps) {
  const count = Math.min(3, top.length);
  if (count === 0) return null;
  const order = RENDER_ORDER[count - 1];
  // Computed from the actual rendered shaft widths + gaps (not a guessed constant per count) so
  // the base slab always lines up under the real pillar feet, whatever the column count.
  const columnsWidth = order.reduce((sum, position) => sum + SHAFT_WIDTH[position === 0 ? 0 : position], 0) + (order.length - 1) * COLUMN_GAP;
  const baseWidth = columnsWidth + BASE_OVERHANG * 2;

  return (
    <View style={styles.podium}>
      <View style={styles.podiumRow}>
        {order.map((position) => {
          const item = top[position];
          if (!item) return null;
          return (
            <Pressable key={item.key} onPress={() => onPressItem?.(item)} style={styles.colPress}>
              <PodiumColumn item={item} position={position} isFirst={position === 0} />
            </Pressable>
          );
        })}
      </View>
      <MarbleRect width={baseWidth} height={11} colors={MARBLE_BASE} radius={3} />
    </View>
  );
}

const styles = StyleSheet.create({
  podium: {
    alignItems: 'center',
  },
  podiumRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 5,
  },
  colPress: {
    alignItems: 'center',
  },
  col: {
    alignItems: 'center',
  },
  apex: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarClip: {
    borderRadius: 999,
    borderWidth: 2.5,
    backgroundColor: Colors.achieverBg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  crest: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  crestText: {
    fontFamily: Fonts.bodyBold,
  },
  avatarInitial: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.achieverText,
  },
  medal: {
    position: 'absolute',
    bottom: -5,
    alignSelf: 'center',
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.ink,
    marginTop: Spacing.two,
    maxWidth: 84,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  value: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.amber,
  },
});
