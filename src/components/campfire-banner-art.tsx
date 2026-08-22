import { useId, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Circle, Rect, Stop } from 'react-native-svg';

import { Colors } from '@/constants/theme';
import { DEFAULT_LOADOUT, getItem } from '@/lib/economy/catalog';

// THE CAMPFIRE BANNER ART, as the header's background (ITEM_CATALOG §2d, mock 110's `.banner`).
//
// §2d has said all along that a BANNER is "header art for a Campfire the user owns" — but nothing
// in the app ever painted one, which is the "banner art currently not rendering" line in
// CAMPFIRE_REDESIGN_SPEC. The equipped item was real, the surface it was meant to land on was not.
// This is that surface: the campfire OWNER's equipped banner supplies the two colours (Emberfall
// Night's orange sky, Ashfall Ridge's grey, Obsidian Colosseum's gold-on-black), and the art is a
// ridgeline under that sky — mock 110's `#ridge` gradient plus its two silhouette paths.
//
// TWO THINGS ARE DELIBERATE HERE:
//
// 1. Numeric width/height from onLayout, never `width="100%"`. A percentage-sized <Svg> inside an
//    absolutely-positioned parent measures as ZERO on Android — which is the mechanical reason the
//    old hero's art never appeared on device while looking fine in the tree.
// 2. The veil is part of THIS svg, not a sibling View. It has to fade to exactly the screen
//    background at the bottom edge so the header dissolves into the page instead of ending on a
//    visible seam.

const FALLBACK = { from: '#2A1A12', to: '#C4701F' };

/** Resolve a banner cosmetic key to its two art colours, falling back to base Hearthlight. */
export function bannerColors(cosmeticKey: string | null | undefined): { from: string; to: string } {
  const item = getItem(cosmeticKey ?? DEFAULT_LOADOUT.banner ?? '');
  if (item?.art?.kind === 'banner') return { from: item.art.from, to: item.art.to };
  return FALLBACK;
}

type CampfireBannerArtProps = {
  from: string;
  to: string;
  /** Where the veil finishes — the colour the header sits on. Defaults to the app background. */
  fadeTo?: string;
};

export function CampfireBannerArt({ from, to, fadeTo = Colors.bgRadialTo }: CampfireBannerArtProps) {
  const uid = useId();
  const sky = `bannerSky-${uid}`;
  const veil = `bannerVeil-${uid}`;
  const [size, setSize] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  // The silhouettes are authored against a 300×220 box (mock 110's viewBox) and stretched to fill,
  // so a short collapsed header crops into the same ridge rather than drawing a different one.
  const VB_W = 300;
  const VB_H = 220;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {size.w > 0 && size.h > 0 && (
        <Svg width={size.w} height={size.h} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice">
          <Defs>
            <LinearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={to} stopOpacity={0.55} />
              <Stop offset="0.5" stopColor={from} stopOpacity={0.9} />
              <Stop offset="1" stopColor={from} />
            </LinearGradient>
            {/* Transparent at the top so the sky reads, opaque at the bottom so the name plate and
                tabs always have ground under them whatever banner is equipped. */}
            <LinearGradient id={veil} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={fadeTo} stopOpacity={0.35} />
              <Stop offset="0.62" stopColor={fadeTo} stopOpacity={0.78} />
              <Stop offset="1" stopColor={fadeTo} stopOpacity={1} />
            </LinearGradient>
          </Defs>

          <Rect width={VB_W} height={VB_H} fill={`url(#${sky})`} />
          {/* Far ridge, then near ridge — two depths is what stops it reading as a flat swatch. */}
          <Path d="M0 150 L70 90 L120 130 L180 70 L240 120 L300 80 L300 220 L0 220Z" fill="#241633" opacity={0.8} />
          <Path d="M0 175 L60 130 L130 165 L200 120 L300 150 L300 220 L0 220Z" fill="#1A1226" />
          {/* Two embers drifting in the sky — the banner's only "live" flourish. */}
          <Circle cx={230} cy={45} r={3} fill={to} opacity={0.5} />
          <Circle cx={90} cy={55} r={2} fill={to} opacity={0.4} />
          <Rect width={VB_W} height={VB_H} fill={`url(#${veil})`} />
        </Svg>
      )}
    </View>
  );
}
