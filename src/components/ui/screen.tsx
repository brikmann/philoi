import { KeyboardAvoidingView, Platform, StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { ScreenBackground } from '@/components/ui/screen-background';
import { Spacing } from '@/constants/theme';

type ScreenProps = ViewProps & {
  /** @deprecated Was a lighter plum fill; every screen is the deep-purple radial now (§2). Ignored. */
  dark?: boolean;
  padded?: boolean;
  /** Opts OUT of the radial entirely, for a screen with its own one-off ground (the running
   * lock-in session's immersive chrome, PHILOI_UI_SPEC.md §13). Everything else gets the radial. */
  backgroundColor?: string;
  /**
   * D1 · WHICH EDGES THE SAFE AREA PADS. Defaults to all four, which is what every ordinary screen
   * wants and what this component has always done.
   *
   * `edges={[]}` is for an IMMERSIVE screen — one that paints its own art edge to edge and insets
   * its OWN chrome. That is not a style preference; it is the difference between a full-bleed
   * background and a letterboxed one, because SafeAreaView pads with real padding and every child
   * — including an `absoluteFill` backdrop — is laid out INSIDE that padding. ScreenBackground sits
   * OUTSIDE this wrapper, which is precisely why the app-wide flare reaches the screen edges and a
   * banner mounted as a child of the screen never could. See group/[groupId]/index.tsx.
   *
   * A screen passing `[]` takes on the whole job: it must apply `insets.top` to its own header and
   * `insets.bottom` to whatever sits at the foot, or its content runs under the clock.
   */
  edges?: readonly Edge[];
  /**
   * A full-bleed, pointer-transparent layer painted OUTSIDE the SafeAreaView — on the same box as
   * the ground, so it reaches behind the status bar and the nav bar with no inset math. Drawn after
   * the content, so it sits over it (the lock-in flare's wash is meant to be over the timer).
   *
   * This is what a child mount can never do: anything inside the SafeAreaView is laid out inside
   * its padding. The running lock-in passes its equipped flare here (lock-in/index.tsx).
   */
  overlay?: React.ReactNode;
};

// KeyboardAvoidingView here (not just in individual forms) so every screen built on Screen
// gets it for free — a plain View doesn't resize/shift for the keyboard on either platform,
// which was covering inputs on every form using this wrapper (setup-handle, join,
// edit-profile, goal check-in caption).
export function Screen({ style, padded = true, backgroundColor, edges, overlay, ...rest }: ScreenProps) {
  const body = (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, padded && styles.padded, style]} {...rest} />
    </KeyboardAvoidingView>
  );

  const overlayLayer = overlay ? (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {overlay}
    </View>
  ) : null;

  // THE reskin sweep, done once (DESIGN_LANGUAGE_EMBER §6). 38 screens render through this
  // component, so putting the deep-purple radial here is what makes the background app-wide
  // rather than 38 copies of a colour — which is the whole point of shipping primitives.
  //
  // `dark` is gone: it painted Colors.plum (#3A2E5C), a lighter washed-out purple, and §2 names
  // exactly that as what the radial replaces. The prop is kept in the type as a no-op so the
  // handful of callers still passing it don't break; they simply get the radial like everything
  // else, which is what they wanted from `dark` in the first place.
  if (backgroundColor) {
    // The fill moves to an outer View only when there is an overlay to paint beside the safe area;
    // every other solid-ground screen keeps its exact tree.
    if (overlayLayer) {
      return (
        <View style={[styles.safeArea, { backgroundColor }]}>
          <SafeAreaView edges={edges} style={styles.safeArea}>
            {body}
          </SafeAreaView>
          {overlayLayer}
        </View>
      );
    }
    return (
      <SafeAreaView edges={edges} style={[styles.safeArea, { backgroundColor }]}>
        {body}
      </SafeAreaView>
    );
  }

  return (
    <ScreenBackground>
      {/* Transparent — the radial is painted by ScreenBackground underneath. */}
      <SafeAreaView edges={edges} style={styles.safeArea}>
        {body}
      </SafeAreaView>
      {overlayLayer}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: Spacing.four,
  },
});
