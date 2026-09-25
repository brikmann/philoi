import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { listBlockedUsers, unblockUser, type BlockedUser } from '@/lib/api/agora';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';

// Settings → Blocked users. Every block path in the app (Agora, DMs, friend profile, chat,
// leaderboards) writes the same blocked_users row, so this one list is the way back from all of
// them. Unblocking is immediate — the feed and comment reads filter on the row, not on a cache.

export default function BlockedUsersScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [people, setPeople] = useState<BlockedUser[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let live = true;
    listBlockedUsers(profile.id)
      .then((rows) => {
        if (live) setPeople(rows);
      })
      .catch((e) => {
        if (!live) return;
        setPeople([]);
        Alert.alert('Could not load', getErrorMessage(e, 'Something went wrong.'));
      });
    return () => {
      live = false;
    };
  }, [profile]);

  function confirmUnblock(person: BlockedUser) {
    Alert.alert(`Unblock ${person.display_name}?`, 'You’ll see their posts and comments again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        onPress: async () => {
          if (!profile) return;
          setBusyId(person.id);
          try {
            await unblockUser(profile.id, person.id);
            setPeople((prev) => (prev ? prev.filter((p) => p.id !== person.id) : prev));
          } catch (e) {
            Alert.alert('Could not unblock', getErrorMessage(e, 'Something went wrong.'));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.muted} />
        </Pressable>
        <Text style={styles.headerTitle}>Blocked users</Text>
      </View>

      {people === null ? (
        <ActivityIndicator color={Colors.coral} style={styles.loader} />
      ) : people.length === 0 ? (
        <Text style={styles.empty}>You haven’t blocked anyone.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.group}>
            {people.map((person, i) => (
              <View key={person.id} style={[styles.row, i === people.length - 1 && styles.rowLast]}>
                <Avatar label={person.display_name} size={36} />
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {person.display_name}
                  </Text>
                  {person.handle ? (
                    <Text style={styles.handle} numberOfLines={1}>
                      @{person.handle}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => confirmUnblock(person)}
                  disabled={busyId === person.id}
                  style={styles.unblock}
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${person.display_name}`}>
                  <Text style={styles.unblockLabel}>{busyId === person.id ? '…' : 'Unblock'}</Text>
                </Pressable>
              </View>
            ))}
          </View>
          <Text style={styles.foot}>
            Blocked people can’t appear in your Agora feed or comments. They aren’t told you blocked them.
          </Text>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.twelve,
  },
  headerTitle: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.ink },
  loader: { marginTop: Spacing.six },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.six,
  },
  body: { padding: Spacing.three, gap: Spacing.twelve, paddingBottom: Spacing.five },
  group: {
    backgroundColor: Colors.card,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: Spacing.twelve,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.ink },
  handle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  unblock: {
    paddingHorizontal: Spacing.twelve,
    paddingVertical: Spacing.two,
    borderRadius: Radius.button,
    backgroundColor: Colors.cardDark,
  },
  unblockLabel: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  foot: { fontFamily: Fonts.body, fontSize: 12, lineHeight: 17, color: Colors.textTertiary },
});
