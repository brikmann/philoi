import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoverCard, EmptyLine, ErrorLine, JoinButton, useJoin } from '@/components/discover/kit';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { SpaceHeader } from '@/components/ui/space-kit';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { joinClub, openClub } from '@/lib/api/discover';
import { fetchForests } from '@/lib/api/forests';
import { fetchSuggestedForests, type SuggestedForest } from '@/lib/api/interests';
import type { ForestSummary } from '@/types/social';

// CLUBS (ShareSpot ss2, mock 356) — cover-art cards with an ABOUT TAGLINE ON THE BANNER so you know
// what each club is ("3 runs/week · all paces" — the club's purpose line), interest-matched
// ("★ Popular · matches Running" — get_suggested_forests' own reason), live counts. Interest matches
// lead in the matcher's order; then every other club, most popular first. Join inline.

const POPULAR_MEMBERS = 25;

type Club = {
  id: string;
  name: string;
  emoji: string;
  purpose: string | null;
  members: number;
  online: number;
  because: string | null;
  mine: boolean;
};

function fromSuggested(f: SuggestedForest): Club {
  return { id: f.id, name: f.name, emoji: f.emoji, purpose: f.purpose, members: f.member_count, online: f.locked_in_now, because: f.because, mine: false };
}

function fromForest(f: ForestSummary): Club {
  return {
    id: f.id,
    name: f.name,
    emoji: f.emoji,
    purpose: f.purpose,
    members: f.member_count,
    online: f.locked_in_now,
    because: null,
    mine: f.my_status === 'active',
  };
}

function whyLine(c: Club): string {
  const popular = c.members >= POPULAR_MEMBERS ? '★ Popular' : null;
  const match = c.because ? `matches ${c.because}` : null;
  return [popular, match].filter(Boolean).join(' · ') || `${c.members} ${c.members === 1 ? 'member' : 'members'}`;
}

export default function ClubsBrowse() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [clubs, setClubs] = useState<{ q: string; rows: Club[] } | null>(null);
  const joins = useJoin();
  const q = query.trim();

  useEffect(() => {
    let live = true;
    const t = setTimeout(
      () => {
        Promise.all([q ? Promise.resolve([]) : fetchSuggestedForests(10).catch(() => []), fetchForests('popular', q || undefined).catch(() => [])]).then(
          ([suggested, all]) => {
            if (!live) return;
            const rows = suggested.map(fromSuggested);
            const seen = new Set(rows.map((r) => r.id));
            for (const f of all) if (!seen.has(f.id)) rows.push(fromForest(f));
            setClubs({ q, rows });
          },
        );
      },
      q ? 280 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const rows = clubs && clubs.q === q ? clubs.rows : null;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <SpaceHeader title="Clubs" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.search}>
          <NavGlyph name="search" size={15} color={Colors.spaceDim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search clubs…"
            placeholderTextColor={Colors.spaceFaint}
            style={styles.input}
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search clubs"
          />
        </View>
        {!rows ? <ActivityIndicator color={Colors.navEmber} style={styles.loader} /> : null}
        <View style={styles.cards}>
          {(rows ?? []).map((c) => (
            <CoverCard
              key={c.id}
              id={c.id}
              emoji={c.emoji}
              title={c.name}
              tagline={c.purpose}
              sub={whyLine(c)}
              online={c.online}
              onPress={() => openClub(router, c.id)}
              action={c.mine ? undefined : <JoinButton label={c.name} state={joins.state[c.id]} onPress={() => joins.run(c.id, () => joinClub(c.id))} />}
            />
          ))}
        </View>
        {rows && rows.length === 0 ? <EmptyLine>{q ? `No clubs match “${q}”.` : 'No clubs yet.'}</EmptyLine> : null}
        <ErrorLine message={joins.error} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.spaceBg },
  body: { paddingHorizontal: Spacing.three, paddingBottom: 120, gap: Spacing.twelve },
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
  cards: { gap: Spacing.twelve },
  loader: { marginTop: Spacing.three },
});
