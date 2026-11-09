import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchChatLiveNow } from '@/lib/api/chat';
import { fetchMyFriends, type Friend } from '@/lib/api/friends';
import { getErrorMessage } from '@/lib/errors';

// FRIENDS (ShareSpot mock 370). Name + status + active dot. ONE primary action per row (Message),
// the row itself opens their Campfire. No rank, no "going cold" — a friend's quiet week is not
// something to shame either of you about.

const DAY = 86_400_000;

function activeLine(f: Friend, liveNow: boolean): { text: string; active: boolean } {
  if (liveNow) return { text: 'active', active: true };
  if (!f.last_lockin_at) return { text: '', active: false };
  const d = Math.floor((Date.now() - new Date(f.last_lockin_at).getTime()) / DAY);
  return { text: d < 1 ? 'today' : `${d}d`, active: false };
}

export default function FriendsScreen() {
  const router = useRouter();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [live, setLive] = useState<Map<string, number>>(new Map());
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [f, l] = await Promise.all([fetchMyFriends(), fetchChatLiveNow().catch(() => new Map<string, number>())]);
      setFriends(f.sort((a, b) => a.display_name.localeCompare(b.display_name)));
      setLive(l);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your friends.'));
      setFriends((prev) => prev ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (friends ?? []).filter((f) => !q || f.display_name.toLowerCase().includes(q));
  }, [friends, query]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Friends</Text>
        <Pressable onPress={() => router.push('/invite')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Invite friends">
          <Text style={styles.invite}>＋</Text>
        </Pressable>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search friends…"
        placeholderTextColor={Colors.spaceDim}
        style={styles.search}
        accessibilityLabel="Search friends"
      />
      {friends === null ? (
        <ActivityIndicator color={Colors.navEmber} style={{ marginTop: Spacing.five }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(f) => f.friend_id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={friends.length ? <Text style={styles.count}>{friends.length} friends</Text> : null}
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
              <Text style={styles.emptyTitle}>{error ?? (query ? 'No one by that name' : 'No friends yet')}</Text>
              {!query ? (
                <Pressable style={styles.emptyBtn} onPress={() => router.push('/invite')} accessibilityRole="button">
                  <Text style={styles.emptyBtnText}>Invite friends</Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item: f }) => {
            const a = activeLine(f, (live.get(`dm:${f.friend_id}`) ?? 0) > 0);
            return (
              <Pressable
                style={styles.row}
                onPress={() => router.push({ pathname: '/friend-profile', params: { userId: f.friend_id } })}
                accessibilityRole="button"
                accessibilityLabel={`${f.display_name}'s Campfire`}>
                <View>
                  {f.avatar_url ? (
                    <Image source={{ uri: f.avatar_url }} style={styles.avatar} />
                  ) : (
                    <Avatar label={(f.display_name || '?').slice(0, 2).toUpperCase()} size={44} />
                  )}
                  {a.active ? <View style={styles.dot} /> : null}
                </View>
                <View style={styles.text}>
                  <Text style={styles.name} numberOfLines={1}>
                    {f.display_name}
                  </Text>
                  {f.shared_circle_name ? (
                    <Text style={styles.sub} numberOfLines={1}>
                      {f.shared_circle_name}
                    </Text>
                  ) : null}
                </View>
                {a.text ? <Text style={[styles.when, a.active && styles.whenActive]}>{a.text}</Text> : null}
                <Pressable
                  style={styles.msg}
                  onPress={() => router.push({ pathname: '/dm/[friendId]', params: { friendId: f.friend_id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${f.display_name}`}>
                  <Text style={styles.msgText}>Message</Text>
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: 10 },
  back: { fontSize: 28, color: Colors.ink, marginTop: -4 },
  title: { fontFamily: Fonts.bodyBold, fontSize: 17, color: Colors.ink },
  invite: { fontSize: 22, color: Colors.navEmber2 },
  search: {
    marginHorizontal: Spacing.three,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  list: { paddingHorizontal: Spacing.three, paddingBottom: 120, gap: 6 },
  count: { fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.spaceDim, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  dot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#39D98A',
    borderWidth: 2,
    borderColor: Colors.spacePanel,
  },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: Fonts.bodyBold, fontSize: 14.5, color: Colors.ink },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.spaceDim },
  when: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.spaceDim },
  whenActive: { color: '#39D98A', fontFamily: Fonts.bodySemiBold },
  msg: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: Colors.spacePanel2, borderWidth: 1, borderColor: Colors.spaceLine },
  msgText: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.ink },
  empty: { marginTop: Spacing.five, alignItems: 'center', gap: 10 },
  emptyTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  emptyBtn: { paddingVertical: 9, paddingHorizontal: 18, borderRadius: 999, backgroundColor: Colors.navEmber },
  emptyBtnText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.onEmber },
});
