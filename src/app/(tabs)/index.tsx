import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DiscoverCircleCard } from '@/components/discover-circle-card';
import { GroupCard } from '@/components/group-card';
import { Logo } from '@/components/logo';
import { TrashTarget } from '@/components/trash-target';
import { PrimaryButton } from '@/components/ui/primary-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useDiscoverGroups } from '@/hooks/use-discover-groups';
import { useMyGroups } from '@/hooks/use-my-groups';
import { deleteGroup, fetchUniversityMemberCount, joinPublicGroup, leaveGroup, type MyGroup } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';

function UniversitySocialProof() {
  const { profile } = useAuth();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (profile?.university) {
      fetchUniversityMemberCount(profile.university).then(setCount);
    }
  }, [profile?.university]);

  if (!profile?.university || !count || count < 2) return null;

  return (
    <Text style={styles.socialProof}>
      🔥 {count} people at {profile.university} are already on Philoi
    </Text>
  );
}

function DiscoverCircles({ onJoined }: { onJoined: () => void }) {
  const { groups, refetch } = useDiscoverGroups();
  const [joiningId, setJoiningId] = useState<string | null>(null);

  if (groups.length === 0) return null;

  async function handleJoin(groupId: string) {
    setJoiningId(groupId);
    try {
      await joinPublicGroup(groupId);
      await refetch();
      onJoined();
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <View style={styles.discoverSection}>
      <Text style={styles.discoverTitle}>Don&apos;t have 3 friends to invite yet?</Text>
      <Text style={styles.discoverBody}>These circles are open — jump in and start your streak today.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.discoverList}>
        {groups.map((group) => (
          <DiscoverCircleCard
            key={group.id}
            group={group}
            onJoin={() => handleJoin(group.id)}
            joining={joiningId === group.id}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export default function TodayScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { groups, loading, error, refetch } = useMyGroups();
  const [draggingGroup, setDraggingGroup] = useState<MyGroup | null>(null);
  const [overTrash, setOverTrash] = useState(false);

  async function handleDropOnTrash(group: MyGroup) {
    if (!session) return;
    const isOwner = group.owner_id === session.user.id;
    try {
      if (isOwner) {
        await deleteGroup(group.id);
      } else {
        await leaveGroup(group.id, session.user.id);
      }
      refetch();
    } catch (e) {
      console.error('[today] failed to delete/leave circle:', e);
      Alert.alert(
        'Something went wrong',
        getErrorMessage(e, `Could not ${isOwner ? 'delete' : 'leave'} this circle — try again.`)
      );
    }
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={groups}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.coral} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Logo size={24} />
            <Text style={styles.headerTitle}>Today</Text>
            {groups.length > 0 && (
              <Text style={styles.hint}>Hold and drag a circle down to the trash to delete or leave it.</Text>
            )}
            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        renderItem={({ item }) => (
          <GroupCard
            group={item}
            onLockIn={() => router.push(`/group/${item.id}/check-in`)}
            onOpen={() => router.push(`/group/${item.id}`)}
            onDragStateChange={(dragging) => setDraggingGroup(dragging ? item : null)}
            onHoverTrashChange={setOverTrash}
            onDropOnTrash={() => handleDropOnTrash(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              title="No circles yet"
              body="Philoi works better with your people — pull 3 friends in."
              action={
                <View style={styles.emptyActions}>
                  <UniversitySocialProof />
                  <PrimaryButton label="Start a circle" onPress={() => router.push('/group/create')} />
                  <SecondaryButton label="Join with a code" onPress={() => router.push('/join')} />
                  <DiscoverCircles onJoined={refetch} />
                </View>
              }
            />
          ) : null
        }
        ListFooterComponent={
          groups.length > 0 ? (
            <View style={styles.footerActions}>
              <SecondaryButton label="Start a new circle" onPress={() => router.push('/group/create')} />
              <SecondaryButton label="Join with a code" onPress={() => router.push('/join')} />
            </View>
          ) : null
        }
      />

      <TrashTarget
        visible={draggingGroup !== null}
        hot={overTrash}
        label={
          draggingGroup && session && draggingGroup.owner_id === session.user.id
            ? 'Drop to delete'
            : 'Drop to leave'
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
  },
  header: {
    gap: Spacing.one,
    paddingVertical: Spacing.three,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.muted,
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 32,
    color: Colors.ink,
  },
  error: {
    fontFamily: Fonts.body,
    color: Colors.coral,
  },
  emptyActions: {
    gap: Spacing.three,
    width: '100%',
  },
  socialProof: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.plum,
    textAlign: 'center',
    flexShrink: 1,
  },
  footerActions: {
    gap: Spacing.three,
    marginTop: Spacing.four,
  },
  discoverSection: {
    marginTop: Spacing.four,
    gap: Spacing.one,
    width: '100%',
  },
  discoverTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
    textAlign: 'center',
  },
  discoverBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  discoverList: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.one,
  },
});
