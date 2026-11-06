import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { SHOW_ALIKE_SCORE } from '@/components/matchmaking/config';
import { MatchAvatar } from '@/components/matchmaking/match-avatar';
import { FirstRunSpine, SPINE_ROW_HEIGHT } from '@/components/tutorial/first-run-spine';
import { Icon } from '@/components/ui/icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Toggle } from '@/components/ui/toggle';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { setCompetitionOptIn } from '@/lib/competition';
import { joinForest } from '@/lib/api/forests';
import { sendFriendRequest } from '@/lib/api/friend-requests';
import {
  fetchInterestVocab,
  fetchMyInterests,
  fetchSuggestedForests,
  setMyInterests,
  vocabIcon,
  type SuggestedForest,
  type VocabTag,
} from '@/lib/api/interests';
import { fetchGrindAlikes, fetchMyMatchSettings, setMyMatchSettings } from '@/lib/api/matchmaking';
import { getErrorMessage } from '@/lib/errors';
import { clearInterestsPending } from '@/lib/interests-flow';
import { shortSchoolName } from '@/lib/universities';
import type { GrindAlike } from '@/types/social';

// INTERESTS → GOALS → YOUR MATCHES (mock 323, 0285). The cold-start signal for matching: before a
// single lock-in, what you picked here is what grind-alikes and forest suggestions run on.
//
// Two ways in:
//   · first run — the root layout's interests gate sends a freshly set-up account here once, after
//     the house claim (lib/interests-flow). All three steps; every exit clears the gate.
//   · ?edit=1 — from Edit identity, any time. Steps A and B only, then Save and back. Matching reads
//     these at query time, so a change re-matches on the next shelf load; nothing to re-run.
//
// A and B are both skippable and nothing gates on them (this is not the old #19 goal-gate): goals
// are intent, never a tracked target. One local `step`, like setup-handle, so Back is just state.
//
// The reveal never opts anyone in silently. 0275's discoverable stays off until the person taps
// "Turn on matching" here; until then they still get forest suggestions, which need no opt-in.
//
// MOCK 333 (connection-first): the reveal is "find your people" — clubs that match what you picked
// ("★ Popular · matches Running"), people like you to add, Join / Add inline, skippable. It seeds
// the graph Discover and Chat run on from minute one. The ONLY competition on any onboarding screen
// is the one switch at the bottom, "Show me global standings", off unless you flip it.

/** A forest this size reads as an established club, not a stub — mock 333's "★ Popular". */
const POPULAR_MEMBERS = 25;

type Step = 1 | 2 | 3;

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
  const [showMore, setShowMore] = useState(false);
  const [query, setQuery] = useState('');
  // Skip means "don't touch this list", not "clear it" — an edit-mode Skip must not wipe a save.
  const [skippedA, setSkippedA] = useState(false);
  const [saving, setSaving] = useState(false);
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

  const byKind = useMemo(() => {
    const all = vocab ?? [];
    return {
      discipline: all.filter((t) => t.kind === 'discipline'),
      interest: all.filter((t) => t.kind === 'interest'),
      goal: all.filter((t) => t.kind === 'goal'),
    };
  }, [vocab]);

  const labelOf = useCallback((key: string) => vocab?.find((t) => t.key === key)?.label ?? key, [vocab]);

  // Featured hubs, plus anything already picked from behind "+ more" so a pick never hides itself.
  const shownInterests = byKind.interest.filter((t) => t.featured || tags.includes(t.key));
  const q = query.trim().toLowerCase();
  const moreInterests = byKind.interest.filter(
    (t) => !t.featured && !tags.includes(t.key) && (q === '' || t.label.toLowerCase().includes(q)),
  );

  /** Every exit from first run — done, skipped through, or "explore on my own". */
  const finish = useCallback(async () => {
    await clearInterestsPending(userId).catch(() => {});
    if (editing) router.back();
    else router.replace('/');
  }, [editing, router, userId]);

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
    if (editing) router.back();
    else setStep(3);
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

  const total = editing ? 2 : 3;
  const picked = disciplines.length + tags.length;

  return (
    <Screen padded={false} style={styles.container}>
      <View style={styles.spineRow}>
        <FirstRunSpine total={total} filled={step} label={`SETUP · ${step} of ${total}`} />
      </View>

      {step === 1 && (
        <>
          <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.h}>What are you into?</Text>
            <Text style={styles.sub}>Pick what you care about — we&apos;ll match you with people chasing the same things.</Text>

            <Text style={styles.sec}>Disciplines</Text>
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

            <Text style={styles.sec}>Forests · interest hubs</Text>
            <View style={styles.chips}>
              {shownInterests.map((t) => (
                <TagChip
                  key={t.key}
                  tag={t}
                  tone="legend"
                  selected={tags.includes(t.key)}
                  onPress={() => setTags((s) => toggle(s, t.key, MAX_INTERESTS))}
                />
              ))}
              {!showMore && (
                <Pressable style={styles.chip} onPress={() => setShowMore(true)} accessibilityRole="button">
                  <Icon name="plus" size={14} color={Colors.muted} />
                  <Text style={styles.chipText}>more</Text>
                </Pressable>
              )}
            </View>

            {showMore && (
              <View style={styles.more}>
                <View style={styles.search}>
                  <Icon name="search" size={15} color={Colors.spaceDim} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search interests"
                    placeholderTextColor={Colors.spaceFaint}
                    style={styles.searchInput}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.chips}>
                  {moreInterests.map((t) => (
                    <TagChip key={t.key} tag={t} tone="legend" selected={false} onPress={() => setTags((s) => toggle(s, t.key, MAX_INTERESTS))} />
                  ))}
                  {moreInterests.length === 0 ? <Text style={styles.none}>Nothing matches — try another word.</Text> : null}
                </View>
              </View>
            )}

            {programTags.length > 0 ? (
              <Text style={styles.programNote}>
                Your program already counts: {programTags.map(labelOf).join(', ')}
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.foot}>
            {picked > 0 ? (
              <View style={styles.match}>
                <Icon name="compass" size={16} color={Colors.green} />
                <Text style={styles.matchText}>
                  <Text style={styles.matchStrong}>{picked} selected</Text>
                </Text>
              </View>
            ) : null}
            <PrimaryButton
              label="Continue"
              onPress={() => {
                setSkippedA(false);
                setStep(2);
              }}
            />
            <Pressable
              style={styles.skip}
              onPress={() => {
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

      {step === 3 && <Reveal university={profile?.university ?? null} onDone={finish} />}
    </Screen>
  );
}

// ─────────────────────────── step C — the payoff ───────────────────────────
function Reveal({ university, onDone }: { university: string | null; onDone: () => void }) {
  const { profile, refreshProfile } = useAuth();
  // The competition opt-in (lib/competition) — written on the way out, only if switched on.
  const [standings, setStandings] = useState(false);
  const [discoverable, setDiscoverable] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [matches, setMatches] = useState<GrindAlike[] | null>(null);
  const [forests, setForests] = useState<SuggestedForest[] | null>(null);
  const [pickedPeople, setPickedPeople] = useState<string[]>([]);
  const [pickedForests, setPickedForests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchSuggestedForests(6)
      .then((rows) => {
        if (!live) return;
        setForests(rows);
        // Forests are low-stakes and leaving one is a tap — the top three start picked.
        setPickedForests(rows.slice(0, 3).map((f) => f.id));
      })
      .catch(() => {
        if (live) setForests([]);
      });
    fetchMyMatchSettings()
      .then((s) => {
        if (live) setDiscoverable(s.discoverable);
      })
      .catch(() => {
        if (live) setDiscoverable(false);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!discoverable) return;
    let live = true;
    fetchGrindAlikes(undefined, 5)
      .then((rows) => {
        if (live) setMatches(rows.filter((m) => !m.is_friend));
      })
      .catch(() => {
        if (live) setMatches([]);
      });
    return () => {
      live = false;
    };
  }, [discoverable]);

  async function enableMatching() {
    setEnabling(true);
    try {
      const s = await setMyMatchSettings({ discoverable: true });
      setDiscoverable(s.discoverable);
    } catch (e) {
      setNote(getErrorMessage(e, "Couldn't turn matching on — you can from People like you later."));
    } finally {
      setEnabling(false);
    }
  }

  async function saveStandings() {
    if (!standings) return;
    await setCompetitionOptIn(profile?.notification_prefs ?? null, true);
    await refreshProfile();
  }

  // People are never pre-picked: a friend request is the person's own call, one tap each.
  async function go() {
    setBusy(true);
    await Promise.allSettled([
      ...pickedForests.map((id) => joinForest(id)),
      ...pickedPeople.map((id) => sendFriendRequest(id)),
      saveStandings(),
    ]);
    setBusy(false);
    onDone();
  }

  async function skip() {
    setBusy(true);
    await saveStandings().catch(() => {});
    setBusy(false);
    onDone();
  }

  const school = university ? shortSchoolName(university) : null;
  const label =
    pickedPeople.length > 0 && pickedForests.length > 0
      ? `Add ${pickedPeople.length} & join ${pickedForests.length} forest${pickedForests.length === 1 ? '' : 's'}`
      : pickedPeople.length > 0
        ? `Add ${pickedPeople.length} ${pickedPeople.length === 1 ? 'person' : 'people'}`
        : pickedForests.length > 0
          ? `Join ${pickedForests.length} forest${pickedForests.length === 1 ? '' : 's'}`
          : 'Enter Philoi';

  return (
    <>
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
        <Text style={styles.h}>Here&apos;s who to connect with.</Text>
        <Text style={styles.sub}>
          Based on what you&apos;re into, these clubs and people {school ? `at ${school} ` : ''}are a match. Join a few — it&apos;s
          how Philoi comes alive.
        </Text>

        <Text style={styles.sec}>Clubs for you</Text>
        {!forests ? (
          <ActivityIndicator color={Colors.navEmber} style={styles.inlineSpin} />
        ) : forests.length === 0 ? (
          <Text style={styles.none}>Pick a few interests and we&apos;ll find your clubs — or browse forests from Discover.</Text>
        ) : (
          forests.map((f) => {
            const on = pickedForests.includes(f.id);
            const popular = f.member_count >= POPULAR_MEMBERS;
            return (
              <Pressable
                key={f.id}
                style={[styles.person, on && styles.personOn]}
                onPress={() => setPickedForests((s) => toggle(s, f.id))}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${on ? 'Leave' : 'Join'} ${f.name}`}>
                <View style={styles.clubTile}>
                  <Text style={styles.clubEmoji}>{f.emoji}</Text>
                </View>
                <View style={styles.personBody}>
                  <Text style={styles.personName} numberOfLines={1}>
                    {f.name}
                  </Text>
                  <Text style={styles.personWhy} numberOfLines={1}>
                    {f.purpose ? `${f.purpose} · ` : ''}
                    {f.member_count} {f.member_count === 1 ? 'member' : 'members'}
                    {f.visibility === 'request' ? ' · ask to join' : ''}
                  </Text>
                  {popular || f.because ? (
                    <Text style={styles.clubWhy} numberOfLines={1}>
                      {popular ? '★ Popular' : ''}
                      {popular && f.because ? ' · ' : ''}
                      {f.because ? `matches ${f.because}` : ''}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.addPill, on && styles.addPillOn]}>
                  <Icon name={on ? 'check' : 'plus'} size={13} color={on ? '#1a1030' : Colors.muted} />
                </View>
              </Pressable>
            );
          })
        )}

        <Text style={styles.sec}>People like you{school ? ` at ${school}` : ''}</Text>
        {discoverable === null ? (
          <ActivityIndicator color={Colors.navEmber} style={styles.inlineSpin} />
        ) : !discoverable ? (
          <View style={styles.optIn}>
            <Text style={styles.optInTitle}>Turn on matching to see them</Text>
            <Text style={styles.optInBody}>
              You&apos;ll show up for people {school ? `at ${school} ` : ''}who turned it on too — and only them. Off by default; change it
              anytime in People like you.
            </Text>
            <PrimaryButton label="Turn on matching" loading={enabling} onPress={enableMatching} />
          </View>
        ) : !matches ? (
          <ActivityIndicator color={Colors.navEmber} style={styles.inlineSpin} />
        ) : matches.length === 0 ? (
          <Text style={styles.none}>No one lines up yet — you&apos;re early. New people join every day; check People like you soon.</Text>
        ) : (
          matches.map((m) => {
            const on = pickedPeople.includes(m.user_id);
            return (
              <Pressable
                key={m.user_id}
                style={[styles.person, on && styles.personOn]}
                onPress={() => setPickedPeople((s) => toggle(s, m.user_id))}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${on ? 'Remove' : 'Add'} ${m.display_name}`}>
                <MatchAvatar name={m.display_name} avatarUrl={m.avatar_url} size={36} live={m.live} />
                <View style={styles.personBody}>
                  <Text style={styles.personName} numberOfLines={1}>
                    {m.handle ? `@${m.handle}` : m.display_name}
                  </Text>
                  <Text style={styles.personWhy} numberOfLines={1}>
                    {m.reasons
                      .slice(0, 3)
                      .map((r) => r.label)
                      .join(' · ')}
                  </Text>
                </View>
                {SHOW_ALIKE_SCORE ? <Text style={styles.pct}>{Math.round(m.score)}%</Text> : null}
                <View style={[styles.addPill, on && styles.addPillOn]}>
                  <Icon name={on ? 'check' : 'plus'} size={13} color={on ? '#1a1030' : Colors.muted} />
                </View>
              </Pressable>
            );
          })
        )}

        {note ? <Text style={styles.error}>{note}</Text> : null}

        {/* The one competition beat in onboarding — opt-in, off by default (lib/competition). */}
        <View style={styles.standings}>
          <View style={styles.personBody}>
            <Text style={styles.personName}>Show me global standings</Text>
            <Text style={styles.personWhy}>Off keeps Standings to your friends. Change it any time in Settings.</Text>
          </View>
          <Toggle value={standings} onValueChange={setStandings} />
        </View>
      </ScrollView>

      <View style={styles.foot}>
        <PrimaryButton label={label} loading={busy} onPress={go} />
        <Pressable style={styles.skip} onPress={() => void skip()} accessibilityRole="button" disabled={busy}>
          <Text style={styles.skipText}>Skip — I&apos;ll find people later</Text>
        </Pressable>
      </View>
    </>
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
  more: {
    marginTop: Spacing.twelve,
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
