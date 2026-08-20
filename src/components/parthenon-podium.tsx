import { Image } from 'expo-image';
import { useId } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { HexagonBadge } from '@/components/hexagon-badge';
import { Crown } from '@/components/ui/crown';
import { Colors, Fonts } from '@/constants/theme';
import { getUniversityCrest } from '@/lib/university-crests';
import type { RankTierName } from '@/types/database';

// THE PODIUM — top 3 rise as fluted Greek pillars, #1 tallest in the centre (design-mocks/95).
//
// What changed from the first cut: the columns were cream/parchment marble, which read as an
// off-brand slab of daylight sitting on the deep-purple ember background. They're now PANTHEON
// PILLARS IN TIER METAL — gold, silver, bronze — each a real column (capital + echinus + grooved
// shaft + two-step base) rather than a plain rectangle. The ember floor-glow that used to pool
// under them is gone with the parchment: the metal carries the light now.
//
// Two effects do the heavy lifting on the shaft, both straight from mock 95:
//   · a HORIZONTAL sheen (dark edge -> highlight -> mid -> highlight -> dark edge) which is what
//     makes a flat rectangle read as a cylinder;
//   · vertical FLUTING — thin dark grooves every 9px down the shaft.

/** Mock 95's own podium metals. Close to RANK_TIER_METAL's gold/silver/bronze but not identical —
 * bronze in particular is warmer here (#C87F3F vs the rank ladder's #B87333) because a podium
 * column is lit stone, not a badge. Position metal ≠ the person's rank tier: the hexagon beside
 * the score still carries that, and the two are meant to be readable as different facts. */
type PillarMetal = {
  light: string;
  mid: string;
  dark: string;
  /** The shaft's shaded edge — the outermost stop of the cylindrical sheen. */
  edge: string;
  /** Fluting groove colour, already at the mock's opacity. */
  groove: string;
};

const PILLAR_METAL: PillarMetal[] = [
  { light: '#FFE9A8', mid: '#F5C542', dark: '#C79A16', edge: '#8A6A10', groove: 'rgba(90,60,0,0.30)' },
  { light: '#EDEFF3', mid: '#C7CDD6', dark: '#9AA2AE', edge: '#8B929E', groove: 'rgba(60,66,74,0.30)' },
  { light: '#F0C08A', mid: '#C87F3F', dark: '#8A4E22', edge: '#7A4420', groove: 'rgba(60,30,10,0.32)' },
];

// Shaft heights, tallest (#1) in the centre — index 0 = #1. Mock 95's 150/110/84.
const SHAFT_HEIGHT = [150, 110, 84];

// One column's anatomy, in the order it stacks. Widths flare out from the shaft in both
// directions, which is what gives a pillar its capital and its footing.
const PILLAR_W = 84;
const CAP_W = 80;
const CAP_H = 11;
const ECHINUS_W = 70;
const ECHINUS_H = 6;
const SHAFT_W = 60;
const BASE1_W = 74;
const BASE1_H = 8;
const BASE2_H = 11;
const FLUTE_GAP = 9;

// Render order left-to-right for however many columns are present (1, 2, or 3 — "fewer than 3
// rankable people... gracefully fall back", PHILOI_UI_SPEC.md §15's small-board rule).
const RENDER_ORDER: number[][] = [[0], [1, 0], [1, 0, 2]];

// "Noah Brikman" -> "Noah B." — the narrow podium truncates to first name + last initial (the
// full row list / profile still show the full name); a bare first name stays as-is.
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

/** One fluted column, drawn as a single SVG so the pieces can't drift apart across layout passes. */
function GreekPillar({ position }: { position: number }) {
  // react-native-svg ids are global; three pillars sharing a literal id blanks two of them on
  // Android. Same fix as FlameLogo/PrimaryButton.
  const uid = useId();
  const metal = PILLAR_METAL[position];
  const trim = `pillarTrim-${uid}`;
  const sheen = `pillarSheen-${uid}`;

  const shaftH = SHAFT_HEIGHT[position];
  const shaftY = CAP_H + ECHINUS_H - 1;
  const base1Y = shaftY + shaftH;
  const base2Y = base1Y + BASE1_H - 1;
  const totalH = base2Y + BASE2_H;

  // Grooves are laid inside the shaft's own width, one every FLUTE_GAP px.
  const flutes: number[] = [];
  for (let x = FLUTE_GAP; x < SHAFT_W; x += FLUTE_GAP) flutes.push(x);

  return (
    <Svg width={PILLAR_W} height={totalH} style={styles.pillar}>
      <Defs>
        {/* Trim (capital + base steps): lit from above, so a simple vertical ramp. */}
        <LinearGradient id={trim} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={metal.light} />
          <Stop offset="0.6" stopColor={metal.mid} />
          <Stop offset="1" stopColor={metal.dark} />
        </LinearGradient>
        {/* Shaft: horizontal, because the roundness of a column is a LEFT-TO-RIGHT fact. */}
        <LinearGradient id={sheen} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={metal.edge} />
          <Stop offset="0.22" stopColor={metal.light} />
          <Stop offset="0.5" stopColor={metal.mid} />
          <Stop offset="0.78" stopColor={metal.light} />
          <Stop offset="1" stopColor={metal.edge} />
        </LinearGradient>
      </Defs>

      <Rect x={(PILLAR_W - CAP_W) / 2} y={0} width={CAP_W} height={CAP_H} rx={3} fill={`url(#${trim})`} />
      <Rect x={(PILLAR_W - ECHINUS_W) / 2} y={CAP_H - 1} width={ECHINUS_W} height={ECHINUS_H} fill={`url(#${trim})`} />

      <Rect x={(PILLAR_W - SHAFT_W) / 2} y={shaftY} width={SHAFT_W} height={shaftH} fill={`url(#${sheen})`} />
      {flutes.map((x) => (
        <Rect key={x} x={(PILLAR_W - SHAFT_W) / 2 + x} y={shaftY} width={1} height={shaftH} fill={metal.groove} />
      ))}

      <Rect x={(PILLAR_W - BASE1_W) / 2} y={base1Y} width={BASE1_W} height={BASE1_H} fill={`url(#${trim})`} />
      <Rect x={0} y={base2Y} width={PILLAR_W} height={BASE2_H} rx={3} fill={`url(#${trim})`} />
    </Svg>
  );
}

function PositionMedal({ position }: { position: number }) {
  const metal = PILLAR_METAL[position];
  return (
    <View style={[styles.medal, { backgroundColor: metal.mid }]}>
      <Text style={styles.medalText}>{position + 1}</Text>
    </View>
  );
}

function PodiumColumn({ item, position, isFirst }: { item: PodiumItem; position: number; isFirst: boolean }) {
  const avatarSize = isFirst ? 64 : 56;
  const metal = PILLAR_METAL[position];

  return (
    <View style={styles.col}>
      {/* Overflow-visible wrapper so the medal can poke past the avatar's bottom rim; the circular
          clip + metal ring lives one level in, and only for a PERSON — a university keeps its
          rounded-square crest. */}
      <View style={[styles.apex, { width: avatarSize, height: avatarSize }]}>
        {isFirst && (
          <View style={styles.crown}>
            <Crown size={28} />
          </View>
        )}
        {item.kind === 'person' ? (
          <View
            style={[
              styles.avatarClip,
              { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, borderColor: metal.mid },
            ]}>
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
              <View style={[styles.crest, { width: avatarSize, height: avatarSize, backgroundColor: crest.bg, borderColor: metal.mid }]}>
                <Text style={[styles.crestText, { color: crest.text, fontSize: avatarSize * 0.24 }]} numberOfLines={1}>
                  {crest.monogram}
                </Text>
              </View>
            );
          })()
        )}
        <PositionMedal position={position} />
      </View>

      <Text style={[styles.name, item.isMe && styles.nameMe]} numberOfLines={1}>
        {item.kind === 'person' ? podiumName(item.displayName) : item.name}
        {item.isMe ? ' · you' : ''}
      </Text>
      <View style={styles.valueRow}>
        {item.kind === 'person' && <HexagonBadge tier={item.tier} division={item.division} size={15} />}
        {/* Score in the POSITION's metal (mock 95) — the podium's own colour language, which is why
            it isn't the amber every other number on this screen uses. */}
        <Text style={[styles.value, { color: metal.mid }]}>{item.value}</Text>
      </View>

      <GreekPillar position={position} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  podium: {
    alignItems: 'center',
  },
  podiumRow: {
    flexDirection: 'row',
    // The pillars are different heights and their FEET must line up, not their heads.
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 10,
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
  crown: {
    position: 'absolute',
    // -30 not -26: the vector is 28 wide (~22 tall) against the emoji's 18px line box, so it needs
    // the extra clearance to sit ON the avatar's rim rather than overlapping into it.
    top: -30,
    alignItems: 'center',
  },
  avatarClip: {
    borderRadius: 999,
    borderWidth: 3,
    backgroundColor: Colors.disabled,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  crest: {
    borderRadius: 12,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  crestText: {
    fontFamily: Fonts.bodyBold,
  },
  avatarInitial: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.ink,
  },
  medal: {
    position: 'absolute',
    bottom: -8,
    alignSelf: 'center',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.bgRadialTo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: '#2A1608',
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
    marginTop: 14,
    maxWidth: 84,
  },
  nameMe: {
    color: Colors.amber,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  value: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
  },
  pillar: {
    marginTop: 12,
  },
});
