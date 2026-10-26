import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useId, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { HouseSeal } from '@/components/house/house-seal';
import { IdentityLine } from '@/components/house/identity-line';
import { AppTopBar } from '@/components/nav/app-top-bar';
import { PrivateClimb } from '@/components/private-climb';
import { usePresence } from '@/hooks/use-presence';
import {
  usePublicLoadouts,
  useRefreshPublicLoadoutsOnFocus,
  type PublicLoadout,
} from '@/hooks/use-public-loadouts';
import { Avatar } from '@/components/ui/avatar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useMetricCatalog, useMetricLeaderboard } from '@/hooks/use-metric-leaderboard';
import { fetchMyProgram } from '@/lib/api/house';
import { rankVisibilityOf } from '@/lib/api/privacy';
import { useAuth } from '@/lib/auth/auth-context';
import { titleLabel } from '@/lib/economy/catalog';
import type { Rarity } from '@/lib/economy/rarity';
import { formatMetricValue } from '@/lib/stats/format';
import type { PresenceRow } from '@/types/database';
import type { MetricCatalogRow, MetricLeaderboardRow, MetricScope, MyProgramRow } from '@/types/house';

// THE LEADERBOARD TAB — the new global board (nav restructure, mock 302). Clean and simple: one
// scope toggle, one metric picker, ranked rows that each carry the person's Heir identity (house
// seal + program line), you highlighted. Everything reads get_metric_leaderboard (0265) as-is.
//
// EVERY MEMBER IN SCOPE (0276): ranked people first, then everyone with nothing logged as "not
// ranked yet", so the board reads as the real member base. A server without 0276 just returns the
// ranked part (stats.ts falls back). The green dot is live presence (get_presence, polled while
// focused); "Live now" narrows the board to who's locked in this minute.
//
// Row body → Head-to-Head vs them. Avatar → their profile. Your own row → your Profile.
// The pre-restructure board screen is gone (ui_pass2 §8): this is the only board UI. Fitness boards
// and Challenges sit one tap away in the tools row; a campfire's own board lives on the campfire.

const SCOPES: { key: MetricScope; label: string }[] = [
  { key: 'global', label: 'Global' },
  { key: 'my_uni', label: 'My Uni' },
  { key: 'my_program', label: 'Program' },
  { key: 'friends', label: 'Friends' },
];

const DEFAULT_METRIC = 'season_xp';

// Server-written pushes still name the OLD board's scopes (0253 sends {"scope":"uni"}); map them
// onto this board's. 'camp' and 'vs' have no equivalent here and land on the Global default.
const LINKED_SCOPE: Record<string, MetricScope> = {
  uni: 'my_uni',
  my_uni: 'my_uni',
  house: 'my_program',
  my_program: 'my_program',
  global: 'global',
  friends: 'friends',
};

export default function LeaderboardTab() {
  const router = useRouter();
  const { profile } = useAuth();
  // The viewer's own visibility dial, honoured exactly as the old board did: private sees only their
  // own climb, friends-only sees only the Friends board.
  const dial = rankVisibilityOf(profile);
  const [pickedScope, setPickedScope] = useState<MetricScope>('global');
  const { scope: linkedScope } = useLocalSearchParams<{ scope?: string }>();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows the route param, which changes on a push tap while the tab stays mounted
    if (linkedScope && LINKED_SCOPE[linkedScope]) setPickedScope(LINKED_SCOPE[linkedScope]);
  }, [linkedScope]);
  const scope: MetricScope = dial === 'friends' ? 'friends' : pickedScope;
  const scopes = dial === 'friends' ? SCOPES.filter((s) => s.key === 'friends') : SCOPES;

  const { catalog } = useMetricCatalog();
  const [metricKey, setMetricKey] = useState(DEFAULT_METRIC);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [liveOnly, setLiveOnly] = useState(false);
  const stat = catalog.find((r) => r.key === metricKey) ?? null;

  const [program, setProgram] = useState<MyProgramRow | null>(null);
  const [programLoaded, setProgramLoaded] = useState(false);
  useEffect(() => {
    fetchMyProgram()
      .then(setProgram)
      .catch(() => setProgram(null))
      .finally(() => setProgramLoaded(true));
  }, []);

  // Same gates as the fitness board: a scope that can't have a board for this viewer explains itself.
  const gate: 'none' | 'no_school' | 'unverified' | 'no_program' =
    scope === 'my_uni' && !profile?.university
      ? 'no_school'
      : scope === 'my_uni' && !profile?.university_email_verified
        ? 'unverified'
        : scope === 'my_program' && programLoaded && !program
          ? 'no_program'
          : 'none';
  const held = dial === 'private' || gate !== 'none' || (scope === 'my_program' && !programLoaded) || !stat;

  const { rows, loading, error, refetch } = useMetricLeaderboard({
    metric: held || !stat ? null : stat.metric,
    scope,
    window: stat?.metric_window ?? 'all',
    includeUnranked: true,
  });
  const presence = usePresence(rows.map((r) => r.user_id));
  // Each row wears its owner's gear (mock 307): one batched read for the board, re-read on focus so
  // someone who re-equipped since you last looked isn't frozen in their old loadout.
  const rowIds = useMemo(() => rows.map((r) => r.user_id), [rows]);
  const loadouts = usePublicLoadouts(rowIds);
  useRefreshPublicLoadoutsOnFocus(rowIds);
  const liveCount = rows.filter((r) => presence[r.user_id]?.locked_in).length;
  const shownRows = liveOnly ? rows.filter((r) => presence[r.user_id]?.locked_in) : rows;

  const format = (v: number) => (stat ? formatMetricValue(stat.unit, v) : String(v));

  function openProfile(row: MetricLeaderboardRow) {
    if (row.is_me) router.push('/profile');
    else router.push({ pathname: '/friend-profile', params: { userId: row.user_id } });
  }

  function openRow(row: MetricLeaderboardRow) {
    if (row.is_me) router.push('/profile');
    else router.push({ pathname: '/versus', params: { with: row.user_id } });
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <AppTopBar />
      <View style={styles.head}>
        <Text style={styles.title}>Leaderboard</Text>
      </View>

      {dial === 'private' ? (
        <PrivateClimb />
      ) : (
        <>
          <View style={styles.scope}>
            {scopes.map((s) => {
              const on = s.key === scope;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => setPickedScope(s.key)}
                  style={[styles.scopeBtn, on && styles.scopeBtnOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}>
                  <Text style={[styles.scopeText, on && styles.scopeTextOn]}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.tools}>
            <Pressable style={styles.metric} onPress={() => setPickerOpen(true)} accessibilityRole="button">
              <Text style={styles.metricText} numberOfLines={1}>
                {stat ? `${stat.emoji} ${stat.label}` : 'Loading stats…'}
              </Text>
              <Ionicons name="chevron-down" size={14} color={Colors.spaceDim} />
            </Pressable>
            <Pressable
              style={[styles.live, liveOnly && styles.liveOn]}
              onPress={() => setLiveOnly((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ selected: liveOnly }}
              accessibilityLabel={`Live now, ${liveCount} locked in`}>
              <View style={styles.liveDot} />
              <Text style={[styles.liveText, liveOnly && styles.liveTextOn]}>Live {liveCount > 0 ? liveCount : ''}</Text>
            </Pressable>
            <QuickLink label="Fitness" onPress={() => router.push('/fitness')} />
            <QuickLink label="Challenges" onPress={() => router.push('/challenges')} />
          </View>

          {gate !== 'none' ? (
            <GateNotice gate={gate} />
          ) : (
            <FlatList
              data={shownRows}
              keyExtractor={(r) => r.user_id}
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={refetch} tintColor={Colors.navEmber} />}
              ListEmptyComponent={
                loading ? (
                  <ActivityIndicator color={Colors.navEmber} style={styles.loader} />
                ) : (
                  <Text style={styles.empty}>
                    {error ?? (liveOnly ? 'Nobody on this board is locked in right now.' : 'Nobody on this board yet — lock in and open it.')}
                  </Text>
                )
              }
              renderItem={({ item }) => (
                <BoardRow
                  row={item}
                  value={item.rank == null ? '—' : format(item.value)}
                  presence={presence[item.user_id]}
                  loadout={loadouts[item.user_id] ?? NO_LOADOUT}
                  onPressRow={openRow}
                  onPressAvatar={openProfile}
                />
              )}
            />
          )}
        </>
      )}

      <MetricPicker
        visible={pickerOpen}
        catalog={catalog}
        selectedKey={metricKey}
        onPick={(r) => {
          setMetricKey(r.key);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const NO_LOADOUT: PublicLoadout = {};

/**
 * How strongly an equipped Card tints the row. Small-scale on purpose (mock 307): a row is a
 * thumbnail of the card, so the tint stays faint — but a Legendary still has to read richer than a
 * Common at a glance, or the board stops being a reason to own one.
 */
const CARD_TINT: Record<Rarity, number> = {
  common: 0.08,
  uncommon: 0.095,
  rare: 0.11,
  epic: 0.14,
  legendary: 0.18,
  mythic: 0.22,
};

/** '#RRGGBB' (or '#RGB') at an alpha. Anything else comes back as-is, opaque. */
function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * A board row, styled to ITS OWNER'S equipped loadout (mock 307) — the public flex that sells
 * cosmetics. Same reads the profile and share card use (get_public_loadouts):
 *
 *  · FLARE → `f`: the row's outline and glow, the rank number and the avatar border.
 *  · HALO  → a radial glow ring behind the avatar, in the halo's colour.
 *  · CARD  → a faint gradient of its colour into the panel, stronger with rarity.
 *  · TITLE → under the name. EARNED titles are ★ + gold; anything acquired another way is italic in
 *    the flare colour. A purchase must never be able to look like an achievement.
 *
 * Nothing equipped draws the plain panel. Your own row keeps the ember edge when you wear no flare.
 * The heir seal and the identity line are untouched.
 */
function BoardRow({
  row,
  value,
  presence,
  loadout,
  onPressRow,
  onPressAvatar,
}: {
  row: MetricLeaderboardRow;
  value: string;
  presence: PresenceRow | undefined;
  loadout: PublicLoadout;
  onPressRow: (row: MetricLeaderboardRow) => void;
  onPressAvatar: (row: MetricLeaderboardRow) => void;
}) {
  const haloId = useId();
  const initials = (row.display_name || row.handle || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const flare = loadout.flare ? (loadout.flare.flare?.colour ?? loadout.flare.art.to) : null;
  const f = flare ?? (row.is_me ? Colors.navEmber : null);
  const rankColor = f ?? (row.rank === 1 ? Colors.gold : Colors.spaceDim);
  const card = loadout.card;
  const tintColour = card?.art.from ?? f;
  const tintAlpha = card ? CARD_TINT[card.rarity] : 0.14;
  const halo = loadout.halo?.art.from ?? null;
  const title = loadout.title ? { ...titleLabel(loadout.title), earned: loadout.title.acquisition === 'earned' } : null;

  return (
    <Pressable
      style={[
        styles.row,
        f ? [styles.rowWorn, { borderColor: f, shadowColor: f }] : null,
        row.is_me && styles.rowMe,
      ]}
      onPress={() => onPressRow(row)}
      accessibilityRole="button"
      accessibilityLabel={`${row.rank == null ? 'Not ranked yet' : row.rank}. ${row.is_me ? 'You' : row.display_name}${title ? `, ${title.earned ? 'earned title' : 'title'} ${title.name}` : ''}${presence?.locked_in ? ', locked in now' : ''}, ${value}${row.is_me ? '' : '. Head-to-head'}`}>
      {tintColour ? (
        <LinearGradient
          pointerEvents="none"
          colors={[withAlpha(tintColour, tintAlpha), withAlpha(tintColour, 0)]}
          locations={[0, 0.7]}
          start={{ x: 0, y: 0.3 }}
          end={{ x: 1, y: 0.7 }}
          style={styles.tint}
        />
      ) : null}
      <Text style={[styles.rank, { color: rankColor }]}>{row.rank ?? '—'}</Text>
      <Pressable onPress={() => onPressAvatar(row)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Open profile">
        {halo ? (
          <Svg pointerEvents="none" width={HALO} height={HALO} style={styles.halo}>
            <Defs>
              <RadialGradient id={haloId} cx="50%" cy="50%" r="50%">
                <Stop offset="0.6" stopColor={halo} stopOpacity={0.6} />
                <Stop offset="1" stopColor={halo} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={HALO / 2} cy={HALO / 2} r={HALO / 2} fill={`url(#${haloId})`} />
          </Svg>
        ) : null}
        <View style={[styles.avatarRing, f ? { borderColor: f } : null]}>
          {row.avatar_url ? (
            <Image source={{ uri: row.avatar_url }} style={styles.avatar} contentFit="cover" />
          ) : (
            <Avatar label={initials} size={36} />
          )}
        </View>
        {/* Presence: bright = locked in now, soft = online. Nothing when neither. */}
        {presence?.locked_in || presence?.online ? (
          <View style={[styles.presenceDot, !presence.locked_in && styles.presenceDotOnline]} />
        ) : null}
      </Pressable>
      <View style={styles.who}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            {row.is_me ? 'You' : row.display_name}
          </Text>
          {row.patron_key ? <HouseSeal patronKey={row.patron_key} size={13} /> : null}
        </View>
        {title ? (
          <Text
            style={[styles.rowTitle, title.earned ? styles.rowTitleEarned : { color: f ?? Colors.legend }]}
            numberOfLines={1}>
            {title.earned ? '★ ' : ''}
            {title.name}
            {title.stamp ? ` · ${title.stamp}` : ''}
          </Text>
        ) : null}
        {row.rank == null ? (
          <Text style={styles.identity}>Not ranked yet</Text>
        ) : (
          <IdentityLine userId={row.user_id} university={row.university} style={styles.identity} />
        )}
      </View>
      <Text style={styles.value}>{value}</Text>
    </Pressable>
  );
}

/** The halo's glow box — the 36px avatar plus its 2px ring, with ~7px of glow on every side. */
const HALO = 54;

function QuickLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quick} onPress={onPress} accessibilityRole="button">
      <Text style={styles.quickText}>{label}</Text>
    </Pressable>
  );
}

function GateNotice({ gate }: { gate: 'no_school' | 'unverified' | 'no_program' }) {
  const router = useRouter();
  const copy =
    gate === 'no_program'
      ? { title: 'Pick your program', body: 'Your program names your house — pick it to rank against every Heir of it.', cta: 'Pick my program', route: '/house/change-program?ceremony=1' }
      : gate === 'unverified'
        ? { title: 'Verify your campus email', body: 'My Uni boards are for verified students.', cta: 'Verify', route: '/campus' }
        : { title: 'Add your university', body: 'Tell us where you study to see your school’s board.', cta: 'Add school', route: '/campus' };
  return (
    <View style={styles.gate}>
      <Text style={styles.gateTitle}>{copy.title}</Text>
      <Text style={styles.gateBody}>{copy.body}</Text>
      <Pressable style={styles.gateBtn} onPress={() => router.push(copy.route as never)} accessibilityRole="button">
        <Text style={styles.gateBtnText}>{copy.cta}</Text>
      </Pressable>
    </View>
  );
}

function MetricPicker({
  visible,
  catalog,
  selectedKey,
  onPick,
  onClose,
}: {
  visible: boolean;
  catalog: MetricCatalogRow[];
  selectedKey: string;
  onPick: (row: MetricCatalogRow) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Grouped by the catalog's own group labels, in catalog order — the 26-stat library (mock 293).
  const groups = useMemo(() => {
    const out: { label: string; rows: MetricCatalogRow[] }[] = [];
    for (const r of [...catalog].sort((a, b) => a.sort - b.sort)) {
      const g = out.find((x) => x.label === r.group_label);
      if (g) g.rows.push(r);
      else out.push({ label: r.group_label, rows: [r] });
    }
    return out;
  }, [catalog]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={styles.sheetTitle}>Rank by</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {groups.map((g) => (
              <View key={g.label}>
                <Text style={styles.sheetGroup}>{g.label}</Text>
                {g.rows.map((r) => {
                  const on = r.key === selectedKey;
                  return (
                    <Pressable
                      key={r.key}
                      style={[styles.sheetRow, on && styles.sheetRowOn]}
                      onPress={() => onPick(r)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}>
                      <Text style={styles.sheetEmoji}>{r.emoji}</Text>
                      <Text style={[styles.sheetLabel, on && styles.sheetLabelOn]}>{r.label}</Text>
                      {on ? <Ionicons name="checkmark" size={16} color={Colors.navEmber} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  title: {
    fontFamily: Fonts.black,
    fontSize: 22,
    color: Colors.ink,
  },
  scope: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    padding: 3,
    borderRadius: 12,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  scopeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 9,
  },
  scopeBtnOn: {
    backgroundColor: Colors.spacePanel2,
  },
  scopeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12.5,
    color: Colors.spaceDim,
  },
  scopeTextOn: {
    color: Colors.navEmber2,
  },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  metric: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 11,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  metricText: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: Colors.ink,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 11,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  liveOn: {
    backgroundColor: 'rgba(57,217,138,0.14)',
    borderColor: '#39D98A',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#39D98A',
  },
  liveText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.spaceDim,
  },
  liveTextOn: {
    color: '#39D98A',
  },
  presenceDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#39D98A',
    borderWidth: 2,
    borderColor: Colors.spacePanel,
  },
  presenceDotOnline: {
    backgroundColor: '#2A8A5C',
  },
  quick: {
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 11,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  quickText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 12,
    color: Colors.legend,
  },
  list: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.five,
    gap: 6,
  },
  loader: {
    marginTop: Spacing.five,
  },
  empty: {
    marginTop: Spacing.five,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  // Wearing a flare: the outline thickens and glows in it (borderColor/shadowColor set per row).
  rowWorn: {
    borderWidth: 1.5,
    shadowOpacity: 0.55,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  // You, on top of whatever you wear: a heavier edge, so your row is findable at a scroll.
  rowMe: {
    borderWidth: 2,
  },
  // The equipped card's tint, behind everything in the row.
  tint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 15,
  },
  halo: {
    position: 'absolute',
    left: (40 - HALO) / 2,
    top: (40 - HALO) / 2,
  },
  avatarRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    fontStyle: 'italic',
  },
  rowTitleEarned: {
    color: Colors.gold,
    fontStyle: 'normal',
  },
  rank: {
    width: 24,
    textAlign: 'center',
    fontFamily: Fonts.black,
    fontSize: 15,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  who: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  name: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  identity: {
    color: Colors.spaceDim,
  },
  value: {
    fontFamily: Fonts.displayHeavy,
    fontSize: 14,
    color: Colors.ink,
  },
  gate: {
    margin: Spacing.three,
    padding: Spacing.three,
    borderRadius: 14,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    gap: 6,
  },
  gateTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
  },
  gateBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.spaceDim,
  },
  gateBtn: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.navEmber,
  },
  gateBtnText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: '#2A0F05',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(6,4,14,0.6)',
  },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: Colors.spacePanel,
    borderTopWidth: 1,
    borderColor: Colors.spaceLine,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  sheetTitle: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
    marginBottom: Spacing.two,
  },
  sheetGroup: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: Colors.spaceFaint,
    marginTop: Spacing.three,
    marginBottom: 4,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  sheetRowOn: {
    backgroundColor: Colors.spacePanel2,
  },
  sheetEmoji: {
    fontSize: 16,
    width: 22,
    textAlign: 'center',
  },
  sheetLabel: {
    flex: 1,
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.spaceDim,
  },
  sheetLabelOn: {
    color: Colors.ink,
  },
});
