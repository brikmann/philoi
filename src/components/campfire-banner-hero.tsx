import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, G, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

import { HeatFlame, heatToState } from '@/components/heat-flame';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { RANK_TIER_LABEL, RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { CampfirePrivacy, RankTierName } from '@/types/database';

// The banner hero from design-mocks/94 (which is mock 62's join-preview banner, now that you're
// inside): the clearing, the campfire's own HEAT FLAME burning on it, the join gate, and the name
// plate. Clan-page furniture — this is the first thing you see when you open a campfire you're in.
//
// The banner art is drawn, not an image asset: log rings around a lit clearing floor, with the
// floor's glow keyed to nothing but the art itself. What's LIVE on the banner is the flame, which
// reads the group's heat (mock 93's mapping, shared with the personal flame).

const BANNER_W = 320;
const BANNER_H = 172;

const HEAT_LABEL: Record<ReturnType<typeof heatToState>, string> = {
  roaring: 'ROARING',
  simmering: 'EMBERS',
  cold: 'BURNT OUT',
};

const PRIVACY_LABEL: Record<CampfirePrivacy, string> = {
  open: '🔥 Open',
  gated: '🛡 Gated',
  private: '🔒 Private',
};

function foundedLabel(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  // "Sep '25" — the mock's shorthand; a founding YEAR is the flex, the day isn't.
  return `founded ${d.toLocaleString('en-US', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`;
}

type CampfireBannerHeroProps = {
  name: string;
  privacy: CampfirePrivacy;
  memberCount: number;
  createdAt?: string;
  /** 0-1, get_my_campfire_heat() — drives the flame's state, same mapping as the personal flame. */
  heat: number;
  lockedInToday: number;
  /** The join gate. Null = anyone can join; the chip hides entirely rather than saying "no gate". */
  minJoinTier: RankTierName | null;
};

export function CampfireBannerHero({
  name,
  privacy,
  memberCount,
  createdAt,
  heat,
  lockedInToday,
  minJoinTier,
}: CampfireBannerHeroProps) {
  // react-native-svg ids are global — a second banner mounted anywhere (a preview behind a sheet)
  // would otherwise blank this one's gradients on Android. Same fix as FlameLogo/EmberIcon.
  const uid = useId();
  const floor = `bannerFloor-${uid}`;
  const hearth = `bannerHearth-${uid}`;
  const shade = `bannerShade-${uid}`;

  const state = heatToState(heat);
  const gateMetal = minJoinTier ? RANK_TIER_METAL[minJoinTier] : null;

  return (
    <View style={styles.hero}>
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        viewBox={`0 0 ${BANNER_W} ${BANNER_H}`}
        preserveAspectRatio="xMidYMid slice">
        <Defs>
          <RadialGradient id={floor} cx="50%" cy="100%" r="70%">
            <Stop offset="0" stopColor={Colors.coral} stopOpacity={0.8} />
            <Stop offset="0.45" stopColor="#7A2A12" stopOpacity={0.4} />
            <Stop offset="1" stopColor={Colors.bgRadialTo} stopOpacity={0} />
          </RadialGradient>
          {/* The mock blurs a small ellipse for the hearth's hotspot; RN SVG has no blur filter, so
              the same softness comes from a radial that fades to transparent instead. */}
          <RadialGradient id={hearth} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={Colors.amber} stopOpacity={0.55} />
            <Stop offset="1" stopColor={Colors.amber} stopOpacity={0} />
          </RadialGradient>
          {/* Bottom-up scrim so the name plate always has something to sit on, whatever the art. */}
          <RadialGradient id={shade} cx="50%" cy="108%" r="86%">
            <Stop offset="0" stopColor={Colors.bgRadialTo} stopOpacity={0.94} />
            <Stop offset="1" stopColor={Colors.bgRadialTo} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Rect width={BANNER_W} height={BANNER_H} fill="#0C0A12" />
        {/* Log rings around the clearing — concentric arcs, receding. */}
        <G fill="none" strokeLinecap="round">
          <Path d="M-30 200 A245 150 0 0 1 350 200" stroke="#1A1A24" strokeWidth={20} />
          <Path d="M-10 204 A205 122 0 0 1 330 204" stroke="#22222E" strokeWidth={17} />
          <Path d="M14 208 A160 96 0 0 1 306 208" stroke="#1A1A24" strokeWidth={15} />
          <Path d="M40 212 A120 72 0 0 1 280 212" stroke="#26262F" strokeWidth={13} />
        </G>
        <Ellipse cx={160} cy={188} rx={128} ry={60} fill={`url(#${floor})`} />
        <Ellipse cx={160} cy={184} rx={46} ry={16} fill={`url(#${hearth})`} />
        <Rect width={BANNER_W} height={BANNER_H} fill={`url(#${shade})`} />
      </Svg>

      <View style={styles.flameSlot} pointerEvents="none">
        <HeatFlame heat={heat} size={64} />
        <Text style={styles.heatLabel}>
          {HEAT_LABEL[state]} · {lockedInToday} of {memberCount} in today
        </Text>
      </View>

      {gateMetal && minJoinTier && (
        <View style={[styles.gate, { borderColor: gateMetal.outer }]}>
          <Svg width={11} height={12} viewBox="0 0 100 100">
            <Polygon points="50,4 89.8,27 89.8,73 50,96 10.2,73 10.2,27" fill={gateMetal.inner} />
          </Svg>
          <Text style={[styles.gateLabel, { color: gateMetal.text }]}>{RANK_TIER_LABEL[minJoinTier]}+ to join</Text>
        </View>
      )}

      <View style={styles.namePlate}>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {PRIVACY_LABEL[privacy]} · {memberCount} {memberCount === 1 ? 'member' : 'members'}
          {createdAt ? ` · ${foundedLabel(createdAt)}` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: BANNER_H,
    overflow: 'hidden',
  },
  flameSlot: {
    position: 'absolute',
    top: 16,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  heatLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.5,
    color: Colors.ember,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 6,
  },
  gate: {
    position: 'absolute',
    top: 13,
    right: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(20,17,28,0.72)',
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  gateLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
    letterSpacing: 0.3,
  },
  namePlate: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 21,
    lineHeight: 23,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: '#D8CAE8',
    marginTop: 5,
  },
});
