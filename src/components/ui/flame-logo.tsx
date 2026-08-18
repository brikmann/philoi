import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

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

/** Mock 92's `#flameMark`, viewBox 0 0 24 24. One path — no inner layers; this reads at 16px. */
export const FLAME_PATH =
  'M13.8 2c.7 3.1-1.2 4.8-2.8 6.2-1.9 1.7-3.5 3.5-3.5 6.3a6.5 6.5 0 0013 0c0-1.4-.45-2.7-1.2-3.8-.25 1.15-1 1.95-2.05 2.2.8-1.75.45-3.9-1-5.3C13.1 6.9 15.1 4.7 13.8 2z';

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
    <Svg width={size} height={size} viewBox="0 0 24 24">
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
      <Path d={FLAME_PATH} fill={color ?? `url(#${grad})`} />
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
