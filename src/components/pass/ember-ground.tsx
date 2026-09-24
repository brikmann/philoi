import { useId, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

// THE Flame Pass ground (mock 214). An opaque firelit radial that stands in for ScreenBackground's
// deep-purple one on the two screens the season owns.
//
// WHY A SECOND GROUND EXISTS AT ALL, when §2 says one background for every screen: the Pass is the
// one surface in the app that is a *place* rather than a screen — a forge you climb, sold on being
// made of fire. On the purple ground the Flame Pass screen read as the shop's lavender cousin with
// some orange text on it, which is the entire "looks cheap" complaint: the wordmark, the level
// number, the molten seam and the premium lane were all warm, and every pixel behind them was cold.
//
// Fully opaque, top to bottom. A translucent warm wash over the purple (what the paywall's hero
// does for its top 300pt) is right for a band inside a purple screen and wrong for a whole one —
// the purple survives the wash in the darker two thirds and the screen ends up neither colour.
//
// The screen that mounts this must use `edges={[]}` on <Screen> and inset its own chrome. Under the
// default edges, SafeAreaView pads with real padding and every child — absoluteFill included — is
// laid out INSIDE it, so the ground would stop short of the status bar and leave a purple band
// across the top. See the note on Screen's `edges` prop.
export function EmberGround() {
  const grad = `emberGround-${useId()}`;
  const [size, setSize] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View style={[StyleSheet.absoluteFill, styles.base]} pointerEvents="none" onLayout={onLayout}>
      {size.w > 0 ? (
        <Svg width={size.w} height={size.h}>
          <Defs>
            {/* Same geometry as ScreenBackground — light placed near the top, `ry` past the bottom
                edge so the darkest value is reached at the very bottom of the screen and nowhere
                above it (punchlist 20.1). Only the three stops change, purple for ember.
                useId because gradient ids are global in react-native-svg. */}
            <RadialGradient id={grad} cx="50%" cy="6%" rx="130%" ry="105%">
              <Stop offset="0" stopColor="#3A1C0C" />
              <Stop offset="0.42" stopColor="#1C1109" />
              <Stop offset="1" stopColor="#0E0A08" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={size.w} height={size.h} fill={`url(#${grad})`} />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The solid floor under the SVG, so the screen is never the purple ground for the frame before
  // onLayout has given the gradient its dimensions.
  base: {
    backgroundColor: '#0E0A08',
  },
});
