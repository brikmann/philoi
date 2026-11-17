import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoverCard, EmptyLine, ErrorLine, JoinButton, PersonRow, SectionHead, useAddFriend, useJoin } from '@/components/discover/kit';
import { FirstRunSpine } from '@/components/tutorial/first-run-spine';
import { PrimaryButton } from '@/components/ui/primary-button';
import { GYM_SPARK } from '@/constants/feature-flags';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import {
  fetchDiscoverRooms,
  fetchPeopleForYou,
  joinClub,
  joinRoomFromCard,
  type DiscoverRoom,
  type PersonCard,
} from '@/lib/api/discover';
import { fetchSuggestedForests, type SuggestedForest } from '@/lib/api/interests';
import { useAuth } from '@/lib/auth/auth-context';
import { clearInterestsPending } from '@/lib/interests-flow';

// YOUR PEOPLE (ShareSpot ss2, mock 379 — onboarding 4/4). "Here's your crew." The matcher's people
// and the rooms/clubs that fit what you picked, each with its own Add / Join. Every add is the
// person's own tap — a friend request is never pre-picked — and each one seeds the first feed, so
// Home isn't empty on day one. "Enter philoi" and "Skip" both end first run.
//
// GYM SPARK: setup is two pages now, so this reveal carries no step counter (it isn't a setup step),
// and the rooms/clubs half is left out — clubs, Discover and rooms are hidden surfaces in the spark
// (the gym room is joined server side). Matching is automatic, which the sub line says.

export default function YourPeople() {
  const router = useRouter();
  const { profile } = useAuth();
  const [people, setPeople] = useState<PersonCard[] | null>(null);
  const [clubs, setClubs] = useState<SuggestedForest[] | null>(null);
  const [rooms, setRooms] = useState<DiscoverRoom[]>([]);
  const [leaving, setLeaving] = useState(false);
  const adds = useAddFriend();
  const joins = useJoin();

  useEffect(() => {
    let live = true;
    fetchPeopleForYou(6).then((r) => {
      if (live) setPeople(r.people.filter((p) => !p.is_friend));
    });
    if (GYM_SPARK) {
      return () => {
        live = false;
      };
    }
    fetchSuggestedForests(4)
      .then((r) => live && setClubs(r))
      .catch(() => live && setClubs([]));
    // A course room for your school leads ("KP344 · your program"), then the busiest open rooms.
    fetchDiscoverRooms(undefined, 20)
      .then((r) => {
        if (!live) return;
        const open = r.filter((x) => !x.is_member && x.join_policy === 'open');
        const mine = profile?.university ? open.filter((x) => x.school === profile.university) : [];
        setRooms([...mine, ...open.filter((x) => !mine.includes(x))].slice(0, 2));
      })
      .catch(() => live && setRooms([]));
    return () => {
      live = false;
    };
  }, [profile?.university]);

  const enter = async () => {
    setLeaving(true);
    await clearInterestsPending(profile?.id ?? null).catch(() => {});
    router.replace('/');
  };

  const added = Object.values(adds.state).filter((s) => s === 'sent').length;
  const joined = Object.values(joins.state).filter((s) => s === 'joined' || s === 'requested').length;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      {!GYM_SPARK ? (
        <View style={styles.spine}>
          <FirstRunSpine total={4} filled={4} label="SETUP · 4 of 4" />
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h}>Your people</Text>
        <Text style={styles.sub}>Here&apos;s your crew, matched on what you love. Add a few — it&apos;s how Philoi comes alive.</Text>
        {GYM_SPARK ? <Text style={styles.note}>You&apos;re matchable by default; turn it off in Settings.</Text> : null}

        <SectionHead title="People like you" />
        {!people ? <ActivityIndicator color={Colors.navEmber} /> : null}
        {people && people.length === 0 ? (
          <EmptyLine>
            {GYM_SPARK ? 'No one lines up yet — you’re early.' : 'No one lines up yet — you’re early. Rooms below are open now.'}
          </EmptyLine>
        ) : null}
        {(people ?? []).map((p) => (
          <PersonRow
            key={p.user_id}
            name={p.display_name}
            avatarUrl={p.avatar_url}
            sub={p.sub}
            live={p.live}
            addState={adds.state[p.user_id]}
            onAdd={() => adds.add(p.user_id)}
            // First run stays on rails: tapping a face adds, it doesn't wander off to a profile.
            onPress={() => !adds.state[p.user_id] && adds.add(p.user_id)}
          />
        ))}
        <ErrorLine message={adds.error} />

        {!GYM_SPARK ? (
          <>
            <SectionHead title="Rooms for you" />
            <View style={styles.cards}>
              {(clubs ?? []).map((c) => (
                <CoverCard
                  key={c.id}
                  id={c.id}
                  emoji={c.emoji}
                  title={c.name}
                  tagline={c.purpose}
                  sub={c.because ? `matches ${c.because}` : `${c.member_count} ${c.member_count === 1 ? 'member' : 'members'}`}
                  online={c.locked_in_now}
                  onPress={() => joins.run(c.id, () => joinClub(c.id))}
                  action={<JoinButton label={c.name} state={joins.state[c.id]} onPress={() => joins.run(c.id, () => joinClub(c.id))} />}
                />
              ))}
              {rooms.map((r) => (
                <CoverCard
                  key={r.id}
                  id={r.id}
                  emoji={r.emoji}
                  title={r.name}
                  sub={profile?.university && r.school === profile.university ? 'your school' : `${r.member_count} ${r.member_count === 1 ? 'member' : 'members'}`}
                  online={r.online_count}
                  onPress={() => joins.run(r.id, () => joinRoomFromCard(router, r.id))}
                  action={<JoinButton label={r.name} state={joins.state[r.id]} onPress={() => joins.run(r.id, () => joinRoomFromCard(router, r.id))} />}
                />
              ))}
            </View>
            {clubs && clubs.length === 0 && rooms.length === 0 ? <EmptyLine>No rooms yet — you can start one from Search.</EmptyLine> : null}
            <ErrorLine message={joins.error} />
          </>
        ) : null}
      </ScrollView>

      <View style={styles.foot}>
        <PrimaryButton label={added + joined > 0 ? 'Enter philoi →' : 'Enter philoi'} loading={leaving} onPress={enter} />
        <Pressable style={styles.skip} onPress={enter} disabled={leaving} accessibilityRole="button">
          <Text style={styles.skipText}>Skip — I&apos;ll find people later</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  spine: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  body: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  h: { marginTop: Spacing.three, fontFamily: Fonts.bodyBold, fontSize: 26, color: Colors.ink },
  sub: { marginTop: Spacing.two, fontFamily: Fonts.body, fontSize: 15, lineHeight: 21, color: Colors.muted },
  note: { marginTop: Spacing.two, fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 17, color: Colors.spaceDim },
  cards: { gap: Spacing.twelve },
  foot: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
  skip: { alignItems: 'center', paddingVertical: Spacing.twelve },
  skipText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.spaceDim },
});
