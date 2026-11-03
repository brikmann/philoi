import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackersCard } from '@/components/home/backers-card';
import { PeopleLikeYou } from '@/components/home/people-like-you';
import { PeopleWeekCard } from '@/components/home/people-week-card';
import { YourPeopleList } from '@/components/home/your-people-list';
import { YourWeekCard } from '@/components/home/your-week-card';
import { LockInCheersSheet } from '@/components/lockin-cheers/lockin-cheers-sheet';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useGatedInterval } from '@/hooks/use-motion-active';
import { useLockInCheers } from '@/hooks/use-lockin-cheers';
import { useActiveSession } from '@/lib/active-session-context';
import {
  fetchFriendsRecentEffort,
  fetchMyBackers,
  fetchMyWeek,
  fetchPeopleWeek,
  weekHeadline,
  type Backer,
  type FriendEffort,
  type MyWeek,
  type PeopleWeek,
} from '@/lib/api/home';
import { useAuth } from '@/lib/auth/auth-context';

// HOME = YOU + YOUR PEOPLE (mock 318). Not a feed — the immersive feed lives on the Social tab now.
// Stacked sections under the greeting:
//   1. Your week — you vs your own last week (ipsative; nothing ranks you against anyone here);
//   1b. Your people, this week — the collective hours of everyone you're connected to (mock 331, 0288);
//   2. Who's backing you — the friends who cheered you this week;
//   3. What your people are doing — friends' latest real effort, reverse-chron, with a Cheer.
// No ranking language on Home: Standings lives behind You, opt-in. The only tier here is your own.

const PEOPLE_LIMIT = 5;
// Presence floor for the live dots, like the cheers hook's 30s poll; only while Home is focused.
const PEOPLE_POLL_MS = 45_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function greeting(name: string | null | undefined, now = new Date()): string {
  const h = now.getHours();
  const part = h >= 5 && h < 12 ? 'Morning' : h >= 12 && h < 17 ? 'Afternoon' : 'Evening';
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first ? `${part}, ${first}.` : `${part}.`;
}

export function HomeConnectionSurface() {
  const { session, profile } = useAuth();
  const { session: activeSession } = useActiveSession();
  const lockInCheers = useLockInCheers({ live: Boolean(activeSession) });
  const [cheersOpen, setCheersOpen] = useState(false);

  const [week, setWeek] = useState<MyWeek | null>(null);
  const [peopleWeek, setPeopleWeek] = useState<PeopleWeek | null>(null);
  const [backers, setBackers] = useState<Backer[] | null>(null);
  const [people, setPeople] = useState<FriendEffort[] | null>(null);
  const [focused, setFocused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadPeople = useCallback(async () => {
    try {
      setPeople(await fetchFriendsRecentEffort(PEOPLE_LIMIT));
    } catch {
      // Keep what's on screen; the next focus or tick retries.
      setPeople((prev) => prev ?? []);
    }
  }, []);

  const load = useCallback(async () => {
    await Promise.all([
      fetchMyWeek()
        .then(setWeek)
        .catch(() => {
          // §1 hides on a failed read rather than showing zeros that would read as "nothing this week".
        }),
      fetchPeopleWeek()
        .then(setPeopleWeek)
        .catch(() => {
          // Keep what's on screen — a failed refresh shouldn't blank the collective.
        }),
      fetchMyBackers()
        .then(setBackers)
        .catch(() => setBackers((prev) => prev ?? [])),
      loadPeople(),
    ]);
  }, [loadPeople]);

  // Tabs stay mounted, so a mount-only read would show this morning's week all day.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void load();
      return () => setFocused(false);
    }, [load])
  );

  useGatedInterval(loadPeople, PEOPLE_POLL_MS, focused && !!session);

  const refetchCheers = lockInCheers.refetch;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), refetchCheers()]);
    setRefreshing(false);
  }, [load, refetchCheers]);

  const now = new Date();
  const headline = week ? weekHeadline(week) : null;
  const sub = headline ? `${WEEKDAYS[now.getDay()]} · ${headline.short}` : WEEKDAYS[now.getDay()];
  const unit = profile?.weight_unit === 'kg' ? 'kg' : 'lb';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* Mock 328: the bar keeps the brand (flame + philoi) with the icons on the right; the greeting
          sits under it at full width, so the icon row can never clip the name on a narrow phone. */}
      <AppTopBar />
      <View style={styles.greetingBlock}>
        <Text style={styles.greeting}>{greeting(profile?.display_name)}</Text>
        <Text style={[styles.greetingSub, headline?.ahead && styles.greetingSubAhead]}>{sub}</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.navEmber2} />}>
        {week ? (
          <>
            <Text style={styles.sec}>Your week</Text>
            <YourWeekCard week={week} />
          </>
        ) : null}

        {/* Hidden until you have people — the cold start below (PeopleLikeYou) covers that case. */}
        {peopleWeek && peopleWeek.people > 0 ? (
          <View style={styles.peopleWeek}>
            <PeopleWeekCard week={peopleWeek} />
          </View>
        ) : null}

        {backers ? (
          <>
            <Text style={styles.sec}>Who’s backing you</Text>
            <BackersCard backers={backers} />
          </>
        ) : null}

        {people ? (
          <>
            <Text style={styles.sec}>What your people are doing</Text>
            <YourPeopleList people={people} unit={unit} onMessageLive={() => setCheersOpen(true)} />
            {/* Cold start (0285): nothing from your people yet → the people who grind like you. */}
            {people.length === 0 ? <PeopleLikeYou /> : null}
          </>
        ) : null}
      </ScrollView>

      <LockInCheersSheet
        visible={cheersOpen}
        onClose={() => {
          setCheersOpen(false);
          void loadPeople();
        }}
        friends={lockInCheers.friends}
        meId={session?.user.id ?? null}
        meLive={Boolean(activeSession)}
        inboundSeq={lockInCheers.inboundSeq}
        onCheered={lockInCheers.markCheered}
        onThreadRead={lockInCheers.markThreadRead}
        onChanged={lockInCheers.refetch}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.spaceBg,
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  greetingBlock: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
  },
  greeting: {
    fontFamily: Fonts.bodyBold,
    fontSize: 20,
    color: Colors.ink,
  },
  greetingSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
    marginTop: 2,
  },
  greetingSubAhead: {
    color: Colors.green,
  },
  // Mock 331's `.people { margin-top: 14px }` — it sits under Your week without its own label.
  peopleWeek: {
    marginTop: 14,
  },
  sec: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: 14,
    marginBottom: 7,
    marginHorizontal: 2,
  },
});
