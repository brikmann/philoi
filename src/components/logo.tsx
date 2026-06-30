import { StyleSheet, Text, View } from 'react-native';

import { FlameIcon } from '@/components/flame-icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';

type LogoProps = {
  size?: number;
  showFlame?: boolean;
  /** Set on plum/dark backgrounds — "oi" is plum by default and disappears against a plum bg. */
  dark?: boolean;
  /** Show the flame inside its plum rounded-square backdrop, like the app icon. */
  badge?: boolean;
};

export function Logo({ size = 28, showFlame = true, dark = false, badge = false }: LogoProps) {
  return (
    <View style={styles.row}>
      {showFlame && <FlameIcon size={size} background={badge ? Colors.plum : null} />}
      <Text style={[styles.wordmark, { fontSize: size }]}>
        <Text style={{ color: Colors.coral }}>Phil</Text>
        <Text style={{ color: dark ? Colors.cream : Colors.plum }}>oi</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  wordmark: {
    fontFamily: Fonts.display,
  },
});
