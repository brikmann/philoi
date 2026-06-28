import { useRouter } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { GroupCard } from '@/components/group-card';
import { Logo } from '@/components/logo';
import { PrimaryButton } from '@/components/ui/primary-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useMyGroups } from '@/hooks/use-my-groups';

export default function TodayScreen() {
  const router = useRouter();
  const { groups, loading, error, refetch } = useMyGroups();

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
            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        renderItem={({ item }) => (
          <GroupCard
            group={item}
            onLockIn={() => router.push(`/group/${item.id}/check-in`)}
            onOpen={() => router.push(`/group/${item.id}`)}
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
                  <PrimaryButton label="Start a circle" onPress={() => router.push('/group/create')} />
                  <SecondaryButton label="Join with a code" onPress={() => router.push('/join')} />
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
  footerActions: {
    gap: Spacing.three,
    marginTop: Spacing.four,
  },
});
