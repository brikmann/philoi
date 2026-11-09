import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyLine, ErrorLine, PersonRow, useAddFriend } from '@/components/discover/kit';
import { MatchingOptIn } from '@/components/discover/matching-opt-in';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { SpaceHeader } from '@/components/ui/space-kit';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { openCampfire } from '@/lib/api/discover';
import { searchPeople } from '@/lib/api/friend-requests';
import { fetchGrindAlikes, fetchMyMatchSettings } from '@/lib/api/matchmaking';
import type { GrindAlike } from '@/types/social';

// PEOPLE (ShareSpot ss2, mock 354) — the matched list behind Search's "People like you" row.
// Filters: For you (the engine's own order), Program (scope = your program), Interests (matches
// that share a declared interest tag), Active (live right now). Add inline. The search box filters
// the list by name and, past two letters, also finds anyone by name or @handle.
//
// The engine is opt-in (0275): until you're discoverable it shows no one, so the page leads with
// the switch instead of an empty list.

type Filter = 'for_you' | 'program' | 'interests' | 'active';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'for_you', label: 'For you' },
  { key: 'program', label: 'Program' },
  { key: 'interests', label: 'Interests' },
  { key: 'active', label: 'Active' },
];

export default function PeopleBrowse() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('for_you');
  const [discoverable, setDiscoverable] = useState<boolean | null>(null);
  const [lists, setLists] = useState<{ all: GrindAlike[]; program: GrindAlike[] } | null>(null);
  const [query, setQuery] = useState('');
  const [named, setNamed] = useState<{ q: string; rows: Awaited<ReturnType<typeof searchPeople>> }>({ q: '', rows: [] });
  const [reload, setReload] = useState(0);
  const adds = useAddFriend();

  useEffect(() => {
    let live = true;
    fetchMyMatchSettings()
      .then((s) => {
        if (!live) return;
        setDiscoverable(s.discoverable);
        if (!s.discoverable) {
          setLists({ all: [], program: [] });
          return;
        }
        return Promise.all([fetchGrindAlikes(undefined, 40), fetchGrindAlikes('program', 40)]).then(([all, program]) => {
          if (live) setLists({ all, program });
        });
      })
      .catch(() => {
        if (live) setLists({ all: [], program: [] });
      });
    return () => {
      live = false;
    };
  }, [reload]);

  const q = query.trim().toLowerCase();
  useEffect(() => {
    if (q.length < 2) return;
    const t = setTimeout(() => {
      searchPeople(q, 12)
        .then((rows) => setNamed({ q, rows }))
        .catch(() => setNamed({ q, rows: [] }));
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  const shown = useMemo(() => {
    if (!lists) return [];
    const base =
      filter === 'program'
        ? lists.program
        : filter === 'interests'
          ? lists.all.filter((m) => m.reasons.some((r) => r.key.startsWith('tag:') || r.key.startsWith('interest:')))
          : filter === 'active'
            ? lists.all.filter((m) => m.live)
            : lists.all;
    return q ? base.filter((m) => m.display_name.toLowerCase().includes(q) || (m.handle ?? '').toLowerCase().includes(q)) : base;
  }, [lists, filter, q]);

  const extra = q.length >= 2 && named.q === q ? named.rows.filter((p) => !shown.some((m) => m.user_id === p.user_id)) : [];

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <SpaceHeader title="People" />
      <View style={styles.pad}>
        <View style={styles.search}>
          <NavGlyph name="search" size={15} color={Colors.spaceDim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search people…"
            placeholderTextColor={Colors.spaceFaint}
            style={styles.input}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search people"
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => {
            const on = f.key === filter;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {discoverable === false ? <MatchingOptIn onEnabled={() => setReload((n) => n + 1)} /> : null}
        {!lists ? <ActivityIndicator color={Colors.navEmber} style={styles.loader} /> : null}

        {shown.map((m) => (
          <PersonRow
            key={m.user_id}
            name={m.display_name}
            avatarUrl={m.avatar_url}
            sub={m.reasons.slice(0, 3).map((r) => r.label).join(' · ') || null}
            live={m.live}
            isFriend={m.is_friend}
            addState={adds.state[m.user_id]}
            onAdd={() => adds.add(m.user_id)}
            onPress={() => openCampfire(router, { userId: m.user_id, handle: m.handle })}
          />
        ))}

        {extra.length > 0 ? <Text style={styles.section}>By name</Text> : null}
        {extra.map((p) => (
          <PersonRow
            key={p.user_id}
            name={p.display_name}
            avatarUrl={p.avatar_url}
            sub={[p.handle ? `@${p.handle}` : null, p.university].filter(Boolean).join(' · ') || null}
            isFriend={p.relationship === 'friends'}
            addState={adds.state[p.user_id]}
            onAdd={() => adds.add(p.user_id)}
            onPress={() => openCampfire(router, { userId: p.user_id, handle: p.handle })}
          />
        ))}

        {lists && discoverable && shown.length === 0 && extra.length === 0 ? (
          <EmptyLine>
            {filter === 'active'
              ? 'Nobody you match is locked in right now.'
              : q
                ? `No one matches “${query.trim()}”.`
                : 'No matches yet. Add a few interests and check back.'}
          </EmptyLine>
        ) : null}
        <ErrorLine message={adds.error} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  pad: { paddingHorizontal: Spacing.three },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  input: { flex: 1, fontFamily: Fonts.body, fontSize: 15, color: Colors.ink, paddingVertical: 0 },
  chips: { gap: Spacing.two, paddingVertical: Spacing.twelve },
  chip: {
    paddingHorizontal: Spacing.three,
    height: 34,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  chipOn: { backgroundColor: Colors.navEmber2, borderColor: Colors.navEmber2 },
  chipText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.muted },
  chipTextOn: { color: Colors.onEmber },
  body: { paddingHorizontal: Spacing.three, paddingBottom: 120 },
  section: { marginTop: Spacing.three, fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  loader: { marginTop: Spacing.four },
});
