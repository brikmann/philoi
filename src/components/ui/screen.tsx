import { KeyboardAvoidingView, Platform, StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Spacing } from '@/constants/theme';

type ScreenProps = ViewProps & {
  dark?: boolean;
  padded?: boolean;
  /** Overrides the dark/cream default entirely — for a screen with its own one-off
   * background (e.g. the running lock-in session's immersive darker chrome, PHILOI_UI_SPEC.md
   * §13). */
  backgroundColor?: string;
};

// KeyboardAvoidingView here (not just in individual forms) so every screen built on Screen
// gets it for free — a plain View doesn't resize/shift for the keyboard on either platform,
// which was covering inputs on every form using this wrapper (setup-handle, join,
// edit-profile, goal check-in caption).
export function Screen({ style, dark, padded = true, backgroundColor, ...rest }: ScreenProps) {
  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: backgroundColor ?? (dark ? Colors.plum : Colors.cream) }]}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.container, padded && styles.padded, style]} {...rest} />
      </KeyboardAvoidingView>
    </SafeAreaView>
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
