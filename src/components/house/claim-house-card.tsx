import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';

// "Pick your patron." Phase 9 (0293): the on-ramp for anyone with no patron chosen — an account
// that predates personas, or one that skipped setup's step 5. Program-independent: any of the twelve,
// whatever you study, so it shows whether or not there's a program. Opens /house/patron; no ceremony.
//
// Named ClaimHouseCard still so existing call sites keep working; it renders nothing once a patron
// is chosen.
export function ClaimHouseCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const { profile } = useAuth();
  if (!profile || profile.patron_key) return null;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      onPress={() => router.push('/house/patron' as never)}
      accessibilityRole="button"
      accessibilityLabel="Pick your patron">
      <View style={styles.icon}>
        <Ionicons name="shield-half-outline" size={18} color={Colors.ember} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>Pick your patron</Text>
        <Text style={styles.sub}>Zeus, Athena, Heracles… the persona you rep, beside your program.</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255,210,122,0.28)',
    paddingVertical: Spacing.twelve,
    paddingHorizontal: Spacing.three,
  },
  pressed: {
    opacity: 0.8,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.forgeBg,
    borderWidth: 1.5,
    borderColor: Colors.ember,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.muted,
    marginTop: 2,
  },
});
