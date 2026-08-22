import { useId, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { EMBER_GRADIENT, Radius } from '@/constants/theme';

// The ember gradient as a BACKGROUND, for the small lit surfaces that aren't PrimaryButton:
// the header's Lock-in pill, the selected tab, the round chat send button (mocks 110/112).
//
// React Native has no gradient backgrounds and neither expo-linear-gradient nor masked-view is
// installed (adding a native module for a pill fill would mean another prebuild), so the same
// trick PrimaryButton uses applies here: measure the box, paint an SVG <Rect> underneath, put the
// children on top. Factored out because three surfaces in this pass needed it and each one
// re-deriving the measure-then-paint dance is exactly the copy-paste that made the old header
// look hand-assembled.
//
// Until the first layout pass lands, the solid mid-ember below shows through — so the surface is
// never transparent for a frame, it just isn't gradient yet.

type EmberFillProps = {
  children?: React.ReactNode;
  /** Match the container's own borderRadius, or the painted corners will square off under it. */
  radius?: number;
  style?: ViewStyle | ViewStyle[];
  /** 135° (top-left → bottom-right) for slabs; horizontal for pills, per DESIGN_LANGUAGE_EMBER §3. */
  direction?: 'diagonal' | 'horizontal';
};

export function EmberFill({ children, radius = Radius.pill, style, direction = 'horizontal' }: EmberFillProps) {
  // Gradient ids are global in react-native-svg — a shared literal blanks every instance after
  // the first on Android.
  const gradId = `ember-fill-${useId()}`;
  const [size, setSize] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View onLayout={onLayout} style={[styles.base, { borderRadius: radius }, style]}>
      {size.w > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={size.w} height={size.h}>
            <Defs>
              <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2={direction === 'diagonal' ? '1' : '0'}>
                <Stop offset="0" stopColor={EMBER_GRADIENT[1]} />
                <Stop offset="1" stopColor={EMBER_GRADIENT[0]} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={size.w} height={size.h} rx={radius} fill={`url(#${gradId})`} />
          </Svg>
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    // The pre-measure fill — mid-ember, so the first frame reads as lit rather than as a hole.
    backgroundColor: EMBER_GRADIENT[1],
    overflow: 'hidden',
  },
});
