import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackersCard } from '@/components/home/backers-card';
import { LockedInNowStrip } from '@/components/home/locked-in-now-strip';
import { PeopleLikeYou } from '@/components/home/people-like-you';
import { PeopleWeekCard } from '@/components/home/people-week-card';
import { PeopleWinsList } from '@/components/home/people-wins-list';
import { YourWeekCard } from '@/components/home/your-week-card';
import { LockInCheersSheet } from '@/components/lockin-cheers/lockin-cheers-sheet';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useGatedInterval } from '@/hooks/use-motion-active';
import { useLockInCheers } from '@/hooks/use-lockin-cheers';
import { useActiveSession } from '@/lib/active-session-context';
import {
  fetchMyBackers,
  fetchMyWeek,
  fetchPeopleActiveNow,
  fetchPeopleWeek,
  fetchPeopleWins,
  type Backer,
  type MyWeek,
  type PeopleActiveNow,
  type PeopleWeek,
  type PeopleWin,
} from '@/lib/api/home';
import { useAuth } from '@/lib/auth/auth-context';

// HOME = PULSE, THE EPICENTER (Phase 8.1, mock 334). You open the app and feel the room; the community
// leads and your own progress sits under it. Stacked:
//   1. Locked in right now — your people in a live session this minute, counted once (0290);
//   2. Your people, this week — the collective hours, the Phase 3 read as-is (0288);
//   3. What your people are building — wins from friends + your clubs, the Agora 'all' channel;
//   4. Your week — you vs your own last week (ipsative, mock 318);
//   5. Who's backing you — the friends who cheered you this week.
// Nothing on Pulse renders a rank, position or "#N": Standings lives behind You, opt-in.

const WINS_LIMIT = 4;
// The live strip's refresh floor, like the cheers hook's 30s poll; only while Pulse is focused.
const LIVE_POLL_MS = 45_000;
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
  const [active, setActive] = useState<PeopleActiveNow | null>(null);
  const [wins, setWins] = useState<PeopleWin[] | null>(null);
  const [focused, setFocused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadActive = useCallback(async () => {
    try {
      setActive(await fetchPeopleActiveNow());
    } catch {
      // Keep what's on screen; the next focus or tick retries.
    }
  }, []);

  const meId = session?.user.id ?? null;
  const loadWins = useCallback(async () => {
    if (!meId) return;
    try {
      setWins(await fetchPeopleWins(meId, WINS_LIMIT));
    } catch {
      setWins((prev) => prev ?? []);
    }
  }, [meId]);

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
      loadActive(),
      loadWins(),
    ]);
  }, [loadActive, loadWins]);

  // Tabs stay mounted, so a mount-only read would show this morning's week all day.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void load();
      return () => setFocused(false);
    }, [load])
  );

  useGatedInterval(loadActive, LIVE_POLL_MS, focused && !!session);

  const refetchCheers = lockInCheers.refetch;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), refetchCheers()]);
    setRefreshing(false);
  }, [load, refetchCheers]);

  const now = new Date();
  const place = profile?.university?.trim() || WEEKDAYS[now.getDay()];
  const sub = active && active.count > 0 ? `${place} · your people are moving` : place;
  const hasPeople = Boolean(peopleWeek && peopleWeek.people > 0);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* Mock 334: the screen is titled Pulse; the greeting sits under the bar at full width, so the
          icon row can never clip the name on a narrow phone. */}
      <AppTopBar title="Pulse" />
      <View style={styles.greetingBlock}>
        <Text style={styles.greeting}>{greeting(profile?.display_name)}</Text>
        <Text style={styles.greetingSub}>{sub}</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.navEmber2} />}>
        {/* Hidden until you have people — the cold start (PeopleLikeYou) covers that case. */}
        {active && hasPeople ? (
          <>
            <Text style={styles.sec}>
              {active.count > 0 ? <Text style={styles.liveDot}>● </Text> : null}
              Locked in right now
            </Text>
            <LockedInNowStrip
              active={active}
              onPress={lockInCheers.friends.some((f) => f.live) ? () => setCheersOpen(true) : undefined}
            />
          </>
        ) : null}

        {peopleWeek && hasPeople ? (
          <View style={styles.peopleWeek}>
            <PeopleWeekCard week={peopleWeek} />
          </View>
        ) : null}

        {wins ? (
          <>
            <Text style={styles.sec}>What your people are building</Text>
            {wins.length > 0 || hasPeople ? <PeopleWinsList wins={wins} /> : null}
            {/* Cold start (0285): no people and nothing from them yet → the people who grind like you. */}
            {wins.length === 0 && !hasPeople ? <PeopleLikeYou /> : null}
          </>
        ) : null}

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
      </ScrollView>

      <LockInCheersSheet
        visible={cheersOpen}
        onClose={() => {
          setCheersOpen(false);
          void loadActive();
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
  liveDot: {
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
