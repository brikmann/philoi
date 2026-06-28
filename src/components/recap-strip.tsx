import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

export function RecapStrip({ checkInsThisWeek }: { checkInsThisWeek: number }) {
  return (
    <View style={styles.strip}>
      <Text style={styles.text}>
        You hit it <Text style={styles.bold}>{checkInsThisWeek}×</Text> this week
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: Colors.plum,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: Fonts.body,
    color: Colors.cream,
    fontSize: 13,
  },
  bold: {
    fontFamily: Fonts.bodyExtraBold,
    color: Colors.ember,
  },
});
