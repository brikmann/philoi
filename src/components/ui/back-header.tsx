import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/constants/theme';

// The plain `‹ Title` row for a pushed screen that hides the native header. The native one is the
// iOS 26 liquid-glass pill, which doesn't belong on these pages; this matches the Activity screen's
// own header (notifications.tsx) so every pushed settings-type page reads the same.
export function BackHeader({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={Colors.muted} />
      </Pressable>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
  },
});
