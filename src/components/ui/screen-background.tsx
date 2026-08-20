import { useId, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Colors } from '@/constants/theme';

// THE background (DESIGN_LANGUAGE_EMBER §2): a deep-purple radial, lit slightly above centre.
//
//   radial-gradient(120% 100% at 50% 6%, #2C1B36, #231830 42%, #161320)
//
// One background for every screen. The thing this replaces is a scattering of flat fills and
// washed-out lighter purples that made some screens (the daily fire worst of all) read as grey.
// The light source sits at 6% from the top so the glow lands behind whatever hero the screen has —
// the flame on home, the roar on daily fire — rather than pooling in the middle of the content.
//
// THE EXTENT IS THE WHOLE POINT (punchlist 20.1). The mocks are 600px-tall phone frames; a real
// device is far taller, and at the mock's `62%` vertical extent the gradient was fully spent
// 40% of the way down — the light pooled in the top sliver and the bottom two thirds fell to
// #161320, which on a device reads as flat black. `ry` reaching past the bottom of the screen
// plus a mid stop is what makes the whole page deep purple with the light *placed* in it, which
// is what the mock looks like at the mock's own proportions.
//
// Rendered as an absolutely-positioned layer BEHIND children rather than as a container style,
// because React Native has no gradient backgrounds and the SVG needs measured pixels.

export function ScreenBackground({ children }: { children?: React.ReactNode }) {
  const uid = useId();
  const grad = `screenBg-${uid}`;
  const [size, setSize] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View style={styles.root} onLayout={onLayout}>
      {/* The solid stop underneath means the screen is never transparent in the first frame,
          before onLayout has given the SVG its dimensions. */}
      <View style={[StyleSheet.absoluteFill, styles.base]} pointerEvents="none" />
      {size.w > 0 ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={size.w} height={size.h}>
            <Defs>
              {/* rx/ry as fractions of the box are the CSS extent; cx/cy the `at 50% 6%` origin.
                  ry 105% puts the outer stop just past the bottom edge, so the darkest value is
                  reached at the very bottom of the screen and nowhere above it. */}
              <RadialGradient id={grad} cx="50%" cy="6%" rx="130%" ry="105%">
                <Stop offset="0" stopColor={Colors.bgRadialFrom} />
                <Stop offset="0.42" stopColor={Colors.bgRadialMid} />
                <Stop offset="1" stopColor={Colors.bgRadialTo} />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width={size.w} height={size.h} fill={`url(#${grad})`} />
          </Svg>
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  base: {
    backgroundColor: Colors.bgRadialTo,
  },
});
