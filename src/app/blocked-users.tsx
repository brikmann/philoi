import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Screen } from '@/components/ui/screen';
import { SpaceEmpty, SpaceHeader, SPACE_GUTTER } from '@/components/ui/space-kit';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { listBlockedUsers, unblockUser, type BlockedUser } from '@/lib/api/agora';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';

// Settings → Blocked users. Every block path in the app (Agora, DMs, friend profile, chat,
// leaderboards) writes the same blocked_users row, so this one list is the way back from all of
// them. Unblocking is immediate — the feed and comment reads filter on the row, not on a cache.

export default function BlockedUsersScreen() {
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
    // Top edge only: the global footer owns the bottom inset.
    <Screen padded={false} edges={['top']}>
      <SpaceHeader title="Blocked users" />

      {people === null ? (
        <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
      ) : people.length === 0 ? (
        <SpaceEmpty
          title="You haven’t blocked anyone."
          body="Anyone you block from the Agora, a DM or a profile shows up here."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.group}>
            {people.map((person) => (
              <View key={person.id} style={styles.row}>
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
                {/* A compact SpaceButton-secondary look, kept a Pressable so it can carry the
                    per-person accessibility label (the kit button takes none). */}
                <Pressable
                  onPress={() => confirmUnblock(person)}
                  disabled={busyId === person.id}
                  style={({ pressed }) => [styles.unblock, pressed && styles.unblockPressed]}
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
  loader: { marginTop: Spacing.six },
  body: { paddingHorizontal: SPACE_GUTTER, gap: Spacing.twelve, paddingBottom: Spacing.five },
  // A stack of standalone SpaceRow-style panels.
  group: { gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 10,
    paddingHorizontal: Spacing.twelve,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontFamily: Fonts.bodyBold, fontSize: 14.5, color: Colors.ink },
  handle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.spaceDim, marginTop: 2 },
  unblock: {
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  unblockPressed: { opacity: 0.85 },
  unblockLabel: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.ink },
  foot: { fontFamily: Fonts.body, fontSize: 12, lineHeight: 17, color: Colors.spaceFaint },
});
