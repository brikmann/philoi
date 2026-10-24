import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchProgramsForUniversity } from '@/lib/api/house';

// "Claim your house — pick your program." The on-ramp for anyone with no program: an account that
// predates the house system, or one whose onboarding couldn't save it. Nobody is FORCED into the
// ceremony (the root layout's gate only fires for a profile that already has a program); this card
// is the invitation instead, and it runs the ceremony after the pick (?ceremony=1).
//
// Self-contained so any surface can drop it in: it reads the profile itself and renders nothing
// once there is a program — or when the school has none to pick from (only Laurier and Waterloo do
// today), since a CTA that opens onto "no houses here yet" is a dead end. A failed lookup reads as
// "none" too: the card is an invitation, and a broken one is worse than none.

export function ClaimHouseCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const { profile } = useAuth();
  const university = profile?.university ?? null;
  const hasProgram = Boolean(profile?.program_id);
  // Keyed by school so a profile edit to another school can't show the last school's answer.
  const [available, setAvailable] = useState<{ university: string; has: boolean } | null>(null);

  useEffect(() => {
    if (hasProgram || !university) return;
    fetchProgramsForUniversity(university)
      .then((rows) => setAvailable({ university, has: rows.length > 0 }))
      .catch(() => setAvailable({ university, has: false }));
  }, [hasProgram, university]);

  if (hasProgram || !university || available?.university !== university || !available.has) return null;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      onPress={() => router.push({ pathname: '/house/change-program', params: { ceremony: '1' } })}
      accessibilityRole="button"
      accessibilityLabel="Claim your house — pick your program">
      <View style={styles.icon}>
        <Ionicons name="shield-half-outline" size={18} color={Colors.ember} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>Claim your house</Text>
        <Text style={styles.sub}>Pick your program — every one is a Greek house.</Text>
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
