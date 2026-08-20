import { forwardRef, useId, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Colors, Fonts } from '@/constants/theme';
import { FlameLogo } from '@/components/ui/flame-logo';
import { DIVISION_NUMERAL, RANK_TIER_METAL } from '@/lib/rank-tiers';
import type { RankTierName } from '@/types/database';

// THE SHARE-CARD FRAME (design-mocks/96 + 97) — the shell every one of the five story cards is
// built on, so the set reads as one family instead of five drawings that happen to be 9:16.
//
// It exists mostly for the FOOTER. Mock 96's whole retention argument is that every share carries
// the sharer's rank in a hex + philoi.app: "each share is an install prompt with a status stamp."
// That only holds if it is genuinely on every card — which means one component, not five copies
// that drift the first time one of them is touched.
//
// The loop it serves: earn a moment -> Share -> post to story -> friends see the flex + rank +
// philoi.app -> they install -> they lock in -> they hit their own moment.

/** 9:16, captured at 2× the mock's 208×370 so the exported PNG holds up at story size. */
export const SHARE_CARD_WIDTH = 360;
export const SHARE_CARD_HEIGHT = 640;

/** The two card grounds from the mocks: the standard purple, and the season card's molten floor. */
export type ShareCardGround = 'purple' | 'season';

const GROUND_STOPS: Record<ShareCardGround, { cy: string; stops: [string, string, string] }> = {
  // radial-gradient(120% 55% at 50% 2%, #3a2350, #1a1526 58%, #141019)
  purple: { cy: '2%', stops: ['#3A2350', '#1A1526', '#141019'] },
  // radial-gradient(120% 60% at 50% 100%, #3a1c12, #1a1526 55%, #141019) — lit from the lava below.
  season: { cy: '100%', stops: ['#3A1C12', '#1A1526', '#141019'] },
};

type ShareCardFrameProps = {
  /** The all-caps kicker at the top: STILL ON FIRE · LOCKED IN · RANKED UP · MYTHIC UNLOCKED. */
  kick: string;
  kickColor?: string;
  ground?: ShareCardGround;
  /** Full-bleed animated layer behind the content — the season card's Emberfall aura. */
  aura?: ReactNode;
  handle: string | null;
  /** The sharer's rank, stamped into the footer hex. Omitted only if they somehow have no rank. */
  tier?: RankTierName;
  division?: number;
  children: ReactNode;
};

export const ShareCardFrame = forwardRef<View, ShareCardFrameProps>(function ShareCardFrame(
  { kick, kickColor = Colors.amber, ground = 'purple', aura, handle, tier, division, children },
  ref
) {
  const uid = useId();
  const bg = `shareBg-${uid}`;
  const g = GROUND_STOPS[ground];

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <Svg width={SHARE_CARD_WIDTH} height={SHARE_CARD_HEIGHT} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={bg} cx="50%" cy={g.cy} rx="120%" ry="58%">
            <Stop offset="0" stopColor={g.stops[0]} />
            <Stop offset="0.58" stopColor={g.stops[1]} />
            <Stop offset="1" stopColor={g.stops[2]} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={SHARE_CARD_WIDTH} height={SHARE_CARD_HEIGHT} fill={`url(#${bg})`} />
      </Svg>

      {aura}

      <Text style={[styles.kick, { color: kickColor }]}>{kick}</Text>
      <View style={styles.hero}>{children}</View>
      <ShareCardFooter handle={handle} tier={tier} division={division} />
    </View>
  );
});

/**
 * The install prompt with a status stamp. Wordmark + flame on top, then the identity row:
 * rank hexagon · @handle · philoi.app.
 */
export function ShareCardFooter({
  handle,
  tier,
  division,
}: {
  handle: string | null;
  tier?: RankTierName;
  division?: number;
}) {
  const metal = tier ? RANK_TIER_METAL[tier] : null;

  return (
    <View style={styles.foot}>
      <View style={styles.mark}>
        {/* The brand mark itself, never a redrawn copy of it (DESIGN_LANGUAGE_EMBER §1). */}
        <FlameLogo size={20} />
        <Text style={styles.wordmark}>philoi</Text>
      </View>
      <View style={styles.idRow}>
        {metal && (
          <View style={styles.hexWrap}>
            <Svg width={17} height={19} viewBox="0 0 100 100">
              <Polygon points="50,4 89.8,27 89.8,73 50,96 10.2,73 10.2,27" fill={metal.inner} />
            </Svg>
            <Text style={[styles.hexNumeral, { color: metal.numeral }]}>
              {DIVISION_NUMERAL[division ?? 1] ?? division}
            </Text>
          </View>
        )}
        <Text style={styles.idText}>
          {handle ? `@${handle} · ` : ''}
          <Text style={styles.idUrl}>philoi.app</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_WIDTH,
    height: SHARE_CARD_HEIGHT,
    alignItems: 'center',
    paddingTop: 34,
    paddingHorizontal: 28,
    paddingBottom: 30,
    overflow: 'hidden',
  },
  kick: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 3,
    textAlign: 'center',
  },
  hero: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  foot: {
    alignItems: 'center',
    gap: 6,
  },
  mark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  wordmark: {
    fontFamily: Fonts.bodyBold,
    fontSize: 22,
    letterSpacing: -0.5,
    color: Colors.ink,
  },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  hexWrap: {
    width: 17,
    height: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexNumeral: {
    position: 'absolute',
    fontFamily: Fonts.bodyBold,
    fontSize: 9,
  },
  idText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  idUrl: {
    fontFamily: Fonts.bodyBold,
    color: Colors.amber,
  },
});
