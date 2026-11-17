import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { NativeConnectCards } from '@/components/connect/native-connect-cards';
import { FirstRunSpine, SPINE_ROW_HEIGHT } from '@/components/tutorial/first-run-spine';
import { EmberFill } from '@/components/ui/ember-fill';
import { Icon } from '@/components/ui/icon';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchInterestVocab, fetchMyInterests, PROGRAM_CATEGORY, setMyInterests, type VocabTag } from '@/lib/api/interests';
import { useAuth } from '@/lib/auth/auth-context';
import { clearInterestsPending } from '@/lib/interests-flow';

// ─────────────────────────── GYM SPARK · SETUP 2 of 2 (mock 405) ───────────────────────────
//
// Rendered by app/interests.tsx for the FIRST RUN when GYM_SPARK is on (?edit=1 keeps the legacy
// editor). Grouped chips — Active / Academic / Social & hobbies — over the same 0296 vocabulary,
// search, a live "N picked", then the native connect cards, then Continue → the matching reveal
// (/discover/matchmaking?onboarding=1 → /discover/your-people, which clears the interests-pending
// flag and lands on the Feed — that is where first run ends, as before).
//
// NO MATCHING TOGGLE. Every account is matchable by default (0303 seeds discoverable rows server
// side), so nothing is asked or written here; the off-switch lives in Settings, and the page says so.
//
// The ten 0296 categories fold into the mock's three groups. Program tags (Kinesiology, Pre-med…)
// are browsable here under Academic — the gym pocket has no program step to imply them.

const MAX_INTERESTS = 12;

type GroupKey = 'active' | 'academic' | 'social';

const GROUPS: readonly { key: GroupKey; title: string; dot: string }[] = [
  { key: 'active', title: 'Active', dot: '#39D98A' },
  { key: 'academic', title: 'Academic', dot: '#4FD6E0' },
  { key: 'social', title: 'Social & hobbies', dot: '#B98BFF' },
];

function groupOf(tag: VocabTag): GroupKey {
  if (tag.category === 'active') return 'active';
  if (tag.category === 'mind' || tag.category === 'finance' || tag.category === PROGRAM_CATEGORY) return 'academic';
  return 'social';
}

export function SparkInterestsScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const userId = profile?.id ?? null;

  const [vocab, setVocab] = useState<VocabTag[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [disciplines, setDisciplines] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [open, setOpen] = useState<GroupKey[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([fetchInterestVocab(), fetchMyInterests()])
      .then(([v, mine]) => {
        if (!live) return;
        setVocab(v);
        setDisciplines(mine.disciplines);
        setTags(mine.interest_tags);
        setLoadFailed(false);
      })
      .catch((e) => {
        console.warn('[spark-interests] could not load the vocabulary:', e);
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [loadKey]);

  const groups = useMemo(() => {
    const interest = (vocab ?? []).filter((t) => t.kind === 'interest');
    return GROUPS.map((g) => ({ ...g, tags: interest.filter((t) => groupOf(t) === g.key) })).filter((g) => g.tags.length > 0);
  }, [vocab]);

  const q = query.trim().toLowerCase();
  const results = q === '' ? [] : (vocab ?? []).filter((t) => t.kind === 'interest' && t.label.toLowerCase().includes(q));
  const dotFor = (t: VocabTag) => GROUPS.find((g) => g.key === groupOf(t))?.dot ?? Colors.spaceDim;
  const pick = (key: string) =>
    setTags((s) => (s.includes(key) ? s.filter((k) => k !== key) : s.length >= MAX_INTERESTS ? s : [...s, key]));

  /** Save what was picked (never blocking), then the reveal. Disciplines go back exactly as loaded. */
  async function onContinue() {
    setSaving(true);
    await setMyInterests({ disciplines, interest_tags: tags }).catch((e) =>
      console.warn('[spark-interests] could not save — continuing:', e)
    );
    setSaving(false);
    router.replace({ pathname: '/discover/matchmaking', params: { onboarding: '1' } } as never);
  }

  /** The vocabulary can't load: first run must never dead-end, so this exits to the Feed. */
  async function leave() {
    await clearInterestsPending(userId).catch(() => {});
    router.replace('/');
  }

  const spine = (
    <View style={styles.spineRow}>
      <FirstRunSpine total={2} filled={2} label="SETUP · 2 of 2" />
    </View>
  );

  if (loadFailed) {
    return (
      <Screen padded={false} style={styles.container}>
        {spine}
        <View style={styles.center}>
          <Text style={styles.h}>Couldn&apos;t load this just now</Text>
          <Text style={styles.sub}>You can set what you&apos;re into later from your profile.</Text>
          <PrimaryButton label="Try again" onPress={() => setLoadKey((k) => k + 1)} />
          <Pressable style={styles.skip} onPress={() => void leave()} accessibilityRole="button">
            <Text style={styles.skipText}>Continue to Philoi</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (!vocab) {
    return (
      <Screen padded={false} style={styles.container}>
        {spine}
        <ActivityIndicator color={Colors.navEmber} style={styles.spinner} />
      </Screen>
    );
  }

  return (
    <Screen padded={false} style={styles.container}>
      {spine}

      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.h}>What you&apos;re into</Text>
        <View style={styles.subRow}>
          <Text style={[styles.sub, styles.flex]}>Pick a few — it&apos;s how we find your people.</Text>
          <Text style={styles.count} accessibilityLiveRegion="polite">
            {tags.length} picked
          </Text>
        </View>

        <View style={styles.search}>
          <Icon name="search" size={16} color={Colors.spaceDim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search — climbing, coffee, anime…"
            placeholderTextColor={Colors.spaceDim}
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
          <View style={[styles.chips, styles.results]}>
            {results.map((t) => (
              <Chip key={t.key} label={t.label} dot={dotFor(t)} selected={tags.includes(t.key)} onPress={() => pick(t.key)} />
            ))}
            {results.length === 0 ? <Text style={styles.none}>Nothing matches — try another word.</Text> : null}
          </View>
        ) : (
          groups.map((g) => {
            const expanded = open.includes(g.key);
            // Featured chips, plus anything already picked, so a pick never hides itself.
            const shown = expanded ? g.tags : g.tags.filter((t) => t.featured || tags.includes(t.key));
            const hidden = g.tags.length - shown.length;
            return (
              <View key={g.key}>
                <Text style={styles.sec}>{g.title}</Text>
                <View style={styles.chips}>
                  {shown.map((t) => (
                    <Chip key={t.key} label={t.label} dot={g.dot} selected={tags.includes(t.key)} onPress={() => pick(t.key)} />
                  ))}
                  {hidden > 0 ? (
                    <Pressable
                      style={styles.chip}
                      onPress={() => setOpen((o) => [...o, g.key])}
                      accessibilityRole="button"
                      accessibilityLabel={`Show ${hidden} more in ${g.title}`}>
                      <Text style={styles.chipText}>+ {hidden} more</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })
        )}

        {tags.length >= MAX_INTERESTS ? (
          <Text style={styles.max}>{MAX_INTERESTS} max — tap one to swap it.</Text>
        ) : null}

        <Text style={styles.sec}>Connect (optional)</Text>
        <NativeConnectCards />

        <View style={styles.privacy}>
          <Icon name="compass" size={14} color={Colors.spaceDim} />
          <Text style={styles.privacyText}>You&apos;re matchable by default; turn it off in Settings.</Text>
        </View>
      </ScrollView>

      <View style={styles.foot}>
        <PrimaryButton label="Continue →" loading={saving} onPress={() => void onContinue()} />
      </View>
    </Screen>
  );
}

function Chip({ label, dot, selected, onPress }: { label: string; dot: string; selected: boolean; onPress: () => void }) {
  const a11y = { accessibilityRole: 'button' as const, accessibilityState: { selected }, accessibilityLabel: label };
  if (selected) {
    return (
      <Pressable onPress={onPress} {...a11y}>
        <EmberFill style={styles.chipOn}>
          <Icon name="check" size={13} color={INK_ON_EMBER} />
          <Text style={styles.chipTextOn}>{label}</Text>
        </EmberFill>
      </Pressable>
    );
  }
  return (
    <Pressable style={styles.chip} onPress={onPress} {...a11y}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const INK_ON_EMBER = '#160d26';

const styles = StyleSheet.create({
  // Same frame as setup page 1 (components/onboarding/spark-setup.tsx), so the spine doesn't move.
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
  h: {
    fontFamily: Fonts.black,
    fontSize: 24,
    color: Colors.ink,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: 4,
    marginBottom: 13,
  },
  sub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  count: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.navEmber2,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(26,18,48,0.6)',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13.5,
    letterSpacing: 0,
    color: Colors.ink,
    paddingVertical: 12,
  },
  results: {
    marginTop: 14,
  },
  sec: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: Colors.spaceDim,
    marginTop: 14,
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
    gap: 7,
    backgroundColor: 'rgba(36,26,58,0.55)',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: Radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipOn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingLeft: 12,
    paddingRight: 14,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  chipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  chipTextOn: {
    fontFamily: Fonts.black,
    fontSize: 13,
    color: INK_ON_EMBER,
  },
  none: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.spaceDim,
  },
  max: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 11.5,
    color: Colors.navEmber2,
    marginTop: Spacing.twelve,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: Spacing.twelve,
    paddingHorizontal: 2,
  },
  privacyText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: Colors.spaceDim,
  },
  foot: {
    paddingTop: Spacing.twelve,
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
});
