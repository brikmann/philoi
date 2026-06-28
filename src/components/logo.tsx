import { StyleSheet, Text, View } from 'react-native';

import { FlameIcon } from '@/components/flame-icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';

type LogoProps = {
  size?: number;
  showFlame?: boolean;
};

export function Logo({ size = 28, showFlame = true }: LogoProps) {
  return (
    <View style={styles.row}>
      {showFlame && <FlameIcon size={size} background={null} />}
      <Text style={[styles.wordmark, { fontSize: size }]}>
        <Text style={{ color: Colors.coral }}>Phil</Text>
        <Text style={{ color: Colors.plum }}>oi</Text>
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
