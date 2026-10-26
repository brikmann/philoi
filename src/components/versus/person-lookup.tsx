import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PublicTitle } from '@/components/economy/loadout-bits';
import { CosmeticAvatar } from '@/components/economy/public-identity';
import { HouseSealInline } from '@/components/house/house-seal';
import { IdentityLine } from '@/components/house/identity-line';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { UiGlyph } from '@/components/ui/ui-glyph';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { usePublicLoadouts, type PublicLoadout } from '@/hooks/use-public-loadouts';
import { searchPeople, type PersonSearchResult } from '@/lib/api/friend-requests';
import { getErrorMessage } from '@/lib/errors';

type PersonLookupProps = {
  /** The caller — never offered as their own opponent. */
  myId: string | null;
  onPick: (person: PersonSearchResult) => void;
};

// Step 1 of head-to-head (mock 292, left frame): a lookup, not a board filter. search_people finds
// anyone on Philoi — no friendship needed — and each row carries what you'd want to know before
// lining someone up: their house · program · school and their custom title.
export function PersonLookup({ myId, onPick }: PersonLookupProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadouts = usePublicLoadouts(results.map((r) => r.user_id));

  // Debounced the same way add-friend's search is: one request per pause, not per keystroke.
  function handleChange(text: string) {
    setQuery(text);
    const empty = text.trim().length === 0;
    setSearching(!empty);
    if (empty) setResults([]);
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const timer = setTimeout(() => {
      searchPeople(trimmed)
        .then((rows) => {
          setError(null);
          setResults(rows.filter((r) => r.user_id !== myId));
        })
        .catch((e) => setError(getErrorMessage(e, 'Search failed.')))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, myId]);

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <NavGlyph name="search" size={16} color={Colors.spaceFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder="Find anyone — @username or name"
          placeholderTextColor={Colors.spaceFaint}
          value={query}
          onChangeText={handleChange}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        {searching && <ActivityIndicator size="small" color={Colors.spaceFaint} />}
      </View>

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {error && <Text style={styles.error}>{error}</Text>}
        {results.map((person) => (
          <LookupRow key={person.user_id} person={person} loadout={loadouts[person.user_id] ?? {}} onPress={() => onPick(person)} />
        ))}
        {query.trim().length > 0 && !searching && results.length === 0 && !error ? (
          <Text style={styles.hint}>No one found by that name.</Text>
        ) : null}
        {query.trim().length === 0 ? (
          <Text style={styles.hint}>Find anyone — friend or not. Tap to line them up against you.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function LookupRow({ person, loadout, onPress }: { person: PersonSearchResult; loadout: PublicLoadout; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.row} accessibilityRole="button" accessibilityLabel={`Compare with ${person.display_name}`}>
      <CosmeticAvatar
        userId={person.user_id}
        name={person.display_name}
        avatarUrl={person.avatar_url}
        size={36}
        loadout={loadout}
        motion="reduced"
      />
      <View style={styles.who}>
        <Text style={styles.name} numberOfLines={1}>
          {person.display_name}
          <HouseSealInline userId={person.user_id} size={13} />
          {person.handle ? <Text style={styles.handle}> @{person.handle}</Text> : null}
        </Text>
        <IdentityLine userId={person.user_id} university={person.university} style={styles.identity} />
        <PublicTitle loadout={loadout} compact />
      </View>
      <UiGlyph name="forward" size={14} color={Colors.spaceFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 4,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
    letterSpacing: 0,
  },
  list: {
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
  },
  // SpaceRow's look (panel, 1px line, 13 corners) — not SpaceRow itself, which takes a plain title
  // and this row's name line carries the seal and handle inline.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twelve,
    paddingVertical: 11,
    paddingHorizontal: Spacing.twelve,
    marginBottom: Spacing.two,
    borderRadius: 13,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  who: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceFaint,
  },
  identity: {
    fontSize: 10,
    marginTop: 1,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.spaceFaint,
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    textAlign: 'center',
    paddingVertical: Spacing.two,
  },
});
