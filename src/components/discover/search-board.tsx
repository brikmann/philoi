import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CoverCard,
  EmptyLine,
  ErrorLine,
  JoinButton,
  PersonTile,
  SectionHead,
  TopicTile,
  useAddFriend,
  useJoin,
} from '@/components/discover/kit';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { Icon } from '@/components/ui/icon';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import {
  fetchDiscoverRooms,
  fetchPeopleForYou,
  fetchTrendingTopics,
  joinClub,
  joinRoomFromCard,
  openCampfire,
  openClub,
  openRoom,
  topicTag,
  type DiscoverRoom,
  type PersonCard,
  type TrendingTopic,
} from '@/lib/api/discover';
import { fetchForests } from '@/lib/api/forests';
import { fetchSuggestedForests } from '@/lib/api/interests';

/**
 * SEARCH = THE DISCOVERY BOARD (ShareSpot ss2, mock 345). No query → trending in each category as
 * horizontal swipe rows: People like you, Rooms, Clubs, Posts by topic. Each header is the link to
 * its full browse page (354–357). Tapping the bar opens the active search (349, /search), which
 * auto-detects across all four. "Find who vibes with you" runs the matcher (383).
 *
 * Every row comes from a matcher or list that already exists (grind-alikes, suggested forests,
 * discoverable rooms) plus 0299's topic counts — nothing here is ranked by engagement.
 */

type Club = { id: string; name: string; emoji: string; tagline: string | null; why: string | null; online: number; mine: boolean };

export function SearchBoard({ onOpenFeed }: { onOpenFeed: () => void }) {
  const router = useRouter();
  const [people, setPeople] = useState<PersonCard[] | null>(null);
  const [rooms, setRooms] = useState<DiscoverRoom[] | null>(null);
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [topics, setTopics] = useState<TrendingTopic[] | null>(null);
  const adds = useAddFriend();
  const joins = useJoin();

  useEffect(() => {
    let live = true;
    fetchPeopleForYou(10).then((r) => live && setPeople(r.people));
    fetchDiscoverRooms(undefined, 10)
      .then((r) => live && setRooms(r.filter((x) => !x.is_member)))
      .catch(() => live && setRooms([]));
    fetchClubs().then((c) => live && setClubs(c));
    fetchTrendingTopics(8)
      .then((t) => live && setTopics(t))
      .catch(() => live && setTopics([]));
    return () => {
      live = false;
    };
  }, []);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <AppTopBar title="Search" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          style={styles.search}
          onPress={() => router.push('/search')}
          accessibilityRole="search"
          accessibilityLabel="Search people, rooms, clubs, posts">
          <NavGlyph name="search" size={16} color={Colors.spaceDim} />
          <Text style={styles.searchText}>Search people, rooms, clubs, posts…</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/discover/matchmaking' as never)}
          accessibilityRole="button"
          accessibilityLabel="Find who vibes with you"
          style={({ pressed }) => [pressed && styles.pressed]}>
          <LinearGradient colors={['#2A1B4A', '#3A2160']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.vibe}>
            <View style={styles.vibeIcon}>
              <Icon name="sparkle" size={18} color={Colors.gold} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.vibeTitle}>Find who vibes with you</Text>
              <Text style={styles.vibeSub}>one tap · matched on what you love</Text>
            </View>
            <Icon name="forward" size={16} color={Colors.navEmber2} />
          </LinearGradient>
        </Pressable>

        {/* People like you */}
        <SectionHead title="People like you" onSeeAll={() => router.push('/discover/people' as never)} />
        {people && people.length === 0 ? (
          <EmptyLine onPress={() => router.push('/discover/matchmaking' as never)}>No matches yet — find your people ›</EmptyLine>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swipe}>
            {(people ?? []).map((p) => (
              <PersonTile
                key={p.user_id}
                name={p.display_name}
                avatarUrl={p.avatar_url}
                sub={p.sub}
                live={p.live}
                isFriend={p.is_friend}
                addState={adds.state[p.user_id]}
                onAdd={() => adds.add(p.user_id)}
                onPress={() => openCampfire(router, { userId: p.user_id, handle: p.handle })}
              />
            ))}
          </ScrollView>
        )}
        <ErrorLine message={adds.error} />

        {/* Rooms */}
        <SectionHead title="Trending rooms" onSeeAll={() => router.push('/discover/rooms' as never)} />
        {rooms && rooms.length === 0 ? (
          <EmptyLine onPress={() => router.push('/discover/rooms' as never)}>No open rooms yet — start one ›</EmptyLine>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swipe}>
            {(rooms ?? []).map((r) => (
              <CoverCard
                key={r.id}
                id={r.id}
                width={220}
                emoji={r.emoji}
                title={r.name}
                sub={`${r.member_count} in`}
                online={r.online_count}
                locked={r.join_policy === 'code'}
                onPress={() => openRoom(router, r.id)}
                action={<JoinButton label={r.name} state={joins.state[r.id]} onPress={() => joins.run(r.id, () => joinRoomFromCard(router, r.id))} />}
              />
            ))}
          </ScrollView>
        )}

        {/* Clubs */}
        <SectionHead title="Clubs" onSeeAll={() => router.push('/discover/clubs' as never)} />
        {clubs && clubs.length === 0 ? (
          <EmptyLine onPress={() => router.push('/discover/clubs' as never)}>Browse every club ›</EmptyLine>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swipe}>
            {(clubs ?? []).map((c) => (
              <CoverCard
                key={c.id}
                id={c.id}
                width={220}
                emoji={c.emoji}
                title={c.name}
                sub={c.why}
                tagline={c.tagline}
                online={c.online}
                onPress={() => openClub(router, c.id)}
                action={
                  c.mine ? undefined : (
                    <JoinButton label={c.name} state={joins.state[c.id]} onPress={() => joins.run(c.id, () => joinClub(c.id))} />
                  )
                }
              />
            ))}
          </ScrollView>
        )}
        <ErrorLine message={joins.error} />

        {/* Posts by topic */}
        <SectionHead title="Posts by topic" onSeeAll={() => router.push('/discover/posts' as never)} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swipe}>
          {(topics ?? []).map((t) => (
            <TopicTile
              key={t.key}
              tag={topicTag(t.label)}
              count={t.post_count}
              onPress={() => router.push({ pathname: '/discover/posts', params: { topic: t.label } } as never)}
            />
          ))}
        </ScrollView>

        <Pressable onPress={onOpenFeed} style={styles.square} accessibilityRole="button" accessibilityLabel="Open the square">
          <Text style={styles.squareText}>Everything, newest first — open the square ›</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const POPULAR_MEMBERS = 25;

/** Interest-matched forests first (with their "matches X"), padded with the most popular. */
async function fetchClubs(): Promise<Club[]> {
  const [suggested, popular] = await Promise.all([
    fetchSuggestedForests(8).catch(() => []),
    fetchForests('popular').catch(() => []),
  ]);
  const out: Club[] = suggested.map((f) => ({
    id: f.id,
    name: f.name,
    emoji: f.emoji,
    tagline: f.purpose,
    why: f.because ? `matches ${f.because}` : f.member_count >= POPULAR_MEMBERS ? '★ Popular' : null,
    online: f.locked_in_now,
    mine: false,
  }));
  const seen = new Set(out.map((c) => c.id));
  for (const f of popular) {
    if (out.length >= 10) break;
    if (seen.has(f.id)) continue;
    out.push({
      id: f.id,
      name: f.name,
      emoji: f.emoji,
      tagline: f.purpose,
      why: f.member_count >= POPULAR_MEMBERS ? `★ Popular · ${f.member_count} members` : `${f.member_count} members`,
      online: f.locked_in_now,
      mine: f.my_status === 'active',
    });
  }
  return out;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.8 },
  content: { paddingHorizontal: Spacing.three, paddingBottom: 120 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 46,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    marginTop: Spacing.two,
  },
  searchText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.spaceFaint },
  vibe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    marginTop: Spacing.twelve,
    padding: Spacing.three,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#4A3478',
  },
  vibeIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,209,102,0.12)',
  },
  vibeTitle: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.ink },
  vibeSub: { marginTop: 2, fontFamily: Fonts.body, fontSize: 13, color: Colors.muted },
  swipe: { gap: Spacing.twelve, paddingRight: Spacing.three },
  square: { marginTop: Spacing.five, alignItems: 'center', paddingVertical: Spacing.twelve },
  squareText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.spaceDim },
});
