import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchMyDmThreads, type DmThreadSummary } from '@/lib/api/dm';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';

// MESSAGES — the ✈ global (nav restructure, mocks 301/303). The inbox the 1:1 threads never had: every
// DM thread (get_my_dm_threads, 0206), newest first, each opening /dm/[friendId] as before. Cheers on a
// live lock-in stay on the timer and in the locked-in-with-you panel — this is the conversation list.

export default function MessagesScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [threads, setThreads] = useState<DmThreadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const next = await fetchMyDmThreads();
      setThreads(next.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your messages.'));
      setThreads((prev) => prev ?? []);
    }
  }, []);

  // On focus: coming back from a thread is when its unread count just dropped to zero.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const me = session?.user.id ?? null;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>Messages</Text>
        <Pressable onPress={() => router.push('/people')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Friends">
          <Ionicons name="create-outline" size={20} color={Colors.navEmber2} />
        </Pressable>
      </View>

      {threads === null ? (
        <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.threadId}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={Colors.navEmber}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{error ?? 'No messages yet'}</Text>
              <Text style={styles.emptyBody}>Message a friend from their profile or your Friends list.</Text>
              <Pressable style={styles.emptyBtn} onPress={() => router.push('/people')} accessibilityRole="button">
                <Text style={styles.emptyBtnText}>Open Friends</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: '/dm/[friendId]', params: { friendId: item.friendId } })}
              accessibilityRole="button"
              accessibilityLabel={`${item.displayName}${item.unread > 0 ? `, ${item.unread} unread` : ''}`}>
              {item.avatarUrl ? (
                <Image source={{ uri: item.avatarUrl }} style={styles.avatar} contentFit="cover" />
              ) : (
                <Avatar label={(item.displayName || '?').slice(0, 2).toUpperCase()} size={44} />
              )}
              <View style={styles.rowText}>
                <Text style={[styles.name, item.unread > 0 && styles.nameUnread]} numberOfLines={1}>
                  {item.displayName}
                </Text>
                <Text style={[styles.last, item.unread > 0 && styles.lastUnread]} numberOfLines={1}>
                  {item.lastBody ? `${item.lastSenderId === me ? 'You: ' : ''}${item.lastBody}` : 'Say hi'}
                </Text>
              </View>
              {item.unread > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unread > 9 ? '9+' : item.unread}</Text>
                </View>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twelve,
  },
  title: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.ink,
  },
  loader: {
    marginTop: Spacing.five,
  },
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    padding: Spacing.twelve,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14.5,
    color: Colors.ink,
  },
  nameUnread: {
    fontFamily: Fonts.bodyBold,
  },
  last: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  lastUnread: {
    color: Colors.ink,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: Colors.navEmber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: Fonts.black,
    fontSize: 10.5,
    color: '#1A1030',
  },
  empty: {
    marginTop: Spacing.five,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  emptyBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
    textAlign: 'center',
  },
  emptyBtn: {
    marginTop: Spacing.two,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: Colors.navEmber,
  },
  emptyBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: '#2A0F05',
  },
});
