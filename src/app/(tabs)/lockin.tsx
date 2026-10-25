import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LockinGoalPicker } from '@/components/lockin-goal-picker';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { NavGlyph, type NavGlyphName } from '@/components/ui/nav-glyph';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useActiveSession } from '@/lib/active-session-context';
import { setPostToAgora } from '@/lib/api/agora';
import { fetchMyGoals } from '@/lib/api/goals';
import { useAuth } from '@/lib/auth/auth-context';
import { setSessionAudioChoice } from '@/lib/economy/equipped-audio';
import { GOAL_TYPE_META, goalTypeForChoice } from '@/lib/goal-types';
import type { FitnessActivity, Goal, LockInCategory } from '@/types/database';

// LOCK IN — the center tab (nav restructure, mocks 302/303). Its own place, not just a button:
// pick a discipline, optionally a goal, confirm the auto-post toggle, Start → the existing running
// timer at /lock-in, unchanged. Presence and cheers stay on that timer.
//
// The four quick tiles map onto the two-tap taxonomy exactly as the goal picker does (goal-types.ts
// is the one place that decides the flat goal_type; the server re-derives it anyway). Custom opens
// that full picker sheet — courses, campfire, detail, gym routine, session audio — so nothing the
// sheet could do is lost by the faster path here.

type Discipline = {
  key: string;
  label: string;
  glyph: NavGlyphName;
  category: LockInCategory | null;
  activity?: FitnessActivity;
};

const DISCIPLINES: Discipline[] = [
  { key: 'deep_work', label: 'Deep Work', glyph: 'brain', category: 'deep_work' },
  { key: 'study', label: 'Study', glyph: 'book', category: 'study' },
  { key: 'gym', label: 'Gym', glyph: 'dumbbell', category: 'fitness', activity: 'strength' },
  { key: 'cardio', label: 'Run / Cardio', glyph: 'lungs', category: 'fitness', activity: 'cardio' },
  { key: 'custom', label: 'Custom', glyph: 'plus', category: null },
];

export default function LockInTab() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const { session: activeSession } = useActiveSession();
  const [picked, setPicked] = useState<Discipline>(DISCIPLINES[0]);
  const [goalLabel, setGoalLabel] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Seeded from the sticky default on the profile row (0273); absent before that migration = off.
  const [autoPost, setAutoPost] = useState(Boolean(profile?.post_to_agora));
  const [autoPostNote, setAutoPostNote] = useState<string | null>(null);

  // On focus, not mount: "+ New goal" pushes /goal/create and comes back here, and the tab never
  // unmounts — the goal just made has to be in the row that sent you to make it.
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let live = true;
      fetchMyGoals(session.user.id)
        .then((g) => {
          if (live) setGoals(g);
        })
        .catch(() => {
          // Goals are a shortcut here; an unnamed session still starts without them.
          if (live) setGoals([]);
        });
      return () => {
        live = false;
      };
    }, [session])
  );

  const goalType = picked.category ? goalTypeForChoice(picked.category, picked.activity ?? null) : null;
  const namedGoals = goalType
    ? goals.filter((g) => g.type === goalType && (g.label ?? '').trim().length > 0)
    : [];

  function pick(d: Discipline) {
    if (d.category === null) {
      setPickerOpen(true);
      return;
    }
    setPicked(d);
    setGoalLabel(null);
  }

  async function toggleAutoPost(next: boolean) {
    setAutoPost(next);
    setAutoPostNote(null);
    try {
      await setPostToAgora(next);
    } catch {
      // set_post_to_agora is 0273 — not on every server yet. Say so rather than pretend it saved.
      setAutoPost(!next);
      setAutoPostNote('Auto-post isn’t live yet — post from the done screen for now.');
    }
  }

  function start() {
    if (!picked.category) return;
    // Same contract as the goal picker's handleStart: audio reset on every start, and the gym
    // session gets its energy param so start_workout runs once the lock-in exists.
    setSessionAudioChoice(undefined);
    router.push({
      pathname: '/lock-in',
      params: {
        type: goalTypeForChoice(picked.category, picked.activity ?? null),
        category: picked.category,
        ...(picked.activity ? { activity: picked.activity } : {}),
        ...(goalLabel ? { detail: goalLabel } : {}),
        ...(picked.activity === 'strength' ? { energy: 'same' } : {}),
      },
    });
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <AppTopBar />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <NavGlyph name="flame" size={64} color={Colors.navEmber} />
          <Text style={styles.heroTitle}>{activeSession ? 'You’re locked in' : 'Ready to lock in?'}</Text>
          <Text style={styles.heroSub}>
            {activeSession ? 'Your session is still running.' : 'Pick what you’re grinding on.'}
          </Text>
        </View>

        {activeSession ? (
          <Pressable style={styles.startBtn} onPress={() => router.push('/lock-in')} accessibilityRole="button">
            <Text style={styles.startLabel}>Return to your lock-in</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.discs}>
              {DISCIPLINES.map((d) => {
                const on = d.key === picked.key;
                return (
                  <Pressable
                    key={d.key}
                    onPress={() => pick(d)}
                    style={[styles.disc, on && styles.discOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={d.category ? d.label : 'Custom — more options'}>
                    <NavGlyph name={d.glyph} size={30} color={on ? Colors.navEmber : Colors.spaceDim} />
                    <Text style={[styles.discLabel, on && styles.discLabelOn]} numberOfLines={1}>
                      {d.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.section}>Goal</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.goalRow}>
              <Pressable
                onPress={() => setGoalLabel(null)}
                style={[styles.goalChip, goalLabel === null && styles.goalChipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: goalLabel === null }}>
                <Text style={[styles.goalChipText, goalLabel === null && styles.goalChipTextOn]}>
                  Just {picked.label.toLowerCase()}
                </Text>
              </Pressable>
              {namedGoals.map((g) => {
                const label = (g.label ?? '').trim();
                const on = goalLabel === label;
                return (
                  <Pressable
                    key={g.id}
                    onPress={() => setGoalLabel(on ? null : label)}
                    style={[styles.goalChip, on && styles.goalChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}>
                    <Text style={[styles.goalChipText, on && styles.goalChipTextOn]}>🎯 {label}</Text>
                  </Pressable>
                );
              })}
              {goalType ? (
                <Pressable
                  onPress={() => router.push({ pathname: '/goal/create', params: { type: goalType } })}
                  style={[styles.goalChip, styles.goalChipNew]}
                  accessibilityRole="button"
                  accessibilityLabel={`New ${GOAL_TYPE_META[goalType].label} goal`}>
                  <Ionicons name="add" size={13} color={Colors.navEmber2} />
                  <Text style={[styles.goalChipText, styles.goalChipNewText]}>New goal</Text>
                </Pressable>
              ) : null}
            </ScrollView>

            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>📣 Post to Home when done</Text>
                <Text style={styles.rowSub}>{autoPostNote ?? 'Your session card goes to the feed.'}</Text>
              </View>
              <Toggle value={autoPost} onValueChange={(v) => void toggleAutoPost(v)} />
            </View>

            <Pressable style={styles.startBtn} onPress={start} accessibilityRole="button">
              <Text style={styles.startLabel}>Start lock-in</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <LockinGoalPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  body: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
  },
  hero: {
    alignItems: 'center',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    gap: 6,
  },
  heroTitle: {
    fontFamily: Fonts.black,
    fontSize: 24,
    color: Colors.ink,
    marginTop: Spacing.two,
  },
  heroSub: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  discs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  disc: {
    flexBasis: '31%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
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
    fontSize: 12,
    color: Colors.spaceDim,
  },
  discLabelOn: {
    color: Colors.ink,
  },
  section: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  goalRow: {
    gap: Spacing.two,
  },
  goalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  goalChipOn: {
    borderColor: Colors.gold,
    backgroundColor: 'rgba(255,209,102,0.08)',
  },
  goalChipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  goalChipTextOn: {
    color: Colors.gold,
  },
  goalChipNew: {
    borderStyle: 'dashed',
  },
  goalChipNewText: {
    color: Colors.navEmber2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    marginTop: Spacing.four,
    padding: Spacing.twelve,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  rowSub: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
  },
  startBtn: {
    marginTop: Spacing.four,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: Colors.navEmber,
    shadowColor: Colors.navEmber,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 8,
  },
  startLabel: {
    fontFamily: Fonts.black,
    fontSize: 16,
    color: '#2A0F05',
  },
});
