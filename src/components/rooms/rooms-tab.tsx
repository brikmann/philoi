import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { roomGradient } from '@/components/rooms/room-art';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { chatLiveKey, fetchChatLiveNow, fetchMyChats } from '@/lib/api/chat';
import { fetchDiscoverableGroups } from '@/lib/api/groups';
import { joinRoom, joinRoomMessage } from '@/lib/api/rooms';
import type { SocialChat } from '@/lib/api/social-chats';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import type { DiscoverableGroup } from '@/types/database';

// HOME → ROOMS (ShareSpot mock 374). Where group chats live — DMs stay in Messages. Cover-art cards:
// gradient banner + crest + last message + live count. "Your rooms" from get_my_chats (0284),
// campfires and forests both (a forest is a Room to the user; the schema keeps them apart);
// "Discover rooms" from get_discoverable_groups. Joining goes through join_room (0297), so an open
// room joins in one tap and a code room routes to the gate.

type RoomChat = Extract<SocialChat, { kind: 'campfire' | 'forest' }>;

export function RoomsTab() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [rooms, setRooms] = useState<RoomChat[] | null>(null);
  const [live, setLive] = useState<Map<string, number>>(new Map());
  const [discover, setDiscover] = useState<DiscoverableGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setError(null);
      const [chats, liveNow, disc] = await Promise.all([
        fetchMyChats(userId),
        fetchChatLiveNow().catch(() => new Map<string, number>()),
        fetchDiscoverableGroups(undefined, undefined, 8).catch(() => [] as DiscoverableGroup[]),
      ]);
      const mine = (chats ?? []).filter((c): c is RoomChat => c.kind === 'campfire' || c.kind === 'forest');
      setRooms(mine);
      setLive(liveNow);
      const mineIds = new Set(mine.map((r) => r.id));
      setDiscover(disc.filter((d) => !mineIds.has(d.id)));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your rooms.'));
      setRooms((prev) => prev ?? []);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const open = (r: RoomChat) => {
    if (r.kind === 'forest') router.push({ pathname: '/forest/[id]', params: { id: r.id } });
    else router.push({ pathname: '/room/[id]', params: { id: r.id } });
  };

  const join = async (g: DiscoverableGroup) => {
    setJoining(g.id);
    try {
      const res = await joinRoom(g.id);
      if (res.status === 'joined' || res.status === 'already_member') {
        router.push({ pathname: '/room/[id]', params: { id: g.id } });
        void load();
      } else if (res.status === 'needs_code') {
        router.push({ pathname: '/room/[id]/code', params: { id: g.id } });
      } else {
        const msg = joinRoomMessage(res);
        if (msg) Alert.alert(g.name, msg);
        void load();
      }
    } catch (e) {
      Alert.alert(g.name, getErrorMessage(e, 'Could not join that room.'));
    } finally {
      setJoining(null);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
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
      }>
      <View style={styles.headRow}>
        <Text style={styles.h}>Your rooms</Text>
        <Pressable onPress={() => router.push('/group/create')} hitSlop={8} accessibilityRole="button">
          <Text style={styles.headAction}>＋ New room</Text>
        </Pressable>
      </View>

      {rooms === null ? (
        <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
      ) : rooms.length === 0 ? (
        <Text style={styles.emptyLine}>{error ?? "You're not in any rooms yet. Join one below, or start one for your crew."}</Text>
      ) : (
        rooms.map((r) => {
          const n = live.get(chatLiveKey(r)) ?? 0;
          return (
            <Pressable key={`${r.kind}:${r.id}`} style={styles.card} onPress={() => open(r)} accessibilityRole="button">
              <LinearGradient colors={roomGradient(r.id)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
                {n > 0 ? (
                  <View style={styles.livePill}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>{n} online</Text>
                  </View>
                ) : null}
              </LinearGradient>
              <View style={styles.cardRow}>
                <View style={styles.crest}>
                  <Text style={styles.crestText}>{r.emoji || '🔥'}</Text>
                </View>
                <View style={styles.cardText}>
                  <Text style={styles.roomName} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={[styles.last, (r.unread ?? 0) > 0 && styles.lastUnread]} numberOfLines={1}>
                    {r.lastLine ?? 'Say hi to the room'}
                  </Text>
                </View>
                {(r.unread ?? 0) > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{(r.unread ?? 0) > 9 ? '9+' : r.unread} new</Text>
                  </View>
                ) : (
                  <Text style={styles.chev}>›</Text>
                )}
              </View>
            </Pressable>
          );
        })
      )}

      {discover.length > 0 ? (
        <>
          <Text style={[styles.h, styles.hGap]}>Discover rooms</Text>
          {discover.map((g) => (
            <View key={g.id} style={styles.discRow}>
              <View style={styles.crest}>
                <Text style={styles.crestText}>{g.emoji || '🔥'}</Text>
              </View>
              <View style={styles.cardText}>
                <Text style={styles.roomName} numberOfLines={1}>
                  {g.name}
                </Text>
                <Text style={styles.last} numberOfLines={1}>
                  {[g.course_code, g.school ?? g.owner_university, `${g.member_count} members`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Pressable
                style={styles.joinBtn}
                onPress={() => void join(g)}
                disabled={joining === g.id || g.has_pending_request}
                accessibilityRole="button"
                accessibilityLabel={`Join ${g.name}`}>
                {joining === g.id ? (
                  <ActivityIndicator size="small" color={Colors.onEmber} />
                ) : (
                  <Text style={styles.joinText}>{g.has_pending_request ? 'Requested' : g.privacy === 'gated' ? 'Ask' : 'Join'}</Text>
                )}
              </Pressable>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: 120, gap: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  hGap: { marginTop: Spacing.three },
  headAction: { fontFamily: Fonts.bodyBold, fontSize: 12.5, color: Colors.navEmber2 },
  loader: { marginTop: Spacing.four },
  emptyLine: { fontFamily: Fonts.body, fontSize: 13, color: Colors.spaceDim },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  banner: { height: 58, alignItems: 'flex-end', padding: 8 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Colors.scrimDeep,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#39D98A' },
  liveText: { fontFamily: Fonts.bodyBold, fontSize: 10.5, color: Colors.ink },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 12, marginTop: -16 },
  crest: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 2,
    borderColor: Colors.spacePanel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crestText: { fontSize: 20 },
  cardText: { flex: 1, gap: 2, paddingTop: 14 },
  roomName: { fontFamily: Fonts.bodyBold, fontSize: 14.5, color: Colors.ink },
  last: { fontFamily: Fonts.body, fontSize: 12, color: Colors.spaceDim },
  lastUnread: { color: Colors.ink },
  badge: { marginTop: 14, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: Colors.navEmber },
  badgeText: { fontFamily: Fonts.black, fontSize: 10, color: Colors.onEmber },
  chev: { marginTop: 14, fontSize: 20, color: Colors.spaceDim },
  discRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  joinBtn: { minWidth: 64, alignItems: 'center', paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: Colors.navEmber },
  joinText: { fontFamily: Fonts.bodyBold, fontSize: 12.5, color: Colors.onEmber },
});
