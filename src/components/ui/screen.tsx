import { StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Spacing } from '@/constants/theme';

type ScreenProps = ViewProps & {
  dark?: boolean;
  padded?: boolean;
};

export function Screen({ style, dark, padded = true, ...rest }: ScreenProps) {
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: dark ? Colors.plum : Colors.cream }]}>
      <View style={[styles.container, padded && styles.padded, style]} {...rest} />
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
