import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { MatchingSwitch } from '@/components/discover/matching-opt-in';
import { FirstRunSpine, SPINE_ROW_HEIGHT } from '@/components/tutorial/first-run-spine';
import { Icon } from '@/components/ui/icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import {
  fetchInterestVocab,
  fetchMyInterests,
  INTEREST_CATEGORIES,
  PROGRAM_CATEGORY,
  setMyInterests,
  vocabIcon,
  type VocabTag,
} from '@/lib/api/interests';
import { fetchMyMatchSettings, setMyMatchSettings } from '@/lib/api/matchmaking';
import { getErrorMessage } from '@/lib/errors';
import { clearInterestsPending } from '@/lib/interests-flow';

// INTERESTS → GOALS → YOUR MATCHES (mock 323, 0285). The cold-start signal for matching: before a
// single lock-in, what you picked here is what grind-alikes and forest suggestions run on.
//
// Two ways in:
//   · first run — the root layout's interests gate sends a freshly set-up account here once, after
//     the house claim (lib/interests-flow). One step here, then matchmaking → your people (which clears the gate).
//   · ?edit=1 — from Edit identity, any time. Steps A and B only, then Save and back. Matching reads
//     these at query time, so a change re-matches on the next shelf load; nothing to re-run.
//
// A and B are both skippable and nothing gates on them (this is not the old #19 goal-gate): goals
// are intent, never a tracked target. One local `step`, like setup-handle, so Back is just state.
//
// SHARESPOT (ss2, mocks 378 → 383 → 379): first run is ONE step here now — interests, an optional
// Spotify/Calendar connect, and "Find my people →", which runs the matcher (/discover/matchmaking)
// and lands on Your people (/discover/your-people), which ends first run. The goals step is edit-
// mode only. Matching ("friends-matching ON by default") is a visible switch beside the button,
// starting on, with what it means written under it; it's applied only when the person taps on.
// Nothing is opted in silently. The old in-screen reveal (mock 333) and its global-standings switch
// are gone from onboarding; standings stay opt-in from Settings.
//
// 0296 / MOCK 339 (interests, not disciplines): step A leads with ten hobby sections (Active, Mind,
// Finance, Create, Play, Culture, Food, Outdoors, People, Pets) — featured chips, "+ N" to expand,
// one search over all ~150. The five disciplines follow as a small row: the lock-in picker and
// relic buckets still need them, but they aren't what you're asked first.
//

type Step = 1 | 2;

const MAX_INTERESTS = 12;

export default function InterestsScreen() {
  const router = useRouter();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editing = edit === '1';
  const { profile } = useAuth();
  const userId = profile?.id ?? null;

  const [step, setStep] = useState<Step>(1);
  const [vocab, setVocab] = useState<VocabTag[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [disciplines, setDisciplines] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [programTags, setProgramTags] = useState<string[]>([]);
  // Sections expanded past their featured chips ("+ N").
  const [open, setOpen] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  // Skip means "don't touch this list", not "clear it" — an edit-mode Skip must not wipe a save.
  const [skippedA, setSkippedA] = useState(false);
  const [saving, setSaving] = useState(false);
  // First run: matching starts ON, visibly, beside the button (MatchingSwitch). Null = already on,
  // so there's nothing to ask.
  const [matchOn, setMatchOn] = useState<boolean | null>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([fetchInterestVocab(), fetchMyInterests()])
      .then(([v, mine]) => {
        if (!live) return;
        setVocab(v);
        setDisciplines(mine.disciplines);
        setTags(mine.interest_tags);
        setGoals(mine.goals);
        setProgramTags(mine.program_tags);
        setLoadFailed(false);
      })
      .catch((e) => {
        console.warn('[interests] could not load the vocabulary:', e);
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [loadKey]);

  useEffect(() => {
    if (editing) return;
    let live = true;
    fetchMyMatchSettings()
      .then((s) => live && s.discoverable && setMatchOn(null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [editing]);

  const byKind = useMemo(() => {
    const all = vocab ?? [];
    return {
      discipline: all.filter((t) => t.kind === 'discipline'),
      interest: all.filter((t) => t.kind === 'interest'),
      goal: all.filter((t) => t.kind === 'goal'),
    };
  }, [vocab]);

  const labelOf = useCallback((key: string) => vocab?.find((t) => t.key === key)?.label ?? key, [vocab]);

  // The ten sections (0296). Tags with a category this build doesn't know — or none, from a pre-0296
  // server — collect in one trailing section, so nothing the server offers is unreachable. Program
  // tags aren't browsed: your program already implies them (programNote below).
  const sections = useMemo(() => {
    const known = new Set(INTEREST_CATEGORIES.map((c) => c.key));
    const groups = INTEREST_CATEGORIES.map((c) => ({
      key: c.key,
      title: c.title,
      tags: byKind.interest.filter((t) => t.category === c.key),
    })).filter((g) => g.tags.length > 0);
    const rest = byKind.interest.filter((t) => !t.category || (!known.has(t.category) && t.category !== PROGRAM_CATEGORY));
    if (rest.length > 0) groups.push({ key: 'more', title: groups.length > 0 ? 'More' : 'Interests', tags: rest });
    return groups;
  }, [byKind.interest]);

  // A program tag you hold (picked before 0296 moved it out of browse) stays visible so it can be unpicked.
  const heldProgram = byKind.interest.filter((t) => t.category === PROGRAM_CATEGORY && tags.includes(t.key));

  const q = query.trim().toLowerCase();
  // Search reaches every interest tag, program ones included, picked or not.
  const results = q === '' ? [] : byKind.interest.filter((t) => t.label.toLowerCase().includes(q));
  const pickTag = (key: string) => setTags((s) => toggle(s, key, MAX_INTERESTS));

  /** Every exit from first run — done, skipped through, or "explore on my own". */
  const finish = useCallback(async () => {
    await clearInterestsPending(userId).catch(() => {});
    if (editing) router.back();
    else router.replace('/');
  }, [editing, router, userId]);

  /** First run, 378 → 383: save what was picked, apply the visible matching switch, run the matcher. */
  async function findMyPeople(skip: boolean) {
    setSaving(true);
    setError(null);
    await Promise.allSettled([
      skip ? Promise.resolve() : setMyInterests({ disciplines, interest_tags: tags }),
      matchOn ? setMyMatchSettings({ discoverable: true }) : Promise.resolve(),
    ]).then((r) => r.forEach((x) => x.status === 'rejected' && console.warn('[interests] first-run save failed — continuing:', x.reason)));
    setSaving(false);
    router.replace({ pathname: '/discover/matchmaking', params: { onboarding: '1' } } as never);
  }

  async function save(opts: { skipGoals: boolean }) {
    if (skippedA && opts.skipGoals) return;
    await setMyInterests({
      disciplines: skippedA ? undefined : disciplines,
      interest_tags: skippedA ? undefined : tags,
      goals: opts.skipGoals ? undefined : goals,
    });
  }

  async function leaveGoals(skipGoals: boolean) {
    setSaving(true);
    setError(null);
    try {
      await save({ skipGoals });
    } catch (e) {
      if (editing) {
        // Edit mode is a save screen: say so and stay.
        setError(getErrorMessage(e, 'Could not save — try again.'));
        setSaving(false);
        return;
      }
      // First run must never dead-end on a server error; the reveal still works off the program.
      console.warn('[interests] could not save — continuing without it:', e);
    }
    setSaving(false);
    router.back();
  }

  if (loadFailed) {
    return (
      <Screen padded={false} style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.h}>Couldn&apos;t load this just now</Text>
          <Text style={styles.sub}>You can set what you&apos;re into later from your profile.</Text>
          <PrimaryButton label="Try again" onPress={() => setLoadKey((k) => k + 1)} />
          <Pressable style={styles.skip} onPress={finish} accessibilityRole="button">
            <Text style={styles.skipText}>{editing ? 'Back' : 'Continue to Philoi'}</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (!vocab) {
    return (
      <Screen padded={false} style={styles.container}>
        <ActivityIndicator color={Colors.navEmber} style={styles.spinner} />
      </Screen>
    );
  }

  // First run is ShareSpot's 4-step setup: identity, patron, THIS (3), your people (4).
  const total = editing ? 2 : 4;
  const filled = editing ? step : 3;
  const picked = disciplines.length + tags.length;

  return (
    <Screen padded={false} style={styles.container}>
      <View style={styles.spineRow}>
        <FirstRunSpine total={total} filled={filled} label={`SETUP · ${filled} of ${total}`} />
      </View>

      {step === 1 && (
        <>
          <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.h}>What you&apos;re into</Text>
            <Text style={styles.sub}>Pick what you love. The more you add, the better we find your people.</Text>

            <View style={styles.search}>
              <Icon name="search" size={15} color={Colors.spaceDim} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search interests — anime, climbing, coffee…"
                placeholderTextColor={Colors.spaceFaint}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {query !== '' ? (
                <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
                  <Icon name="close" size={14} color={Colors.spaceDim} />
                </Pressable>
              ) : null}
            </View>

            {q !== '' ? (
              <View style={styles.chips}>
                {results.map((t) => (
                  <TagChip key={t.key} tag={t} tone="legend" selected={tags.includes(t.key)} onPress={() => pickTag(t.key)} />
                ))}
                {results.length === 0 ? <Text style={styles.none}>Nothing matches — try another word.</Text> : null}
              </View>
            ) : (
              <>
                {sections.map((s) => {
                  const expanded = open.includes(s.key);
                  // Featured chips, plus anything already picked so a pick never hides itself.
                  const shown = expanded ? s.tags : s.tags.filter((t) => t.featured || tags.includes(t.key));
                  const hidden = s.tags.length - shown.length;
                  return (
                    <View key={s.key}>
                      <Text style={styles.sec}>{s.title}</Text>
                      <View style={styles.chips}>
                        {shown.map((t) => (
                          <TagChip key={t.key} tag={t} tone="legend" selected={tags.includes(t.key)} onPress={() => pickTag(t.key)} />
                        ))}
                        {hidden > 0 ? (
                          <Pressable
                            style={styles.chip}
                            onPress={() => setOpen((o) => [...o, s.key])}
                            accessibilityRole="button"
                            accessibilityLabel={`Show ${hidden} more in ${s.title}`}>
                            <Icon name="plus" size={14} color={Colors.muted} />
                            <Text style={styles.chipText}>{hidden}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                })}

                {heldProgram.length > 0 ? (
                  <>
                    <Text style={styles.sec}>From your field</Text>
                    <View style={styles.chips}>
                      {heldProgram.map((t) => (
                        <TagChip key={t.key} tag={t} tone="legend" selected onPress={() => pickTag(t.key)} />
                      ))}
                    </View>
                  </>
                ) : null}

                {/* Disciplines: what the lock-in picker and relics bucket by. Kept, but not the face of this step. */}
                <Text style={styles.sec}>What you lock in on</Text>
                <View style={styles.chips}>
                  {byKind.discipline.map((t) => (
                    <TagChip
                      key={t.key}
                      tag={t}
                      tone="ember"
                      selected={disciplines.includes(t.key)}
                      onPress={() => setDisciplines((s) => toggle(s, t.key))}
                    />
                  ))}
                </View>
              </>
            )}

            {programTags.length > 0 ? (
              <Text style={styles.programNote}>
                Your program already counts: {programTags.map(labelOf).join(', ')}
              </Text>
            ) : null}

            {/* Mock 378 · optional syncs. The tokens are ss5's (Settings → Connected apps); this only
                points there, so skipping costs nothing. */}
            {!editing ? (
              <>
                <Text style={styles.sec}>Connect (optional)</Text>
                <View style={styles.chips}>
                  <Pressable style={styles.chip} onPress={() => router.push('/connected-apps' as never)} accessibilityRole="button">
                    <Icon name="music" size={14} color={Colors.muted} />
                    <Text style={styles.chipText}>Spotify</Text>
                  </Pressable>
                  <Pressable style={styles.chip} onPress={() => router.push('/connected-apps' as never)} accessibilityRole="button">
                    <Icon name="calendar" size={14} color={Colors.muted} />
                    <Text style={styles.chipText}>Calendar</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </ScrollView>

          <View style={styles.foot}>
            {picked > 0 ? (
              <View style={styles.match}>
                <Icon name="compass" size={16} color={Colors.green} />
                <Text style={styles.matchText}>
                  <Text style={styles.matchStrong}>{picked} selected</Text>
                  {tags.length >= MAX_INTERESTS ? ` · ${MAX_INTERESTS} interests max — tap one to swap it` : ''}
                </Text>
              </View>
            ) : null}
            {!editing && matchOn !== null ? <MatchingSwitch value={matchOn} onChange={setMatchOn} /> : null}
            <PrimaryButton
              label={editing ? 'Continue' : 'Find my people →'}
              loading={saving}
              onPress={() => {
                if (!editing) return void findMyPeople(false);
                setSkippedA(false);
                setStep(2);
              }}
            />
            <Pressable
              style={styles.skip}
              disabled={saving}
              onPress={() => {
                if (!editing) return void findMyPeople(true);
                setSkippedA(true);
                setStep(2);
              }}
              accessibilityRole="button">
              <Text style={styles.skipText}>Skip for now</Text>
            </Pressable>
          </View>
        </>
      )}

      {step === 2 && (
        <>
          <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
            <Text style={styles.h}>What do you want out of philoi?</Text>
            <Text style={styles.sub}>You can change this anytime.</Text>
            <Text style={styles.sec}>I&apos;m here to…</Text>
            {byKind.goal.map((g) => (
              <GoalRow key={g.key} goal={g} selected={goals.includes(g.key)} onPress={() => setGoals((s) => toggle(s, g.key))} />
            ))}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.foot}>
            <PrimaryButton
              label={editing ? 'Save' : 'See who you match with →'}
              loading={saving}
              onPress={() => leaveGoals(false)}
            />
            <View style={styles.footRow}>
              <Pressable style={styles.skip} onPress={() => setStep(1)} accessibilityRole="button" disabled={saving}>
                <Text style={styles.skipText}>Back</Text>
              </Pressable>
              <Pressable style={styles.skip} onPress={() => leaveGoals(true)} accessibilityRole="button" disabled={saving}>
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}

    </Screen>
  );
}

// ─────────────────────────── pieces ───────────────────────────
function toggle(list: string[], key: string, max?: number): string[] {
  if (list.includes(key)) return list.filter((k) => k !== key);
  if (max !== undefined && list.length >= max) return list;
  return [...list, key];
}

function TagChip({ tag, tone, selected, onPress }: { tag: VocabTag; tone: 'ember' | 'legend'; selected: boolean; onPress: () => void }) {
  const onStyle = tone === 'ember' ? styles.chipEmber : styles.chipLegend;
  const onText = tone === 'ember' ? styles.chipTextEmber : styles.chipTextLegend;
  const iconColor = selected ? (tone === 'ember' ? '#1a1030' : Colors.ink) : Colors.muted;
  return (
    <Pressable
      style={[styles.chip, selected && onStyle]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}>
      <Icon name={vocabIcon(tag.icon)} size={14} color={iconColor} />
      <Text style={[styles.chipText, selected && onText]}>{tag.label}</Text>
    </Pressable>
  );
}

function GoalRow({ goal, selected, onPress }: { goal: VocabTag; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.goal, selected && styles.goalOn]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}>
      <View style={styles.goalIcon}>
        <Icon name={vocabIcon(goal.icon)} size={17} color={Colors.navEmber2} />
      </View>
      <View style={styles.goalBody}>
        <Text style={styles.goalTitle}>{goal.label}</Text>
        {goal.sub ? <Text style={styles.goalSub}>{goal.sub}</Text> : null}
      </View>
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected ? <Icon name="check" size={12} color="#1a1030" /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Same frame as setup-handle, so the spine doesn't move when first run hands over.
  container: {
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: 14,
  },
  spineRow: {
    minHeight: SPINE_ROW_HEIGHT,
    justifyContent: 'center',
    marginBottom: 18,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: Spacing.three,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
  },
  spinner: {
    marginTop: Spacing.six,
  },
  inlineSpin: {
    marginVertical: Spacing.three,
  },
  h: {
    fontFamily: Fonts.display,
    fontSize: 21,
    color: Colors.ink,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.muted,
    marginTop: 7,
    marginBottom: Spacing.two,
  },
  sec: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: Spacing.three,
    marginBottom: 9,
    marginHorizontal: 2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 13,
  },
  chipEmber: {
    backgroundColor: Colors.navEmber,
    borderColor: Colors.navEmber,
  },
  chipLegend: {
    backgroundColor: 'rgba(185,139,255,0.16)',
    borderColor: Colors.legend,
  },
  chipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.muted,
  },
  chipTextEmber: {
    color: '#1a1030',
    fontFamily: Fonts.black,
  },
  chipTextLegend: {
    color: Colors.ink,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.twelve,
    marginBottom: Spacing.twelve,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
    paddingVertical: 9,
  },
  none: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.spaceDim,
  },
  programNote: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceDim,
    marginTop: Spacing.three,
  },
  foot: {
    paddingTop: Spacing.twelve,
    gap: Spacing.two,
  },
  footRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  match: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(57,217,138,0.08)',
    borderWidth: 1,
    borderColor: '#1f5a40',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  matchText: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11,
    color: Colors.green,
  },
  matchStrong: {
    color: Colors.ink,
    fontFamily: Fonts.bodyBold,
  },
  skip: {
    alignSelf: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  skipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    marginTop: Spacing.twelve,
  },
  goal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: Spacing.two,
  },
  goalOn: {
    borderColor: Colors.navEmber,
    backgroundColor: 'rgba(255,122,47,0.08)',
  },
  goalIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.spacePanel2,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalBody: {
    flex: 1,
  },
  goalTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  goalSub: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.spaceDim,
    marginTop: 1,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: Colors.navEmber,
    borderColor: Colors.navEmber,
  },
  optIn: {
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    padding: Spacing.twelve,
    gap: Spacing.two,
  },
  optInTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  optInBody: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.spaceDim,
  },
  // Mock 333's club card: the forest's own emoji on a tile, then the person-row layout.
  clubTile: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.spacePanel2,
  },
  clubEmoji: {
    fontSize: 18,
  },
  clubWhy: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.gold,
    marginTop: 2,
  },
  standings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    marginTop: Spacing.four,
    paddingVertical: 12,
    paddingHorizontal: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    paddingVertical: 10,
    paddingHorizontal: 11,
    marginBottom: Spacing.two,
  },
  personOn: {
    borderColor: Colors.green,
  },
  personBody: {
    flex: 1,
    minWidth: 0,
  },
  personName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  personWhy: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 10,
    color: Colors.legend,
    marginTop: 1,
  },
  pct: {
    fontFamily: Fonts.black,
    fontSize: 12,
    color: Colors.green,
  },
  addPill: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPillOn: {
    backgroundColor: Colors.green,
    borderColor: Colors.green,
  },
});
