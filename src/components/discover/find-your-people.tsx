import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClubsForYou } from '@/components/discover/clubs-for-you';
import { PeopleLikeYou } from '@/components/home/people-like-you';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { Icon } from '@/components/ui/icon';
import { NavGlyph } from '@/components/ui/nav-glyph';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchInterestVocab, fetchMyInterests, vocabIcon, type VocabTag } from '@/lib/api/interests';

/**
 * DISCOVER = FIND YOUR PEOPLE (Phase 8.3, mock 336). The tab lands here, not on an infinite scroll:
 *   • a search field (people + clubs, by name or interest — the global /search, which matches forest
 *     tags too);
 *   • your interest chips, each a search for that interest; "+ edit" reopens the interests step;
 *   • People like you — the grind-alike engine (0275/0285), inline + Add;
 *   • Clubs for you — the forest suggestions (0285), inline Join;
 *   • then the square itself, one tap below (onOpenFeed) — the immersive feed, unchanged.
 * Every list comes from a matcher that already exists; nothing here orders by engagement and there
 * is no like button anywhere on it.
 */
export function FindYourPeople({ onOpenFeed }: { onOpenFeed: () => void }) {
  const router = useRouter();
  const [chips, setChips] = useState<VocabTag[] | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([fetchMyInterests(), fetchInterestVocab()])
      .then(([mine, vocab]) => {
        if (!live) return;
        const picked = new Set([...mine.disciplines, ...mine.interest_tags]);
        setChips(vocab.filter((v) => picked.has(v.key)));
      })
      .catch(() => {
        if (live) setChips([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => (chips ?? []).slice(0, 8), [chips]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <AppTopBar title="Discover" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable
          style={styles.search}
          onPress={() => router.push('/search')}
          accessibilityRole="search"
          accessibilityLabel="Find people and clubs by interest">
          <NavGlyph name="search" size={15} color={Colors.spaceDim} />
          <Text style={styles.searchText}>Find people &amp; clubs by interest…</Text>
        </Pressable>

        {chips ? (
          <View style={styles.chips}>
            {shown.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => router.push({ pathname: '/search', params: { q: c.label } } as never)}
                accessibilityRole="button"
                accessibilityLabel={`Find people and clubs into ${c.label}`}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                <Icon name={vocabIcon(c.icon)} size={12} color={Colors.navEmber2} />
                <Text style={styles.chipText}>{c.label}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => router.push({ pathname: '/interests', params: { edit: '1' } } as never)}
              accessibilityRole="button"
              accessibilityLabel="Edit your interests"
              style={({ pressed }) => [styles.chip, styles.chipEdit, pressed && styles.pressed]}>
              <Text style={styles.chipEditText}>{shown.length > 0 ? '+ edit' : '+ add your interests'}</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.sec}>People like you</Text>
        <PeopleLikeYou limit={4} lead={null} />

        <Text style={styles.sec}>Clubs for you</Text>
        <ClubsForYou limit={4} />

        <Pressable
          onPress={onOpenFeed}
          accessibilityRole="button"
          accessibilityLabel="See what people are posting"
          style={({ pressed }) => [styles.feedDoor, pressed && styles.pressed]}>
          <View style={styles.feedText}>
            <Text style={styles.feedTitle}>See what people are posting</Text>
          </View>
          <Icon name="forward" size={14} color={Colors.spaceDim} />
        </Pressable>
      </ScrollView>
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
  pressed: {
    opacity: 0.8,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    marginTop: Spacing.one,
  },
  searchText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceFaint,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,122,47,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,122,47,0.35)',
  },
  chipText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  chipEdit: {
    backgroundColor: 'transparent',
    borderColor: Colors.spaceLine,
    borderStyle: 'dashed',
  },
  chipEditText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  sec: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: 18,
    marginBottom: 7,
    marginHorizontal: 2,
  },
  feedDoor: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: Colors.spacePanel,
  },
  feedText: {
    flex: 1,
  },
  feedTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: Colors.ink,
  },
  feedSub: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.spaceDim,
    marginTop: 1,
  },
});
