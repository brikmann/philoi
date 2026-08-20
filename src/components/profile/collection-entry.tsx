import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

// §7 — the way into the RL-style closet, from your own profile and from anyone else's.
//
// This is NOT the "Inventory & loadout" row §1 removed. That one opened the EDITOR from a screen
// that already showed the loadout; this opens a read-only BROWSE that also works on other people's
// profiles. Viewing/showcase lives on the profile, editing/equipping stays in the inventory (⚙).

export function CollectionEntry({
  userId,
  isOwn,
  /** Whose closet, for the label on someone else's profile. First name only. */
  name,
  count,
}: {
  userId: string;
  isOwn: boolean;
  name?: string;
  count?: number | null;
}) {
  const router = useRouter();
  const firstName = name?.split(' ')[0];

  return (
    <Pressable
      style={styles.row}
      onPress={() => router.push({ pathname: '/collection', params: { userId } })}
      accessibilityRole="button"
      accessibilityLabel={isOwn ? 'Loadout and collection' : `View ${firstName ?? 'their'} collection`}>
      <Ionicons name="albums-outline" size={17} color={Colors.ember} />
      <Text style={styles.label}>
        {isOwn ? 'Loadout & Collection' : `View ${firstName ? `${firstName}'s` : 'their'} collection`}
      </Text>
      {typeof count === 'number' ? <Text style={styles.count}>{count} items</Text> : <View />}
      <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: Spacing.twelve,
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  label: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  count: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textTertiary,
  },
});
