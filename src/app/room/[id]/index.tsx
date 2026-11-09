import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { feedCardImage } from '@/components/home/home-feed';
import { RoomMembers } from '@/components/rooms/room-members';
import { roomGradient } from '@/components/rooms/room-art';
import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchRoomWeek, type RoomWeek } from '@/lib/api/club';
import { fetchCampfireFeed } from '@/lib/api/feed-channels';
import { formatPeopleHours } from '@/lib/api/home';
import { fetchRoomGate, joinRoom, joinRoomMessage, roomTimeAgo, RoomsNotLiveError, type RoomGate } from '@/lib/api/rooms';
import { getErrorMessage } from '@/lib/errors';
import type { AgoraItem } from '@/types/database';

// ROOM DETAIL (ShareSpot mock 375). A Room is a `groups` row. Cover-banner header + crest, the
// collective ("12 hrs together this week", get_group_week_hours 0292), "Leaderboard off" when the
// room hasn't switched standings on, the role line ("Code-gated · owned by Jordan · mods: Maya,
// Dev", get_room_gate 0297), then Feed / Chat / Members / Events.
//   · Feed    — the room's posts (get_campfire_feed, agora_posts.campfire_id) + "Share something…".
//   · Chat    — the Discord-style room chat (/room/[id]/chat, mock 380).
//   · Members — roster; owner/mods manage roles and removal inline.
//   · Events  — the room's #events channel.
// A non-member of a code room never sees this screen: it bounces to the gate (mock 384).
// On a server without 0297 it falls back to the legacy campfire screen, so this can ship first.

type Tab = 'feed' | 'chat' | 'members' | 'events';

export default function RoomDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [gate, setGate] = useState<RoomGate | null | undefined>(undefined);
  const [week, setWeek] = useState<RoomWeek | null>(null);
  const [posts, setPosts] = useState<AgoraItem[] | null>(null);
  const [tab, setTab] = useState<Tab>('feed');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const g = await fetchRoomGate(id);
      if (g && !g.is_member && g.room.join_policy === 'code') {
        router.replace({ pathname: '/room/[id]/code', params: { id } });
        return;
      }
      setGate(g);
      if (g) {
        fetchRoomWeek('campfire', id)
          .then(setWeek)
          .catch(() => setWeek(null));
        if (g.is_member || g.room.privacy === 'open') {
          fetchCampfireFeed(id, null, 30)
            .then(setPosts)
            .catch(() => setPosts([]));
        } else setPosts([]);
      }
    } catch (e) {
      if (e instanceof RoomsNotLiveError) {
        router.replace({ pathname: '/group/[groupId]', params: { groupId: id } });
        return;
      }
      setError(getErrorMessage(e, 'Could not open this room.'));
      setGate((prev) => prev ?? null);
    }
  }, [id, router]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onJoin = async () => {
    if (!gate) return;
    setJoining(true);
    try {
      const res = await joinRoom(gate.room.id);
      if (res.status === 'needs_code') router.replace({ pathname: '/room/[id]/code', params: { id: gate.room.id } });
      else if (res.status === 'joined' || res.status === 'already_member') void load();
      else {
        const msg = joinRoomMessage(res);
        if (msg) Alert.alert(gate.room.name, msg);
        void load();
      }
    } catch (e) {
      Alert.alert(gate.room.name, getErrorMessage(e, 'Could not join.'));
    } finally {
      setJoining(false);
    }
  };

  if (gate === undefined) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={Colors.navEmber} style={{ marginTop: Spacing.six }} />
      </SafeAreaView>
    );
  }
  if (gate === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <BackButton />
        <Text style={styles.missing}>{error ?? "This room doesn't exist, or it's invite-only."}</Text>
      </SafeAreaView>
    );
  }

  const r = gate.room;
  const isAdmin = gate.my_role === 'owner' || gate.my_role === 'moderator';
  const roleLine = [
    r.join_policy === 'code' ? 'Code-gated' : r.privacy === 'gated' ? 'Ask to join' : 'Open',
    gate.owner?.display_name ? `owned by ${gate.owner.display_name}` : null,
    gate.moderators.length ? `mods: ${gate.moderators.map((m) => m.display_name ?? 'someone').join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const openChat = (channel?: string) =>
    router.push({ pathname: '/room/[id]/chat', params: channel ? { id: r.id, channel } : { id: r.id } });

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} stickyHeaderIndices={[1]}>
        <View>
          <LinearGradient colors={roomGradient(r.id)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
            <SafeAreaView edges={['top']} style={styles.bannerBar}>
              <BackButton />
              {isAdmin ? (
                <Pressable
                  onPress={() => router.push({ pathname: '/room/[id]/manage', params: { id: r.id } })}
                  style={styles.chrome}
                  accessibilityRole="button"
                  accessibilityLabel="Manage room">
                  <Text style={styles.chromeText}>⚙</Text>
                </Pressable>
              ) : null}
            </SafeAreaView>
          </LinearGradient>
          <View style={styles.head}>
            <View style={styles.crest}>
              <Text style={styles.crestText}>{r.emoji || '🔥'}</Text>
            </View>
            <View style={styles.headText}>
              <Text style={styles.name}>{r.name}</Text>
              <Text style={styles.meta}>
                {[`${r.member_count} members`, r.course_code, r.school].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {gate.is_member ? (
              <View style={styles.joined}>
                <Text style={styles.joinedText}>Joined ✓</Text>
              </View>
            ) : (
              <Pressable style={styles.joinBtn} onPress={() => void onJoin()} disabled={joining || gate.has_pending_request}>
                {joining ? (
                  <ActivityIndicator size="small" color={Colors.onEmber} />
                ) : (
                  <Text style={styles.joinText}>{gate.has_pending_request ? 'Requested' : r.privacy === 'gated' ? 'Ask to join' : 'Join'}</Text>
                )}
              </Pressable>
            )}
          </View>
          <Text style={styles.roleLine}>{roleLine}</Text>

          <View style={styles.statRow}>
            {week?.thisWeekSeconds ? (
              <View style={styles.stat}>
                <Text style={styles.statBig}>🔥 {formatPeopleHours(week.thisWeekSeconds)}</Text>
                <Text style={styles.statSub}>together this week</Text>
              </View>
            ) : null}
            {!r.standings_enabled ? (
              <View style={styles.offPill}>
                <Text style={styles.offText}>Leaderboard off</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.tabs}>
          {(['feed', 'chat', 'members', 'events'] as Tab[]).map((t) => (
            <Pressable
              key={t}
              style={styles.tab}
              onPress={() => {
                if (!gate.is_member && t !== 'feed') return;
                if (t === 'chat') openChat();
                else setTab(t);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t, disabled: !gate.is_member && t !== 'feed' }}>
              <Text style={[styles.tabText, tab === t && styles.tabOn, !gate.is_member && t !== 'feed' && styles.tabOff]}>
                {t[0].toUpperCase() + t.slice(1)}
              </Text>
              {tab === t ? <View style={styles.underline} /> : null}
            </Pressable>
          ))}
        </View>

        {tab === 'feed' ? (
          <View style={styles.body}>
            {gate.is_member ? (
              <Pressable
                style={styles.composer}
                onPress={() => router.push({ pathname: '/agora/compose', params: { campfireId: r.id, campfireName: r.name } })}
                accessibilityRole="button">
                <Text style={styles.composerText}>Share something…</Text>
              </Pressable>
            ) : null}
            {posts === null ? (
              <ActivityIndicator color={Colors.navEmber} />
            ) : posts.length === 0 ? (
              <Text style={styles.empty}>{gate.is_member ? 'No posts yet. Be the first.' : 'Join to see what this room is sharing.'}</Text>
            ) : (
              posts.map((p) => <RoomPost key={`${p.item_type}:${p.id}`} item={p} />)
            )}
          </View>
        ) : tab === 'members' ? (
          <RoomMembers roomId={r.id} myRole={gate.my_role} onChanged={() => void load()} />
        ) : tab === 'events' ? (
          <View style={styles.body}>
            {r.channels.includes('events') ? (
              <Pressable style={styles.composer} onPress={() => openChat('events')} accessibilityRole="button">
                <Text style={styles.composerText}>Open # events</Text>
              </Pressable>
            ) : (
              <Text style={styles.empty}>
                {isAdmin ? 'Add an # events channel in Manage room to plan meetups here.' : 'No events channel in this room yet.'}
              </Text>
            )}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function RoomPost({ item }: { item: AgoraItem }) {
  const router = useRouter();
  const img = feedCardImage(item);
  return (
    <Pressable
      style={styles.post}
      onPress={() => router.push({ pathname: '/agora/[id]', params: { id: item.id, type: item.item_type } })}
      accessibilityRole="button">
      <View style={styles.postHead}>
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={styles.postAvatar} />
        ) : (
          <Avatar label={(item.display_name || '?').slice(0, 2).toUpperCase()} size={28} />
        )}
        <Text style={styles.postName}>{item.display_name}</Text>
        <Text style={styles.postTime}>{roomTimeAgo(item.created_at)}</Text>
      </View>
      {item.body ? <Text style={styles.postBody}>{item.body}</Text> : null}
      {img ? <Image source={{ uri: img }} style={styles.postImg} contentFit="cover" /> : null}
      <Text style={styles.postMeta}>💬 {item.comments}</Text>
    </Pressable>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.back()} style={styles.chrome} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
      <Text style={styles.chromeText}>‹</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  scroll: { paddingBottom: 120 },
  banner: { height: 140 },
  bannerBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingTop: 6 },
  chrome: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.scrimDeep,
    alignItems: 'center',
    justifyContent: 'center',
    margin: Spacing.three,
  },
  chromeText: { fontSize: 20, color: Colors.ink, marginTop: -2 },
  missing: { margin: Spacing.four, fontFamily: Fonts.body, fontSize: 14, color: Colors.muted, textAlign: 'center' },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: Spacing.three, marginTop: -28 },
  crest: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 3,
    borderColor: Colors.spaceBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crestText: { fontSize: 30 },
  headText: { flex: 1, paddingBottom: 2 },
  name: { fontFamily: Fonts.black, fontSize: 21, color: Colors.ink },
  meta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.spaceDim },
  joined: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: Colors.spaceLine },
  joinedText: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.muted },
  joinBtn: { minWidth: 72, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: Colors.navEmber },
  joinText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.onEmber },
  roleLine: { paddingHorizontal: Spacing.three, marginTop: 10, fontFamily: Fonts.bodySemiBold, fontSize: 12, color: Colors.muted },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.three, marginTop: 12 },
  stat: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  statBig: { fontFamily: Fonts.black, fontSize: 18, color: Colors.gold },
  statSub: { fontFamily: Fonts.body, fontSize: 11.5, color: Colors.spaceDim },
  offPill: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: Colors.spacePanel2 },
  offText: { fontFamily: Fonts.bodySemiBold, fontSize: 11, color: Colors.spaceDim },
  tabs: {
    flexDirection: 'row',
    gap: 22,
    paddingHorizontal: Spacing.three,
    paddingTop: 14,
    paddingBottom: 8,
    backgroundColor: Colors.spaceBg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.spaceLine,
  },
  tab: { alignItems: 'center' },
  tabText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.spaceDim },
  tabOn: { fontFamily: Fonts.bodyBold, color: Colors.ink },
  tabOff: { opacity: 0.4 },
  underline: { marginTop: 4, height: 3, width: 20, borderRadius: 2, backgroundColor: Colors.navEmber },
  body: { padding: Spacing.three, gap: 10 },
  composer: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  composerText: { fontFamily: Fonts.body, fontSize: 13.5, color: Colors.spaceDim },
  empty: { fontFamily: Fonts.body, fontSize: 13, color: Colors.spaceDim, textAlign: 'center', marginTop: Spacing.three },
  post: { padding: 12, gap: 8, borderRadius: 16, backgroundColor: Colors.spacePanel, borderWidth: 1, borderColor: Colors.spaceLine },
  postHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  postAvatar: { width: 28, height: 28, borderRadius: 14 },
  postName: { flex: 1, fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.ink },
  postTime: { fontFamily: Fonts.body, fontSize: 11, color: Colors.spaceDim },
  postBody: { fontFamily: Fonts.body, fontSize: 13.5, lineHeight: 19, color: Colors.ink },
  postImg: { width: '100%', aspectRatio: 1.2, borderRadius: 12, backgroundColor: Colors.spacePanel2 },
  postMeta: { fontFamily: Fonts.bodySemiBold, fontSize: 11.5, color: Colors.spaceDim },
});
