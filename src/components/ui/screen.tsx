import { KeyboardAvoidingView, Platform, StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenBackground } from '@/components/ui/screen-background';
import { Spacing } from '@/constants/theme';

type ScreenProps = ViewProps & {
  /** @deprecated Was a lighter plum fill; every screen is the deep-purple radial now (§2). Ignored. */
  dark?: boolean;
  padded?: boolean;
  /** Opts OUT of the radial entirely, for a screen with its own one-off ground (the running
   * lock-in session's immersive chrome, PHILOI_UI_SPEC.md §13). Everything else gets the radial. */
  backgroundColor?: string;
};

// KeyboardAvoidingView here (not just in individual forms) so every screen built on Screen
// gets it for free — a plain View doesn't resize/shift for the keyboard on either platform,
// which was covering inputs on every form using this wrapper (setup-handle, join,
// edit-profile, goal check-in caption).
export function Screen({ style, padded = true, backgroundColor, ...rest }: ScreenProps) {
  const body = (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, padded && styles.padded, style]} {...rest} />
    </KeyboardAvoidingView>
  );

  // THE reskin sweep, done once (DESIGN_LANGUAGE_EMBER §6). 38 screens render through this
  // component, so putting the deep-purple radial here is what makes the background app-wide
  // rather than 38 copies of a colour — which is the whole point of shipping primitives.
  //
  // `dark` is gone: it painted Colors.plum (#3A2E5C), a lighter washed-out purple, and §2 names
  // exactly that as what the radial replaces. The prop is kept in the type as a no-op so the
  // handful of callers still passing it don't break; they simply get the radial like everything
  // else, which is what they wanted from `dark` in the first place.
  if (backgroundColor) {
    return <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>{body}</SafeAreaView>;
  }

  return (
    <ScreenBackground>
      {/* Transparent — the radial is painted by ScreenBackground underneath. */}
      <SafeAreaView style={styles.safeArea}>{body}</SafeAreaView>
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
