import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoverCard, EmptyLine, ErrorLine, JoinButton, PersonRow, useAddFriend, useJoin } from '@/components/discover/kit';
import { PostTile } from '@/components/discover/post-tile';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import {
  fetchDiscoverRooms,
  joinClub,
  joinRoomFromCard,
  openCampfire,
  openClub,
  openRoom,
  searchAgoraPosts,
  searchPeopleByInterest,
  type DiscoverRoom,
} from '@/lib/api/discover';
import { fetchForests } from '@/lib/api/forests';
import { searchPeople } from '@/lib/api/friend-requests';
import type { AgoraItem } from '@/types/database';
import type { ForestSummary } from '@/types/social';

// SEARCH · ACTIVE + AUTO-DETECT (ShareSpot ss2, mock 349). One query, all four surfaces: typing
// "running" doesn't pick a category — it surfaces people with Running on their profile (and anyone
// named it), run clubs and rooms, and posts about running, grouped. The People / Rooms / Clubs /
// Posts chips narrow it. Opened from the board's bar (345) or with ?q= from a chip anywhere.
//
// Server: search_people (names), 0299's search_people_by_interest + search_agora_posts, get_forests
// (name + tags) for clubs, and 0297's get_discoverable_rooms for rooms. Each degrades to empty on a
// server that predates it; nothing is ranked by engagement.

type Filter = 'all' | 'people' | 'rooms' | 'clubs' | 'posts';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'people', label: 'People' },
  { key: 'rooms', label: 'Rooms' },
  { key: 'clubs', label: 'Clubs' },
  { key: 'posts', label: 'Posts' },
];

type Person = {
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  sub: string | null;
  is_friend: boolean;
};

type Results = { people: Person[]; rooms: DiscoverRoom[]; clubs: ForestSummary[]; posts: AgoraItem[] };

const EMPTY: Results = { people: [], rooms: [], clubs: [], posts: [] };

export default function SearchScreen() {
  const router = useRouter();
  const { q, filter: initialFilter } = useLocalSearchParams<{ q?: string; filter?: string }>();
  const [query, setQuery] = useState(() => (typeof q === 'string' ? q : ''));
  const [filter, setFilter] = useState<Filter>(() =>
    FILTERS.some((f) => f.key === initialFilter) ? (initialFilter as Filter) : 'all',
  );
  // Results remember the query they answer, so "loading" is derived rather than set in the effect.
  const [answered, setAnswered] = useState<{ key: string; results: Results }>({ key: '', results: EMPTY });
  const seq = useRef(0);
  const adds = useAddFriend();
  const joins = useJoin();

  const term = query.trim().replace(/^#/, '');

  useEffect(() => {
    if (term.length < 2) return;
    const mine = ++seq.current;
    // Debounced: one round per pause in typing. Only the newest round may land. Every surface is
    // fetched regardless of the chip, so flipping chips is instant and never refetches.
    const timer = setTimeout(() => {
      Promise.all([
        searchPeople(term, 12).catch(() => []),
        searchPeopleByInterest(term, 12).catch(() => []),
        fetchDiscoverRooms(term, 12).catch(() => []),
        fetchForests('active', term).catch(() => []),
        searchAgoraPosts(term, null, 12).catch(() => []),
      ]).then(([named, tagged, rooms, clubs, posts]) => {
        if (mine !== seq.current) return;
        // Tagged people lead (that's the auto-detect), then name matches not already shown.
        const people: Person[] = tagged.map((p) => ({
          user_id: p.user_id,
          display_name: p.display_name,
          handle: p.handle,
          avatar_url: p.avatar_url,
          sub: [p.patron_name, p.program_abbrev, `tagged ‘${p.matched_label}’`].filter(Boolean).join(' · '),
          is_friend: p.is_friend,
        }));
        const seen = new Set(people.map((p) => p.user_id));
        for (const p of named) {
          if (seen.has(p.user_id)) continue;
          people.push({
            user_id: p.user_id,
            display_name: p.display_name,
            handle: p.handle,
            avatar_url: p.avatar_url,
            sub: [p.handle ? `@${p.handle}` : null, p.university].filter(Boolean).join(' · ') || null,
            is_friend: p.relationship === 'friends',
          });
        }
        setAnswered({ key: term, results: { people, rooms, clubs: clubs.slice(0, 12), posts } });
      });
    }, 280);
    return () => clearTimeout(timer);
  }, [term]);

  const hasQuery = term.length >= 2;
  const loading = hasQuery && answered.key !== term;
  const r = hasQuery && !loading ? answered.results : EMPTY;
  const show = (f: Filter) => filter === 'all' || filter === f;
  const total =
    (show('people') ? r.people.length : 0) +
    (show('rooms') ? r.rooms.length : 0) +
    (show('clubs') ? r.clubs.length : 0) +
    (show('posts') ? r.posts.length : 0);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.top}>
        <View style={styles.bar}>
          <NavGlyph name="search" size={17} color={Colors.spaceDim} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search people, rooms, clubs, posts…"
            placeholderTextColor={Colors.spaceFaint}
            autoCorrect={false}
            autoCapitalize="none"
            autoFocus={!q}
            returnKeyType="search"
            accessibilityLabel="Search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={17} color={Colors.spaceFaint} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.navigate('/social'))}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close search">
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!hasQuery ? (
          <Text style={styles.hint}>Try a vibe — “running”, “anime”, “KP344”. We’ll look across people, rooms, clubs and posts at once.</Text>
        ) : null}
        {loading ? <ActivityIndicator color={Colors.navEmber} style={styles.loader} /> : null}

        {show('people') && r.people.length > 0 ? (
          <>
            <Text style={styles.section}>People</Text>
            {r.people.map((p) => (
              <PersonRow
                key={p.user_id}
                name={p.display_name}
                avatarUrl={p.avatar_url}
                sub={p.sub}
                isFriend={p.is_friend}
                addState={adds.state[p.user_id]}
                onAdd={() => adds.add(p.user_id)}
                onPress={() => openCampfire(router, { userId: p.user_id, handle: p.handle })}
              />
            ))}
            <ErrorLine message={adds.error} />
          </>
        ) : null}

        {(show('clubs') && r.clubs.length > 0) || (show('rooms') && r.rooms.length > 0) ? (
          <Text style={styles.section}>{filter === 'rooms' ? 'Rooms' : filter === 'clubs' ? 'Clubs' : 'Clubs & rooms'}</Text>
        ) : null}
        <View style={styles.cards}>
          {show('clubs')
            ? r.clubs.map((c) => (
                <CoverCard
                  key={c.id}
                  id={c.id}
                  emoji={c.emoji}
                  title={c.name}
                  tagline={c.purpose}
                  sub={`Club · ${c.member_count} ${c.member_count === 1 ? 'member' : 'members'}`}
                  online={c.locked_in_now}
                  onPress={() => openClub(router, c.id)}
                  action={
                    c.my_status === 'active' ? undefined : (
                      <JoinButton label={c.name} state={joins.state[c.id]} onPress={() => joins.run(c.id, () => joinClub(c.id))} />
                    )
                  }
                />
              ))
            : null}
          {show('rooms')
            ? r.rooms.map((room) => (
                <CoverCard
                  key={room.id}
                  id={room.id}
                  emoji={room.emoji}
                  title={room.name}
                  sub={`Room · ${room.member_count} ${room.member_count === 1 ? 'member' : 'members'}${room.course_code ? ` · ${room.course_code}` : ''}`}
                  online={room.online_count}
                  locked={room.join_policy === 'code'}
                  onPress={() => openRoom(router, room.id)}
                  action={
                    room.is_member ? undefined : (
                      <JoinButton
                        label={room.name}
                        state={joins.state[room.id]}
                        onPress={() => joins.run(room.id, () => joinRoomFromCard(router, room.id))}
                      />
                    )
                  }
                />
              ))
            : null}
        </View>
        <ErrorLine message={joins.error} />

        {show('posts') && r.posts.length > 0 ? (
          <>
            <Text style={styles.section}>Posts</Text>
            <View style={styles.cards}>
              {r.posts.map((p) => (
                <PostTile key={p.id} item={p} topic={term} wide />
              ))}
            </View>
          </>
        ) : null}

        {hasQuery && !loading && total === 0 ? <EmptyLine>Nothing for “{term}” yet.</EmptyLine> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  bar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 46,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.navEmber,
  },
  input: { flex: 1, fontFamily: Fonts.body, fontSize: 15, color: Colors.ink, paddingVertical: 0 },
  cancel: { fontFamily: Fonts.bodySemiBold, fontSize: 15, color: Colors.muted },
  chips: { gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.twelve },
  chip: {
    paddingHorizontal: Spacing.three,
    height: 34,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  chipOn: { backgroundColor: Colors.navEmber2, borderColor: Colors.navEmber2 },
  chipText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.muted },
  chipTextOn: { color: Colors.onEmber },
  body: { paddingHorizontal: Spacing.three, paddingBottom: 120 },
  section: { marginTop: Spacing.three, marginBottom: Spacing.two, fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.ink },
  cards: { gap: Spacing.twelve },
  hint: { marginTop: Spacing.three, fontFamily: Fonts.body, fontSize: 14, lineHeight: 20, color: Colors.spaceDim },
  loader: { marginTop: Spacing.four },
});
