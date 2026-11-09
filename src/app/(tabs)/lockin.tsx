import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LockInTrackerPrompt } from '@/components/fitness/tracker-prompts';
import { YourWeekCard } from '@/components/home/your-week-card';
import { EmberCta } from '@/components/lockin-hub/ember-cta';
import { HubChallenges, HubFeed, HubPeopleCard, HubStandingsRow, SectionLabel } from '@/components/lockin-hub/hub-sections';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { NavGlyph, type NavGlyphName } from '@/components/ui/nav-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useActiveSession } from '@/lib/active-session-context';
import { itemAttachments } from '@/lib/agora-attachment';
import { fetchAgoraFeed } from '@/lib/api/agora';
import {
  fetchMyWeek,
  fetchPeopleActiveNow,
  fetchPeopleWeek,
  type MyWeek,
  type PeopleActiveNow,
  type PeopleWeek,
} from '@/lib/api/home';
import { fetchMySocialChallenges } from '@/lib/api/social-challenges';
import { useCompetition } from '@/lib/competition';
import { setSessionAudioChoice } from '@/lib/economy/equipped-audio';
import { goalTypeForChoice } from '@/lib/goal-types';
import type { AgoraItem, FitnessActivity, LockInCategory, SocialChallenge } from '@/types/database';

// LOCK IN — the tab (ShareSpot ss4 §A, mock 347). Pencil icon on the bar: the study/project signal,
// never an "Arena" or crossed swords.
//
// DUAL PURPOSE, YOUR PROGRESS FIRST. The order is the point: you open the tab on YOUR week (ipsative —
// you against your own last week, never against anyone), then your people as one collective number,
// then a feed of their lock-in posts, then challenges, then a quiet opt-in Standings row. Nobody is
// discouraged by somebody else's number before they've seen their own.
//
// Starting a session is the big action and stays one tap: the four disciplines from mock 327 (Deep
// Work · Study · Gym · Cardio, no Custom, no Goal row, no post toggle — posting is asked once, on the
// done screen) sit right above "Start a Lock-In". The tiles map onto the two-tap taxonomy via
// goal-types.ts, the one place that decides the flat goal_type; the server re-derives it anyway.
//
// Every read is best-effort: a section whose read fails or comes back empty is simply not drawn, so a
// slow network never blocks the Start button.

type Discipline = {
  key: string;
  label: string;
  glyph: NavGlyphName;
  category: LockInCategory;
  activity?: FitnessActivity;
};

const DISCIPLINES: Discipline[] = [
  { key: 'deep_work', label: 'Deep Work', glyph: 'brain', category: 'deep_work' },
  { key: 'study', label: 'Study', glyph: 'book', category: 'study' },
  { key: 'gym', label: 'Gym', glyph: 'dumbbell', category: 'fitness', activity: 'strength' },
  { key: 'cardio', label: 'Cardio', glyph: 'lungs', category: 'fitness', activity: 'cardio' },
];

/** How many of your people's lock-in posts the hub shows before the full feed takes over. */
const FEED_SHOWN = 4;

/** A lock-in post first; failing enough of those, any post with words in it. Standing-only posts never. */
function pickFeed(items: AgoraItem[]): AgoraItem[] {
  const lockins = items.filter((it) => itemAttachments(it).some((a) => a.kind === 'lockin'));
  if (lockins.length >= FEED_SHOWN) return lockins.slice(0, FEED_SHOWN);
  const words = items.filter((it) => !lockins.includes(it) && it.item_type === 'post' && Boolean(it.body?.trim()));
  return [...lockins, ...words]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, FEED_SHOWN);
}

const LIVE_STATUSES = new Set<SocialChallenge['status']>(['pending', 'active']);

export default function LockInTab() {
  const router = useRouter();
  const { session: activeSession } = useActiveSession();
  const competition = useCompetition();
  const [picked, setPicked] = useState<Discipline>(DISCIPLINES[0]);

  const [myWeek, setMyWeek] = useState<MyWeek | null>(null);
  const [peopleWeek, setPeopleWeek] = useState<PeopleWeek | null>(null);
  const [peopleNow, setPeopleNow] = useState<PeopleActiveNow | null>(null);
  const [feed, setFeed] = useState<AgoraItem[]>([]);
  const [challenges, setChallenges] = useState<SocialChallenge[]>([]);

  // Re-read on every focus — coming back from a finished session should show the new week. Each read
  // settles on its own; `live` is this focus's guard (a blur stops a slow read from landing late).
  useFocusEffect(
    useCallback(() => {
      let live = true;
      fetchMyWeek()
        .then((w) => live && setMyWeek(w))
        .catch(() => {});
      fetchPeopleWeek()
        .then((w) => live && setPeopleWeek(w))
        .catch(() => {});
      fetchPeopleActiveNow()
        .then((n) => live && setPeopleNow(n))
        .catch(() => {});
      fetchAgoraFeed('all', null, 30)
        .then((items) => live && setFeed(pickFeed(items)))
        .catch(() => {});
      fetchMySocialChallenges()
        .then((cs) => live && setChallenges(cs.filter((c) => LIVE_STATUSES.has(c.status)).slice(0, 3)))
        .catch(() => {});
      return () => {
        live = false;
      };
    }, [])
  );

  function start() {
    // Same contract as the goal picker's handleStart: audio reset on every start, and the gym
    // session gets its energy param so start_workout runs once the lock-in exists.
    setSessionAudioChoice(undefined);
    router.push({
      pathname: '/lock-in',
      params: {
        type: goalTypeForChoice(picked.category, picked.activity ?? null),
        category: picked.category,
        ...(picked.activity ? { activity: picked.activity } : {}),
        ...(picked.activity === 'strength' ? { energy: 'same' } : {}),
      },
    });
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <AppTopBar title="Lock In" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* ── 1 · the big action ── */}
        {activeSession ? (
          <EmberCta
            big
            label="Return to your lock-in"
            leading={<NavGlyph name="flame" size={22} color="#2A0F05" />}
            onPress={() => router.push('/lock-in')}
            style={styles.cta}
          />
        ) : (
          <>
            <View style={styles.discs}>
              {DISCIPLINES.map((d) => {
                const on = d.key === picked.key;
                return (
                  <Pressable
                    key={d.key}
                    onPress={() => setPicked(d)}
                    style={[styles.disc, on && styles.discOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={d.label}>
                    <NavGlyph name={d.glyph} size={22} color={on ? Colors.navEmber : Colors.spaceDim} />
                    <Text style={[styles.discLabel, on && styles.discLabelOn]} numberOfLines={1}>
                      {d.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Mock 314: Gym or Cardio is the moment a tracker matters — say so right there. Renders
                nothing once any tracker is connected, and never for Study / Deep Work. */}
            {picked.activity === 'strength' || picked.activity === 'cardio' ? (
              <LockInTrackerPrompt activity={picked.activity} style={styles.trackerPrompt} />
            ) : null}

            <EmberCta
              big
              label="Start a Lock-In"
              accessibilityLabel={`Start a ${picked.label} lock-in`}
              leading={<NavGlyph name="flame" size={22} color="#2A0F05" />}
              onPress={start}
              style={styles.cta}
            />
          </>
        )}

        {/* ── 2 · you first ── */}
        {myWeek ? (
          <>
            <SectionLabel>Your week</SectionLabel>
            <YourWeekCard week={myWeek} />
          </>
        ) : null}

        {/* ── 3 · then your people, as one number ── */}
        {peopleWeek && peopleWeek.people > 0 ? (
          <>
            <SectionLabel>Your people</SectionLabel>
            <HubPeopleCard week={peopleWeek} now={peopleNow} />
          </>
        ) : null}

        {/* ── 4 · the feed — a feed, not a stat sheet ── */}
        <SectionLabel>Study season 📚</SectionLabel>
        <HubFeed items={feed} onCompose={() => router.push('/agora/compose')} />

        {/* ── 5 · challenges ── */}
        <SectionLabel>Challenges</SectionLabel>
        <HubChallenges live={challenges} />

        {/* ── 6 · the only door to rank-vs-others, and it's opt-in (off by default) ── */}
        <SectionLabel>Standings</SectionLabel>
        <HubStandingsRow on={competition.on} onPress={() => router.push('/leaderboards')} />

        <Pressable onPress={() => router.push('/lock-in-history')} style={styles.historyLink} accessibilityRole="button">
          <Text style={styles.historyLinkText}>Your lock-in history ›</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  body: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
  },
  discs: {
    flexDirection: 'row',
    gap: 8,
  },
  disc: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  discOn: {
    borderColor: Colors.navEmber,
    backgroundColor: 'rgba(255,122,47,0.10)',
  },
  discLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.spaceDim,
  },
  discLabelOn: {
    color: Colors.ink,
  },
  trackerPrompt: {
    marginTop: Spacing.three,
  },
  cta: {
    marginTop: Spacing.three,
  },
  historyLink: {
    alignSelf: 'center',
    paddingVertical: Spacing.three,
    marginTop: Spacing.two,
  },
  historyLinkText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
});
