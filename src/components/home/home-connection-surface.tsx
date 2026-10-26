import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackersCard } from '@/components/home/backers-card';
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
  weekHeadline,
  type Backer,
  type FriendEffort,
  type MyWeek,
} from '@/lib/api/home';
import { useAuth } from '@/lib/auth/auth-context';

// HOME = YOU + YOUR PEOPLE (mock 318). Not a feed — the immersive feed lives on the Social tab now.
// Three stacked sections under the greeting:
//   1. Your week — you vs your own last week (ipsative; nothing ranks you against anyone here);
//   2. Who's backing you — the friends who cheered you this week;
//   3. What your people are doing — friends' latest real effort, reverse-chron, with a Cheer.
// The Leaderboard tab stays the arena; the only "rank" on Home is your own movement in §1.

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
  const sub = week ? `${WEEKDAYS[now.getDay()]} · ${weekHeadline(week).short}` : WEEKDAYS[now.getDay()];
  const unit = profile?.weight_unit === 'kg' ? 'kg' : 'lb';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <AppTopBar title={greeting(profile?.display_name)} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.navEmber2} />}>
        <Text style={styles.greetingSub}>{sub}</Text>

        {week ? (
          <>
            <Text style={styles.sec}>Your week</Text>
            <YourWeekCard week={week} />
          </>
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
  greetingSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
    marginTop: -Spacing.one,
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
