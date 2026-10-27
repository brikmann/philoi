import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CampfirePreviewSheet } from '@/components/campfire-preview-sheet';
import { HouseSeal } from '@/components/house/house-seal';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { Avatar } from '@/components/ui/avatar';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchSuggestedPeople, searchPeople, type PersonSearchResult, type SuggestedPerson } from '@/lib/api/friend-requests';
import { fetchForests } from '@/lib/api/forests';
import { fetchDiscoverableGroups } from '@/lib/api/groups';
import { fetchProgramsForUniversity } from '@/lib/api/house';
import { searchExerciseLibrary } from '@/lib/api/stats';
import { useAuth } from '@/lib/auth/auth-context';
import type { DiscoverableGroup } from '@/types/database';
import type { ExerciseLibraryRow, ProgramRow } from '@/types/house';
import type { ForestSummary } from '@/types/social';

// SEARCH (nav restructure, mocks 302/303) — find anything, over the search endpoints that already
// exist. Its own screen, pushed from the 🔍 in the top bar on every tab (pre-submission fix E11):
// a real page you go back from, not a tab swapped in over the one you were on. Its categories are a
// DISCOVERY axis and live only here — they are not the feed's scope chips. Over the endpoints that
// already exist: search_people, get_programs_for_university, search_exercise_library, get_forests (0274) and
// the discoverable-campfires list. Nothing new server-side. Grind-alikes (0275) is the discovery
// card on the empty state.

type Category = 'all' | 'people' | 'programs' | 'exercises' | 'forests' | 'campfires';

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'people', label: 'People' },
  { key: 'programs', label: 'Programs' },
  { key: 'exercises', label: 'Exercises' },
  { key: 'forests', label: 'Forests' },
  { key: 'campfires', label: 'Campfires' },
];

type Results = {
  people: PersonSearchResult[];
  programs: ProgramRow[];
  exercises: ExerciseLibraryRow[];
  campfires: DiscoverableGroup[];
  forests: ForestSummary[];
};

const EMPTY: Results = { people: [], programs: [], exercises: [], campfires: [], forests: [] };

export default function SearchTab() {
  const router = useRouter();
  const { profile } = useAuth();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  // Results remember which query + category they answer, so "loading" is derived (results are
  // for something other than what's typed) rather than set synchronously inside the effect.
  const [answered, setAnswered] = useState<{ key: string; results: Results }>({ key: '', results: EMPTY });
  const [suggested, setSuggested] = useState<SuggestedPerson[]>([]);
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [activeForests, setActiveForests] = useState<ForestSummary[]>([]);
  const [previewGroupId, setPreviewGroupId] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    fetchSuggestedPeople(6)
      .then(setSuggested)
      .catch(() => setSuggested([]));
  }, []);

  // What the Forests chip shows before anything is typed: the most active ones.
  useEffect(() => {
    fetchForests('active')
      .then((f) => setActiveForests(f.slice(0, 12)))
      .catch(() => setActiveForests([]));
  }, []);

  // Programs are per school and small, so they're fetched once and filtered here.
  useEffect(() => {
    if (!profile?.university) return;
    fetchProgramsForUniversity(profile.university)
      .then(setPrograms)
      .catch(() => setPrograms([]));
  }, [profile?.university]);

  const trimmed = query.trim();

  const searchKey = `${category}:${trimmed}`;

  useEffect(() => {
    if (trimmed.length < 2) return;
    const mine = ++seq.current;
    // Debounced: one round of requests per pause in typing, not per keystroke. Only the newest
    // round may land, so a slow answer for "ben" can't paint over "bench press".
    const timer = setTimeout(() => {
      const want = (c: Category) => category === 'all' || category === c;
      Promise.all([
        want('people') ? searchPeople(trimmed, 12).catch(() => []) : Promise.resolve([]),
        want('exercises') ? searchExerciseLibrary(trimmed, 12).catch(() => []) : Promise.resolve([]),
        want('campfires') ? fetchDiscoverableGroups(undefined, trimmed, 12).catch(() => []) : Promise.resolve([]),
        want('forests') ? fetchForests('active', trimmed).catch(() => []) : Promise.resolve([]),
      ]).then(([people, exercises, campfires, forests]) => {
        if (mine !== seq.current) return;
        setAnswered({
          key: `${category}:${trimmed}`,
          results: { people, exercises, campfires, forests: forests.slice(0, 12), programs: [] },
        });
      });
    }, 280);
    return () => clearTimeout(timer);
  }, [trimmed, category]);

  const programHits = useMemo(() => {
    if (trimmed.length < 2 || !(category === 'all' || category === 'programs')) return [];
    const q = trimmed.toLowerCase();
    return programs.filter((p) =>
      [p.name, p.program_abbrev, p.patron_name].some((s) => (s ?? '').toLowerCase().includes(q))
    );
  }, [programs, trimmed, category]);

  const hasQuery = trimmed.length >= 2;
  const loading = hasQuery && answered.key !== searchKey;
  const results = hasQuery && !loading ? answered.results : EMPTY;
  const nothing =
    hasQuery &&
    !loading &&
    results.people.length + results.exercises.length + results.campfires.length + results.forests.length + programHits.length === 0;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* A pushed screen: close goes back to wherever you opened it. A cold deep link has nothing
          to go back to, so it lands on Social, where search used to live. */}
      <AppTopBar
        title="Search"
        right={
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.navigate('/social'))}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close search">
            <Ionicons name="close" size={20} color={Colors.ink} />
          </Pressable>
        }
      />

      <View style={styles.bar}>
        <NavGlyph name="search" size={18} color={Colors.spaceDim} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search people, programs, exercises…"
          placeholderTextColor={Colors.spaceFaint}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={17} color={Colors.spaceFaint} />
          </Pressable>
        ) : null}
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
          {CATEGORIES.map((c) => {
            const on = c.key === category;
            return (
              <Pressable
                key={c.key}
                onPress={() => setCategory(c.key)}
                style={[styles.cat, on && styles.catOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}>
                <Text style={[styles.catText, on && styles.catTextOn]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!hasQuery && (category === 'all' || category === 'people') ? (
          <>
            {/* Grind-alikes (0275, mock 299) — the discovery entry: match shelf → why you match →
                Add friend / Challenge, all on its own screens. */}
            <Pressable
              style={styles.ga}
              onPress={() => router.push('/grind-alikes' as never)}
              accessibilityRole="button"
              accessibilityLabel="Find your grind-alikes">
              <Text style={styles.gaTitle}>🧭 Grind-alikes</Text>
              <Text style={styles.gaBody}>People who lock in like you — same mix, goals, schedule.</Text>
              <Text style={styles.gaGo}>Find your people →</Text>
            </Pressable>

            {suggested.length > 0 ? <Text style={styles.section}>Suggested</Text> : null}
            {suggested.map((p) => (
              <ResultRow
                key={p.user_id}
                avatarUrl={p.avatar_url}
                initials={initialsOf(p.display_name)}
                title={p.display_name}
                sub={p.mutual_circle_name ? `In ${p.mutual_circle_name}` : p.handle ? `@${p.handle}` : null}
                onPress={() => router.push({ pathname: '/friend-profile', params: { userId: p.user_id } })}
              />
            ))}
          </>
        ) : null}

        {!hasQuery && category === 'forests' ? (
          <>
            {activeForests.length > 0 ? <Text style={styles.section}>Active now</Text> : null}
            {activeForests.map((f) => (
              <ForestRow key={f.id} forest={f} onPress={() => router.push({ pathname: '/forest/[id]', params: { id: f.id } } as never)} />
            ))}
          </>
        ) : null}

        {!hasQuery && category !== 'all' && category !== 'people' && category !== 'forests' ? (
          <Text style={styles.hint}>Type at least two letters to search.</Text>
        ) : null}

        {hasQuery && loading ? <ActivityIndicator color={Colors.navEmber} style={styles.loader} /> : null}

        {results.people.length > 0 ? <Text style={styles.section}>People</Text> : null}
        {results.people.map((p) => (
          <ResultRow
            key={p.user_id}
            avatarUrl={p.avatar_url}
            initials={initialsOf(p.display_name)}
            title={p.display_name}
            sub={[p.handle ? `@${p.handle}` : null, p.university].filter(Boolean).join(' · ') || null}
            onPress={() => router.push({ pathname: '/friend-profile', params: { userId: p.user_id } })}
          />
        ))}

        {programHits.length > 0 ? <Text style={styles.section}>Programs</Text> : null}
        {programHits.map((p) => (
          <ResultRow
            key={p.program_id}
            leading={<HouseSeal patronKey={p.patron_key} patronName={p.patron_name} size={30} />}
            title={p.name}
            sub={`Heir to ${p.patron_name.replace(/^The\s+/i, 'the ')}`}
            onPress={() => router.push('/house/change-program')}
          />
        ))}

        {results.exercises.length > 0 ? <Text style={styles.section}>Exercises</Text> : null}
        {results.exercises.map((e) => (
          <ResultRow
            key={e.slug}
            emoji="🏋️"
            title={e.name}
            sub={`Exercise board · ${e.lifters} ranked`}
            onPress={() =>
              router.push({
                pathname: '/fitness/exercise',
                params: { slug: e.slug, name: e.name, unit: e.unit, muscle: e.muscle_group ?? '' },
              })
            }
          />
        ))}

        {results.forests.length > 0 ? <Text style={styles.section}>Forests</Text> : null}
        {results.forests.map((f) => (
          <ForestRow key={f.id} forest={f} onPress={() => router.push({ pathname: '/forest/[id]', params: { id: f.id } } as never)} />
        ))}

        {results.campfires.length > 0 ? <Text style={styles.section}>Campfires</Text> : null}
        {results.campfires.map((g) => (
          <ResultRow
            key={g.id}
            emoji={g.emoji}
            title={g.name}
            sub={`${g.member_count} ${g.member_count === 1 ? 'member' : 'members'}`}
            onPress={() => setPreviewGroupId(g.id)}
          />
        ))}

        {nothing ? <Text style={styles.hint}>Nothing for “{trimmed}”.</Text> : null}
      </ScrollView>

      <CampfirePreviewSheet groupId={previewGroupId} onClose={() => setPreviewGroupId(null)} />
    </SafeAreaView>
  );
}

function ForestRow({ forest, onPress }: { forest: ForestSummary; onPress: () => void }) {
  const live = forest.locked_in_now > 0 ? ` · ${forest.locked_in_now} locked in` : '';
  return (
    <ResultRow
      emoji={forest.emoji}
      title={forest.name}
      sub={`${forest.member_count} ${forest.member_count === 1 ? 'member' : 'members'}${live}`}
      onPress={onPress}
    />
  );
}

function initialsOf(name: string | null | undefined): string {
  return (name || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function ResultRow({
  avatarUrl,
  initials,
  emoji,
  leading,
  title,
  sub,
  onPress,
}: {
  avatarUrl?: string | null;
  initials?: string;
  emoji?: string;
  leading?: React.ReactNode;
  title: string;
  sub: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      {leading ??
        (avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : emoji ? (
          <View style={styles.emojiTile}>
            <Text style={styles.emoji}>{emoji}</Text>
          </View>
        ) : (
          <Avatar label={initials ?? '?'} size={36} />
        ))}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={14} color={Colors.spaceFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Opaque: a full screen of its own, not a translucent layer over the page you came from.
  safe: {
    flex: 1,
    backgroundColor: Colors.spaceBg,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    paddingHorizontal: Spacing.twelve,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  input: {
    flex: 1,
    padding: 0,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  cats: {
    gap: 6,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twelve,
  },
  cat: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  catOn: {
    backgroundColor: 'rgba(255,122,47,0.12)',
    borderColor: Colors.navEmber,
  },
  catText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  catTextOn: {
    color: Colors.navEmber2,
  },
  body: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: 6,
  },
  ga: {
    padding: Spacing.three,
    borderRadius: 16,
    backgroundColor: 'rgba(185,139,255,0.08)',
    borderWidth: 1,
    borderColor: '#3A2D5A',
    gap: 4,
    marginBottom: Spacing.two,
  },
  gaTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  gaBody: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  gaGo: {
    marginTop: 4,
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: Colors.legend,
  },
  section: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: Spacing.twelve,
    marginBottom: 2,
  },
  hint: {
    marginTop: Spacing.four,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  loader: {
    marginTop: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 10,
    paddingHorizontal: Spacing.twelve,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  emojiTile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.spacePanel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 18,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  rowSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
  },
});
