import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoverCard, EmptyLine, ErrorLine, JoinButton, SectionHead, useJoin } from '@/components/discover/kit';
import { Icon } from '@/components/ui/icon';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { SpaceHeader } from '@/components/ui/space-kit';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchDiscoverRooms, joinRoomFromCard, openRoom, type DiscoverRoom } from '@/lib/api/discover';
import { fetchMyGroups } from '@/lib/api/groups';
import { useAuth } from '@/lib/auth/auth-context';

// ROOMS BROWSE (ShareSpot ss2, mock 355) — cover-art cards, live-online counts, Your rooms +
// Discover. Group messaging lives in Rooms, not Messages. Rooms themselves (detail, chat, the code
// gate) are ss1's; this is the discovery surface. A code-gated room shows a lock and its Join routes
// to ss1's gate screen (384), which lists the owner and mods to message for the code.

type Mine = { id: string; name: string; emoji: string; sub: string; online: number };

export default function RoomsBrowse() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [found, setFound] = useState<{ q: string; rows: DiscoverRoom[] } | null>(null);
  const joins = useJoin();
  const q = query.trim();

  // Your rooms: every membership (private ones included), with live counts from the discover list.
  useEffect(() => {
    if (!userId) return;
    let live = true;
    Promise.all([fetchMyGroups(userId), fetchDiscoverRooms(undefined, 100).catch(() => [])])
      .then(([groups, listed]) => {
        if (!live) return;
        const online = new Map(listed.map((r) => [r.id, r.online_count]));
        setMine(
          groups.map((g) => ({
            id: g.id,
            name: g.name,
            emoji: g.emoji,
            sub: [g.course_code, g.role === 'owner' ? 'you own it' : g.role === 'admin' ? 'moderator' : null].filter(Boolean).join(' · ') || 'Room',
            online: online.get(g.id) ?? 0,
          })),
        );
      })
      .catch(() => live && setMine([]));
    return () => {
      live = false;
    };
  }, [userId]);

  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () => {
        fetchDiscoverRooms(q || undefined, 40)
          .then((rows) => live && setFound({ q, rows: rows.filter((r) => !r.is_member) }))
          .catch(() => live && setFound({ q, rows: [] }));
      },
      q ? 280 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const discover = found && found.q === q ? found.rows : null;
  const mineShown = (mine ?? []).filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <SpaceHeader
        title="Rooms"
        right={
          <Pressable
            onPress={() => router.push('/group/create')}
            style={styles.newBtn}
            accessibilityRole="button"
            accessibilityLabel="New room">
            <Icon name="plus" size={13} color={Colors.onEmber} />
            <Text style={styles.newText}>New</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.search}>
          <NavGlyph name="search" size={15} color={Colors.spaceDim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search rooms, courses…"
            placeholderTextColor={Colors.spaceFaint}
            style={styles.input}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search rooms"
          />
        </View>

        {mineShown.length > 0 ? <SectionHead title="Your rooms" /> : null}
        <View style={styles.cards}>
          {mineShown.map((m) => (
            <CoverCard key={m.id} id={m.id} emoji={m.emoji} title={m.name} sub={m.sub} online={m.online} onPress={() => openRoom(router, m.id)} />
          ))}
        </View>

        <SectionHead title="Discover" />
        {!discover ? <ActivityIndicator color={Colors.navEmber} style={styles.loader} /> : null}
        <View style={styles.cards}>
          {(discover ?? []).map((r) => (
            <CoverCard
              key={r.id}
              id={r.id}
              emoji={r.emoji}
              title={r.name}
              sub={[`${r.member_count} ${r.member_count === 1 ? 'member' : 'members'}`, r.course_code, r.join_policy === 'code' ? 'code to join' : null]
                .filter(Boolean)
                .join(' · ')}
              online={r.online_count}
              locked={r.join_policy === 'code'}
              onPress={() => openRoom(router, r.id)}
              action={<JoinButton label={r.name} state={joins.state[r.id]} onPress={() => joins.run(r.id, () => joinRoomFromCard(router, r.id))} />}
            />
          ))}
        </View>
        {discover && discover.length === 0 ? (
          <EmptyLine onPress={() => router.push('/group/create')}>{q ? `No rooms match “${q}” — start one ›` : 'No open rooms yet — start one ›'}</EmptyLine>
        ) : null}
        <ErrorLine message={joins.error} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  body: { paddingHorizontal: Spacing.three, paddingBottom: 120 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  input: { flex: 1, fontFamily: Fonts.body, fontSize: 15, color: Colors.ink, paddingVertical: 0 },
  cards: { gap: Spacing.twelve },
  loader: { marginTop: Spacing.three },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    paddingHorizontal: Spacing.twelve,
    borderRadius: Radius.pill,
    backgroundColor: Colors.navEmber2,
  },
  newText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.onEmber },
});
