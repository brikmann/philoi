import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

import { Colors, Fonts } from '@/constants/theme';

// THE BRAND MARK (DESIGN_LANGUAGE_EMBER §1). The flame glyph from mocks 91/92 — app icon, splash,
// wordmark lockup, empty states, and the hero on home / done / daily fire at large sizes.
//
// This RETIRES the campfire (crossed logs + three-layer flame in components/flame-icon.tsx) as the
// logo. flame-icon.tsx is not deleted here: it still backs the flame COSMETIC ramp, which is a
// different job than being the brand.
//
// Kept deliberately distinct from <EmberIcon> (§4): flame = the app, ember = money. They share a
// palette but not a silhouette — the flame has the tongue-lick notch and an open base, the ember
// token is a closed, rounded coal.

/** Mock 115's flame — the "Cindy flame": sharper and less rounded than the retired mock-92 mark.
 *  viewBox 0 0 24 24. Rendered mirrored (FLAME_MIRROR_TRANSFORM) to match mock 115 exactly. */
export const FLAME_PATH =
  'M12 2c1.5 4.5 6 5.5 6 10.5a6 6 0 0 1-12 0c0-2.5 1-4 2.4-5.2 0 2.4 1.2 3.6 2.4 3.6.8-2.6-1.4-5 1.2-8.9z';

/** The viewBox FLAME_PATH is authored in. Square, so this is both width and height. */
export const FLAME_VIEWBOX = 24;

/**
 * THE ONE FLIP (CINDY_SPEC rendering rule 1). The canonical mark app-wide is FLAME_PATH mirrored
 * horizontally — the "Cindy flame". It is applied HERE, once, at the source, and every surface
 * inherits it: app icon, favicon, splash, notification silhouette, home / done / daily-fire hero,
 * lock-in, share cards, the website.
 *
 * Left as a transform rather than baked into the path data so the glyph stays legible and diffable
 * against mock 92, and so the raster generators can mirror the same way (they flip x -> 24 - x,
 * which is this matrix).
 *
 * Nothing downstream may apply a SECOND mirror — two flips cancel and the surface silently renders
 * the retired orientation. The old opt-in `mirrored` prop on FlameSvg is gone for exactly this
 * reason; if you find yourself reaching for scaleX(-1) on a flame, you are about to unflip it.
 */
export const FLAME_MIRROR_TRANSFORM = `translate(${FLAME_VIEWBOX},0) scale(-1,1)`;

type FlameLogoProps = {
  size?: number;
  /** Override the ember ramp with a flat colour (monochrome contexts — a tab bar glyph). */
  color?: string;
};

export function FlameLogo({ size = 24, color }: FlameLogoProps) {
  // Gradient ids are GLOBAL in react-native-svg, and duplicate <Defs> ids make every instance after
  // the first render blank on Android. useId per mount is the fix — same bug EmberIcon hit.
  const uid = useId();
  const grad = `flameLogo-${uid}`;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${FLAME_VIEWBOX} ${FLAME_VIEWBOX}`}>
      {!color ? (
        <Defs>
          {/* Vertical, bottom→top: deep ember at the base rising to pale gold at the tip. */}
          <LinearGradient id={grad} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#E0612C" />
            <Stop offset="0.55" stopColor="#F2A33C" />
            <Stop offset="1" stopColor="#FFD27A" />
          </LinearGradient>
        </Defs>
      ) : null}
      <G transform={FLAME_MIRROR_TRANSFORM}>
        <Path d={FLAME_PATH} fill={color ?? `url(#${grad})`} />
      </G>
    </Svg>
  );
}

/**
 * The lockup: flame + lowercase "philoi". Mock 92 sets the wordmark at weight 800 with a slight
 * negative tracking, which is what stops the lowercase from reading as loose beside the glyph.
 */
export function FlameWordmark({ size = 34 }: { size?: number }) {
  return (
    <View style={styles.lockup}>
      <FlameLogo size={size * 0.82} />
      <Text style={[styles.wordmark, { fontSize: size }]}>philoi</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  wordmark: {
    fontFamily: Fonts.bodyBold,
    letterSpacing: -0.5,
    color: Colors.ink,
  },
});
