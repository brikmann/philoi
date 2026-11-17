import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedPulseSheet, PulseEmojiTile, type PulseOption } from '@/components/gym-spark/feed-pulse-sheet';
import { GymPostCard } from '@/components/gym-spark/gym-post-card';
import { GymTopBar } from '@/components/gym-spark/gym-top-bar';
import { PrStoryButton } from '@/components/gym-spark/share/pr-story-button';
import { useGymPostModeration } from '@/components/gym-spark/use-gym-post-moderation';
import { PatronCrestTile } from '@/components/patron/patron-crest-tile';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchGymFeed, type GymFeedFilter, type GymFeedItem } from '@/lib/api/gym-spark';
import { fetchMyProgram, fetchProgramsForUniversity } from '@/lib/api/house';
import { fetchPatronRoster, patronTagline, type Patron } from '@/lib/api/patrons';
import { useAuth } from '@/lib/auth/auth-context';
import { fireLightTap } from '@/lib/reward-feedback';
import type { MyProgramRow, ProgramRow } from '@/types/house';

// THE GYM SPARK · the Feed, which is home (mock 400). The global GymTopBar (✈ 🔔 ☰, v2 §6), then the chip
// row over get_gym_feed, newest first; posting is the ＋ in the global top bar (GymTopBar). Comment-only —
// no cheer anywhere. A running session lives in the docked live lock-in bar, not here.
//
// CHIPS (v2 §7/§8, mocks 409/410): Feed · Following stay the PRIMARY pills — they stretch to fill the row
// when everything fits (Noah's full-width ask) — and {program} · {patron} follow as SECONDARY, smaller
// chips; the row scrolls sideways when it doesn't fit. Default stays Feed (everyone) — nothing auto-selects.
//   · Short tap on {program}/{patron}: toggles YOUR OWN filter on/off. While a picked value is active, a
//     tap clears back to Feed.
//   · Long-press (350ms, light haptic): the pulse picker sheet — any of your school's programs / any of the
//     twelve patrons. A pick filters the feed and relabels the chip to it ("Heracles" → "Ares").
//   · No program yet: the chip reads "Pick a program" and a tap opens the sheet too (hidden only when there
//     is no program AND no school to list programs for). No patron yet: "Pick a patron", same.
// Thin slices get a friendly empty state ("No posts in Kinesiology yet — be the first"), never blank; an
// RPC error on those chips (0307 not applied yet) shows that chip's error line, not a crash.
//
// Refreshes on focus, so a post you just made (compose → detail → back) and a comment you just left
// (its 💬 count and the top-comment line) are both there when you land back here. The refetch asks
// for as many rows as are already on screen (capped), so a focus refresh doesn't chop a long scroll.

const PAGE = 20;
const FOCUS_CAP = 60;
const LONG_PRESS_MS = 350;

type Lens = 'program' | 'patron';

const FEED: GymFeedFilter = { kind: 'gym' };

// 'prs' stays a valid GymFeedFilter (the server still serves it) but has no chip since v2 §4.
const PRIMARY: { filter: GymFeedFilter; label: string }[] = [
  { filter: FEED, label: 'Feed' },
  { filter: { kind: 'following' }, label: 'Following' },
];

const EMPTY: Record<'gym' | 'following' | 'prs', string> = {
  gym: 'Nothing posted yet. Be the first — tap + and post something.',
  following: 'Nobody you follow has posted yet.',
  prs: 'No PRs yet.',
};

// Programs carry no art of their own, so the pulse sheet's 🎓 tiles take a stable gradient from this
// set (mock 410's tile palette), keyed by the program so a row keeps its colour between opens.
const PROGRAM_TILES: readonly (readonly [string, string])[] = [
  ['#ff7a2f', '#ffb05a'],
  ['#378add', '#185fa5'],
  ['#e24b4a', '#a32d2d'],
  ['#f0b429', '#d4870b'],
  ['#1fae6b', '#0f6e56'],
  ['#b98bff', '#7a4df0'],
  ['#4fd6e0', '#2a9fb0'],
];

function programTile(key: string): readonly [string, string] {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return PROGRAM_TILES[Math.abs(h) % PROGRAM_TILES.length];
}

function sameFilter(a: GymFeedFilter, b: GymFeedFilter): boolean {
  if (a.kind !== b.kind) return false;
  if ((a.kind === 'program' || a.kind === 'patron') && (b.kind === 'program' || b.kind === 'patron')) {
    return a.value === b.value;
  }
  return true;
}

function emptyText(filter: GymFeedFilter, error: boolean): string {
  if (filter.kind === 'program' || filter.kind === 'patron') {
    return error
      ? `Couldn’t load posts in ${filter.label} right now. Pull down to try again.`
      : `No posts in ${filter.label} yet — be the first.`;
  }
  if (error) return 'Couldn’t load the feed. Pull down to try again.';
  return EMPTY[filter.kind];
}

export function GymFeedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ lockin?: string }>();
  const { profile } = useAuth();
  const [filter, setFilter] = useState<GymFeedFilter>(FEED);
  const [items, setItems] = useState<GymFeedItem[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Plain refs, read only inside callbacks: whether the last page came back short, how many rows are
  // on screen (for the focus refetch size), and a token so a slow response for an old chip is dropped.
  const done = useRef(false);
  const shown = useRef(0);
  const token = useRef(0);

  // A friend's "lock in?" nudge deep-links /?lockin=1 (installed builds and 0207 write that route).
  // The legacy home forwards it to the Lock In tab; so does this one.
  useEffect(() => {
    if (params.lockin === '1') {
      router.setParams({ lockin: undefined });
      router.navigate('/lockin');
    }
  }, [params.lockin, router]);

  const load = useCallback(async () => {
    const mine = ++token.current;
    const limit = Math.min(Math.max(shown.current, PAGE), FOCUS_CAP);
    try {
      const rows = await fetchGymFeed(filter, null, limit);
      if (mine !== token.current) return;
      done.current = rows.length < limit;
      shown.current = rows.length;
      setError(false);
      setItems(rows);
    } catch {
      if (mine !== token.current) return;
      setError(true);
      setItems((prev) => prev ?? []);
    }
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  function pickFilter(next: GymFeedFilter) {
    if (sameFilter(next, filter)) return;
    shown.current = 0;
    done.current = false;
    setItems(null);
    setError(false);
    setFilter(next);
  }

  // ── your own program + patron (the chips' default values) and the pulse sheet's lists ──
  const programId = profile?.program_id ?? null;
  const patronKey = profile?.patron_key ?? null;
  const [myProgramRow, setMyProgramRow] = useState<MyProgramRow | null>(null);
  const [roster, setRoster] = useState<Patron[] | null>(null);
  const [rosterFailed, setRosterFailed] = useState(false);
  const [programs, setPrograms] = useState<ProgramRow[] | null>(null);
  const [programsFailed, setProgramsFailed] = useState(false);
  const [sheet, setSheet] = useState<Lens | null>(null);
  const programsLoading = useRef(false);

  // get_my_program follows profiles.program_id; refetched when the program changes. A stale row (the
  // program was just changed) is ignored by the id check below rather than cleared here.
  useEffect(() => {
    if (!programId) return;
    let live = true;
    fetchMyProgram()
      .then((row) => {
        if (live) setMyProgramRow(row);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [programId]);

  // The twelve (cached for the session by fetchPatronRoster) — names, crests and taglines.
  useEffect(() => {
    let live = true;
    fetchPatronRoster()
      .then((r) => {
        if (live) setRoster(r);
      })
      .catch(() => {
        if (live) setRosterFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const myProgram = programId && myProgramRow?.program_id === programId ? myProgramRow : null;
  const myPatron = (patronKey && roster?.find((p) => p.key === patronKey)) || null;
  // Programs are per school: the sheet lists the viewer's school's programs (get_programs_for_university).
  const university = myProgram?.university?.trim() || profile?.university?.trim() || null;

  function ownFilter(lens: Lens): GymFeedFilter | null {
    if (lens === 'program') {
      return myProgram ? { kind: 'program', value: myProgram.program_id, label: myProgram.name } : null;
    }
    return myPatron ? { kind: 'patron', value: myPatron.key, label: myPatron.name } : null;
  }

  function loadPrograms() {
    if (programs !== null || programsLoading.current) return;
    if (!university) {
      setProgramsFailed(true);
      return;
    }
    programsLoading.current = true;
    setProgramsFailed(false);
    fetchProgramsForUniversity(university)
      .then((rows) => setPrograms([...rows].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setProgramsFailed(true))
      .finally(() => {
        programsLoading.current = false;
      });
  }

  function openSheet(lens: Lens) {
    fireLightTap();
    if (lens === 'program') loadPrograms();
    setSheet(lens);
  }

  // Short tap: an active program/patron filter (yours or a picked one) clears back to Feed; otherwise
  // it turns YOUR OWN on — or, with none set yet, opens the sheet so the chip is never a dead tap.
  function tapLens(lens: Lens) {
    if (filter.kind === lens) {
      pickFilter(FEED);
      return;
    }
    const own = ownFilter(lens);
    if (own) pickFilter(own);
    else openSheet(lens);
  }

  function pickFromSheet(option: PulseOption) {
    const lens = sheet;
    setSheet(null);
    if (lens) pickFilter({ kind: lens, value: option.key, label: option.name });
  }

  const patronOptions: PulseOption[] | null = roster
    ? roster.map((p) => ({
        key: p.key,
        name: p.name,
        tagline: patronTagline(p),
        tile: <PatronCrestTile patronKey={p.key} name={p.name} size={36} />,
      }))
    : null;
  const programOptions: PulseOption[] | null = programs
    ? programs.map((p) => ({
        key: p.program_id,
        name: p.name,
        tagline: [p.program_abbrev, university].filter(Boolean).join(' · '),
        tile: <PulseEmojiTile emoji="🎓" colors={programTile(p.program_key || p.program_id)} />,
        search: p.program_abbrev ?? undefined,
      }))
    : null;

  // What each secondary chip says: the active value when it's filtering, else your own, else a prompt.
  const programChip =
    filter.kind === 'program' ? filter.label : (myProgram?.name ?? (programId ? 'Program' : 'Pick a program'));
  const patronValue = filter.kind === 'patron' ? filter.value : (myPatron?.key ?? null);
  const patronChip =
    filter.kind === 'patron' ? filter.label : (myPatron?.name ?? (patronKey ? 'Patron' : 'Pick a patron'));
  const showProgramChip = Boolean(programId || university);

  async function refresh() {
    setRefreshing(true);
    shown.current = 0;
    await load();
    setRefreshing(false);
  }

  async function loadMore() {
    if (!items?.length || done.current || loadingMore || error) return;
    const mine = token.current;
    setLoadingMore(true);
    try {
      const last = items[items.length - 1];
      const more = await fetchGymFeed(filter, { created_at: last.created_at, id: last.id }, PAGE);
      if (mine !== token.current) return;
      if (more.length < PAGE) done.current = true;
      setItems((prev) => {
        const list = prev ?? [];
        const seen = new Set(list.map((p) => `${p.item_type}:${p.id}`));
        const next = [...list, ...more.filter((m) => !seen.has(`${m.item_type}:${m.id}`))];
        shown.current = next.length;
        return next;
      });
    } catch {
      // A failed page is retried by the next scroll-to-bottom.
    } finally {
      setLoadingMore(false);
    }
  }

  const moderation = useGymPostModeration((gone, reason) => {
    setItems((prev) =>
      (prev ?? []).filter((i) =>
        reason === 'blocked' ? i.user_id !== gone.user_id : !(i.id === gone.id && i.item_type === gone.item_type)
      )
    );
  });
  const openMore = moderation.open;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <GymTopBar />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
        accessibilityRole="tablist">
        {PRIMARY.map((f) => {
          const on = f.filter.kind === filter.kind;
          return (
            <Pressable
              key={f.filter.kind}
              onPress={() => pickFilter(f.filter)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
            </Pressable>
          );
        })}
        {showProgramChip ? (
          <LensChip
            on={filter.kind === 'program'}
            glyph={<Text style={styles.lensEmoji}>🎓</Text>}
            label={programChip}
            hint="Long-press to browse any program"
            onPress={() => tapLens('program')}
            onLongPress={() => openSheet('program')}
          />
        ) : null}
        <LensChip
          on={filter.kind === 'patron'}
          glyph={patronValue ? <PatronCrestTile patronKey={patronValue} size={16} /> : null}
          label={patronChip}
          hint="Long-press to browse any patron"
          onPress={() => tapLens('patron')}
          onLongPress={() => openSheet('patron')}
        />
      </ScrollView>

      {items === null ? (
        <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => `${i.item_type}:${i.id}`}
          renderItem={({ item }) => (
            // The card draws prAccessory only on PR posts; the button itself only shows on your own.
            <GymPostCard
              item={item}
              variant="feed"
              onMore={openMore}
              prAccessory={item.is_pr ? <PrStoryButton item={item} /> : null}
            />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={Separator}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={Colors.navEmber} />
          }
          ListEmptyComponent={<Text style={styles.empty}>{emptyText(filter, error)}</Text>}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={Colors.navEmber} style={styles.more} /> : null}
        />
      )}

      {moderation.sheets}

      <FeedPulseSheet
        visible={sheet === 'patron'}
        title="Sort the feed by patron"
        countLabel={`${patronOptions?.length ?? 12} total`}
        options={patronOptions}
        failed={rosterFailed}
        activeKey={filter.kind === 'patron' ? filter.value : null}
        onPick={pickFromSheet}
        onClose={() => setSheet(null)}
      />
      <FeedPulseSheet
        visible={sheet === 'program'}
        title="Sort the feed by program"
        countLabel={programOptions ? `${programOptions.length} programs` : ''}
        options={programOptions}
        failed={programsFailed}
        searchable
        activeKey={filter.kind === 'program' ? filter.value : null}
        onPick={pickFromSheet}
        onClose={() => setSheet(null)}
      />
    </SafeAreaView>
  );
}

/** A secondary {program}/{patron} chip: tap = your own on/off, hold = the pulse picker (the tiny ▾ says so). */
function LensChip({
  on,
  glyph,
  label,
  hint,
  onPress,
  onLongPress,
}: {
  on: boolean;
  glyph: ReactNode;
  label: string;
  hint: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  // RN's Pressable never fires onPress after onLongPress has fired, so a hold can't also toggle.
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
      style={({ pressed }) => [styles.lens, on && styles.lensOn, pressed && styles.lensPressed]}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityActions={[{ name: 'longpress', label: 'Pick any' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'longpress') onLongPress();
      }}>
      {glyph}
      <Text style={[styles.lensText, on && styles.lensTextOn]} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="chevron-down" size={11} color={on ? Colors.navEmber2 : Colors.spaceDim} />
    </Pressable>
  );
}

function Separator() {
  return <View style={styles.sep} />;
}


const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  chipScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipRow: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.twelve,
  },
  // Primary pills grow to share the row when everything fits (full width) and keep a floor when it scrolls.
  chip: {
    flexGrow: 1,
    minWidth: 96,
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  chipOn: {
    backgroundColor: Colors.navEmber2,
    borderColor: Colors.navEmber,
  },
  chipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14.5,
    color: Colors.ink,
  },
  chipTextOn: {
    color: '#1A1030',
  },
  lens: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 190,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(36,26,58,0.6)',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  lensOn: {
    backgroundColor: 'rgba(255,122,47,0.16)',
    borderColor: 'rgba(255,176,90,0.5)',
  },
  lensPressed: {
    opacity: 0.75,
  },
  lensEmoji: {
    fontSize: 13,
  },
  lensText: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.ink,
  },
  lensTextOn: {
    color: Colors.navEmber2,
  },
  loader: {
    marginTop: Spacing.six,
  },
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    flexGrow: 1,
  },
  sep: {
    height: Spacing.three,
  },
  empty: {
    marginTop: Spacing.six,
    paddingHorizontal: Spacing.five,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: Colors.spaceDim,
  },
  more: {
    marginVertical: Spacing.four,
  },
});
